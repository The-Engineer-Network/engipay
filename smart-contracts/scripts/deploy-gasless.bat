@echo off
echo.
echo ========================================
echo   EngiPay Gasless Deployment
echo   Using AVNU Paymaster - No Gas Needed!
echo ========================================
echo.

cd /d "%~dp0"
node deploy-gasless.js

pause
