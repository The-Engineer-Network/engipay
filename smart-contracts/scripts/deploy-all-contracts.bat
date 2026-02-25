@echo off
REM ============================================================================
REM EngiPay - Deploy All Smart Contracts (Windows)
REM ============================================================================
REM This script deploys all EngiPay smart contracts in the correct order
REM ============================================================================

setlocal enabledelayedexpansion

echo ============================================
echo EngiPay Smart Contracts Deployment
echo ============================================
echo.

REM Configuration
if "%NETWORK%"=="" set NETWORK=sepolia
if "%ACCOUNT%"=="" set ACCOUNT=account0
if "%RPC_URL%"=="" set RPC_URL=https://starknet-sepolia.public.blastapi.io/rpc/v0_7

echo Network: %NETWORK%
echo Account: %ACCOUNT%
echo RPC URL: %RPC_URL%
echo.

REM Build contracts
echo Step 1: Building contracts...
call scarb build
if errorlevel 1 (
    echo ERROR: Build failed
    exit /b 1
)
echo [OK] Build complete
echo.

REM Deploy EngiToken
echo Step 2: Deploying EngiToken...
for /f "tokens=*" %%i in ('starkli deploy target/dev/engipay_contracts_EngiToken.contract_class.json --network %NETWORK% --account %ACCOUNT% --rpc %RPC_URL% str:"EngiPay Token" str:"ENGI" u256:1000000000000000000000000 %ACCOUNT% ^| findstr /R "0x[0-9a-fA-F]"') do set ENGI_TOKEN=%%i
echo [OK] EngiToken deployed at: %ENGI_TOKEN%
echo.

REM Deploy EscrowV2
echo Step 3: Deploying EscrowV2...
for /f "tokens=*" %%i in ('starkli deploy target/dev/engipay_contracts_EscrowV2.contract_class.json --network %NETWORK% --account %ACCOUNT% --rpc %RPC_URL% %ACCOUNT% %ACCOUNT% u256:250 ^| findstr /R "0x[0-9a-fA-F]"') do set ESCROW=%%i
echo [OK] EscrowV2 deployed at: %ESCROW%
echo.

REM Deploy RewardDistributorV2
echo Step 4: Deploying RewardDistributorV2...
for /f "tokens=*" %%i in ('starkli deploy target/dev/engipay_contracts_RewardDistributorV2.contract_class.json --network %NETWORK% --account %ACCOUNT% --rpc %RPC_URL% %ACCOUNT% ^| findstr /R "0x[0-9a-fA-F]"') do set REWARD_DISTRIBUTOR=%%i
echo [OK] RewardDistributorV2 deployed at: %REWARD_DISTRIBUTOR%
echo.

REM Deploy AtomiqAdapter
echo Step 5: Deploying AtomiqAdapter...
for /f "tokens=*" %%i in ('starkli deploy target/dev/engipay_contracts_AtomiqAdapter.contract_class.json --network %NETWORK% --account %ACCOUNT% --rpc %RPC_URL% %ACCOUNT% %ACCOUNT% u256:100 u64:86400 ^| findstr /R "0x[0-9a-fA-F]"') do set ATOMIQ_ADAPTER=%%i
echo [OK] AtomiqAdapter deployed at: %ATOMIQ_ADAPTER%
echo.

REM Deploy VesuAdapter
echo Step 6: Deploying VesuAdapter...
if "%VESU_PROTOCOL%"=="" set VESU_PROTOCOL=0x0000000000000000000000000000000000000000000000000000000000000001
for /f "tokens=*" %%i in ('starkli deploy target/dev/engipay_contracts_VesuAdapter.contract_class.json --network %NETWORK% --account %ACCOUNT% --rpc %RPC_URL% %ACCOUNT% %VESU_PROTOCOL% ^| findstr /R "0x[0-9a-fA-F]"') do set VESU_ADAPTER=%%i
echo [OK] VesuAdapter deployed at: %VESU_ADAPTER%
echo.

REM Save deployment addresses
echo Step 7: Saving deployment addresses...
(
echo {
echo   "network": "%NETWORK%",
echo   "timestamp": "%date% %time%",
echo   "contracts": {
echo     "EngiToken": "%ENGI_TOKEN%",
echo     "EscrowV2": "%ESCROW%",
echo     "RewardDistributorV2": "%REWARD_DISTRIBUTOR%",
echo     "AtomiqAdapter": "%ATOMIQ_ADAPTER%",
echo     "VesuAdapter": "%VESU_ADAPTER%"
echo   }
echo }
) > deployment-addresses.json

echo [OK] Deployment addresses saved to deployment-addresses.json
echo.

REM Display summary
echo ============================================
echo Deployment Complete!
echo ============================================
echo.
echo Contract Addresses:
echo -------------------
echo EngiToken:           %ENGI_TOKEN%
echo EscrowV2:            %ESCROW%
echo RewardDistributorV2: %REWARD_DISTRIBUTOR%
echo AtomiqAdapter:       %ATOMIQ_ADAPTER%
echo VesuAdapter:         %VESU_ADAPTER%
echo.
echo Next Steps:
echo 1. Update your .env file with these addresses
echo 2. Configure the RewardDistributor with reward pools
echo 3. Add supported assets to VesuAdapter
echo 4. Test all contract interactions
echo.

endlocal
