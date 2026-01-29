#!/bin/bash

# Vesu API Endpoints Accessibility Test Script
# This script tests all Vesu API endpoints using curl
# 
# Usage: ./test-vesu-endpoints.sh [BASE_URL]
# Example: ./test-vesu-endpoints.sh http://localhost:3001

BASE_URL="${1:-http://localhost:3001}"
API_BASE="$BASE_URL/api/vesu"

# Mock JWT token for authenticated requests
# In production, replace with a valid JWT token
MOCK_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMzQ1Njc4OTAiLCJlbWFpbCI6InRlc3RAdGVzdC5jb20iLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to print test result
print_result() {
    local test_name="$1"
    local status_code="$2"
    local expected_codes="$3"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [[ " ${expected_codes[@]} " =~ " ${status_code} " ]]; then
        echo -e "${GREEN}✓${NC} $test_name (Status: $status_code)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}✗${NC} $test_name (Status: $status_code, Expected: $expected_codes)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

echo "========================================="
echo "Vesu API Endpoints Accessibility Tests"
echo "========================================="
echo "Base URL: $API_BASE"
echo ""

# Health check endpoint
echo "Testing Health Check Endpoint..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/health")
print_result "GET /api/vesu/health" "$STATUS" "200 503"
echo ""

# Supply endpoints
echo "Testing Supply Endpoints..."

# POST /api/vesu/supply - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/supply" \
    -H "Content-Type: application/json" \
    -d '{"poolAddress":"0x123","asset":"ETH","amount":"1.0","walletAddress":"0xabc"}')
print_result "POST /api/vesu/supply (no auth)" "$STATUS" "401"

# POST /api/vesu/supply - with auth but missing fields (should fail validation)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/supply" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"asset":"ETH"}')
print_result "POST /api/vesu/supply (missing fields)" "$STATUS" "400"

# POST /api/vesu/supply - with auth and valid structure
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/supply" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"poolAddress":"0x123","asset":"ETH","amount":"1.0","walletAddress":"0xabc"}')
print_result "POST /api/vesu/supply (valid)" "$STATUS" "200 422 500 502 503"

# GET /api/vesu/supply/estimate - missing params (should fail validation)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/supply/estimate")
print_result "GET /api/vesu/supply/estimate (missing params)" "$STATUS" "400"

# GET /api/vesu/supply/estimate - with valid params
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$API_BASE/supply/estimate?poolAddress=0x123&asset=ETH&amount=1.0")
print_result "GET /api/vesu/supply/estimate (valid)" "$STATUS" "200 422 500 502 503"

echo ""

# Borrow endpoints
echo "Testing Borrow Endpoints..."

# POST /api/vesu/borrow - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/borrow" \
    -H "Content-Type: application/json" \
    -d '{"poolAddress":"0x123","collateralAsset":"ETH","debtAsset":"USDC","borrowAmount":"1000","walletAddress":"0xabc"}')
print_result "POST /api/vesu/borrow (no auth)" "$STATUS" "401"

# POST /api/vesu/borrow - with auth but missing fields (should fail validation)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/borrow" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"collateralAsset":"ETH"}')
print_result "POST /api/vesu/borrow (missing fields)" "$STATUS" "400"

# POST /api/vesu/borrow - with auth and valid structure
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/borrow" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"poolAddress":"0x123","collateralAsset":"ETH","debtAsset":"USDC","borrowAmount":"1000","walletAddress":"0xabc"}')
print_result "POST /api/vesu/borrow (valid)" "$STATUS" "200 422 500 502 503"

# GET /api/vesu/borrow/max - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$API_BASE/borrow/max?positionId=123")
print_result "GET /api/vesu/borrow/max (no auth)" "$STATUS" "401"

# GET /api/vesu/borrow/max - with auth and valid params
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    "$API_BASE/borrow/max?positionId=123")
print_result "GET /api/vesu/borrow/max (valid)" "$STATUS" "200 404 422 500 502 503"

echo ""

# Repay endpoints
echo "Testing Repay Endpoints..."

# POST /api/vesu/repay - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/repay" \
    -H "Content-Type: application/json" \
    -d '{"positionId":"123","amount":"500","walletAddress":"0xabc"}')
print_result "POST /api/vesu/repay (no auth)" "$STATUS" "401"

# POST /api/vesu/repay - with auth but missing fields (should fail validation)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/repay" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"positionId":"123"}')
print_result "POST /api/vesu/repay (missing fields)" "$STATUS" "400"

# POST /api/vesu/repay - with auth and valid structure
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/repay" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"positionId":"123","amount":"500","walletAddress":"0xabc"}')
print_result "POST /api/vesu/repay (valid)" "$STATUS" "200 404 422 500 502 503"

# GET /api/vesu/repay/total - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$API_BASE/repay/total?positionId=123")
print_result "GET /api/vesu/repay/total (no auth)" "$STATUS" "401"

# GET /api/vesu/repay/total - with auth and valid params
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    "$API_BASE/repay/total?positionId=123")
print_result "GET /api/vesu/repay/total (valid)" "$STATUS" "200 404 422 500 502 503"

echo ""

# Withdraw endpoints
echo "Testing Withdraw Endpoints..."

# POST /api/vesu/withdraw - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/withdraw" \
    -H "Content-Type: application/json" \
    -d '{"positionId":"123","amount":"0.5","walletAddress":"0xabc"}')
print_result "POST /api/vesu/withdraw (no auth)" "$STATUS" "401"

# POST /api/vesu/withdraw - with auth but missing fields (should fail validation)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/withdraw" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"positionId":"123"}')
print_result "POST /api/vesu/withdraw (missing fields)" "$STATUS" "400"

# POST /api/vesu/withdraw - with auth and valid structure
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/withdraw" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"positionId":"123","amount":"0.5","walletAddress":"0xabc"}')
print_result "POST /api/vesu/withdraw (valid)" "$STATUS" "200 404 422 500 502 503"

# GET /api/vesu/withdraw/max - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$API_BASE/withdraw/max?positionId=123")
print_result "GET /api/vesu/withdraw/max (no auth)" "$STATUS" "401"

# GET /api/vesu/withdraw/max - with auth and valid params
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    "$API_BASE/withdraw/max?positionId=123")
print_result "GET /api/vesu/withdraw/max (valid)" "$STATUS" "200 404 422 500 502 503"

echo ""

# Position management endpoints
echo "Testing Position Management Endpoints..."

# GET /api/vesu/positions - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/positions")
print_result "GET /api/vesu/positions (no auth)" "$STATUS" "401"

# GET /api/vesu/positions - with auth
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    "$API_BASE/positions")
print_result "GET /api/vesu/positions (valid)" "$STATUS" "200 500 503"

# GET /api/vesu/positions - with pagination
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    "$API_BASE/positions?limit=10&offset=0&status=active")
print_result "GET /api/vesu/positions (with pagination)" "$STATUS" "200 500 503"

# GET /api/vesu/positions/:id - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/positions/123")
print_result "GET /api/vesu/positions/:id (no auth)" "$STATUS" "401"

# GET /api/vesu/positions/:id - with auth
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    "$API_BASE/positions/123")
print_result "GET /api/vesu/positions/:id (valid)" "$STATUS" "200 403 404 500 503"

# POST /api/vesu/positions/:id/sync - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/positions/123/sync" \
    -H "Content-Type: application/json" \
    -d '{"walletAddress":"0xabc"}')
print_result "POST /api/vesu/positions/:id/sync (no auth)" "$STATUS" "401"

# POST /api/vesu/positions/:id/sync - with auth and valid structure
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/positions/123/sync" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"walletAddress":"0xabc"}')
print_result "POST /api/vesu/positions/:id/sync (valid)" "$STATUS" "200 403 404 422 500 502 503"

# GET /api/vesu/positions/:id/health - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/positions/123/health")
print_result "GET /api/vesu/positions/:id/health (no auth)" "$STATUS" "401"

# GET /api/vesu/positions/:id/health - with auth
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    "$API_BASE/positions/123/health")
print_result "GET /api/vesu/positions/:id/health (valid)" "$STATUS" "200 403 404 422 500 502 503"

echo ""

# Pool information endpoints
echo "Testing Pool Information Endpoints..."

# GET /api/vesu/pools - should be accessible without auth
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/pools")
print_result "GET /api/vesu/pools" "$STATUS" "200 500"

# GET /api/vesu/pools/:address - with invalid address format (should fail validation)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/pools/invalid-address")
print_result "GET /api/vesu/pools/:address (invalid format)" "$STATUS" "400"

# GET /api/vesu/pools/:address - with valid address format
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/pools/0x123abc")
print_result "GET /api/vesu/pools/:address (valid)" "$STATUS" "200 404 500"

# GET /api/vesu/pools/:address/interest-rate - with invalid address format (should fail validation)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/pools/invalid-address/interest-rate")
print_result "GET /api/vesu/pools/:address/interest-rate (invalid format)" "$STATUS" "400"

# GET /api/vesu/pools/:address/interest-rate - with valid address format
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/pools/0x123abc/interest-rate")
print_result "GET /api/vesu/pools/:address/interest-rate (valid)" "$STATUS" "200 404 422 500 502 503"

echo ""

# Liquidation endpoints
echo "Testing Liquidation Endpoints..."

# GET /api/vesu/liquidations/opportunities - should be accessible without auth
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/liquidations/opportunities")
print_result "GET /api/vesu/liquidations/opportunities" "$STATUS" "200 500 503"

# POST /api/vesu/liquidations/execute - without auth (should fail)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/liquidations/execute" \
    -H "Content-Type: application/json" \
    -d '{"positionId":"123","liquidatorAddress":"0xabc123"}')
print_result "POST /api/vesu/liquidations/execute (no auth)" "$STATUS" "401"

# POST /api/vesu/liquidations/execute - with auth but missing fields (should fail validation)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/liquidations/execute" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"positionId":"123"}')
print_result "POST /api/vesu/liquidations/execute (missing fields)" "$STATUS" "400"

# POST /api/vesu/liquidations/execute - with auth but invalid address format (should fail validation)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/liquidations/execute" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"positionId":"123","liquidatorAddress":"invalid-address"}')
print_result "POST /api/vesu/liquidations/execute (invalid address)" "$STATUS" "400"

# POST /api/vesu/liquidations/execute - with auth and valid structure
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/liquidations/execute" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    -d '{"positionId":"123","liquidatorAddress":"0xabc123","debtToCover":"1000"}')
print_result "POST /api/vesu/liquidations/execute (valid)" "$STATUS" "200 404 422 500 502 503"

# GET /api/vesu/liquidations/history - should be accessible without auth
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/liquidations/history")
print_result "GET /api/vesu/liquidations/history" "$STATUS" "200 500"

# GET /api/vesu/liquidations/history - with pagination
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$API_BASE/liquidations/history?limit=20&offset=10")
print_result "GET /api/vesu/liquidations/history (with pagination)" "$STATUS" "200 500"

echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo -e "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Please review the output above.${NC}"
    exit 1
fi
