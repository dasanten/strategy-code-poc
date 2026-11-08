//! The I/O shell as a library, so its modules are testable from `tests/`; `main.rs` is the binary.
pub mod admin_cli;
pub mod app;
pub mod auth;
pub mod backup;
pub mod config;
pub mod db;
pub mod explored;
pub mod first_day;
pub mod log;
pub mod monitoring;
pub mod saves;
pub mod scripts;
pub mod server;
pub mod tick_window;
pub mod world_format;
