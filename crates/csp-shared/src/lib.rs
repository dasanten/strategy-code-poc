//! World state types, balance numbers, terrain helpers and the wire protocol (ADR 0030): the
//! Rust twin of `packages/shared`. Plain serialisable data; no I/O, no rules.

<<<<<<< HEAD
pub mod balance;
pub mod chunks;
pub mod footprint;
pub mod goods;
pub mod terrain;
pub mod time;
=======
pub mod world;
>>>>>>> origin/epic/84-rust-foundations

/// Real milliseconds per tick: 1 real second is 1 game minute (`CONTEXT.md`: Game time).
pub const TICK_MS: u64 = 1000;
