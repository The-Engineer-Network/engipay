#!/bin/sh
# Install Scarb in WSL Ubuntu

echo "Installing Scarb in WSL..."

# Install asdf if not present
if [ ! -d "$HOME/.asdf" ]; then
    echo "Installing asdf..."
    git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.13.1
    echo '. "$HOME/.asdf/asdf.sh"' >> ~/.bashrc
    echo '. "$HOME/.asdf/completions/asdf.bash"' >> ~/.bashrc
    . "$HOME/.asdf/asdf.sh"
fi

# Source asdf
. "$HOME/.asdf/asdf.sh"

# Install Scarb plugin
echo "Installing Scarb plugin..."
asdf plugin add scarb || true

# Install Scarb 2.6.4 (matching your Scarb.toml)
echo "Installing Scarb 2.6.4..."
asdf install scarb 2.6.4
asdf global scarb 2.6.4

# Verify
echo ""
echo "Verifying installation..."
scarb --version

echo ""
echo "✓ Scarb installed successfully!"
echo "Now run: scarb build"
