@echo off
REM EngiPay Contract Deployment - Windows Version

echo ============================================
echo EngiPay Smart Contract Deployment
echo ============================================
echo.

REM Configuration - Using your wallet from .env.local
set WALLET=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
set RPC=https://rpc.starknet.lava.build

set ACCOUNT_FILE=%USERPROFILE%\.starkli-wallets\account.json
set SIGNER_FILE=%USERPROFILE%\.starkli-wallets\signer.json

echo Wallet: %WALLET%
echo RPC: %RPC%
echo.

REM Step 1: Check account
echo Step 1: Checking account...
if not exist "%ACCOUNT_FILE%" (
    echo ❌ Account not found!
    echo.
    echo Please run: setup-wallet.bat
    exit /b 1
)
echo ✓ Account exists
echo.

REM Step 2: Check signer
echo Step 2: Checking signer...
if not exist "%SIGNER_FILE%" (
    echo ❌ Signer not found!
    echo.
    echo Please run: setup-wallet.bat
    exit /b 1
)
echo ✓ Signer exists
echo.

REM Step 3: Check balance
echo Step 3: Checking STRK balance...
starkli balance %WALLET% --rpc %RPC%
echo.

REM Step 4: Declare contracts
echo ============================================
echo Step 4: Declaring Contracts
echo ============================================
echo.

echo Declaring EngiToken...
for /f "tokens=*" %%i in ('starkli declare target/dev/engipay_contracts_EngiToken.contract_class.json --account "%ACCOUNT_FILE%" --keystore "%SIGNER_FILE%" --rpc %RPC% 2^>^&1 ^| findstr /R "0x[0-9a-fA-F]" ^| findstr /V "Class hash declared"') do set ENGI_CLASS=%%i

if "%ENGI_CLASS%"=="" (
    echo ❌ Failed to declare EngiToken
    exit /b 1
)
echo ✓ EngiToken class: %ENGI_CLASS%
echo.

echo Declaring EscrowV2...
for /f "tokens=*" %%i in ('starkli declare target/dev/engipay_contracts_EscrowV2.contract_class.json --account "%ACCOUNT_FILE%" --keystore "%SIGNER_FILE%" --rpc %RPC% 2^>^&1 ^| findstr /R "0x[0-9a-fA-F]" ^| findstr /V "Class hash declared"') do set ESCROW_CLASS=%%i

if "%ESCROW_CLASS%"=="" (
    echo ❌ Failed to declare EscrowV2
    exit /b 1
)
echo ✓ EscrowV2 class: %ESCROW_CLASS%
echo.

echo Declaring AtomiqAdapter...
for /f "tokens=*" %%i in ('starkli declare target/dev/engipay_contracts_AtomiqAdapter.contract_class.json --account "%ACCOUNT_FILE%" --keystore "%SIGNER_FILE%" --rpc %RPC% 2^>^&1 ^| findstr /R "0x[0-9a-fA-F]" ^| findstr /V "Class hash declared"') do set ATOMIQ_CLASS=%%i

if "%ATOMIQ_CLASS%"=="" (
    echo ❌ Failed to declare AtomiqAdapter
    exit /b 1
)
echo ✓ AtomiqAdapter class: %ATOMIQ_CLASS%
echo.

REM Step 5: Deploy contracts
echo ============================================
echo Step 5: Deploying Contracts
echo ============================================
echo.

echo Deploying EngiToken...
for /f "tokens=*" %%i in ('starkli deploy %ENGI_CLASS% --account "%ACCOUNT_FILE%" --keystore "%SIGNER_FILE%" --rpc %RPC% str:"EngiPay Token" str:"ENGI" u256:1000000000000000000000000 %WALLET% 2^>^&1 ^| findstr "Contract deployed:"') do set DEPLOY_OUTPUT=%%i
for /f "tokens=3" %%i in ("%DEPLOY_OUTPUT%") do set ENGI_TOKEN=%%i

if "%ENGI_TOKEN%"=="" (
    echo ❌ Failed to deploy EngiToken
    exit /b 1
)
echo ✓ EngiToken: %ENGI_TOKEN%
echo.

echo Deploying EscrowV2...
for /f "tokens=*" %%i in ('starkli deploy %ESCROW_CLASS% --account "%ACCOUNT_FILE%" --keystore "%SIGNER_FILE%" --rpc %RPC% %WALLET% %WALLET% u256:250 2^>^&1 ^| findstr "Contract deployed:"') do set DEPLOY_OUTPUT=%%i
for /f "tokens=3" %%i in ("%DEPLOY_OUTPUT%") do set ESCROW=%%i

if "%ESCROW%"=="" (
    echo ❌ Failed to deploy EscrowV2
    exit /b 1
)
echo ✓ EscrowV2: %ESCROW%
echo.

echo Deploying AtomiqAdapter...
for /f "tokens=*" %%i in ('starkli deploy %ATOMIQ_CLASS% --account "%ACCOUNT_FILE%" --keystore "%SIGNER_FILE%" --rpc %RPC% %WALLET% %WALLET% u256:100 u64:86400 2^>^&1 ^| findstr "Contract deployed:"') do set DEPLOY_OUTPUT=%%i
for /f "tokens=3" %%i in ("%DEPLOY_OUTPUT%") do set ATOMIQ=%%i

if "%ATOMIQ%"=="" (
    echo ❌ Failed to deploy AtomiqAdapter
    exit /b 1
)
echo ✓ AtomiqAdapter: %ATOMIQ%
echo.

REM Save results
echo ============================================
echo Deployment Complete!
echo ============================================
echo.
echo Contract Addresses:
echo -------------------
echo EngiToken:       %ENGI_TOKEN%
echo EscrowV2:        %ESCROW%
echo AtomiqAdapter:   %ATOMIQ%
echo.

REM Save to file
(
echo {
echo   "network": "sepolia",
echo   "timestamp": "%date% %time%",
echo   "deployer": "%WALLET%",
echo   "contracts": {
echo     "EngiToken": "%ENGI_TOKEN%",
echo     "EscrowV2": "%ESCROW%",
echo     "AtomiqAdapter": "%ATOMIQ%"
echo   },
echo   "explorer": {
echo     "EngiToken": "https://sepolia.starkscan.co/contract/%ENGI_TOKEN%",
echo     "EscrowV2": "https://sepolia.starkscan.co/contract/%ESCROW%",
echo     "AtomiqAdapter": "https://sepolia.starkscan.co/contract/%ATOMIQ%"
echo   }
echo }
) > deployment-addresses.json

echo ✓ Saved to deployment-addresses.json
echo.
echo Update your .env.local with these addresses!
echo.

pause
