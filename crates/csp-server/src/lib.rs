//! The I/O shell as a library, so its modules are testable from `tests/`; `main.rs` is the binary.
pub mod admin_cli;
pub mod auth;
pub mod backup;
pub mod config;
pub mod db;
pub mod explored;
pub mod log;
pub mod monitoring;
pub mod saves;
pub mod server;
pub mod sync;
pub mod tick_window;
pub mod world_format;
