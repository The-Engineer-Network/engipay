//! The chain service.
//!
//! This is the only EngiPay process that will ever hold signing keys, which is
//! why it is a separate binary from the API: the API can be compromised without
//! the attacker gaining the ability to move funds.
//!
//! Each network sits behind the same [`ChainClient`] trait, so the API and the
//! deposit watcher never care which network they are talking to. Stellar is
//! implemented ([`stellar`]); Base (via `alloy`) and Bitcoin (via `bdk`) come
//! next.

pub mod creditor;
pub mod deposit_creditor;
pub mod dlq;
pub mod evm;
pub mod routes;
pub mod services;
pub mod stellar;

use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use engipay_core::{Asset, Chain, Money};

#[derive(Debug, thiserror::Error)]
pub enum ChainError {
    #[error("{0:?} is not supported by this client")]
    UnsupportedChain(Chain),
    #[error("{0} is not supported by this client")]
    UnsupportedAsset(Asset),
    #[error("the node or RPC endpoint is unavailable: {0}")]
    Unavailable(String),
    /// The network refused a transaction, e.g. insufficient funds or a bad
    /// sequence number. Not retried blindly: the reason decides what happens.
    #[error("the network rejected the transaction: {0}")]
    Rejected(String),
    #[error("configuration: {0}")]
    Config(String),
    #[error("not implemented yet")]
    NotImplemented,
}

/// A transfer seen on-chain into one of EngiPay's deposit addresses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedDeposit {
    pub money: Money,
    pub address: String,
    /// Unique per credit, e.g. `base:<tx hash>:<log index>`. This becomes the
    /// ledger reference, which is what stops a deposit being credited twice.
    pub reference: String,
    pub confirmations: u32,
}

/// A ledger or block event emitted by [`ChainClient::stream_events`].
///
/// Each event carries all the deposits seen in a single poll so consumers can
/// process them atomically.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerEvent {
    /// The ledger sequence number or block height this event describes.
    pub height: u64,
    /// All creditable deposits observed at or after this height.
    pub deposits: Vec<ObservedDeposit>,
}

/// A pinned, boxed async stream of [`LedgerEvent`]s.
///
/// Using a type alias keeps trait users readable; the concrete stream type
/// stays private to each implementor.
pub type EventStream =
    Pin<Box<dyn futures_core::Stream<Item = Result<LedgerEvent, ChainError>> + Send>>;

/// What every network implementation provides.
pub trait ChainClient: Send + Sync {
    fn chain(&self) -> Chain;

    /// Confirmations required before a deposit is credited.
    fn required_confirmations(&self) -> u32 {
        match self.chain() {
            Chain::Base => 12,
            Chain::Bitcoin => 2,
            // Stellar ledgers are final once closed: there are no reorgs to wait out.
            Chain::Stellar => 1,
        }
    }

    fn latest_height(&self) -> impl std::future::Future<Output = Result<u64, ChainError>> + Send;

    fn deposits_since(
        &self,
        height: u64,
    ) -> impl std::future::Future<Output = Result<Vec<ObservedDeposit>, ChainError>> + Send;

    /// Returns an async stream of [`LedgerEvent`]s starting from `from_height`.
    ///
    /// Chains that natively support WebSocket push streams should override this
    /// to return a real event-driven stream. The **default implementation** is a
    /// polling fallback: it ticks every `poll_interval`, calls
    /// [`deposits_since`](Self::deposits_since), and emits one [`LedgerEvent`]
    /// per tick. This default has the same semantics as the original `watch()`
    /// loop in `main.rs`, so every chain gets correct behaviour without needing
    /// a WebSocket endpoint.
    fn stream_events(
        &self,
        from_height: u64,
        poll_interval: Duration,
    ) -> impl std::future::Future<Output = Result<EventStream, ChainError>> + Send;
}

/// Whether an observed deposit may be credited yet.
pub fn is_creditable(client: &impl ChainClient, deposit: &ObservedDeposit) -> bool {
    deposit.money.is_positive() && deposit.confirmations >= client.required_confirmations()
}

/// Polling-based [`EventStream`] implementation.
///
/// Clients that do not have a native push stream can call this from
/// `stream_events`. It polls `deposits_since` every `interval` and emits one
/// [`LedgerEvent`] per tick. The overlap-by-one-ledger behaviour from the
/// original `watch()` loop is preserved.
///
/// The stream is infinite (it never returns `None`); callers cancel it by
/// dropping the `EventStream`.
pub fn polling_stream<C>(client: Arc<C>, from_height: u64, interval: Duration) -> EventStream
where
    C: ChainClient + 'static,
{
    // We drive the polling with an async generator pattern: store state in a
    // struct and implement `Stream` manually so we have full control.
    use futures_core::Stream;
    use std::task::{Context, Poll};

    // All state lives in a single struct so the stream is `Send`.
    #[allow(clippy::type_complexity)]
    struct Poller<C> {
        client: Arc<C>,
        next_height: u64,
        interval: tokio::time::Interval,
        /// Currently in-flight future (if any).
        pending: Option<
            Pin<
                Box<
                    dyn std::future::Future<Output = Result<LedgerEvent, ChainError>>
                        + Send
                        + 'static,
                >,
            >,
        >,
    }

    // SAFETY: All fields are Send, so Poller<C: Send> is Send.
    impl<C: ChainClient + 'static> Stream for Poller<C> {
        type Item = Result<LedgerEvent, ChainError>;

        fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            loop {
                // 1. Drive any in-flight future.
                if let Some(ref mut fut) = self.pending {
                    match fut.as_mut().poll(cx) {
                        Poll::Ready(result) => {
                            self.pending = None;
                            // Advance the cursor on success.
                            if let Ok(ref event) = result {
                                self.next_height = event.height;
                            }
                            return Poll::Ready(Some(result));
                        }
                        Poll::Pending => return Poll::Pending,
                    }
                }

                // 2. Wait for the next tick.
                match self.interval.poll_tick(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(_) => {}
                }

                // 3. Spawn a new fetch future.
                let client = self.client.clone();
                let height = self.next_height;
                self.pending = Some(Box::pin(async move {
                    let tip = client.latest_height().await?;
                    let deposits = client.deposits_since(height).await?;
                    Ok(LedgerEvent { height: tip, deposits })
                }));
                // Loop back to drive the newly created future immediately.
            }
        }
    }

    let mut interval_timer = tokio::time::interval(interval);
    interval_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    Box::pin(Poller {
        client,
        next_height: from_height,
        interval: interval_timer,
        pending: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeBase;

    impl ChainClient for FakeBase {
        fn chain(&self) -> Chain {
            Chain::Base
        }
        async fn latest_height(&self) -> Result<u64, ChainError> {
            Ok(100)
        }
        async fn deposits_since(&self, _height: u64) -> Result<Vec<ObservedDeposit>, ChainError> {
            Ok(Vec::new())
        }
        async fn stream_events(
            &self,
            from_height: u64,
            poll_interval: Duration,
        ) -> Result<EventStream, ChainError> {
            Ok(polling_stream(Arc::new(FakeBase), from_height, poll_interval))
        }
    }

    fn deposit(confirmations: u32, minor: i128) -> ObservedDeposit {
        ObservedDeposit {
            money: Money::from_minor(Asset::Usdc, minor),
            address: "0xabc".to_owned(),
            reference: "base:0x1:0".to_owned(),
            confirmations,
        }
    }

    #[test]
    fn deposits_wait_for_enough_confirmations() {
        assert!(!is_creditable(&FakeBase, &deposit(11, 5)));
        assert!(is_creditable(&FakeBase, &deposit(12, 5)));
    }

    #[test]
    fn zero_value_deposits_are_never_credited() {
        assert!(!is_creditable(&FakeBase, &deposit(50, 0)));
    }

    /// Verifies that `stream_events` starts and produces at least one event.
    #[tokio::test]
    async fn stream_events_produces_ledger_events() {
        let stream = FakeBase
            .stream_events(90, Duration::from_millis(10))
            .await
            .expect("stream_events failed");

        let first = tokio::time::timeout(
            Duration::from_secs(2),
            futures_util::StreamExt::into_future(stream),
        )
        .await
        .expect("stream_events timed out")
        .0;

        let event = first
            .expect("stream ended without an event")
            .expect("stream error");
        assert_eq!(event.height, 100, "height should match latest_height()");
        assert!(event.deposits.is_empty(), "FakeBase has no deposits");
    }

    /// Verifies that errors from the client propagate through the stream rather
    /// than panicking.
    #[tokio::test]
    async fn stream_events_propagates_errors() {
        struct ErrorClient;
        impl ChainClient for ErrorClient {
            fn chain(&self) -> Chain {
                Chain::Base
            }
            async fn latest_height(&self) -> Result<u64, ChainError> {
                Err(ChainError::Unavailable("node down".into()))
            }
            async fn deposits_since(&self, _: u64) -> Result<Vec<ObservedDeposit>, ChainError> {
                Ok(Vec::new())
            }
            async fn stream_events(
                &self,
                from_height: u64,
                poll_interval: Duration,
            ) -> Result<EventStream, ChainError> {
                Ok(polling_stream(
                    Arc::new(ErrorClient),
                    from_height,
                    poll_interval,
                ))
            }
        }

        let stream = ErrorClient
            .stream_events(0, Duration::from_millis(10))
            .await
            .expect("stream creation should not fail");

        let first = tokio::time::timeout(
            Duration::from_secs(2),
            futures_util::StreamExt::into_future(stream),
        )
        .await
        .expect("stream_events timed out")
        .0;

        assert!(
            matches!(first, Some(Err(ChainError::Unavailable(_)))),
            "expected Unavailable error, got {first:?}"
        );
    }
}
