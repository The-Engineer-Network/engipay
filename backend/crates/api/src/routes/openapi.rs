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
            }
        ]
    }))
}
