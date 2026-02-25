# EngiPay Contract Deployment - Windows PowerShell
# Run this script from PowerShell

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "EngiPay Contract Deployment (Windows)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$NETWORK = "sepolia"
$RPC_URL = "https://free-rpc.nethermind.io/sepolia-juno/v0_7"
$ACCOUNT_FILE = "$HOME\.starkli-wallets\deployer\account.json"
$KEYSTORE_FILE = "$HOME\.starkli-wallets\deployer\keystore.json"

# Check if starkli is installed
Write-Host "Checking for starkli..." -ForegroundColor Yellow
try {
    $starkliVersion = starkli --version 2>&1
    Write-Host "✓ Starkli found: $starkliVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Starkli not found on Windows" -ForegroundColor Red
    Write-Host ""
    Write-Host "To install Starkli on Windows:" -ForegroundColor Yellow
    Write-Host "1. Install Rust: https://rustup.rs/" -ForegroundColor White
    Write-Host "2. Run: cargo install --locked --git https://github.com/xJonathanLEI/starkli" -ForegroundColor White
    Write-Host ""
    Write-Host "Or use WSL Ubuntu (after fixing DNS)" -ForegroundColor Yellow
    exit 1
}

# Check if account files exist
if (-not (Test-Path $ACCOUNT_FILE)) {
    Write-Host "✗ Account file not found: $ACCOUNT_FILE" -ForegroundColor Red
    Write-Host "Copying from WSL..." -ForegroundColor Yellow
    
    $wslAccountPath = "/home/hp/.starkli-wallets/deployer/account.json"
    $wslKeystorePath = "/home/hp/.starkli-wallets/deployer/keystore.json"
    
    # Create directory
    New-Item -ItemType Directory -Force -Path "$HOME\.starkli-wallets\deployer" | Out-Null
    
    # Copy files from WSL
    wsl cp $wslAccountPath /mnt/c/Users/$env:USERNAME/.starkli-wallets/deployer/account.json
    wsl cp $wslKeystorePath /mnt/c/Users/$env:USERNAME/.starkli-wallets/deployer/keystore.json
    
    Write-Host "✓ Files copied from WSL" -ForegroundColor Green
}

Write-Host ""
Write-Host "Network: $NETWORK" -ForegroundColor Blue
Write-Host "RPC: $RPC_URL" -ForegroundColor Blue
Write-Host ""

# Get account address
$accountContent = Get-Content $ACCOUNT_FILE | ConvertFrom-Json
$ACCOUNT_ADDRESS = $accountContent.deployment.address
Write-Host "Account: $ACCOUNT_ADDRESS" -ForegroundColor Blue
Write-Host ""

# Deploy account first
Write-Host "Deploying account..." -ForegroundColor Yellow
try {
    starkli account deploy `
        --rpc $RPC_URL `
        --keystore $KEYSTORE_FILE `
        $ACCOUNT_FILE
    Write-Host "✓ Account deployed" -ForegroundColor Green
} catch {
    Write-Host "Account may already be deployed or needs funding" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Building contracts..." -ForegroundColor Yellow
scarb build
Write-Host "✓ Build complete" -ForegroundColor Green
Write-Host ""

# Function to declare and deploy
function Deploy-Contract {
    param(
        [string]$ContractName,
        [string]$ConstructorArgs
    )
    
    Write-Host "=== Deploying $ContractName ===" -ForegroundColor Cyan
    
    $contractFile = "target\dev\engipay_contracts_$ContractName.contract_class.json"
    
    if (-not (Test-Path $contractFile)) {
        Write-Host "✗ Contract file not found: $contractFile" -ForegroundColor Red
        return $null
    }
    
    # Declare
    Write-Host "Declaring contract..." -ForegroundColor Yellow
    $declareOutput = starkli declare `
        --rpc $RPC_URL `
        --account $ACCOUNT_FILE `
        --keystore $KEYSTORE_FILE `
        $contractFile 2>&1 | Out-String
    
    $classHash = if ($declareOutput -match "0x[0-9a-fA-F]{64}") { $matches[0] } else { $null }
    
    if (-not $classHash) {
        Write-Host "Contract may already be declared" -ForegroundColor Yellow
        # Try to get from file
        $contractContent = Get-Content $contractFile | ConvertFrom-Json
        $classHash = $contractContent.class_hash
    }
    
    Write-Host "Class hash: $classHash" -ForegroundColor White
    
    # Deploy
    Write-Host "Deploying contract..." -ForegroundColor Yellow
    $deployArgs = @(
        "deploy",
        "--rpc", $RPC_URL,
        "--account", $ACCOUNT_FILE,
        "--keystore", $KEYSTORE_FILE,
        $classHash
    ) + $ConstructorArgs.Split(" ")
    
    $deployOutput = & starkli @deployArgs 2>&1 | Out-String
    
    $contractAddress = if ($deployOutput -match "0x[0-9a-fA-F]{64}") { $matches[0] } else { $null }
    
    Write-Host "✓ $ContractName deployed at: $contractAddress" -ForegroundColor Green
    Write-Host ""
    
    return $contractAddress
}

# Deploy contracts
$ENGI_TOKEN = Deploy-Contract -ContractName "EngiToken" `
    -ConstructorArgs "str:EngiPay str:ENGI u256:1000000000000000000000000 $ACCOUNT_ADDRESS"

$ESCROW = Deploy-Contract -ContractName "EscrowV2" `
    -ConstructorArgs "$ACCOUNT_ADDRESS $ACCOUNT_ADDRESS u256:250"

# Save addresses
$deployment = @{
    network = $NETWORK
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    deployer = $ACCOUNT_ADDRESS
    contracts = @{
        EngiToken = $ENGI_TOKEN
        EscrowV2 = $ESCROW
    }
} | ConvertTo-Json -Depth 10

$deployment | Out-File -FilePath "deployment-addresses.json" -Encoding UTF8

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Contract Addresses:" -ForegroundColor White
Write-Host "-------------------" -ForegroundColor White
Write-Host "EngiToken: $ENGI_TOKEN" -ForegroundColor Blue
Write-Host "EscrowV2:  $ESCROW" -ForegroundColor Blue
Write-Host ""
Write-Host "Saved to: deployment-addresses.json" -ForegroundColor White
Write-Host ""
Write-Host "View on Starkscan:" -ForegroundColor White
Write-Host "https://sepolia.starkscan.co/contract/$ENGI_TOKEN" -ForegroundColor Cyan
Write-Host "https://sepolia.starkscan.co/contract/$ESCROW" -ForegroundColor Cyan
Write-Host ""
