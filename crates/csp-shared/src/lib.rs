//! World state types, balance numbers, terrain helpers and the wire protocol (ADR 0030). Plain
//! serialisable data; no I/O, no rules.

pub mod balance;
pub mod balance_export;
pub mod building_spec;
pub mod chunks;
pub mod craft_spec;
pub mod footprint;
pub mod good_spec;
pub mod goods;
mod named_enum;
pub mod protocol;
pub mod spec_export;
pub mod terrain;
pub mod time;
pub mod ts_aliases;
pub mod views;
pub mod world;

/// Real milliseconds per tick: 1 real second is 1 game minute (`CONTEXT.md`: Game time).
pub const TICK_MS: u64 = 1000;
