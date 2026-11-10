//! TypeScript names for Rust type aliases. A Rust `type` alias has no name of its own to `ts-rs`
//! (it sees the type behind it), but the client imports some of them by name (`Stock`,
//! `ScriptMemory`, ...), so each gets a newtype here that exists only to be exported: `ts-rs`
//! writes a newtype as `export type Name = <inner>`. Nothing serialises these; the real values use
//! the alias.

use std::collections::BTreeMap;

use indexmap::IndexMap;
use ts_rs::TS;

use crate::world::{Good, ScriptParamValue};

macro_rules! ts_alias {
    ($(#[$doc:meta])* $name:ident = $ty:ty) => {
        $(#[$doc])*
        #[derive(TS)]
        #[allow(dead_code)]
        pub struct $name($ty);
    };
}

ts_alias!(
    /// `Stock`: goods by kind, as unit counts.
    Stock = IndexMap<Good, f64>
);
ts_alias!(
    /// `MemoryValue`: a script value as plain data.
    MemoryValue = serde_json::Value
);
ts_alias!(
    /// `ScriptMemory`: a running script's memory.
    ScriptMemory = serde_json::Map<String, serde_json::Value>
);
ts_alias!(
    /// `GoodsWanted`: the goods a store or fetch order moves.
    GoodsWanted = IndexMap<Good, Option<f64>>
);
ts_alias!(
    /// `ScriptParamValues`: a resident's picked script parameter values, by script id and name.
    ScriptParamValues = BTreeMap<u64, IndexMap<String, ScriptParamValue>>
);
