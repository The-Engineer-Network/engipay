//! Fee-bumping a Stellar withdrawal that is stuck during surge pricing.
//!
//! A transaction sitting in the mempool because its fee fell behind the
//! market can be *fee-bumped*: a new outer transaction wraps the original
//! signed envelope and offers a higher total fee, paid by the same custody
//! account. The payment itself (destination, amount, memo, sequence) is
//! untouched, so at most one of the two can ever apply — the network accepts
//! the higher-fee outer transaction and the displaced original fails with
//! `tx_bad_seq`. Nothing can be paid twice.
//!
//! Issue #517 is implemented here:
//!
//! * [`FeeBumpPolicy`] decides **when** to bump — after
//!   [`FeeBumpPolicy::after_ledgers`] ledgers without inclusion, as counted by
//!   [`FinalityPoller::poll_with_fee_bump`](crate::stellar::broadcast::FinalityPoller::poll_with_fee_bump)
//!   — and enforces the **configured ceiling** `max_fee_stroops`: a bump that
//!   would offer more than the ceiling is never submitted.
//! * [`build_fee_bump`] wraps a signed envelope and signs the wrapper with
//!   the custody key, verifying the signature before it ever leaves the
//!   process.
//! * [`fee_bump_stuck_transaction`] ties both to a live [`StellarClient`]:
//!   it reads the current market fee from Horizon, respects the ceiling,
//!   submits the bump and reports the **extra fee** so the caller can book it
//!   against the withdrawal's hold
//!   ([`WithdrawalStore::record_fee_bump`](crate::withdrawals::WithdrawalStore::record_fee_bump),
//!   settled by [`crate::stellar::settlement`]).

use std::sync::atomic::{AtomicU32, Ordering};

use stellar_xdr::{
    DecoratedSignature, FeeBumpTransaction, FeeBumpTransactionEnvelope, FeeBumpTransactionExt,
    FeeBumpTransactionInnerTx, MuxedAccount, Signature, TransactionEnvelope, Uint256,
};

use super::StellarClient;
use super::broadcast::hash_hex;
use super::network::StellarNetwork;
use super::payment::{self, PaymentError, StellarSigner};
use crate::ChainError;

/// Ledgers without inclusion to wait for before the first bump, by default.
/// Six ledgers is roughly half a minute at one ledger every five seconds.
pub const DEFAULT_AFTER_LEDGERS: u64 = 6;

/// Default ceiling on the bumped total fee, in stroops —
/// [`payment::MAX_FEE`], the same bound Horizon's fee stats are clamped to.
pub const DEFAULT_MAX_FEE_STROOPS: u32 = payment::MAX_FEE;

// ── FeeBumpPolicy ─────────────────────────────────────────────────────────────

/// When to bump, and the most the bump is ever allowed to offer.
///
/// The ceiling is what keeps a surge from becoming an open cheque: if the
/// market fee is above [`max_fee_stroops`](Self::max_fee_stroops) no bump is
/// offered at all, and the withdrawal keeps waiting (or times out into manual
/// review) instead of paying whatever the network asks.
///
/// Interior mutability (atomics) keeps the policy shareable behind plain
/// shared references across await points, which is what the async polling
/// callbacks need.
#[derive(Debug)]
pub struct FeeBumpPolicy {
    after_ledgers: u64,
    max_fee_stroops: u32,
    /// The highest total fee already submitted. Every later bump must beat it
    /// or the network treats it as a replacement and refuses it.
    /// [`NO_OFFER`] means no bump has been submitted yet.
    offered: AtomicU32,
}

/// Sentinel for "no fee offered yet" (no real offer is near `u32::MAX`).
const NO_OFFER: u32 = u32::MAX;

impl Clone for FeeBumpPolicy {
    fn clone(&self) -> Self {
        Self {
            after_ledgers: self.after_ledgers,
            max_fee_stroops: self.max_fee_stroops,
            offered: AtomicU32::new(self.offered.load(Ordering::Relaxed)),
        }
    }
}

impl FeeBumpPolicy {
    /// `after_ledgers` is clamped to at least 1; the ceiling is taken as
    /// given (a ceiling below the network minimum simply forbids bumps).
    #[must_use]
    pub fn new(after_ledgers: u64, max_fee_stroops: u32) -> Self {
        Self {
            after_ledgers: after_ledgers.max(1),
            max_fee_stroops,
            offered: AtomicU32::new(NO_OFFER),
        }
    }

    /// Policy from `STELLAR_FEE_BUMP_AFTER_LEDGERS` (default
    /// [`DEFAULT_AFTER_LEDGERS`]) and `STELLAR_FEE_BUMP_MAX_FEE_STROOPS`
    /// (default [`DEFAULT_MAX_FEE_STROOPS`]). Missing, unparsable or zero
    /// values fall back to the defaults.
    #[must_use]
    pub fn from_env() -> Self {
        fn env_u64(name: &str, default: u64) -> u64 {
            std::env::var(name)
                .ok()
                .and_then(|value| value.trim().parse::<u64>().ok())
                .filter(|parsed| *parsed > 0)
                .unwrap_or(default)
        }
        let after_ledgers = env_u64("STELLAR_FEE_BUMP_AFTER_LEDGERS", DEFAULT_AFTER_LEDGERS);
        let max = env_u64(
            "STELLAR_FEE_BUMP_MAX_FEE_STROOPS",
            u64::from(DEFAULT_MAX_FEE_STROOPS),
        );
        let max_fee_stroops = u32::try_from(max).unwrap_or(DEFAULT_MAX_FEE_STROOPS);
        Self::new(after_ledgers, max_fee_stroops)
    }

    /// Ledgers without inclusion to wait for before bumping.
    pub const fn after_ledgers(&self) -> u64 {
        self.after_ledgers
    }

    /// The ceiling on the total fee of a bump, in stroops.
    pub const fn max_fee_stroops(&self) -> u32 {
        self.max_fee_stroops
    }

    /// The highest total fee submitted so far, if a bump already happened.
    pub fn offered_fee(&self) -> Option<u32> {
        let offered = self.offered.load(Ordering::Acquire);
        (offered != NO_OFFER).then_some(offered)
    }

    /// The total fee the next bump should offer, or `None` when the ceiling
    /// forbids it.
    ///
    /// The offer is the market fee, but never lower than one stroop above
    /// what is already on the table (`inner_fee`, or the previous bump), so a
    /// replacement actually outranks the stuck transaction.
    pub fn next_fee(&self, inner_fee: u32, market_fee: u32) -> Option<u32> {
        let floor = self.offered_fee().unwrap_or(0).max(inner_fee);
        let candidate = market_fee.max(floor.saturating_add(1));
        (candidate <= self.max_fee_stroops).then_some(candidate)
    }

    /// Remembers that `fee` was successfully submitted.
    pub fn record_offer(&self, fee: u32) {
        self.offered.store(fee, Ordering::Release);
    }
}

// ── Building the bump ─────────────────────────────────────────────────────────

/// The fee the wrapped transaction carries, in stroops. Taken from the
/// envelope itself so a caller never has to remember it.
///
/// Errors ([`ChainError::Config`]) when the envelope is already a fee bump:
/// a fee bump cannot wrap a fee bump.
pub fn inner_fee_stroops(envelope: &TransactionEnvelope) -> Result<u32, ChainError> {
    match envelope {
        TransactionEnvelope::Tx(v1) => Ok(v1.tx.fee),
        TransactionEnvelope::TxV0(v0) => Ok(v0.tx.fee),
        TransactionEnvelope::TxFeeBump(_) => Err(ChainError::Config(
            "a fee bump cannot wrap a fee bump".to_owned(),
        )),
    }
}

/// Wraps `inner` in a fee-bump transaction offering `total_fee_stroops`,
/// signs the wrapper with `signer`, and verifies the signature before
/// returning.
///
/// The inner envelope keeps its original signatures; only the wrapper is
/// signed. Returns the envelope and the wrapper's hash (the hash the network
/// will report for the bumped transaction).
pub fn build_fee_bump(
    inner: &TransactionEnvelope,
    total_fee_stroops: u32,
    signer: &dyn StellarSigner,
    network: StellarNetwork,
) -> Result<(TransactionEnvelope, [u8; 32]), PaymentError> {
    let TransactionEnvelope::Tx(v1) = inner else {
        return Err(PaymentError::Encoding(
            "only a v1 transaction can be fee-bumped; a fee bump cannot \
             wrap a fee bump or a v0 transaction"
                .to_owned(),
        ));
    };

    let fee_bump = FeeBumpTransaction {
        fee_source: MuxedAccount::Ed25519(Uint256(signer.public_key())),
        fee: i64::from(total_fee_stroops),
        inner_tx: FeeBumpTransactionInnerTx::Tx(v1.clone()),
        ext: FeeBumpTransactionExt::V0,
    };
    let hash = fee_bump
        .hash(network.network_id())
        .map_err(|error| PaymentError::Encoding(error.to_string()))?;

    let signature = DecoratedSignature {
        hint: payment::signature_hint(&signer.public_key()),
        signature: Signature(
            signer
                .sign(&hash)
                .to_vec()
                .try_into()
                .map_err(|_| PaymentError::Encoding("signature length".to_owned()))?,
        ),
    };
    let signatures = vec![signature]
        .try_into()
        .map_err(|_| PaymentError::Encoding("too many signatures".to_owned()))?;
    let envelope = TransactionEnvelope::TxFeeBump(FeeBumpTransactionEnvelope {
        tx: fee_bump,
        signatures,
    });

    // A faulty signer (a mix-up, a misbehaving HSM) must fail here, not on
    // the network with a fee bump nobody can explain.
    if !fee_bump_signature_verifies(&envelope, &signer.public_key(), network)? {
        return Err(PaymentError::Key(
            "the fee-bump signature does not verify against the signing key",
        ));
    }
    Ok((envelope, hash))
}

/// Whether `envelope` carries a valid fee-bump signature by `public_key`.
fn fee_bump_signature_verifies(
    envelope: &TransactionEnvelope,
    public_key: &[u8; 32],
    network: StellarNetwork,
) -> Result<bool, PaymentError> {
    let TransactionEnvelope::TxFeeBump(bump) = envelope else {
        return Ok(false);
    };
    let hash = bump
        .tx
        .hash(network.network_id())
        .map_err(|error| PaymentError::Encoding(error.to_string()))?;
    let Ok(key) = ed25519_dalek::VerifyingKey::from_bytes(public_key) else {
        return Ok(false);
    };
    let hint = payment::signature_hint(public_key);
    Ok(bump
        .signatures
        .iter()
        .filter(|decorated| decorated.hint == hint)
        .any(|decorated| {
            ed25519_dalek::Signature::from_slice(decorated.signature.0.as_slice())
                .is_ok_and(|signature| key.verify_strict(&hash, &signature).is_ok())
        }))
}

// ── Submitting the bump ───────────────────────────────────────────────────────

/// A fee bump Horizon accepted for a stuck transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeeBumpSubmission {
    /// The outer transaction's hash, lower-case hex.
    pub hash: String,
    /// The total fee the outer transaction offered, in stroops.
    pub fee: u32,
    /// How much more than the inner transaction's fee, in stroops. This is
    /// the extra fee the caller must book against the withdrawal's hold.
    pub extra_fee: u32,
}

/// Submits a fee bump for `inner` if — and only if — the policy's ceiling
/// allows it.
///
/// * Reads the current market fee from Horizon's `/fee_stats` (clamped to
///   `[BASE_FEE, MAX_FEE]` inside [`StellarClient::recommended_fee`]).
/// * Asks the policy for the next offer; `Ok(None)` means the ceiling forbids
///   a bump and **nothing is submitted**.
/// * Builds, signs and submits the outer transaction, then checks the hash
///   Horizon reports against the signed one — a mismatch is
///   [`ChainError::Unavailable`], never a success.
/// * On success records the offer so any later bump must beat it.
pub async fn fee_bump_stuck_transaction(
    client: &StellarClient,
    signer: &dyn StellarSigner,
    inner: &TransactionEnvelope,
    policy: &FeeBumpPolicy,
) -> Result<Option<FeeBumpSubmission>, ChainError> {
    let inner_fee = inner_fee_stroops(inner)?;
    let market_fee = client.recommended_fee().await;
    let Some(fee) = policy.next_fee(inner_fee, market_fee) else {
        tracing::debug!(
            inner_fee,
            market_fee,
            ceiling = policy.max_fee_stroops(),
            "fee bump withheld: the configured ceiling would be exceeded"
        );
        return Ok(None);
    };

    let (envelope, hash) = build_fee_bump(inner, fee, signer, client.config().network)
        .map_err(|error| ChainError::Config(format!("fee bump is unusable: {error}")))?;
    let hash_hex = hash_hex(&hash);
    let xdr = payment::envelope_base64(&envelope)
        .map_err(|error| ChainError::Config(format!("fee bump encoding: {error}")))?;

    tracing::info!(
        inner_fee,
        bump_fee = fee,
        ceiling = policy.max_fee_stroops(),
        hash = %hash_hex,
        "transaction missed ledgers; submitting a fee bump"
    );
    let submitted = client.submit_transaction(&xdr).await?;
    if submitted.hash != hash_hex {
        return Err(ChainError::Unavailable(format!(
            "Horizon reported hash {} for the fee bump of {hash_hex}",
            submitted.hash
        )));
    }

    policy.record_offer(fee);
    Ok(Some(FeeBumpSubmission {
        hash: hash_hex,
        fee,
        extra_fee: fee.saturating_sub(inner_fee),
    }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use std::time::Duration;

    use engipay_core::{Asset, Money};
    use stellar_xdr::{Limits, ReadXdr};
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::stellar::broadcast::{FinalityError, FinalityOutcome, FinalityPoller};
    use crate::stellar::payment::{
        BASE_FEE, CustodySigner, LocalTestnetSigner, PaymentRequest, build_payment, sign_withdrawal,
    };
    use crate::stellar::{StellarConfig, StellarNetwork};
    use crate::withdrawals::fake::{FakeWithdrawalStore, pending};

    /// A signed withdrawal (fee = [`BASE_FEE`]) against a fake Horizon.
    struct Harness {
        server: MockServer,
        client: StellarClient,
        custody: CustodySigner<LocalTestnetSigner>,
        envelope: TransactionEnvelope,
        hash: String,
    }

    async fn harness() -> Harness {
        let signer = LocalTestnetSigner::from_secret(
            stellar_strkey::ed25519::PrivateKey([4; 32])
                .as_unredacted()
                .to_string()
                .as_str(),
            StellarNetwork::Testnet,
        )
        .unwrap();
        let custody_account = signer.account();
        let custody = CustodySigner::new(signer, &custody_account).unwrap();

        let server = MockServer::start().await;
        let config = StellarConfig::new(
            StellarNetwork::Testnet,
            Some(server.uri()),
            &custody_account,
        )
        .unwrap();
        let client = StellarClient::new(config).unwrap();

        let destination = stellar_strkey::ed25519::PublicKey([2; 32])
            .to_string()
            .as_str()
            .to_owned();
        let tx = build_payment(
            &custody.public_key(),
            100,
            &PaymentRequest {
                destination,
                money: Money::from_minor(Asset::Usdc, 20_000_000),
                memo: None,
            },
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let (envelope, hash) = sign_withdrawal(tx, &custody, StellarNetwork::Testnet).unwrap();

        Harness {
            server,
            client,
            custody,
            envelope,
            hash: hash_hex(&hash),
        }
    }

    impl Harness {
        /// `GET /fee_stats` with a surging p90 fee.
        async fn fee_stats_at(&self, p90: u32) {
            Mock::given(method("GET"))
                .and(path("/fee_stats"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "fee_charged": { "p50": "100", "p90": p90.to_string() }
                })))
                .mount(&self.server)
                .await;
        }

        async fn horizon_lookup_returns(&self, hash: &str, response: ResponseTemplate) {
            Mock::given(method("GET"))
                .and(path(format!("/transactions/{hash}")))
                .respond_with(response)
                .mount(&self.server)
                .await;
        }

        /// The exact envelope and hash the next bump at `fee` must produce.
        fn expected_bump(&self, fee: u32) -> (TransactionEnvelope, String) {
            let (envelope, hash) =
                build_fee_bump(&self.envelope, fee, &self.custody, StellarNetwork::Testnet)
                    .unwrap();
            (envelope, hash_hex(&hash))
        }

        /// The `tx` field the client actually POSTed, decoded.
        async fn posted_envelope(&self) -> TransactionEnvelope {
            let requests = self.server.received_requests().await.unwrap();
            let body = requests
                .iter()
                .find(|request| request.url.path() == "/transactions")
                .map(|request| String::from_utf8_lossy(&request.body).into_owned())
                .expect("a POST /transactions");
            let encoded = body
                .split("tx=")
                .nth(1)
                .expect("the form carries the signed tx");
            let xdr = encoded
                .replace("%2B", "+")
                .replace("%2F", "/")
                .replace("%3D", "=");
            TransactionEnvelope::from_xdr_base64(&xdr, Limits::none()).expect("readable XDR")
        }
    }

    // ── FeeBumpPolicy ────────────────────────────────────────────────────────

    #[test]
    fn the_ceiling_forbids_any_bump_above_it() {
        let policy = FeeBumpPolicy::new(3, 4_000);
        assert_eq!(
            policy.next_fee(BASE_FEE, 5_000),
            None,
            "market is above the ceiling"
        );
        assert_eq!(policy.offered_fee(), None);
    }

    #[test]
    fn the_ceiling_still_allows_bumps_below_it() {
        let policy = FeeBumpPolicy::new(3, 4_000);
        assert_eq!(policy.next_fee(BASE_FEE, 2_500), Some(2_500));
    }

    #[test]
    fn every_following_bump_must_outrank_the_previous_offer() {
        let policy = FeeBumpPolicy::new(1, 100_000);
        let first = policy.next_fee(BASE_FEE, 500).unwrap();
        policy.record_offer(first);
        // The market dropped, but a replacement must still beat the offer.
        assert_eq!(policy.next_fee(first, 100), Some(first + 1));
        // And once the ceiling is one stroop away, no further bump fits.
        let at_ceiling = FeeBumpPolicy::new(1, first + 1);
        at_ceiling.record_offer(first);
        assert_eq!(at_ceiling.next_fee(first, 90_000), None);
    }

    #[test]
    fn the_first_bump_always_outranks_the_stuck_transaction() {
        let policy = FeeBumpPolicy::new(1, 100_000);
        assert_eq!(policy.next_fee(700, 100), Some(701));
    }

    #[test]
    fn zero_after_ledgers_still_waits_for_at_least_one_ledger() {
        assert_eq!(FeeBumpPolicy::new(0, 1_000).after_ledgers(), 1);
    }

    #[test]
    fn a_v0_or_already_bumped_envelope_cannot_be_bumped() {
        let bump =
            TransactionEnvelope::TxFeeBump(stellar_xdr::FeeBumpTransactionEnvelope::default());
        assert!(matches!(
            inner_fee_stroops(&bump),
            Err(ChainError::Config(_))
        ));
    }

    // ── build_fee_bump ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn the_bump_wraps_the_original_signed_transaction() {
        let h = harness().await;
        let (envelope, _hash) = h.expected_bump(5_000);

        let TransactionEnvelope::TxFeeBump(bump) = &envelope else {
            panic!("expected a fee-bump envelope");
        };
        assert_eq!(bump.tx.fee, 5_000);
        let stellar_xdr::FeeBumpTransactionInnerTx::Tx(inner) = &bump.tx.inner_tx;
        let TransactionEnvelope::Tx(original) = &h.envelope else {
            panic!("the harness signs a v1 envelope");
        };
        assert_eq!(inner, original, "the signed payment is untouched");
        assert!(!bump.signatures.is_empty(), "the wrapper is signed");
        assert_eq!(inner_fee_stroops(&h.envelope).unwrap(), BASE_FEE);
    }

    // ── the bump reaches a fake Horizon ──────────────────────────────────────

    #[tokio::test]
    async fn a_stuck_transaction_is_fee_bumped_at_the_market_fee() {
        let h = harness().await;
        h.fee_stats_at(5_000).await;
        let (expected, expected_hash) = h.expected_bump(5_000);
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .and(body_string_contains("tx="))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "hash": expected_hash,
                "ledger": 100
            })))
            .expect(1)
            .mount(&h.server)
            .await;

        let policy = FeeBumpPolicy::new(3, 100_000);
        let submission = fee_bump_stuck_transaction(&h.client, &h.custody, &h.envelope, &policy)
            .await
            .unwrap()
            .expect("a bump above the base fee must be submitted");

        assert_eq!(submission.hash, expected_hash);
        assert_eq!(submission.fee, 5_000);
        assert_eq!(
            submission.extra_fee, 4_900,
            "the surcharge over the original fee"
        );
        assert_eq!(policy.offered_fee(), Some(5_000));

        let posted = h.posted_envelope().await;
        assert_eq!(posted, expected, "Horizon received exactly the signed bump");
    }

    #[tokio::test]
    async fn a_market_fee_above_the_ceiling_submits_nothing() {
        let h = harness().await;
        h.fee_stats_at(5_000).await;
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&h.server)
            .await;

        let policy = FeeBumpPolicy::new(3, 4_000);
        let submission = fee_bump_stuck_transaction(&h.client, &h.custody, &h.envelope, &policy)
            .await
            .unwrap();

        assert_eq!(submission, None, "the ceiling is respected: no bump at all");
        assert_eq!(policy.offered_fee(), None);
    }

    #[tokio::test]
    async fn horizon_rejecting_the_bump_is_surfaced_not_swallowed() {
        let h = harness().await;
        h.fee_stats_at(5_000).await;
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "title": "Transaction Failed",
                "status": 400,
                "extras": { "result_codes": { "transaction": "tx_insufficient_fee" } }
            })))
            .mount(&h.server)
            .await;

        let policy = FeeBumpPolicy::new(3, 100_000);
        let error = fee_bump_stuck_transaction(&h.client, &h.custody, &h.envelope, &policy)
            .await
            .unwrap_err();

        assert!(matches!(error, ChainError::Rejected(_)), "{error:?}");
        assert_eq!(
            policy.offered_fee(),
            None,
            "an offer never made is not recorded"
        );
    }

    // ── detection, success after the bump, and the ceiling ───────────────────

    #[tokio::test]
    async fn a_transaction_left_out_of_ledgers_confirms_after_the_bump() {
        let h = harness().await;
        h.fee_stats_at(5_000).await;
        // Horizon has not seen the original transaction in a ledger...
        h.horizon_lookup_returns(&h.hash, ResponseTemplate::new(404))
            .await;
        let (_bump_envelope, bump_hash) = h.expected_bump(5_000);
        // ...the bump is accepted...
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "hash": bump_hash,
                "ledger": 100
            })))
            .expect(1)
            .mount(&h.server)
            .await;
        // ...and the bumped transaction lands in a closed ledger.
        h.horizon_lookup_returns(
            &bump_hash,
            ResponseTemplate::new(200).set_body_json(
                serde_json::json!({ "hash": bump_hash, "ledger": 900, "successful": true }),
            ),
        )
        .await;
        let mut withdrawal = pending(Asset::Usdc, 20_000_000, 1_000_000);
        withdrawal.tx_hash = Some(h.hash.clone());
        let id = withdrawal.id;
        let store = FakeWithdrawalStore::with(withdrawal);
        let policy = FeeBumpPolicy::new(2, 100_000);
        let poller = FinalityPoller::with_config(Duration::from_millis(1), Duration::from_secs(5));

        let outcome = poller
            .poll_finality_with_fee_bump(&h.client, &h.custody, &h.envelope, &policy, &store, id)
            .await
            .unwrap();

        assert_eq!(
            outcome,
            FinalityOutcome::Confirmed {
                hash: h.hash.clone(),
                ledger: 900,
            },
            "the outcome reports the original transaction hash"
        );
        assert_eq!(policy.offered_fee(), Some(5_000));
        assert_eq!(
            store.snapshot(id).extra_fee,
            Money::from_minor(Asset::Usdc, 4_900),
            "the surcharge is booked against the withdrawal"
        );
    }

    #[tokio::test]
    async fn never_included_and_over_the_ceiling_times_out_without_a_bump() {
        let h = harness().await;
        h.fee_stats_at(5_000).await;
        h.horizon_lookup_returns(&h.hash, ResponseTemplate::new(404))
            .await;
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&h.server)
            .await;
        let mut withdrawal = pending(Asset::Usdc, 20_000_000, 1_000_000);
        withdrawal.tx_hash = Some(h.hash.clone());
        let id = withdrawal.id;
        let store = FakeWithdrawalStore::with(withdrawal);
        let policy = FeeBumpPolicy::new(2, 4_000);
        let poller =
            FinalityPoller::with_config(Duration::from_millis(1), Duration::from_millis(60));

        let error = poller
            .poll_finality_with_fee_bump(&h.client, &h.custody, &h.envelope, &policy, &store, id)
            .await
            .unwrap_err();

        assert!(
            matches!(error, FinalityError::Timeout { .. }),
            "expected a timeout, got {error:?}"
        );
        assert_eq!(policy.offered_fee(), None, "the ceiling was respected");
        assert_eq!(
            store.snapshot(id).extra_fee,
            Money::from_minor(Asset::Usdc, 0)
        );
        // The POST expectation above (0 calls) is verified when the server drops.
    }
}
