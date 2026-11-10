//! The game server (ADR 0030): runs the world at one tick a second (`apps/server/src/index.ts`),
//! with HTTP and WebSocket sync beside it.

use std::process::ExitCode;

use csp_server::{config::Config, log::init_logging, server};

#[tokio::main]
async fn main() -> ExitCode {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    init_logging(&config.log_level, config.pretty_logs);
    match server::run(config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!("{e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    /// Proves nextest sees this crate (T84.1); a binary crate has no lib target for `tests/`.
    #[test]
    fn csp_server_smoke() {
        assert_eq!(env!("CARGO_PKG_NAME"), "csp-server");
    }
}
