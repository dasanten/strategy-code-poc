//! The server's configuration from the environment (`apps/server/src/config.ts`): the same
//! variables, the same defaults. One `.env` at the repo root serves server and client; real
//! environment variables win over it.

use std::path::{Path, PathBuf};

/// Where Vite serves the client in development (`apps/web/vite.config.ts`).
const DEV_ORIGINS: &str = "http://localhost:5173,http://127.0.0.1:5173";

/// Which browsers may open the WebSocket (`deploy/.env.example`): the request's own host always
/// may; `allowed` lists any others. A socket without an Origin (not a browser) is let in only
/// outside production.
#[derive(Debug, Clone, PartialEq)]
pub struct Origins {
    pub allowed: Vec<String>,
    pub allow_missing: bool,
}

/// What one WebSocket client may do, so no client can swamp the server (`realtime.ts`).
#[derive(Debug, Clone, PartialEq)]
pub struct RealtimeLimits {
    /// The largest frame a client may send, in bytes; a larger frame closes the socket.
    pub max_payload_bytes: usize,
    /// Messages a socket may send at once, and how many a second it earns back (a token bucket).
    pub message_burst: u32,
    pub messages_per_second: u32,
    /// The most sockets one account may hold open at once (its tabs); the next is refused.
    pub connections_per_user: usize,
    /// The most orders a realm may have waiting for the next tick; the next is rejected.
    pub pending_orders_per_realm: usize,
    /// A message longer than this many bytes goes out gzipped as a binary frame, to a client
    /// whose protocol version takes them (ADR 0034).
    pub compress_over_bytes: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub port: u16,
    pub host: String,
    pub db_path: PathBuf,
    /// A world save is written every this many ticks, and on shutdown (ADR 0006).
    pub save_every_ticks: u64,
    /// Where SQLite backups go (ADR 0007). Unset means no backups, the default in dev.
    pub backup_dir: Option<PathBuf>,
    /// The built client, served by the server in production. Unset in dev, where Vite serves it.
    pub web_dist: Option<PathBuf>,
    /// Session cookies only over HTTPS. On in production, where Caddy terminates TLS.
    pub secure_cookies: bool,
    /// Trust X-Forwarded-For from the reverse proxy, so rate limits see the real client IP.
    pub trust_proxy: bool,
    pub environment: String,
    pub log_level: String,
    /// Pretty logs for a human at a terminal; JSON lines in production.
    pub pretty_logs: bool,
    /// Unset means Sentry reporting is off and only logs are written.
    pub sentry_dsn: Option<String>,
    /// Share of ticks whose invariants are checked: every tick in dev, sampled in prod.
    pub invariant_sample_rate: f64,
    /// A tick slower than this is reported as a warning naming its slowest phase (the budget is
    /// `TICK_MS`). `SLOW_TICK_MS` lowers it in development to see the warning on a quiet world.
    pub slow_tick_ms: f64,
    pub origins: Origins,
    pub realtime: RealtimeLimits,
}

/// A variable that holds no number where one is needed. The TypeScript took it as `NaN` and
/// failed later (or, for a rate, never checked); this server refuses to start instead.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{name} is not a number: {value:?}")]
pub struct ConfigError {
    pub name: &'static str,
    pub value: String,
}

/// Loads the repo root's `.env` if there is one (`process.loadEnvFile`): it never overrides a
/// variable that is already set.
pub fn load_env_file() {
    let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.env");
    if file.exists() {
        let _ = dotenvy::from_path(file);
    }
}

impl Config {
    /// The configuration from the process environment, after [`load_env_file`].
    pub fn from_env() -> Result<Config, ConfigError> {
        load_env_file();
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// The configuration from `var`, which gives a variable's value or `None` when it is unset.
    pub fn from_lookup(var: impl Fn(&str) -> Option<String>) -> Result<Config, ConfigError> {
        let is_production = var("NODE_ENV").as_deref() == Some("production");
        // `process.env.X || undefined`: an empty value counts as unset.
        let non_empty = |name: &str| var(name).filter(|v| !v.is_empty());
        let flag = |name: &str| match var(name) {
            Some(v) if !v.is_empty() => v == "true",
            _ => is_production,
        };
        let number = |name: &'static str, default: f64| -> Result<f64, ConfigError> {
            match var(name) {
                None => Ok(default),
                // `Number('')` is 0.
                Some(v) if v.trim().is_empty() => Ok(0.0),
                Some(v) => {
                    v.trim().parse::<f64>().map_err(|_| ConfigError { name, value: v.clone() })
                }
            }
        };
        let port = number("PORT", 3000.0)?;
        if !(0.0..=65535.0).contains(&port) || port.fract() != 0.0 {
            return Err(ConfigError { name: "PORT", value: port.to_string() });
        }
        let allowed = var("ALLOWED_ORIGINS")
            .unwrap_or_else(|| if is_production { String::new() } else { DEV_ORIGINS.into() })
            .split(',')
            .map(str::trim)
            .filter(|o| !o.is_empty())
            .map(String::from)
            .collect();
        Ok(Config {
            port: port as u16,
            host: var("HOST").unwrap_or_else(|| "127.0.0.1".into()),
            db_path: var("DB_PATH").map(PathBuf::from).unwrap_or_else(|| {
                std::env::current_dir().unwrap_or_default().join("data").join("world.db")
            }),
            save_every_ticks: 30,
            backup_dir: non_empty("BACKUP_DIR").map(PathBuf::from),
            web_dist: non_empty("WEB_DIST").map(PathBuf::from),
            secure_cookies: flag("SECURE_COOKIES"),
            trust_proxy: flag("TRUST_PROXY"),
            environment: var("NODE_ENV").unwrap_or_else(|| "development".into()),
            log_level: var("LOG_LEVEL").unwrap_or_else(|| "info".into()),
            pretty_logs: !is_production,
            sentry_dsn: non_empty("SENTRY_DSN"),
            invariant_sample_rate: number(
                "INVARIANT_SAMPLE_RATE",
                if is_production { 0.1 } else { 1.0 },
            )?,
            slow_tick_ms: number("SLOW_TICK_MS", 800.0)?,
            origins: Origins { allowed, allow_missing: !is_production },
            realtime: RealtimeLimits {
                max_payload_bytes: 64 * 1024,
                message_burst: 20,
                messages_per_second: 10,
                connections_per_user: 8,
                pending_orders_per_realm: 100,
                compress_over_bytes: 8 * 1024,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> =
            vars.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        Config::from_lookup(|name| map.get(name).cloned())
    }

    #[test]
    fn has_the_typescript_defaults_in_development() {
        let c = config(&[]).unwrap();
        assert_eq!((c.port, c.host.as_str()), (3000, "127.0.0.1"));
        assert!(c.db_path.ends_with("data/world.db"));
        assert_eq!(c.save_every_ticks, 30);
        assert_eq!((c.backup_dir, c.web_dist, c.sentry_dsn), (None, None, None));
        assert!(!c.secure_cookies && !c.trust_proxy && c.pretty_logs);
        assert_eq!((c.environment.as_str(), c.log_level.as_str()), ("development", "info"));
        assert_eq!((c.invariant_sample_rate, c.slow_tick_ms), (1.0, 800.0));
        assert_eq!(c.origins.allowed, vec!["http://localhost:5173", "http://127.0.0.1:5173"]);
        assert!(c.origins.allow_missing);
        assert_eq!(c.realtime.max_payload_bytes, 65536);
    }

    #[test]
    fn has_the_typescript_defaults_in_production() {
        let c = config(&[("NODE_ENV", "production")]).unwrap();
        assert!(c.secure_cookies && c.trust_proxy && !c.pretty_logs);
        assert_eq!(c.invariant_sample_rate, 0.1);
        assert!(c.origins.allowed.is_empty());
        assert!(!c.origins.allow_missing);
        assert_eq!(c.environment, "production");
    }

    #[test]
    fn reads_every_variable() {
        let c = config(&[
            ("NODE_ENV", "production"),
            ("PORT", "8080"),
            ("HOST", "0.0.0.0"),
            ("DB_PATH", "/data/world.db"),
            ("BACKUP_DIR", "/backups"),
            ("WEB_DIST", "/web"),
            ("SECURE_COOKIES", "false"),
            ("TRUST_PROXY", "nope"),
            ("LOG_LEVEL", "debug"),
            ("SENTRY_DSN", "https://key@sentry.example/1"),
            ("INVARIANT_SAMPLE_RATE", "0.5"),
            ("SLOW_TICK_MS", "50"),
            ("ALLOWED_ORIGINS", " https://a.example , ,https://b.example"),
        ])
        .unwrap();
        assert_eq!((c.port, c.host.as_str()), (8080, "0.0.0.0"));
        assert_eq!(c.db_path, PathBuf::from("/data/world.db"));
        assert_eq!(c.backup_dir, Some(PathBuf::from("/backups")));
        assert_eq!(c.web_dist, Some(PathBuf::from("/web")));
        assert!(!c.secure_cookies && !c.trust_proxy);
        assert_eq!(c.log_level, "debug");
        assert_eq!(c.sentry_dsn.as_deref(), Some("https://key@sentry.example/1"));
        assert_eq!((c.invariant_sample_rate, c.slow_tick_ms), (0.5, 50.0));
        assert_eq!(c.origins.allowed, vec!["https://a.example", "https://b.example"]);
    }

    #[test]
    fn treats_empty_values_as_the_typescript_does() {
        let c = config(&[("BACKUP_DIR", ""), ("SENTRY_DSN", ""), ("SECURE_COOKIES", "")]).unwrap();
        assert_eq!((c.backup_dir, c.sentry_dsn), (None, None));
        assert!(!c.secure_cookies);
    }

    #[test]
    fn refuses_a_number_that_is_not_one() {
        let e = config(&[("SLOW_TICK_MS", "fast")]).unwrap_err();
        assert_eq!(e.name, "SLOW_TICK_MS");
        assert!(config(&[("PORT", "70000")]).is_err());
    }
}
