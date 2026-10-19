//! Application-level services that sit above the ledger: rules the ledger
//! itself does not know about, such as AML velocity limits and SEP-23 muxed
//! address derivation.

pub mod bank_name_check;
pub mod buy;
pub mod cooling_off;
pub mod kyc_provider;
pub mod limits;
pub mod notification_service;
pub mod notifications;
pub mod payment_envelope;
pub mod payment_requests;
pub mod price_source;
pub mod scheduled_transfers;
pub mod recipient;
pub mod stellar_muxed;
pub mod withdrawal_review;
