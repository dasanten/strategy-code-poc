//! Goods: their kinds, stock and wear as amounts, the piles on the ground, and the places goods
//! are taken from or put.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::named_enum::named_enum;

/// Goods by kind, as unit counts; a missing good is 0 (`Stock`).
pub type Stock = IndexMap<Good, f64>;

/// How worn the used pieces of gear among a stock are (`CONTEXT.md`: Wear): for each good, the
/// share of its life each used piece has worn away, from 0 up to (not including) 1, most worn
/// first. Units of the good not listed are as new, so a stock of new gear lists nothing.
pub type Wear = IndexMap<Good, Vec<f64>>;

/// The goods a store or fetch order moves (`GoodsWanted`): units of each, or `null` for as many as
/// there are.
pub type GoodsWanted = IndexMap<Good, Option<f64>>;

named_enum! {
/// The PoC goods (`GOODS`, `CONTEXT.md`: Good). `Exclude<Good, 'coins'>` in the TypeScript is
/// this type too; the rules check it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
pub enum Good {
    Food = "food",
    Wood = "wood",
    Stone = "stone",
    IronOre = "ironOre",
    Iron = "iron",
    GoldOre = "goldOre",
    Coins = "coins",
    Spear = "spear",
    Sword = "sword",
    Shield = "shield",
    Armour = "armour",
    Coal = "coal",
    Steel = "steel",
    SteelSword = "steelSword",
    SteelShield = "steelShield",
    SteelArmour = "steelArmour",
    Tools = "tools",
    Bow = "bow",
    Crossbow = "crossbow",
    Arrows = "arrows",
}
}

named_enum! {
/// `PricedGood`: every good but Coins (`Exclude<Good, 'coins'>`), the goods with a price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
pub enum PricedGood {
    Food = "food",
    Wood = "wood",
    Stone = "stone",
    IronOre = "ironOre",
    Iron = "iron",
    GoldOre = "goldOre",
    Spear = "spear",
    Sword = "sword",
    Shield = "shield",
    Armour = "armour",
    Coal = "coal",
    Steel = "steel",
    SteelSword = "steelSword",
    SteelShield = "steelShield",
    SteelArmour = "steelArmour",
    Tools = "tools",
    Bow = "bow",
    Crossbow = "crossbow",
    Arrows = "arrows",
}
}

/// A place on the resident's own tile that goods are taken from or put (`GoodsSpot`), or a vessel
/// beside them (`CONTEXT.md`: Beside a vessel).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GoodsSpot {
    Ground,
    Storage { storage_id: String },
    Site { site_id: String },
    Carriage { carriage_id: String },
    Resident { resident_id: String },
    Vessel { vessel_id: String },
}

/// Where a store or fetch order takes goods to or from (`GoodsPlace`): a storage, a carriage, or a
/// vessel, loaded from beside it (`CONTEXT.md`: Beside a vessel).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GoodsPlace {
    Storage { storage_id: String },
    Carriage { carriage_id: String },
    Vessel { vessel_id: String },
}

/// Goods lying on the ground on one tile (`CONTEXT.md`: Pile).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Pile {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub goods: Stock,
}
