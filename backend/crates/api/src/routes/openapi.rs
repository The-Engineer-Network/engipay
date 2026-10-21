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
            "/v1/quotes/stellar-path": {
                "post": {
                    "summary": "Quote a Stellar path payment",
                    "description": "Finds a path with Horizon and quotes a strict-send or strict-receive cross-asset payment",
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["source_asset", "dest_asset", "amount"],
                                    "properties": {
                                        "source_asset": { "type": "string", "description": "Asset to send, e.g. XLM or USDC:GA..." },
                                        "dest_asset": { "type": "string", "description": "Asset to receive, e.g. USDC:GA..." },
                                        "amount": { "type": "string", "description": "Amount in the mode's asset" },
                                        "mode": { "type": "string", "enum": ["strict_send", "strict_receive"], "default": "strict_send" },
                                        "slippage_bps": { "type": "integer", "description": "Maximum slippage in basis points", "default": 50 }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Path quote",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "source_amount": { "type": "string" },
                                            "dest_amount": { "type": "string" },
                                            "path": { "type": "array", "items": { "type": "string" } },
                                            "slippage_bps": { "type": "integer" },
                                            "min_dest_amount": { "type": "string" },
                                            "max_source_amount": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        },
                        "401": { "description": "Unauthorized" },
                        "422": { "description": "No path found or invalid request" }
                    }
                }
            },
            "/v1/transfers/stellar-path": {
                "post": {
                    "summary": "Send a Stellar path payment",
                    "description": "Executes a cross-asset path payment enforcing the user's slippage limit and records sent/received amounts in the ledger",
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["source_asset", "dest_asset", "amount", "destination"],
                                    "properties": {
                                        "source_asset": { "type": "string" },
                                        "dest_asset": { "type": "string" },
                                        "amount": { "type": "string" },
                                        "destination": { "type": "string", "description": "Recipient Stellar account" },
                                        "mode": { "type": "string", "enum": ["strict_send", "strict_receive"], "default": "strict_send" },
                                        "slippage_bps": { "type": "integer", "description": "Maximum slippage in basis points", "default": 50 }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Path payment submitted",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "transaction_id": { "type": "string" },
                                            "stellar_tx_hash": { "type": "string" },
                                            "sent_amount": { "type": "string" },
                                            "sent_asset": { "type": "string" },
                                            "received_amount": { "type": "string" },
                                            "received_asset": { "type": "string" },
                                            "status": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        },
                        "401": { "description": "Unauthorized" },
                        "422": { "description": "Slippage limit exceeded or no path found" }
                    }
                }
            },
            "/sep31/transactions": {
                "post": {
                    "summary": "SEP-31: initiate an inbound cross-border payment",
                    "description": "Receiving anchor endpoint used by foreign senders to initiate a cross-border payment",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["amount", "asset_code", "sender_id", "receiver_id"],
                                    "properties": {
                                        "amount": { "type": "string" },
                                        "asset_code": { "type": "string" },
                                        "asset_issuer": { "type": "string" },
                                        "sender_id": { "type": "string" },
                                        "receiver_id": { "type": "string" },
                                        "fields": {
                                            "type": "object",
                                            "additionalProperties": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "201": {
                            "description": "Transaction created",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "id": { "type": "string" },
                                            "stellar_account_id": { "type": "string" },
                                            "stellar_memo": { "type": "string" },
                                            "stellar_memo_type": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        },
                        "400": { "description": "Invalid request" }
                    }
                }
            },
            "/sep31/transactions/{id}": {
                "get": {
                    "summary": "SEP-31: get transaction status",
                    "description": "Returns the status of an inbound SEP-31 transaction",
                    "parameters": [
                        {
                            "name": "id",
                            "in": "path",
                            "required": true,
                            "schema": { "type": "string" }
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Transaction status",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "id": { "type": "string" },
                                            "status": { "type": "string" },
                                            "amount_in": { "type": "string" },
                                            "amount_out": { "type": "string" },
                                            "amount_fee": { "type": "string" },
                                            "started_at": { "type": "string" },
                                            "completed_at": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        },
                        "404": { "description": "Transaction not found" }
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
            {
                "name": "Health",
                "description": "Service health and readiness checks"
            },
            {
                "name": "Transactions",
                "description": "Transaction history and queries"
            },
            {
                "name": "Stellar Path Payments",
                "description": "Cross-asset path payment quotes and transfers"
            },
            {
                "name": "SEP-31",
                "description": "Inbound cross-border payments (receiving anchor)"
            }
        ]
    }))
}
