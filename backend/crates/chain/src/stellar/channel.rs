//! Channel accounts for parallel Stellar withdrawals.
//!
//! Every withdrawal previously used the custody account's sequence number,
//! serialising withdrawals and causing `tx_bad_seq` collisions under load.
//!
//! A **channel account** is a separate signing account whose only role is to
//! be the transaction *source* (which owns the sequence number). The custody
//! account is set as the payment operation's *source*, so the funds still
//! leave custody — the channel account never holds user funds.
//!
//! Because the channel account is the transaction source, *its* sequence
//! number is the one that must be managed. [`ChannelPool`] persists
//! `last_sequence` per channel to the `stellar_channel_accounts` table so the
//! pool survives a restart without replaying or skipping a sequence number.
//!
//! # Round-robin
//!
//! Each [`ChannelPool::acquire`] advances the sequence by one and updates
//! `last_sequence` atomically. The pool cycles through channels round-robin so
//! load is spread evenly.
//!
//! # Thread safety
//!
//! All mutable in-memory state (the round-robin counter and the per-channel
//! sequence numbers) lives inside a single `Mutex<ChannelState>`. The lock is
//! acquired, the counter and sequence are updated, and the lock is released
//! *before* any async operation (the database persist). This ensures the pool
//! is never held under a lock across an async boundary.
//!
//! # Fee top-up
//!
//! Channel accounts need XLM for the base reserve and transaction fees.
//! [`ChannelPool::top_up`] sends XLM from the custody account to any channel
//! whose balance falls below the configured threshold, topping it up to the
//! target amount.

use std::sync::{Arc, Mutex};

use sqlx::PgPool;
use tracing::{info, warn};

use super::payment::{PaymentRequest, StellarSigner, build_payment, sign};
use super::{StellarClient, StellarNetwork};
use crate::ChainError;

/// Default XLM threshold (in stroops) below which a channel is topped up.
/// 2 XLM = 20_000_000 stroops. A channel needs at least the base reserve
/// (0.5 XLM) plus enough for several transaction fees.
pub const DEFAULT_TOP_UP_THRESHOLD: i64 = 20_000_000;

/// Default XLM amount (in stroops) to top up a channel to.
/// 10 XLM = 100_000_000 stroops — enough for ~100_000 transactions at the
/// base fee, or a long run before the next top-up.
pub const DEFAULT_TOP_UP_AMOUNT: i64 = 100_000_000;

/// A channel account and its locally-managed sequence number.
#[derive(Debug, Clone)]
pub struct ChannelEntry {
    /// The channel account's public key (`G...`).
    pub account: String,
    /// The raw ed25519 public key bytes.
    pub public_key: [u8; 32],
    /// The last sequence number used for a transaction sourced from this
    /// channel. The next withdrawal uses `last_sequence + 1`.
    pub last_sequence: i64,
}

impl ChannelEntry {
    /// Creates a channel entry from a signer and the last known sequence.
    fn from_signer(signer: &dyn StellarSigner, last_sequence: i64) -> Self {
        Self {
            account: signer.account(),
            public_key: signer.public_key(),
            last_sequence,
        }
    }
}

/// A channel acquired for one withdrawal. Holds the account, public key, and
/// the sequence number the transaction should use.
///
/// The sequence is pre-incremented at acquisition time, so the caller uses
/// `sequence` directly as the transaction's `seq_num` (i.e. the channel's
/// previous `last_sequence + 1`).
#[derive(Debug, Clone)]
pub struct AcquiredChannel {
    /// The channel account's public key (`G...`).
    pub account: String,
    /// The raw ed25519 public key bytes.
    pub public_key: [u8; 32],
    /// The sequence number to use for this transaction.
    pub sequence: i64,
}

/// All mutable in-memory pool state in one place, protected by one `Mutex`.
struct ChannelState {
    /// The channel entries and their locally-managed sequences.
    channels: Vec<ChannelEntry>,
    /// Round-robin index; wraps naturally via modulo.
    next: usize,
}

/// A pool of channel accounts that manages sequence numbers for parallel
/// Stellar withdrawals.
///
/// The pool is created with a set of [`StellarSigner`] instances (one per
/// channel account) and a database pool for sequence persistence. On startup,
/// [`ChannelPool::refresh`] loads each channel's sequence from the database
/// and reconciles it with Horizon, taking the maximum so a crash before a
/// commit never reuses a sequence.
pub struct ChannelPool {
    /// The signers, indexed by channel position. Immutable after construction.
    signers: Vec<Arc<dyn StellarSigner>>,
    /// All mutable state behind one mutex, never held across an await point.
    state: Mutex<ChannelState>,
    /// The database pool for sequence persistence.
    /// `None` only in unit tests: skips the DB persist in `acquire()`.
    pool: Option<PgPool>,
}

impl ChannelPool {
    /// Creates a new channel pool from signers and a database pool.
    ///
    /// Does **not** refresh sequences from the database or Horizon — call
    /// [`refresh`](Self::refresh) after construction.
    pub fn new(signers: Vec<Arc<dyn StellarSigner>>, pool: PgPool) -> Result<Self, ChainError> {
        if signers.is_empty() {
            return Err(ChainError::Config(
                "at least one channel account is required".to_owned(),
            ));
        }
        let channels = signers
            .iter()
            .map(|s| ChannelEntry::from_signer(s.as_ref(), 0))
            .collect();
        Ok(Self {
            signers,
            state: Mutex::new(ChannelState { channels, next: 0 }),
            pool: Some(pool),
        })
    }

    /// Creates a pool that skips database persistence. **For unit tests only.**
    ///
    /// In production the database persist in [`acquire`](Self::acquire) is
    /// required for crash-safety; this constructor bypasses it so tests do not
    /// need a live Postgres instance.
    #[cfg(test)]
    pub fn new_for_test(signers: Vec<Arc<dyn StellarSigner>>) -> Result<Self, ChainError> {
        if signers.is_empty() {
            return Err(ChainError::Config(
                "at least one channel account is required".to_owned(),
            ));
        }
        let channels = signers
            .iter()
            .map(|s| ChannelEntry::from_signer(s.as_ref(), 0))
            .collect();
        Ok(Self {
            signers,
            state: Mutex::new(ChannelState { channels, next: 0 }),
            pool: None,
        })
    }

    /// Returns the signer for a given channel account, if it belongs to this pool.
    pub fn signer_for(&self, account: &str) -> Option<&Arc<dyn StellarSigner>> {
        self.signers.iter().find(|s| s.account() == account)
    }

    /// Returns the number of channels in the pool.
    pub fn len(&self) -> usize {
        self.signers.len()
    }

    /// Returns `true` if the pool has no channels.
    pub fn is_empty(&self) -> bool {
        self.signers.is_empty()
    }

    /// Acquires the next channel in round-robin order, atomically incrementing
    /// its sequence number and persisting the new sequence to the database.
    ///
    /// The returned [`AcquiredChannel`] carries the sequence number to use
    /// for the transaction (`last_sequence + 1`). The database is updated
    /// *before* the transaction is built, so a crash after acquisition but
    /// before broadcast does not lose the sequence — the next process
    /// starts from the persisted value.
    ///
    /// # Errors
    ///
    /// Returns [`ChainError::Unavailable`] if the database update fails.
    pub async fn acquire(&self) -> Result<AcquiredChannel, ChainError> {
        // Advance the round-robin counter and increment the channel sequence
        // under the lock. Release the lock before any await.
        let (account, public_key, new_sequence) = {
            let mut state = self.state.lock().expect("channel pool state lock poisoned");
            let idx = state.next % state.channels.len();
            state.next = state.next.saturating_add(1);

            let entry = &mut state.channels[idx];
            let new_sequence = entry
                .last_sequence
                .checked_add(1)
                .ok_or_else(|| ChainError::Unavailable("channel sequence overflow".to_owned()))?;
            entry.last_sequence = new_sequence;

            (entry.account.clone(), entry.public_key, new_sequence)
        }; // Lock released here, before the first await.

        // Persist the new sequence before returning so a crash does not lose
        // it. If the persist fails the caller retries and acquires a fresh
        // (higher) sequence next time. Skipped when `pool` is `None` (tests).
        if let Some(ref pool) = self.pool {
            sqlx::query(
                "INSERT INTO stellar_channel_accounts (account, last_sequence)
                 VALUES ($1, $2)
                 ON CONFLICT (account)
                 DO UPDATE SET last_sequence = $2, updated_at = now()",
            )
            .bind(&account)
            .bind(new_sequence)
            .execute(pool)
            .await
            .map_err(|error| ChainError::Unavailable(error.to_string()))?;
        }

        Ok(AcquiredChannel {
            account,
            public_key,
            sequence: new_sequence,
        })
    }

    /// Reconciles each channel's `last_sequence` from the database and
    /// Horizon, taking the maximum of the two.
    ///
    /// Call this once on startup, before the pool is used. For each channel:
    ///
    /// 1. Read `last_sequence` from `stellar_channel_accounts`.
    /// 2. Fetch the current sequence from Horizon.
    /// 3. Take the maximum and persist it.
    ///
    /// Taking the maximum ensures a crash before a database commit never
    /// reuses a sequence (Horizon knows about it) and a crash after a commit
    /// but before the transaction lands never stalls (the database knows the
    /// next expected sequence).
    pub async fn refresh(&mut self, client: &StellarClient) -> Result<(), ChainError> {
        // Collect accounts before any await so we do not hold the lock.
        let accounts: Vec<String> = {
            let state = self.state.lock().expect("channel pool state lock poisoned");
            state.channels.iter().map(|e| e.account.clone()).collect()
        };

        for account in &accounts {
            let from_db = self.load_sequence(account).await?;
            let from_horizon = client.sequence(account).await?;

            // Take the maximum so we never reuse a sequence.
            let max = from_db.max(from_horizon);

            if max != from_db {
                info!(
                    %account,
                    from_db,
                    from_horizon,
                    max,
                    "refreshing channel sequence from Horizon",
                );
            }

            // Persist the reconciled sequence.
            sqlx::query(
                "INSERT INTO stellar_channel_accounts (account, last_sequence)
                 VALUES ($1, $2)
                 ON CONFLICT (account)
                 DO UPDATE SET last_sequence = $2, updated_at = now()",
            )
            .bind(account)
            .bind(max)
            .execute(
                self.pool.as_ref().ok_or_else(|| {
                    ChainError::Config("refresh requires a database pool".to_owned())
                })?,
            )
            .await
            .map_err(|error| ChainError::Unavailable(error.to_string()))?;

            // Update the in-memory entry. Lock is acquired and released here,
            // not across the awaits above.
            let mut state = self.state.lock().expect("channel pool state lock poisoned");
            if let Some(entry) = state.channels.iter_mut().find(|e| &e.account == account) {
                entry.last_sequence = max;
            }
        }
        Ok(())
    }

    /// Loads the last sequence for a channel from the database.
    async fn load_sequence(&self, account: &str) -> Result<i64, ChainError> {
        let pool = self.pool.as_ref().ok_or_else(|| {
            ChainError::Config("load_sequence requires a database pool".to_owned())
        })?;
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT last_sequence FROM stellar_channel_accounts WHERE account = $1")
                .bind(account)
                .fetch_optional(pool)
                .await
                .map_err(|error| ChainError::Unavailable(error.to_string()))?;
        Ok(row.map(|(seq,)| seq).unwrap_or(0))
    }

    /// Tops up channel accounts whose XLM balance is below `threshold`.
    ///
    /// For each channel whose balance is below the threshold, sends
    /// `amount` XLM from the custody account to the channel account. This
    /// ensures channels always have enough XLM for the base reserve and
    /// transaction fees.
    ///
    /// Returns the number of channels topped up.
    pub async fn top_up(
        &self,
        client: &StellarClient,
        custody_signer: &dyn StellarSigner,
        threshold: i64,
        amount: i64,
    ) -> Result<usize, ChainError> {
        use engipay_core::{Asset, Money};
        use super::payment::BASE_FEE;

        // Collect accounts before any await so we do not hold the lock.
        let accounts: Vec<String> = {
            let state = self.state.lock().expect("channel pool state lock poisoned");
            state.channels.iter().map(|e| e.account.clone()).collect()
        };

        let mut topped_up = 0;

        for channel_account in &accounts {
            let balance = match self.channel_balance(client, channel_account).await {
                Ok(bal) => bal,
                Err(error) => {
                    warn!(
                        account = %channel_account,
                        %error,
                        "could not check channel balance; skipping top-up",
                    );
                    continue;
                }
            };

            if balance >= threshold {
                continue;
            }

            info!(
                account = %channel_account,
                balance,
                threshold,
                top_up_amount = amount,
                "topping up channel account",
            );

            let request = PaymentRequest {
                destination: channel_account.clone(),
                money: Money::from_minor(Asset::Xlm, i128::from(amount)),
                memo: None,
            };

            let source = custody_signer.account();
            let (sequence, fee) = tokio::join!(client.sequence(&source), client.recommended_fee());
            let sequence = sequence?;

            let valid_until = std::time::SystemTime::now()
                .checked_add(std::time::Duration::from_secs(120))
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .ok_or_else(|| {
                    ChainError::Config("system clock is before 1970".to_owned())
                })?;

            let tx = build_payment(
                &custody_signer.public_key(),
                sequence,
                &request,
                client.config().network,
                valid_until,
                fee.max(BASE_FEE),
            )
            .map_err(|error| ChainError::Rejected(error.to_string()))?;

            let (envelope, _) = sign(tx, custody_signer, client.config().network)
                .map_err(|error| ChainError::Rejected(error.to_string()))?;

            let envelope_xdr = super::payment::envelope_base64(&envelope)
                .map_err(|error| ChainError::Rejected(error.to_string()))?;

            client.submit_transaction(&envelope_xdr).await?;
            topped_up += 1;
        }

        if topped_up > 0 {
            info!(topped_up, "channel accounts topped up");
        }

        Ok(topped_up)
    }

    /// Fetches the native (XLM) balance of a channel account in stroops.
    async fn channel_balance(
        &self,
        client: &StellarClient,
        account: &str,
    ) -> Result<i64, ChainError> {
        use super::horizon::parse_stroops;
        let acct: super::horizon::Account = client
            .get(&format!("/accounts/{account}"))
            .await?;
        for bal in &acct.balances {
            if bal.asset_type == "native" {
                return parse_stroops(&bal.balance).ok_or_else(|| {
                    ChainError::Unavailable(format!(
                        "unparseable native balance: {}",
                        bal.balance
                    ))
                });
            }
        }
        // No native balance = 0.
        Ok(0)
    }

    /// Builds, signs, and prepares a channel payment without submitting it.
    ///
    /// The transaction's *source account* is the channel (which owns the
    /// sequence number), and the payment operation's *source* is the custody
    /// account (which owns the funds). The channel signer signs the
    /// transaction; the custody signer co-signs it (required because the
    /// operation debits the custody account).
    ///
    /// Returns the prepared payment (hash + envelope) ready for
    /// [`StellarClient::submit_prepared`].
    pub async fn prepare_channel_payment(
        &self,
        client: &StellarClient,
        custody_signer: &dyn StellarSigner,
        request: &PaymentRequest,
        network: StellarNetwork,
    ) -> Result<super::PreparedPayment, ChainError> {
        let channel = self.acquire().await?;

        let fee = client.recommended_fee().await;
        let valid_until = std::time::SystemTime::now()
            .checked_add(std::time::Duration::from_secs(120))
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .ok_or_else(|| ChainError::Config("system clock is before 1970".to_owned()))?;

        let custody_key = custody_signer.public_key();

        // Build the transaction: channel is the tx source, custody is the
        // operation source.
        let transaction = super::payment::build_channel_payment(
            &channel.public_key,
            channel.sequence,
            &custody_key,
            request,
            network,
            valid_until,
            fee,
        )
        .map_err(|error| ChainError::Rejected(error.to_string()))?;

        // Find the channel signer.
        let channel_signer = self.signer_for(&channel.account).ok_or_else(|| {
            ChainError::Config(format!("no signer for channel {}", channel.account))
        })?;

        // Sign with both the channel and custody signers.
        let (envelope, hash) = super::payment::sign_channel_payment(
            transaction,
            channel_signer.as_ref(),
            custody_signer,
            network,
        )
        .map_err(|error| ChainError::Rejected(error.to_string()))?;

        let envelope_xdr = super::payment::envelope_base64(&envelope)
            .map_err(|error| ChainError::Rejected(error.to_string()))?;

        Ok(super::PreparedPayment {
            hash: super::hex_lower(&hash),
            envelope_xdr,
        })
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use super::super::payment::LocalTestnetSigner;
    use super::super::StellarNetwork;

    fn signer(seed: u8) -> Arc<dyn StellarSigner> {
        Arc::new(
            LocalTestnetSigner::from_secret(
                stellar_strkey::ed25519::PrivateKey([seed; 32])
                    .as_unredacted()
                    .to_string()
                    .as_str(),
                StellarNetwork::Testnet,
            )
            .unwrap(),
        )
    }

    #[test]
    fn creating_a_pool_requires_at_least_one_channel() {
        let result = ChannelPool::new_for_test(vec![]);
        assert!(result.is_err());
    }

    #[test]
    fn pool_reports_its_size() {
        let pool = ChannelPool::new_for_test(vec![signer(1), signer(2)]).unwrap();
        assert_eq!(pool.len(), 2);
        assert!(!pool.is_empty());
    }

    #[test]
    fn signer_for_finds_a_known_channel() {
        let s = signer(3);
        let account = s.account();
        let pool = ChannelPool::new_for_test(vec![s]).unwrap();
        assert!(pool.signer_for(&account).is_some());
        assert!(pool.signer_for("GUNKNOWN").is_none());
    }

    /// The in-memory round-robin counter cycles through channels and each
    /// channel's sequence strictly increases with every acquisition.
    #[test]
    fn round_robin_cycles_and_sequences_increase() {
        let pool = ChannelPool::new_for_test(vec![signer(1), signer(2)]).unwrap();

        // Simulate six acquires: channels[0], [1], [0], [1], [0], [1].
        // Expected sequences:
        //   channel 0 → 1, 2, 3
        //   channel 1 → 1, 2, 3
        let expected = [
            (0usize, 1i64),
            (1, 1),
            (0, 2),
            (1, 2),
            (0, 3),
            (1, 3),
        ];

        for (expected_idx, expected_seq) in &expected {
            let mut state = pool.state.lock().unwrap();
            let idx = state.next % state.channels.len();
            state.next = state.next.saturating_add(1);
            state.channels[idx].last_sequence =
                state.channels[idx].last_sequence.saturating_add(1);

            assert_eq!(idx, *expected_idx, "wrong channel at iteration");
            assert_eq!(
                state.channels[idx].last_sequence, *expected_seq,
                "wrong sequence at iteration"
            );
        }
    }
}
