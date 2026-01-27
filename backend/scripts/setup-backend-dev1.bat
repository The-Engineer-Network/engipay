@echo off
REM Backend Dev 1 Setup Script for Windows
REM Run with: backend\scripts\setup-backend-dev1.bat

echo.
echo 🚀 Setting up Backend Dev 1 environment...
echo.

REM Check if we're in the backend directory
if not exist "package.json" (
    echo ❌ Error: Please run this script from the backend directory
    echo    cd backend ^&^& scripts\setup-backend-dev1.bat
    exit /b 1
)

REM Check if .env exists
if not exist ".env" (
    echo 📝 Creating .env file from template...
    copy .env.example .env
    echo ✅ .env file created
    echo ⚠️  Please edit .env and add your RPC URLs:
    echo    - ETHEREUM_RPC_URL
    echo    - STARKNET_RPC_URL
    echo    - BITCOIN_RPC_URL
    echo.
) else (
    echo ✅ .env file already exists
)

REM Install dependencies
echo 📦 Installing dependencies...
call npm install
echo ✅ Dependencies installed
echo.

REM Create tests directory if it doesn't exist
if not exist "tests" (
    echo 📁 Creating tests directory...
    mkdir tests
    echo ✅ Tests directory created
)

REM Run test
echo 🧪 Running blockchain service tests...
echo.
node tests\test-blockchain-service.js

if %errorlevel% equ 0 (
    echo.
    echo 🎉 Backend Dev 1 setup complete!
    echo.
    echo ✅ Next steps:
    echo    1. Edit .env and add your RPC URLs
    echo    2. Run: npm run dev
    echo    3. Test endpoints with cURL or Postman
    echo.
    echo 📚 Documentation: backend\BACKEND_DEV1_IMPLEMENTATION.md
) else (
    echo.
    echo ⚠️  Tests failed. Please check your .env configuration
    echo    Make sure you have valid RPC URLs configured
)

pause
