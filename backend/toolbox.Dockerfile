# Rust tooling for development: build, test, lint, format.
#
# clippy and rustfmt are installed here, in the image, on purpose. Installing
# them inside a `docker compose run --rm` container throws them away on exit,
# and a lint command that is not installed reports an error that is easy to
# misread as "clean".
FROM rust:1.98-bookworm
RUN rustup component add clippy rustfmt
WORKDIR /work
