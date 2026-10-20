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
            },
            "/v1/payment-requests/{id}/split": {
                "post": {
                    "summary": "Split a payment request across several payers",
                    "description": "Creates per-payer shares for a payment request. Shares may be equal or custom, but always sum to the request total (uneven splits are rounded so the remainder is distributed).",
                    "parameters": [
                        {
                            "name": "id",
                            "in": "path",
                            "required": true,
                            "schema": { "type": "string" }
                        }
                    ],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["mode", "payers"],
                                    "properties": {
                                        "mode": {
                                            "type": "string",
                                            "enum": ["equal", "custom"]
                                        },
                                        "payers": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "required": ["payer"],
                                                "properties": {
                                                    "payer": { "type": "string" },
                                                    "amount": {
                                                        "type": "string",
                                                        "description": "Required when mode is custom"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "200": {
                            "description": "Split created",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "shares": {
                                                "type": "array",
                                                "items": { "$ref": "#/components/schemas/PaymentShare" }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "400": {
                            "description": "Shares do not sum to the total"
                        },
                        "401": {
                            "description": "Unauthorized"
                        },
                        "404": {
                            "description": "Payment request not found"
                        }
                    }
                }
            },
            "/v1/payment-requests/{id}/shares/{payer}/pay": {
                "post": {
                    "summary": "Pay a payer's share",
                    "description": "Marks a single payer's share as paid. The payment request completes when all shares are paid.",
                    "parameters": [
                        {
                            "name": "id",
                            "in": "path",
                            "required": true,
                            "schema": { "type": "string" }
                        },
                        {
                            "name": "payer",
                            "in": "path",
                            "required": true,
                            "schema": { "type": "string" }
                        }
                    ],
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "200": {
                            "description": "Share paid",
                            "content": {
                                "application/json": {
                                    "schema": { "$ref": "#/components/schemas/PaymentShare" }
                                }
                            }
                        },
                        "401": {
                            "description": "Unauthorized"
                        },
                        "404": {
                            "description": "Payment request or share not found"
                        },
                        "409": {
                            "description": "Share already paid or request cancelled"
                        }
                    }
                }
            },
            "/v1/payment-requests/{id}/cancel": {
                "post": {
                    "summary": "Cancel a split payment request",
                    "description": "Cancels the payment request and refunds any partial payments already collected. Only the creator may cancel.",
                    "parameters": [
                        {
                            "name": "id",
                            "in": "path",
                            "required": true,
                            "schema": { "type": "string" }
                        }
                    ],
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "200": {
                            "description": "Request cancelled and partial payments refunded"
                        },
                        "401": {
                            "description": "Unauthorized"
                        },
                        "403": {
                            "description": "Only the creator may cancel"
                        },
                        "404": {
                            "description": "Payment request not found"
                        },
                        "409": {
                            "description": "Request already completed or cancelled"
                        }
                    }
                }
            },
            "/v1/contacts": {
                "get": {
                    "summary": "List saved contacts",
                    "description": "Returns the authenticated user's saved contacts.",
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "200": {
                            "description": "List of contacts",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": { "$ref": "#/components/schemas/Contact" }
                                    }
                                }
                            }
                        },
                        "401": {
                            "description": "Unauthorized"
                        }
                    }
                },
                "post": {
                    "summary": "Create a contact",
                    "description": "Stores a tag or chain address with a label for the authenticated user.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["label", "address"],
                                    "properties": {
                                        "label": { "type": "string" },
                                        "address": { "type": "string" },
                                        "chain": { "type": "string" }
                                    }
                                }
                            }
                        }
                    },
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "201": {
                            "description": "Contact created",
                            "content": {
                                "application/json": {
                                    "schema": { "$ref": "#/components/schemas/Contact" }
                                }
                            }
                        },
                        "400": {
                            "description": "Invalid contact"
                        },
                        "401": {
                            "description": "Unauthorized"
                        }
                    }
                }
            },
            "/v1/contacts/{id}": {
                "patch": {
                    "summary": "Update a contact",
                    "parameters": [
                        {
                            "name": "id",
                            "in": "path",
                            "required": true,
                            "schema": { "type": "string" }
                        }
                    ],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "label": { "type": "string" },
                                        "address": { "type": "string" },
                                        "chain": { "type": "string" }
                                    }
                                }
                            }
                        }
                    },
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "200": {
                            "description": "Contact updated",
                            "content": {
                                "application/json": {
                                    "schema": { "$ref": "#/components/schemas/Contact" }
                                }
                            }
                        },
                        "401": {
                            "description": "Unauthorized"
                        },
                        "404": {
                            "description": "Contact not found"
                        }
                    }
                },
                "delete": {
                    "summary": "Delete a contact",
                    "parameters": [
                        {
                            "name": "id",
                            "in": "path",
                            "required": true,
                            "schema": { "type": "string" }
                        }
                    ],
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "204": {
                            "description": "Contact deleted"
                        },
                        "401": {
                            "description": "Unauthorized"
                        },
                        "404": {
                            "description": "Contact not found"
                        }
                    }
                }
            },
            "/v1/recipients/risk": {
                "get": {
                    "summary": "Assess recipient risk",
                    "description": "Flags first-time recipients and very similar-looking (look-alike) addresses that may indicate address poisoning.",
                    "parameters": [
                        {
                            "name": "address",
                            "in": "query",
                            "required": true,
                            "schema": { "type": "string" }
                        },
                        {
                            "name": "chain",
                            "in": "query",
                            "schema": { "type": "string" }
                        }
                    ],
                    "security": [
                        { "bearerAuth": [] }
                    ],
                    "responses": {
                        "200": {
                            "description": "Recipient risk assessment",
                            "content": {
                                "application/json": {
                                    "schema": { "$ref": "#/components/schemas/RecipientRisk" }
                                }
                            }
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
            },
            "schemas": {
                "PaymentShare": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "payment_request_id": { "type": "string" },
                        "payer": { "type": "string" },
                        "amount": { "type": "string" },
                        "status": {
                            "type": "string",
                            "enum": ["pending", "paid", "refunded"]
                        }
                    }
                },
                "Contact": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "label": { "type": "string" },
                        "address": { "type": "string" },
                        "chain": { "type": "string" },
                        "created_at": { "type": "string", "format": "date-time" }
                    }
                },
                "RecipientRisk": {
                    "type": "object",
                    "properties": {
                        "address": { "type": "string" },
                        "is_first_time": { "type": "boolean" },
                        "is_look_alike": { "type": "boolean" },
                        "similar_to": {
                            "type": "array",
                            "items": { "type": "string" }
                        },
                        "risk_level": {
                            "type": "string",
                            "enum": ["low", "medium", "high"]
                        }
                    }
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
                "name": "Payment Requests",
                "description": "Split payment requests and per-payer shares"
            },
            {
                "name": "Contacts",
                "description": "Saved contacts and recipient risk checks"
            }
        ]
    }))
}
