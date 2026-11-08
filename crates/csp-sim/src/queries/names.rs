//! The TypeScript string of a building kind or good, for the `csp_shared` tables keyed by it
//! (`FOOTPRINT`, `GOOD_WEIGHT`, `RECIPES`, …), and small conveniences over `Stock`.

use csp_shared::footprint::Placed;
use csp_shared::world::{Building, BuildingKind, Good, Stock};

/// Every good, in the order of `GOODS`.
pub const ALL_GOODS: [Good; 11] = [
    Good::Food,
    Good::Wood,
    Good::Stone,
    Good::IronOre,
    Good::Iron,
    Good::GoldOre,
    Good::Coins,
    Good::Spear,
    Good::Sword,
    Good::Shield,
    Good::Armour,
];

/// Goods other than coins, in the order of `GOODS`: what a warehouse puts a price on
/// (`PRICED_GOODS`).
pub const PRICED_GOODS: [Good; 10] = [
    Good::Food,
    Good::Wood,
    Good::Stone,
    Good::IronOre,
    Good::Iron,
    Good::GoldOre,
    Good::Spear,
    Good::Sword,
    Good::Shield,
    Good::Armour,
];

/// The good's TypeScript name.
pub fn good_name(g: Good) -> &'static str {
    match g {
        Good::Food => "food",
        Good::Wood => "wood",
        Good::Stone => "stone",
        Good::IronOre => "ironOre",
        Good::Iron => "iron",
        Good::GoldOre => "goldOre",
        Good::Coins => "coins",
        Good::Spear => "spear",
        Good::Sword => "sword",
        Good::Shield => "shield",
        Good::Armour => "armour",
    }
}

/// The good a TypeScript name names, if any.
pub fn good_of(name: &str) -> Option<Good> {
    ALL_GOODS.into_iter().find(|g| good_name(*g) == name)
}

/// The building kind's TypeScript name.
pub fn kind_name(k: BuildingKind) -> &'static str {
    match k {
        BuildingKind::TownHall => "townHall",
        BuildingKind::House => "house",
        BuildingKind::Storage => "storage",
        BuildingKind::Warehouse => "warehouse",
        BuildingKind::Wall => "wall",
        BuildingKind::Gate => "gate",
        BuildingKind::Farm => "farm",
        BuildingKind::Stable => "stable",
        BuildingKind::Mine => "mine",
        BuildingKind::Quarry => "quarry",
        BuildingKind::LumberCamp => "lumberCamp",
        BuildingKind::Smelter => "smelter",
        BuildingKind::Mint => "mint",
        BuildingKind::Smithy => "smithy",
        BuildingKind::TrainingGround => "trainingGround",
        BuildingKind::Road => "road",
        BuildingKind::Carriage => "carriage",
    }
}

/// Every building kind, in the order of `FOOTPRINT`'s keys.
pub const ALL_KINDS: [BuildingKind; 17] = [
    BuildingKind::TownHall,
    BuildingKind::House,
    BuildingKind::Storage,
    BuildingKind::Warehouse,
    BuildingKind::Wall,
    BuildingKind::Gate,
    BuildingKind::Farm,
    BuildingKind::Stable,
    BuildingKind::Mine,
    BuildingKind::Quarry,
    BuildingKind::LumberCamp,
    BuildingKind::Smelter,
    BuildingKind::Mint,
    BuildingKind::Smithy,
    BuildingKind::TrainingGround,
    BuildingKind::Road,
    BuildingKind::Carriage,
];

/// The building kind a TypeScript name names, if any (`Object.hasOwn(FOOTPRINT, kind)`).
pub fn kind_of(name: &str) -> Option<BuildingKind> {
    ALL_KINDS.into_iter().find(|k| kind_name(*k) == name)
}

/// What a building's footprint is worked out from (`Placed`): its kind and north-west tile.
pub fn placed(b: &Building) -> Placed<'static> {
    Placed { kind: kind_name(b.kind), x: b.x as i32, y: b.y as i32 }
}

/// Units of a good in a stock: 0 for one it lacks (`stock[good] ?? 0`).
pub fn held(stock: &Stock, g: Good) -> f64 {
    stock.get(&g).copied().unwrap_or(0.0)
}

/// Units of a good in a building's stock, if it has one (`b.stock?.[good] ?? 0`).
pub fn held_in(stock: Option<&Stock>, g: Good) -> f64 {
    stock.map_or(0.0, |s| held(s, g))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_the_serde_names() {
        for g in ALL_GOODS {
            assert_eq!(serde_json::to_value(g).unwrap(), good_name(g));
            assert_eq!(good_of(good_name(g)), Some(g));
        }
        for k in ALL_KINDS {
            assert_eq!(serde_json::to_value(k).unwrap(), kind_name(k));
            assert_eq!(kind_of(kind_name(k)), Some(k));
            assert!(csp_shared::footprint::FOOTPRINT.get(kind_name(k)).is_some());
        }
        assert_eq!(csp_shared::footprint::FOOTPRINT.0.len(), ALL_KINDS.len());
        assert_eq!(kind_of("nonsense"), None);
    }
}
