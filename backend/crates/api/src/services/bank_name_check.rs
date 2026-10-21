//! Bank account name check trait and fake implementation.
//!
//! Before a payout account is saved the CBN requires that the account name is
//! confirmed — this is the "NUBAN name enquiry" step. The trait decouples the
//! route handler from the real provider (Paystack / Flutterwave / etc.) so
//! tests and development can use a fake that always succeeds.

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum NameCheckError {
    #[error("the bank code and account number combination was not found")]
    NotFound,
    #[error("name check provider is unavailable")]
    Unavailable,
    #[error("provider error: {0}")]
    Provider(String),
}

/// Result of a successful name enquiry.
#[derive(Debug, Clone)]
pub struct AccountName {
    /// The name the bank has on record for this account, title-cased.
    pub name: String,
}

/// Performs a NUBAN name enquiry with a payment partner.
///
/// Implementations must not log the full account number.
pub trait BankNameCheck: Send + Sync {
    fn lookup(&self, bank_code: &str, account_number: &str) -> Result<AccountName, NameCheckError>;
}

// ── Fake implementation ───────────────────────────────────────────────────────

/// Always returns "Verified Account Holder" regardless of the inputs.
/// Used in development and tests.
pub struct FakeBankNameCheck;

impl BankNameCheck for FakeBankNameCheck {
    fn lookup(
        &self,
        _bank_code: &str,
        _account_number: &str,
    ) -> Result<AccountName, NameCheckError> {
        Ok(AccountName {
            name: "Verified Account Holder".to_owned(),
        })
    }
}

/// Always returns `NameCheckError::NotFound`. Useful for testing failure paths.
pub struct FakeBankNameCheckFails;

impl BankNameCheck for FakeBankNameCheckFails {
    fn lookup(
        &self,
        _bank_code: &str,
        _account_number: &str,
    ) -> Result<AccountName, NameCheckError> {
        Err(NameCheckError::NotFound)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn fake_check_returns_a_name() {
        let checker = FakeBankNameCheck;
        let result = checker.lookup("044", "0123456789").unwrap();
        assert!(!result.name.is_empty());
    }

    #[test]
    fn fake_failing_check_returns_not_found() {
        let checker = FakeBankNameCheckFails;
        let err = checker.lookup("044", "0123456789").unwrap_err();
        assert_eq!(err, NameCheckError::NotFound);
    }
}
