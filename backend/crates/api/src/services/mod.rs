//! Application-level services that sit above the ledger: rules the ledger
//! itself does not know about, such as AML velocity limits and SEP-23 muxed
//! address derivation.

pub mod limits;
pub mod stellar_muxed;
pub mod payment_requests;
