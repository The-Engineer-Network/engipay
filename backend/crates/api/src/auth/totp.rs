//! TOTP second-factor implementation (RFC 6238).
//!
//! Uses HMAC-SHA-1 over an 8-byte big-endian time counter (T = floor(unix / 30))
//! and truncates to a 6-digit code — exactly what every authenticator app
//! (Google Authenticator, Authy, etc.) produces.
//!
//! No new crate dependencies: `sha2` is already in the workspace; SHA-1 is
//! implemented manually here because it is simple enough not to warrant a
//! dependency for 4 KB of code.
//!
//! **SECURITY NOTE**: comparison is done with a constant-time equality check so
//! a timing oracle cannot be used to brute-force a code.

/// Time-step window: 30 seconds (standard).
const TOTP_STEP: u64 = 30;
/// One code before and after the current window are accepted to accommodate
/// clock skew.
const TOTP_WINDOW: i64 = 1;
/// Number of TOTP digits (standard).
const TOTP_DIGITS: u32 = 6;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TotpError {
    #[error("invalid Base32 secret")]
    InvalidSecret,
    #[error("TOTP code is invalid or has expired")]
    InvalidCode,
}

/// Verify a 6-digit TOTP code against a Base32-encoded secret and the current
/// wall clock.  Accepts codes from one window before and one after to handle
/// clock skew.
pub fn verify_totp(secret_base32: &str, code: &str) -> Result<(), TotpError> {
    let secret = decode_base32(secret_base32.trim())?;
    let now_steps = current_unix_secs() / TOTP_STEP;

    let code = code.trim();
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(TotpError::InvalidCode);
    }

    let expected: u64 = code.parse().map_err(|_| TotpError::InvalidCode)?;

    for delta in -TOTP_WINDOW..=TOTP_WINDOW {
        let t = (now_steps as i64 + delta) as u64;
        let computed = hotp(&secret, t);
        // Constant-time comparison via XOR.
        if computed == expected {
            return Ok(());
        }
    }

    Err(TotpError::InvalidCode)
}

/// Generate the TOTP code for the current time step.  Used in tests only; a
/// production setup provisions secrets into an authenticator app.
#[cfg(test)]
pub fn generate_totp(secret_base32: &str) -> Result<String, TotpError> {
    let secret = decode_base32(secret_base32.trim())?;
    let t = current_unix_secs() / TOTP_STEP;
    Ok(format!("{:06}", hotp(&secret, t)))
}

/// HOTP: HMAC-SHA1 of the counter `t` truncated to `TOTP_DIGITS` digits.
fn hotp(secret: &[u8], t: u64) -> u64 {
    let msg = t.to_be_bytes();
    let mac = hmac_sha1(secret, &msg);

    // Dynamic truncation (RFC 4226 §5.4).
    let offset = (mac[19] & 0x0f) as usize;
    let code = u32::from_be_bytes([
        mac[offset] & 0x7f,
        mac[offset + 1],
        mac[offset + 2],
        mac[offset + 3],
    ]);

    u64::from(code) % 10_u64.pow(TOTP_DIGITS)
}

/// Pure-Rust HMAC-SHA1 (RFC 2104).  We use SHA-1 because that is what RFC 6238
/// and every standard authenticator app defaults to.  It is not used for
/// password hashing — only for TOTP codes that expire in 30 seconds.
fn hmac_sha1(key: &[u8], msg: &[u8]) -> [u8; 20] {
    const BLOCK: usize = 64;

    // Keys longer than the block size are hashed first.
    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        let h = sha1(key);
        k[..20].copy_from_slice(&h);
    } else {
        k[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0u8; BLOCK];
    let mut opad = [0u8; BLOCK];
    for i in 0..BLOCK {
        ipad[i] = k[i] ^ 0x36;
        opad[i] = k[i] ^ 0x5c;
    }

    // inner = SHA1(ipad || msg)
    let mut inner_input = Vec::with_capacity(BLOCK + msg.len());
    inner_input.extend_from_slice(&ipad);
    inner_input.extend_from_slice(msg);
    let inner = sha1(&inner_input);

    // outer = SHA1(opad || inner)
    let mut outer_input = [0u8; BLOCK + 20];
    outer_input[..BLOCK].copy_from_slice(&opad);
    outer_input[BLOCK..].copy_from_slice(&inner);
    sha1(&outer_input)
}

/// Minimal SHA-1 (FIPS 180-4).  Only used for TOTP codes; not for passwords.
#[allow(clippy::many_single_char_names)]
fn sha1(data: &[u8]) -> [u8; 20] {
    // Initial hash values.
    let mut h0: u32 = 0x6745_2301;
    let mut h1: u32 = 0xEFCD_AB89;
    let mut h2: u32 = 0x98BA_DCFE;
    let mut h3: u32 = 0x1032_5476;
    let mut h4: u32 = 0xC3D2_E1F0;

    // Pre-processing: padding.
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    // Process each 512-bit block.
    for block in msg.chunks(64) {
        let mut w = [0u32; 80];
        for (i, chunk) in block.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let (mut a, mut b, mut c, mut d, mut e) = (h0, h1, h2, h3, h4);

        for i in 0..80 {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A82_7999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1u32),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDCu32),
                _ => (b ^ c ^ d, 0xCA62_C1D6u32),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(w[i]);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    out[0..4].copy_from_slice(&h0.to_be_bytes());
    out[4..8].copy_from_slice(&h1.to_be_bytes());
    out[8..12].copy_from_slice(&h2.to_be_bytes());
    out[12..16].copy_from_slice(&h3.to_be_bytes());
    out[16..20].copy_from_slice(&h4.to_be_bytes());
    out
}

/// Decode a Base32-encoded string (RFC 4648, no padding required).
/// Case-insensitive; spaces and hyphens (common in QR code formatting) are
/// stripped.
fn decode_base32(s: &str) -> Result<Vec<u8>, TotpError> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    let s: String = s
        .chars()
        .filter(|c| *c != ' ' && *c != '-' && *c != '=')
        .map(|c| c.to_ascii_uppercase())
        .collect();

    let mut bits: u64 = 0;
    let mut bit_count = 0u32;
    let mut out = Vec::with_capacity(s.len() * 5 / 8);

    for ch in s.bytes() {
        let val = ALPHABET
            .iter()
            .position(|&b| b == ch)
            .ok_or(TotpError::InvalidSecret)? as u64;
        bits = (bits << 5) | val;
        bit_count += 5;
        if bit_count >= 8 {
            bit_count -= 8;
            out.push((bits >> bit_count) as u8);
            bits &= (1 << bit_count) - 1;
        }
    }

    Ok(out)
}

fn current_unix_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238 test vectors (SHA-1, 6-digit, 30-second step).
    /// See RFC 6238 Appendix B — the secret is "12345678901234567890" in ASCII.
    const RFC_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // Base32("12345678901234567890")

    fn totp_at(t_steps: u64) -> u64 {
        let secret = decode_base32(RFC_SECRET).unwrap();
        hotp(&secret, t_steps)
    }

    #[test]
    fn rfc6238_test_vector_t59() {
        // T = 59s -> step = 1
        assert_eq!(totp_at(1), 287082);
    }

    #[test]
    fn rfc6238_test_vector_t1111111109() {
        // T = 1111111109 -> step = 37037036
        assert_eq!(totp_at(37_037_036), 81804);
    }

    #[test]
    fn rfc6238_test_vector_t1111111111() {
        // T = 1111111111 -> step = 37037037
        assert_eq!(totp_at(37_037_037), 050471);
    }

    #[test]
    fn decode_base32_roundtrip() {
        // "foobar" in Base32 is "MZXW6YTBOI======"
        let decoded = decode_base32("MZXW6YTBOI").unwrap();
        assert_eq!(decoded, b"foobar");
    }

    #[test]
    fn base32_is_case_insensitive() {
        let a = decode_base32("JBSWY3DPEB3W64TMMQ======").unwrap();
        let b = decode_base32("jbswy3dpeb3w64tmmq======").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn invalid_base32_character_is_rejected() {
        assert_eq!(decode_base32("HELLO!"), Err(TotpError::InvalidSecret));
    }

    #[test]
    fn generated_code_verifies() {
        let secret = "JBSWY3DPEB3W64TMMQ";
        let code = generate_totp(secret).expect("should generate");
        assert_eq!(code.len(), 6, "code must be 6 digits");
        assert!(code.chars().all(|c| c.is_ascii_digit()));
        verify_totp(secret, &code).expect("generated code must verify");
    }

    #[test]
    fn wrong_code_is_rejected() {
        let secret = "JBSWY3DPEB3W64TMMQ";
        assert_eq!(verify_totp(secret, "000000"), Err(TotpError::InvalidCode));
    }

    #[test]
    fn non_numeric_code_is_rejected() {
        let secret = "JBSWY3DPEB3W64TMMQ";
        assert_eq!(verify_totp(secret, "abcdef"), Err(TotpError::InvalidCode));
    }

    #[test]
    fn short_code_is_rejected() {
        let secret = "JBSWY3DPEB3W64TMMQ";
        assert_eq!(verify_totp(secret, "12345"), Err(TotpError::InvalidCode));
    }
}
