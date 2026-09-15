use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_addr: String,
    pub database_url: Option<String>,
    pub db_max_connections: u32,
    pub allowed_origins: Vec<String>,
    pub json_logs: bool,
}

#[derive(Debug, thiserror::Error)]
#[error("{name} is invalid: {reason}")]
pub struct ConfigError {
    name: &'static str,
    reason: String,
}

impl Config {
    /// Reads configuration from the environment. Secrets such as the database
    /// password arrive this way and are never written to the repository.
    pub fn from_env() -> Result<Self, ConfigError> {
        let db_max_connections = match env::var("DB_MAX_CONNECTIONS") {
            Ok(value) => value.parse().map_err(|_| ConfigError {
                name: "DB_MAX_CONNECTIONS",
                reason: format!("expected a whole number, got {value:?}"),
            })?,
            Err(_) => 10,
        };

        Ok(Self {
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_owned()),
            database_url: env::var("DATABASE_URL")
                .ok()
                .filter(|url| !url.trim().is_empty()),
            db_max_connections,
            allowed_origins: env::var("ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:3000".to_owned())
                .split(',')
                .map(|origin| origin.trim().to_owned())
                .filter(|origin| !origin.is_empty())
                .collect(),
            json_logs: env::var("LOG_FORMAT")
                .is_ok_and(|format| format.eq_ignore_ascii_case("json")),
        })
    }

    /// A configuration for tests: no database, the local web origin.
    pub fn for_tests() -> Self {
        Self {
            bind_addr: "127.0.0.1:0".to_owned(),
            database_url: None,
            db_max_connections: 1,
            allowed_origins: vec!["http://localhost:3000".to_owned()],
            json_logs: false,
        }
    }
}
