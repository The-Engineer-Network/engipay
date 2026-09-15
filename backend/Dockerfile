# Builds one EngiPay binary. Choose it with --build-arg BIN=engipay-api (or engipay-chain).
#
# Compilation happens here, not on a developer machine: dependency build
# scripts run inside this throwaway container, never next to wallets or keys.

# Pinned, so every build uses the same compiler. Bump deliberately.
FROM rust:1.98-bookworm AS build
ARG BIN=engipay-api
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked --bin "${BIN}" \
    && cp "target/release/${BIN}" /app

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home engipay
COPY --from=build /app /usr/local/bin/app
# Never run as root.
USER engipay
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/app"]
