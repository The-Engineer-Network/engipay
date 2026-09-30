//! SEP-10 challenge transaction validation.
//!
//! The SEP-10 spec requires the challenge's sequence number to be zero (so
//! the "transaction" can never be submitted to the ledger for real) and its
//! time bounds to be enforced, so a signed challenge cannot be replayed
//! indefinitely. Both checks are pure functions over an already-decoded
//! transaction so they can be unit tested without touching the network.

use stellar_xdr::{Preconditions, Transaction};

use super::AuthError;

/// The SEP-10 challenge sequence number must be exactly zero.
pub fn validate_sequence_number(tx: &Transaction) -> Result<(), AuthError> {
    if tx.seq_num.0 != 0 {
        return Err(AuthError::InvalidToken);
    }
    Ok(())
}

/// The challenge must carry time bounds, and `now` must fall within them:
/// `min_time <= now <= max_time`.
pub fn validate_time_bounds(tx: &Transaction, now: u64) -> Result<(), AuthError> {
    let bounds = match &tx.cond {
        Preconditions::Time(bounds) => Some(bounds),
        Preconditions::V2(bounds) => bounds.time_bounds.as_ref(),
        Preconditions::None => None,
    }
    .ok_or(AuthError::InvalidToken)?;

    if now < bounds.min_time.0 {
        return Err(AuthError::InvalidToken);
    }
    if bounds.max_time.0 == 0 || now > bounds.max_time.0 {
        return Err(AuthError::ExpiredToken);
    }
    Ok(())
}

/// Runs both SEP-10 structural checks required before a challenge's
/// signatures are even inspected.
pub fn validate_challenge(tx: &Transaction, now: u64) -> Result<(), AuthError> {
    validate_sequence_number(tx)?;
    validate_time_bounds(tx, now)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_xdr::{
        Memo, MuxedAccount, SequenceNumber, TimeBounds, TimePoint, TransactionExt, Uint256,
    };

    fn base_transaction(seq_num: i64, min_time: u64, max_time: u64) -> Transaction {
        Transaction {
            source_account: MuxedAccount::Ed25519(Uint256([0; 32])),
            fee: 100,
            seq_num: SequenceNumber(seq_num),
            cond: Preconditions::Time(TimeBounds {
                min_time: TimePoint(min_time),
                max_time: TimePoint(max_time),
            }),
            operations: Default::default(),
            ext: TransactionExt::V0,
            memo: Memo::None,
        }
    }

    #[test]
    fn accepts_a_zero_sequence_number() {
        let tx = base_transaction(0, 0, 300);
        assert!(validate_sequence_number(&tx).is_ok());
    }

    #[test]
    fn rejects_a_nonzero_sequence_number() {
        let tx = base_transaction(1, 0, 300);
        assert!(validate_sequence_number(&tx).is_err());
    }

    #[test]
    fn accepts_a_transaction_within_time_bounds() {
        let tx = base_transaction(0, 100, 200);
        assert!(validate_time_bounds(&tx, 150).is_ok());
    }

    #[test]
    fn rejects_a_transaction_before_min_time() {
        let tx = base_transaction(0, 100, 200);
        assert!(validate_time_bounds(&tx, 50).is_err());
    }

    #[test]
    fn rejects_an_expired_challenge_transaction() {
        let tx = base_transaction(0, 100, 200);

        let result = validate_time_bounds(&tx, 201);
        assert!(matches!(result, Err(AuthError::ExpiredToken)));
    }

    #[test]
    fn rejects_a_transaction_with_no_time_bounds() {
        let mut tx = base_transaction(0, 0, 300);
        tx.cond = Preconditions::None;

        assert!(validate_time_bounds(&tx, 100).is_err());
    }

    #[test]
    fn rejects_a_challenge_without_an_expiry() {
        assert!(validate_time_bounds(&base_transaction(0, 0, 0), 150).is_err());
    }

    #[test]
    fn validate_challenge_rejects_expired_and_nonzero_sequence_together() {
        let tx = base_transaction(5, 100, 200);
        assert!(validate_challenge(&tx, 500).is_err());
    }

    #[test]
    fn validate_challenge_accepts_a_well_formed_challenge() {
        let tx = base_transaction(0, 100, 200);
        assert!(validate_challenge(&tx, 150).is_ok());
    }
}
