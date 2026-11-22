//! Domain types every EngiPay service agrees on.
//!
//! Nothing here touches a database, a network or a key. That keeps the rules
//! about money in one small place that is easy to test and hard to misuse.

pub mod asset;
pub mod fee;
pub mod ids;
pub mod money;
pub mod stellar;

pub use asset::{Asset, Chain};
pub use fee::{FeeError, FeeResult, FeeSchedule, Product, UnknownProduct};
pub use ids::UserId;
pub use money::{Money, MoneyError};
