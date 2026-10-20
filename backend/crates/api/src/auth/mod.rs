//! Session authentication: JWT issuance/verification and SEP-10 challenge
//! validation, kept separate from the HTTP handlers in `routes::auth` so the
//! rules that decide whether a caller is who they claim to be can be unit
//! tested without a database or a running server.

pub mod jwt;
pub mod stellar;

pub use jwt::{AuthError, Claims};
pub use stellar::validate_challenge;
