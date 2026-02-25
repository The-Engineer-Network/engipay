@echo off
REM EngiPay - Setup Wallet for Deployment (Windows)
REM This script sets up your starkli wallet using your private key

echo ============================================
echo EngiPay Wallet Setup
echo ============================================
echo.

REM Your wallet details from .env.local
set WALLET_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
set PRIVATE_KEY=0x06bf4e0ba3e4a19017bb806f860b3406b31538afa34e8c7ca8bbd8d51988e22a
set RPC=https://rpc.starknet.lava.build

set WALLET_DIR=%USERPROFILE%\.starkli-wallets
set ACCOUNT_FILE=%WALLET_DIR%\account.json
set SIGNER_FILE=%WALLET_DIR%\signer.json

echo Creating wallet directory...
if not exist "%WALLET_DIR%" mkdir "%WALLET_DIR%"

REM Step 1: Create signer from private key
echo.
echo Step 1: Creating signer from private key...
if exist "%SIGNER_FILE%" (
    echo WARNING: Signer file already exists at %SIGNER_FILE%
    set /p OVERWRITE="Overwrite? (y/n): "
    if /i not "%OVERWRITE%"=="y" (
        echo Skipping signer creation
        goto fetch_account
    )
    del "%SIGNER_FILE%"
)

echo %PRIVATE_KEY% | starkli signer keystore from-key "%SIGNER_FILE%"
echo ✓ Signer created

:fetch_account
REM Step 2: Fetch account
echo.
echo Step 2: Fetching account from network...
if exist "%ACCOUNT_FILE%" (
    echo WARNING: Account file already exists at %ACCOUNT_FILE%
    set /p OVERWRITE="Overwrite? (y/n): "
    if /i not "%OVERWRITE%"=="y" (
        echo Skipping account fetch
        goto check_balance
    )
    del "%ACCOUNT_FILE%"
)

starkli account fetch %WALLET_ADDRESS% --output "%ACCOUNT_FILE%" --rpc %RPC%
echo ✓ Account fetched

:check_balance
REM Step 3: Check balance
echo.
echo Step 3: Checking STRK balance...
starkli balance %WALLET_ADDRESS% --rpc %RPC%

echo.
echo ============================================
echo ✓ Wallet Setup Complete!
echo ============================================
echo.
echo Wallet Address: %WALLET_ADDRESS%
echo Account File:   %ACCOUNT_FILE%
echo Signer File:    %SIGNER_FILE%
echo.
echo You can now run: deploy.bat
echo.

pause
