#!/bin/bash

echo "Testing sncast configuration..."
echo ""

# Test 1: Check sncast version
echo "1. Checking sncast version:"
sncast --version
echo ""

# Test 2: Check if profile exists
echo "2. Checking snfoundry.toml:"
cat snfoundry.toml
echo ""

# Test 3: Check account file
echo "3. Checking account file:"
cat ~/.starknet_accounts/starknet_open_zeppelin_accounts.json
echo ""

# Test 4: Try to declare with full output
echo "4. Testing declare command (EngiToken):"
sncast --profile sepolia declare --contract-name EngiToken --fee-token strk 2>&1
echo ""

# Test 5: Alternative - declare without profile
echo "5. Testing declare without profile:"
sncast \
    --accounts-file ~/.starknet_accounts/starknet_open_zeppelin_accounts.json \
    --account engipay-deployer \
    --url https://rpc.starknet.lava.build \
    declare \
    --contract-name EngiToken \
    --fee-token strk \
    2>&1
echo ""

echo "Done!"
