//! World state types, balance numbers, terrain helpers and the wire protocol (ADR 0030): the
//! Rust twin of `packages/shared`. Plain serialisable data; no I/O, no rules.

pub mod balance;
pub mod balance_export;
pub mod chunks;
pub mod footprint;
pub mod goods;
pub mod protocol;
pub mod terrain;
pub mod time;
pub mod ts_aliases;
pub mod views;
pub mod world;

/// Real milliseconds per tick: 1 real second is 1 game minute (`CONTEXT.md`: Game time).
pub const TICK_MS: u64 = 1000;
