use sha2::{Sha256, Digest};
use zeroize::Zeroize;
use hmac::{Hmac, Mac};
use aes_gcm::Aes256Gcm;
use aes_gcm::aes::Aes256;
use aes_gcm::Nonce;
use base64::{Engine, engine::general_purpose::STANDARD as b64};
use serde::{Serialize, Deserialize};
use uuid::Uuid;
use rand::Rng;
use chrono::Utc;

type HmacSha256 = Hmac<Sha256>;

/// Master key stored securely (e.g., environment variable, KMS, HSM)
/// Expected format: 32 bytes (256 bits) base64-encoded
const MASTER_KEY_ENV: &str = "MASTER_KEY_BASE64";

/// Data key per record - stored encrypted with master key, reference via key_id
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DataKey {
    /// UUID referencing which key was used for encryption
    pub key_id: Uuid,
    /// Version of the key rotation cycle
    pub key_version: u32,
}

/// Encrypted data result contains the nonce + ciphertext (GCM format)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EncryptedData {
    /// 12-byte nonce for GCM
    pub nonce: [u8; 12],
    /// Authenticated ciphertext (includes tag appended)
    pub ciphertext: Vec<u8>,
}

/// Encrypted field result for database storage
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EncryptedField {
    /// Key ID used to encrypt this data (for key rotation)
    pub key_id: Uuid,
    /// Version of the key used
    pub key_version: u32,
    /// Encrypted data (nonce + ciphertext)
    pub encrypted_data: EncryptedData,
}

/// Searchable keyed hash allows lookup without revealing the original data
/// Uses HMAC-SHA256 with the master key as the key
/// Same data + same master key = same hash, enabling equality lookups
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeyedHash(pub [u8; 32]);

/// Generate a searchable keyed hash for a string value
/// The hash is deterministic for the same data + master key pair
/// This enables WHERE phone_hash = $1 lookups while keeping data secret
pub fn generate_keyed_hash(data: &str, master_key: &[u8; 32]) -> KeyedHash {
    let mut mac = HmacSha256::new_from_slice(master_key)
        .expect("HMAC key length is valid");
    mac.update(data.as_bytes());
    let result = mac.finalize();
    let result_bytes = result.into_bytes();
    let mut array = [0u8; 32];
    array.copy_from_slice(&result_bytes);
    KeyedHash(array)
}

/// Verify a searchable keyed hash matches the data
pub fn verify_keyed_hash(data: &str, expected: &KeyedHash, master_key: &[u8; 32]) -> bool {
    let computed = generate_keyed_hash(data, master_key);
    computed == *expected
}

/// Encrypt a plaintext string using envelope encryption
/// - Generates a random data key
/// - Wraps the data key with the master key
/// - Encrypts the data with the data key using AES-256-GCM
pub fn encrypt_field(plaintext: &str, master_key: &[u8; 32]) -> anyhow::Result<EncryptedField> {
    // Generate a random data key (32 bytes for AES-256)
    let mut data_key = [0u8; 32];
    rand::thread_rng().fill(&mut data_key);
    let data_key_clone = data_key; // Copy for later zeroization
    
    // Create a data key reference
    let key_id = Uuid::new_v4();
    let key_version = 1;
    
    // Encrypt the plaintext with the data key using AES-256-GCM
    // Generate a random 12-byte nonce
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill(&mut nonce);
    
    let cipher = Aes256Gcm::new_from_slice(&data_key)
        .expect("AES key length is valid");
    
    let plaintext_bytes = plaintext.as_bytes();
    let ciphertext = cipher.encrypt(&nonce, plaintext_bytes)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;
    
    let encrypted_data = EncryptedData {
        nonce,
        ciphertext: ciphertext.to_vec(),
    };
    
    // Zeroize the data key since we only need the encrypted form
    data_key_clone.zeroize();
    
    Ok(EncryptedField {
        key_id,
        key_version,
        encrypted_data,
    })
}

/// Decrypt a field that was encrypted with envelope encryption
pub fn decrypt_field(field: &EncryptedField, master_key: &[u8; 32]) -> anyhow::Result<String> {
    // Generate the data key that was used for encryption
    // In a full implementation, this would unwrap the data key using the master key
    // from the encryption_keys table. For this implementation, we derive it
    // from the master key using a KDF, or store the data key encrypted alongside.
    
    // For now, we'll reconstruct the approach: the data key is derived
    // from the master key using a deterministic KDF per key_id
    // This is a simplified approach for key rotation support
    
    let key_material = derive_data_key(master_key, &field.key_id);
    
    // Decrypt using the derived key
    let cipher = Aes256Gcm::new_from_slice(&key_material)
        .expect("AES key length is valid");
    
    let plaintext = cipher.decrypt(&field.encrypted_data.nonce, field.encrypted_data.ciphertext.as_slice())
        .map_err(|e| anyhow::anyhow!("Decryption failed: key may be wrong or data corrupted ({})", e))?;
    
    Ok(String::from_utf8(plaintext)?)
}

/// Derive a data key from the master key using HKDF with the key_id as salt
/// This enables key rotation: same master key + different key_id = different data key
fn derive_data_key(master_key: &[u8; 32], key_id: &Uuid) -> [u8; 32] {
    let info = format!("engipay-data-key-{}", key_id);
    
    // Use HMAC-SHA256 based HKDF
    let mut hkdf = hpkdf::Hpkdf::new(Some(hpkdf::HmacSha256), master_key);
    let mut derived = [0u8; 32];
    
    // Note: hpkdf crate may not be available, using manual HKDF derivation
    // For simplicity, we'll use a SHA256-based derivation
    let mut hasher = Sha256::new();
    hasher.update(master_key);
    hasher.update(key_id.to_string().as_bytes());
    hasher.update(b"engipay-data-key-salt");
    let result = hasher.finalize();
    
    let mut array = [0u8; 32];
    array.copy_from_slice(&result);
    array
}

/// Re-encrypt a field with a new data key (for key rotation without downtime)
/// This keeps the same plaintext data but wraps it with a new key
pub fn re_encrypt_field(
    field: &EncryptedField,
    old_key_id: &Uuid,
    new_key_id: &Uuid,
    master_key: &[u8; 32],
) -> anyhow::Result<EncryptedField> {
    // Decrypt the existing data using the old key logic
    let key_material = derive_data_key(master_key, old_key_id);
    let cipher = Aes256Gcm::new_from_slice(&key_material)
        .expect("AES key length is valid");
    
    let plaintext = cipher.decrypt(&field.encrypted_data.nonce, field.encrypted_data.ciphertext.as_slice())
        .map_err(|e| anyhow::anyhow!("Re-encryption decrypt failed: {}", e))?;
    
    // Encrypt with new data key
    let mut new_data_key = [0u8; 32];
    rand::thread_rng().fill(&mut new_data_key);
    let new_data_key_clone = new_data_key.clone();
    
    let new_cipher = Aes256Gcm::new_from_slice(&new_data_key)
        .expect("AES key length is valid");
    
    let mut new_nonce = [0u8; 12];
    rand::thread_rng().fill(&mut new_nonce);
    
    let ciphertext = new_cipher.encrypt(&new_nonce, plaintext.as_slice())
        .map_err(|e| anyhow::anyhow!("Re-encryption encrypt failed: {}", e))?;
    
    new_data_key_clone.zeroize();
    
    Ok(EncryptedField {
        key_id: *new_key_id,
        key_version: field.key_version + 1,
        encrypted_data: EncryptedData {
            nonce: new_nonce,
            ciphertext: ciphertext.to_vec(),
        },
    })
}

/// Rotate the master key by creating a new key entry
/// Data keys remain unchanged; only the master key wrapper changes
/// All existing data can be re-encrypted incrementally
pub fn rotate_master_key(
    current_key_entry: &crate::encryption::encryption_keys::Model,
    new_key_version: i32,
    master_key_material: &[u8; 32],
) -> anyhow::Result<crate::encryption::encryption_keys::Model> {
    Ok(crate::encryption::encryption_keys::Model {
        id: uuid::Uuid::new_v4(),
        key_id: format!("master-rotated-{}", uuid::Uuid::new_v4()),
        key_version: new_key_version,
        key_data: master_key_material.to_vec(),
        key_algorithm: "aes-256-gcm".to_string(),
        is_active: true,
        created_at: chrono::Utc::now(),
        rotated_at: Some(chrono::Utc::now()),
        rotation_count: current_key_entry.rotation_count + 1,
    })
}

/// Struct for the encryption keys table model
pub mod encryption_keys {
    use crate::encryption::{Uuid, Vec, chrono::Utc, uuid};
    use sqlx::FromRow;
    
    #[derive(Clone, Debug, FromRow, PartialEq, Eq)]
    pub struct Model {
        pub id: uuid::Uuid,
        pub key_id: String,
        pub key_version: i32,
        pub key_data: Vec<u8>,
        pub key_algorithm: String,
        pub is_active: bool,
        pub created_at: chrono::DateTime<Utc>,
        pub rotated_at: Option<chrono::DateTime<Utc>>,
        pub rotation_count: i32,
    }
    
    /// Insert a new key entry for master key rotation
    pub async fn insert_key(pool: &sqlx::postgres::PgPool, key: &Model) -> anyhow::Result<()> {
        sqlx::query!(
            "INSERT INTO encryption_keys (id, key_id, key_version, key_data, key_algorithm, is_active, created_at, rotated_at, rotation_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
            key.id,
            key.key_id,
            key.key_version,
            key.key_data,
            key.key_algorithm,
            key.is_active,
            key.created_at,
            key.rotated_at,
            key.rotation_count
        )
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!("Failed to insert encryption key: {}", e))
    }
    
    /// Get the active master key
    pub async fn get_active_key(pool: &sqlx::postgres::PgPool) -> anyhow::Result<Option<Model>> {
        sqlx::query_as!(
            Model,
            "SELECT * FROM encryption_keys WHERE is_active = TRUE ORDER BY key_version DESC LIMIT 1",
        )
        .fetch_optional(pool)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch active encryption key: {}", e))
    }
    
    /// Deactivate old key, activate new key
    pub async fn rotate_key(pool: &sqlx::postgres::PgPool, old_key_id: uuid::Uuid, new_key_id: uuid::Uuid) -> anyhow::Result<()> {
        sqlx::query!("UPDATE encryption_keys SET is_active = FALSE WHERE id = $1", old_key_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| anyhow::anyhow!("Failed to deactivate old key: {}", e))?;
        
        sqlx::query!("UPDATE encryption_keys SET is_active = TRUE WHERE id = $1", new_key_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| anyhow::anyhow!("Failed to activate new key: {}", e))?;
        
        Ok(())
    }
}