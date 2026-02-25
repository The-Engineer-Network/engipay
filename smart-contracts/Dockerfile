# EngiPay Smart Contracts - Docker Build Environment
FROM ubuntu:22.04

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    libssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Scarb
RUN curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Install Starkli
RUN curl https://get.starkli.sh | sh
RUN /root/.starkli/bin/starkliup
ENV PATH="/root/.starkli/bin:${PATH}"

# Set working directory
WORKDIR /workspace

# Copy project files
COPY . .

# Default command
CMD ["scarb", "build"]
