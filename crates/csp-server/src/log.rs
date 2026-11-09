//! The server's log (`apps/server/src/log.ts`): `tracing`, written as pino wrote it so whatever
//! reads the logs keeps working. JSON lines in production, one object per line with pino's
//! `level` (10 trace … 50 error), `time` (ms), `pid`, `hostname` and `msg`, and the event's
//! fields at the top level; readable lines for a human at a terminal in development.
//!
//! An event's fields are its `tracing` fields, plus the object in its `fields` field (a JSON
//! string, see [`log_event`]) merged in: what pino's first argument was.

use std::{
    io::Write,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Map, Value};
use tracing::{field::Field, Event, Level, Subscriber};
use tracing_subscriber::{
    filter::LevelFilter, layer::Context, prelude::*, registry::Registry, Layer,
};

/// pino's numeric level.
pub fn pino_level(level: &Level) -> u8 {
    match *level {
        Level::TRACE => 10,
        Level::DEBUG => 20,
        Level::INFO => 30,
        Level::WARN => 40,
        Level::ERROR => 50,
    }
}

/// `LOG_LEVEL` as pino names levels; `fatal` is `error` here, `silent` turns logging off.
pub fn level_filter(name: &str) -> LevelFilter {
    match name.trim().to_ascii_lowercase().as_str() {
        "trace" => LevelFilter::TRACE,
        "debug" => LevelFilter::DEBUG,
        "warn" => LevelFilter::WARN,
        "error" | "fatal" => LevelFilter::ERROR,
        "silent" => LevelFilter::OFF,
        _ => LevelFilter::INFO,
    }
}

/// Logs `message` at `level` with `fields` (an object) as its fields, as pino's
/// `log.<level>(fields, message)`.
pub fn log_event(level: Level, fields: &Value, message: &str) {
    let fields = fields.to_string();
    match level {
        Level::TRACE => tracing::trace!(fields = fields.as_str(), "{message}"),
        Level::DEBUG => tracing::debug!(fields = fields.as_str(), "{message}"),
        Level::INFO => tracing::info!(fields = fields.as_str(), "{message}"),
        Level::WARN => tracing::warn!(fields = fields.as_str(), "{message}"),
        Level::ERROR => tracing::error!(fields = fields.as_str(), "{message}"),
    }
}

#[derive(Default)]
struct Fields {
    map: Map<String, Value>,
    message: Option<String>,
}

impl tracing::field::Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        match field.name() {
            "fields" => {
                if let Ok(Value::Object(o)) = serde_json::from_str::<Value>(value) {
                    self.map.extend(o);
                }
            }
            "message" => self.message = Some(value.to_owned()),
            name => {
                self.map.insert(name.to_owned(), Value::from(value));
            }
        }
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.map.insert(field.name().to_owned(), Value::from(value));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.map.insert(field.name().to_owned(), Value::from(value));
    }
    fn record_f64(&mut self, field: &Field, value: f64) {
        self.map.insert(field.name().to_owned(), Value::from(value));
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.map.insert(field.name().to_owned(), Value::from(value));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.record_str(field, &format!("{value:?}"));
    }
}

type Writer = Arc<Mutex<dyn Write + Send>>;

/// Writes every event as one pino JSON line.
pub struct PinoLayer {
    out: Writer,
    pid: u32,
    hostname: String,
}

impl PinoLayer {
    pub fn new(out: Writer) -> Self {
        let hostname = std::env::var("HOSTNAME")
            .or_else(|_| std::env::var("COMPUTERNAME"))
            .unwrap_or_default();
        Self { out, pid: std::process::id(), hostname }
    }
}

impl<S: Subscriber> Layer<S> for PinoLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        let time = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        let mut line = Map::new();
        line.insert("level".into(), Value::from(pino_level(event.metadata().level())));
        line.insert("time".into(), Value::from(time));
        line.insert("pid".into(), Value::from(self.pid));
        line.insert("hostname".into(), Value::from(self.hostname.as_str()));
        line.extend(fields.map);
        line.insert("msg".into(), Value::from(fields.message.unwrap_or_default()));
        let mut out = self.out.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(out, "{}", Value::Object(line));
    }
}

/// Readable lines for a terminal: level, message, then the fields.
pub struct PrettyLayer;

impl<S: Subscriber> Layer<S> for PrettyLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        let level = event.metadata().level();
        let rest = if fields.map.is_empty() {
            String::new()
        } else {
            format!(" {}", Value::Object(fields.map))
        };
        eprintln!("{level:>5} {}{rest}", fields.message.unwrap_or_default());
    }
}

/// Starts logging for the process at `level` (pino's names): pretty or JSON lines on stdout.
pub fn init_logging(level: &str, pretty: bool) {
    let filter = level_filter(level);
    let registry = Registry::default();
    let result = if pretty {
        registry.with(PrettyLayer.with_filter(filter)).try_init()
    } else {
        let out: Writer = Arc::new(Mutex::new(std::io::stdout()));
        registry.with(PinoLayer::new(out).with_filter(filter)).try_init()
    };
    // Already started (a test, or a second call): keep the first.
    let _ = result;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl Write for Buffer {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().write(buf)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn writes_pino_lines_with_the_fields_at_the_top() {
        let buffer = Buffer::default();
        let out: Writer = Arc::new(Mutex::new(buffer.clone()));
        let subscriber =
            Registry::default().with(PinoLayer::new(out).with_filter(level_filter("info")));
        tracing::subscriber::with_default(subscriber, || {
            log_event(Level::WARN, &json!({ "tick": 7, "phases": { "world": 5.0 } }), "slow tick");
            tracing::info!(file = "a.db", "backup written");
            log_event(Level::DEBUG, &json!({}), "filtered out");
        });
        let text = String::from_utf8(buffer.0.lock().unwrap().clone()).unwrap();
        let lines: Vec<Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["level"], 40);
        assert_eq!(lines[0]["msg"], "slow tick");
        assert_eq!(lines[0]["tick"], 7);
        assert_eq!(lines[0]["phases"], json!({ "world": 5.0 }));
        assert!(lines[0]["time"].as_u64().unwrap() > 0);
        assert_eq!(lines[0]["pid"], std::process::id());
        assert_eq!(lines[1]["level"], 30);
        assert_eq!(lines[1]["file"], "a.db");
        assert_eq!(lines[1]["msg"], "backup written");
    }

    #[test]
    fn reads_pino_level_names() {
        assert_eq!(level_filter("debug"), LevelFilter::DEBUG);
        assert_eq!(level_filter("fatal"), LevelFilter::ERROR);
        assert_eq!(level_filter("silent"), LevelFilter::OFF);
        assert_eq!(level_filter("nonsense"), LevelFilter::INFO);
    }
}
