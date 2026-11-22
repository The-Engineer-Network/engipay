use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;

use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/openapi.json", get(get_openapi_spec))
}

/// Returns the OpenAPI 3.0 specification for the EngiPay API.
async fn get_openapi_spec() -> Json<serde_json::Value> {
    Json(json!({
        "openapi": "3.0.0",
        "info": {
            "title": "EngiPay API",
            "version": env!("CARGO_PKG_VERSION"),
            "description": "API for EngiPay financial transactions and money movement",
            "contact": {
                "name": "EngiPay Support"
            }
        },
        "servers": [
            {
                "url": "https://api.engipay.com",
                "description": "Production server"
            },
            {
                "url": "http://localhost:8080",
                "description": "Development server"
            }
        ],
        "paths": {
            "/live": {
                "get": {
                    "summary": "Liveness probe",
                    "description": "Indicates if the process is alive",
                    "responses": {
                        "200": {
                            "description": "Process is alive",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "status": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/ready": {
                "get": {
                    "summary": "Readiness probe",
                    "description": "Indicates if the application is ready to serve traffic",
                    "responses": {
                        "200": {
                            "description": "Application is ready",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "status": { "type": "string" },
                                            "database": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        },
                        "503": {
                            "description": "Service unavailable"
                        }
                    }
                }
            },
            "/v1/deletion-request": {
                "get": {
                    "summary": "Get latest deletion request",
                    "description": "Returns the caller's latest account deletion request and its status",
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "200": {
                            "description": "Latest deletion request",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "id": { "type": "string" },
                                            "status": { "type": "string" },
                                            "created_at": { "type": "string" },
                                            "completed_at": { "type": "string", "nullable": true }
                                        }
                                    }
                                }
                            }
                        },
                        "401": {
                            "description": "Unauthorized"
                        },
                        "404": {
                            "description": "No deletion request found"
                        }
                    }
                }
            },
            "/v1/kyc/session": {
                "get": {
                    "summary": "Get latest KYC session",
                    "description": "Returns the caller's latest KYC verification session",
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "200": {
                            "description": "Latest KYC session",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "id": { "type": "string" },
                                            "status": { "type": "string" },
                                            "tier": { "type": "string" },
                                            "created_at": { "type": "string" },
                                            "updated_at": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        },
                        "401": {
                            "description": "Unauthorized"
                        },
                        "404": {
                            "description": "No KYC session found"
                        }
                    }
                }
            },
            "/v1/auth/nonce": {
                "post": {
                    "summary": "Issue a nonce",
                    "description": "Issues a one-time nonce for use in SIWE or Stellar SEP-10 authentication",
                    "tags": ["Auth"],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "address": { "type": "string", "description": "Wallet address (EVM 0x… or Stellar G…)" }
                                    },
                                    "required": ["address"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Nonce issued",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "nonce": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/v1/auth/verify-evm": {
                "post": {
                    "summary": "Verify EVM (SIWE) signature",
                    "description": "Verifies an EIP-191 signed message from an Ethereum or EVM-compatible wallet and issues a session JWT",
                    "tags": ["Auth"],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "message": { "type": "string" },
                                        "signature": { "type": "string" }
                                    },
                                    "required": ["message", "signature"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "JWT issued",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "token": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        },
                        "401": { "description": "Invalid signature or nonce" }
                    }
                }
            },
            "/v1/auth/stellar/challenge": {
                "get": {
                    "summary": "Get Stellar SEP-10 challenge",
                    "description": "Returns a SEP-10 challenge transaction envelope for the given Stellar account",
                    "tags": ["Auth"],
                    "parameters": [
                        { "name": "account", "in": "query", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": {
                            "description": "Challenge transaction",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "transaction": { "type": "string" },
                                            "network_passphrase": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/v1/auth/stellar/verify": {
                "post": {
                    "summary": "Verify Stellar SEP-10 challenge",
                    "description": "Verifies a signed SEP-10 challenge transaction and issues a session JWT",
                    "tags": ["Auth"],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "transaction": { "type": "string" }
                                    },
                                    "required": ["transaction"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "JWT issued",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "token": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        },
                        "401": { "description": "Invalid or expired challenge" }
                    }
                }
            },
            "/v1/auth/logout": {
                "post": {
                    "summary": "Logout",
                    "description": "Revokes the current session token",
                    "tags": ["Auth"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "204": { "description": "Token revoked" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/balances": {
                "get": {
                    "summary": "Get balances",
                    "description": "Returns the authenticated user's balances across all supported assets",
                    "tags": ["Balances"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "200": {
                            "description": "Balances by asset",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "additionalProperties": { "type": "string" }
                                    }
                                }
                            }
                        },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/transfers": {
                "post": {
                    "summary": "Create a transfer",
                    "description": "Initiates a transfer of assets between wallets",
                    "tags": ["Transfers"],
                    "security": [{ "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "to": { "type": "string" },
                                        "asset": { "type": "string" },
                                        "amount": { "type": "string" }
                                    },
                                    "required": ["to", "asset", "amount"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Transfer initiated" },
                        "400": { "description": "Invalid request" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/deposit-address": {
                "get": {
                    "summary": "Get deposit address",
                    "description": "Returns the authenticated user's deposit address for a given chain",
                    "tags": ["Deposits"],
                    "security": [{ "bearerAuth": [] }],
                    "parameters": [
                        { "name": "chain", "in": "query", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": {
                            "description": "Deposit address",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "address": { "type": "string" },
                                            "memo": { "type": "string", "nullable": true }
                                        }
                                    }
                                }
                            }
                        },
                        "401": { "description": "Unauthorized" },
                        "503": { "description": "Chain not configured" }
                    }
                }
            },
            "/v1/withdrawals": {
                "post": {
                    "summary": "Create a withdrawal",
                    "description": "Initiates a withdrawal to an external address",
                    "tags": ["Withdrawals"],
                    "security": [{ "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "to": { "type": "string" },
                                        "asset": { "type": "string" },
                                        "amount": { "type": "string" }
                                    },
                                    "required": ["to", "asset", "amount"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Withdrawal initiated" },
                        "400": { "description": "Invalid request" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/withdrawals/{id}": {
                "get": {
                    "summary": "Get withdrawal status",
                    "description": "Returns the status of a withdrawal by ID",
                    "tags": ["Withdrawals"],
                    "security": [{ "bearerAuth": [] }],
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Withdrawal details" },
                        "401": { "description": "Unauthorized" },
                        "404": { "description": "Withdrawal not found" }
                    }
                }
            },
            "/v1/payment-requests": {
                "get": {
                    "summary": "List payment requests",
                    "description": "Returns payment requests received by the authenticated user",
                    "tags": ["Payment Requests"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "200": { "description": "List of payment requests" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/payment-requests/{id}": {
                "get": {
                    "summary": "Get a payment request",
                    "description": "Returns a single payment request by ID",
                    "tags": ["Payment Requests"],
                    "security": [{ "bearerAuth": [] }],
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Payment request details" },
                        "401": { "description": "Unauthorized" },
                        "404": { "description": "Not found" }
                    }
                }
            },
            "/v1/payment-requests/{id}/pay": {
                "post": {
                    "summary": "Pay a payment request",
                    "description": "Records payment against a payment request",
                    "tags": ["Payment Requests"],
                    "security": [{ "bearerAuth": [] }],
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Payment recorded" },
                        "401": { "description": "Unauthorized" },
                        "404": { "description": "Not found" }
                    }
                }
            },
            "/v1/money-requests": {
                "post": {
                    "summary": "Create a money request",
                    "description": "Creates a new money request to another user",
                    "tags": ["Money Requests"],
                    "security": [{ "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "to": { "type": "string" },
                                        "asset": { "type": "string" },
                                        "amount": { "type": "string" },
                                        "note": { "type": "string", "nullable": true }
                                    },
                                    "required": ["to", "asset", "amount"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Money request created" },
                        "401": { "description": "Unauthorized" }
                    }
                },
                "get": {
                    "summary": "List money requests",
                    "description": "Returns money requests sent and received by the authenticated user",
                    "tags": ["Money Requests"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "200": { "description": "List of money requests" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/money-requests/{id}/accept": {
                "post": {
                    "summary": "Accept a money request",
                    "description": "Accepts and fulfils an incoming money request",
                    "tags": ["Money Requests"],
                    "security": [{ "bearerAuth": [] }],
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Request accepted" },
                        "401": { "description": "Unauthorized" },
                        "404": { "description": "Not found" }
                    }
                }
            },
            "/v1/money-requests/{id}/decline": {
                "post": {
                    "summary": "Decline a money request",
                    "description": "Declines an incoming money request",
                    "tags": ["Money Requests"],
                    "security": [{ "bearerAuth": [] }],
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Request declined" },
                        "401": { "description": "Unauthorized" },
                        "404": { "description": "Not found" }
                    }
                }
            },
            "/v1/buy/quotes": {
                "post": {
                    "summary": "Create a buy quote",
                    "description": "Returns a quote for buying an asset with Naira",
                    "tags": ["Buy"],
                    "security": [{ "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "asset": { "type": "string" },
                                        "amount": { "type": "string" }
                                    },
                                    "required": ["asset", "amount"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Buy quote" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/buy/orders": {
                "post": {
                    "summary": "Create a buy order",
                    "description": "Executes a buy order for an asset with Naira",
                    "tags": ["Buy"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "200": { "description": "Buy order created" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/buy/orders/{id}": {
                "get": {
                    "summary": "Get buy order status",
                    "description": "Returns the status of a buy order",
                    "tags": ["Buy"],
                    "security": [{ "bearerAuth": [] }],
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Buy order details" },
                        "401": { "description": "Unauthorized" },
                        "404": { "description": "Not found" }
                    }
                }
            },
            "/v1/convert/quote": {
                "post": {
                    "summary": "Create a conversion quote",
                    "description": "Returns a quote for converting one asset to another",
                    "tags": ["Convert"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "200": { "description": "Conversion quote" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/convert/execute": {
                "post": {
                    "summary": "Execute a conversion",
                    "description": "Executes an asset conversion",
                    "tags": ["Convert"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "200": { "description": "Conversion executed" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/convert/orders": {
                "get": {
                    "summary": "List conversions",
                    "description": "Returns the authenticated user's conversion history",
                    "tags": ["Convert"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "200": { "description": "List of conversions" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/convert/orders/{id}": {
                "get": {
                    "summary": "Get conversion",
                    "description": "Returns a single conversion order by ID",
                    "tags": ["Convert"],
                    "security": [{ "bearerAuth": [] }],
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Conversion details" },
                        "401": { "description": "Unauthorized" },
                        "404": { "description": "Not found" }
                    }
                }
            },
            "/v1/naira/deposits": {
                "post": {
                    "summary": "Start a Naira deposit",
                    "description": "Initiates a Naira-to-USDC deposit via bank transfer",
                    "tags": ["Naira"],
                    "security": [{ "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "amount": { "type": "string", "description": "Amount in USDC" }
                                    },
                                    "required": ["amount"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Deposit initiated with bank transfer instructions" },
                        "400": { "description": "Invalid amount" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/naira/deposits/{transaction_id}": {
                "get": {
                    "summary": "Get Naira deposit status",
                    "description": "Returns the status of a Naira deposit",
                    "tags": ["Naira"],
                    "security": [{ "bearerAuth": [] }],
                    "parameters": [
                        { "name": "transaction_id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Deposit status" },
                        "401": { "description": "Unauthorized" },
                        "404": { "description": "Not found" }
                    }
                }
            },
            "/v1/naira/withdrawals": {
                "post": {
                    "summary": "Start a Naira withdrawal",
                    "description": "Initiates a USDC-to-Naira withdrawal via bank transfer",
                    "tags": ["Naira"],
                    "security": [{ "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "amount": { "type": "string" },
                                        "bank_account_id": { "type": "string" }
                                    },
                                    "required": ["amount", "bank_account_id"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Withdrawal initiated" },
                        "400": { "description": "Invalid amount" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/quotes": {
                "post": {
                    "summary": "Create a quote",
                    "description": "Returns a price quote for an asset",
                    "tags": ["Quotes"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "200": { "description": "Quote details" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/settles": {
                "post": {
                    "summary": "Settle a hold",
                    "description": "Settles a pending hold, completing the transaction",
                    "tags": ["Settles"],
                    "security": [{ "bearerAuth": [] }],
                    "responses": {
                        "200": { "description": "Hold settled" },
                        "401": { "description": "Unauthorized" }
                    }
                }
            },
            "/v1/transactions": {
                "get": {
                    "summary": "Get transaction history",
                    "description": "Returns chronological transaction history with filters and pagination",
                    "parameters": [
                        {
                            "name": "limit",
                            "in": "query",
                            "schema": { "type": "integer", "default": 20 }
                        },
                        {
                            "name": "cursor",
                            "in": "query",
                            "schema": { "type": "string" }
                        },
                        {
                            "name": "asset",
                            "in": "query",
                            "schema": { "type": "string" }
                        },
                        {
                            "name": "kind",
                            "in": "query",
                            "schema": { "type": "string" }
                        },
                        {
                            "name": "from_date",
                            "in": "query",
                            "schema": { "type": "string" }
                        },
                        {
                            "name": "to_date",
                            "in": "query",
                            "schema": { "type": "string" }
                        }
                    ],
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "200": {
                            "description": "Transaction history"
                        },
                        "401": {
                            "description": "Unauthorized"
                        }
                    }
                }
            }
        },
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT"
                }
            }
        },
        "tags": [
            { "name": "Health", "description": "Service health and readiness checks" },
            { "name": "Auth", "description": "Authentication: nonce, SIWE, Stellar SEP-10, logout" },
            { "name": "Balances", "description": "User asset balances" },
            { "name": "Transfers", "description": "Asset transfers" },
            { "name": "Deposits", "description": "On-chain deposit addresses" },
            { "name": "Withdrawals", "description": "On-chain withdrawals" },
            { "name": "Payment Requests", "description": "Payment requests between users" },
            { "name": "Money Requests", "description": "Money requests between users" },
            { "name": "Buy", "description": "Buy USDC with Naira" },
            { "name": "Convert", "description": "Convert assets" },
            { "name": "Naira", "description": "Naira deposit and withdrawal via bank transfer" },
            { "name": "Quotes", "description": "Price quotes" },
            { "name": "Settles", "description": "Settle holds" },
            { "name": "Transactions", "description": "Transaction history and queries" }
        ]
    }))
}
