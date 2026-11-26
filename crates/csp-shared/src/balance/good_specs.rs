//! Goods: every fact and number of each good, one block per good (`GoodSpec`). The balance tables
//! (`GOOD_WEIGHT`, `WAREHOUSE_FLOOR`, `WEAPON_ATTACK`, ...) and every list of goods are made from these
//! blocks (`good_spec.rs`), so a new good is its name in `Good` (and `PricedGood`, `Weapon`, which are
//! checked) and its block here. What each number means is said at its table and at `GoodSpec`.

use crate::good_spec::{Gear, GoodSpec, Protection, ProtectionKind, Shot, WeaponSpec};
use crate::world::Good;

impl Good {
    /// The good's facts and numbers. Exhaustive: a good without a block does not compile.
    pub const fn spec(self) -> &'static GoodSpec {
        match self {
            Good::Food => &FOOD,
            Good::Wood => &WOOD,
            Good::Stone => &STONE,
            Good::IronOre => &IRON_ORE,
            Good::Iron => &IRON,
            Good::GoldOre => &GOLD_ORE,
            Good::Coins => &COINS,
            Good::Spear => &SPEAR,
            Good::Sword => &SWORD,
            Good::Shield => &SHIELD,
            Good::Armour => &ARMOUR,
            Good::Coal => &COAL,
            Good::Steel => &STEEL,
            Good::SteelSword => &STEEL_SWORD,
            Good::SteelShield => &STEEL_SHIELD,
            Good::SteelArmour => &STEEL_ARMOUR,
            Good::Tools => &TOOLS,
            Good::Bow => &BOW,
            Good::Crossbow => &CROSSBOW,
            Good::Arrows => &ARROWS,
            Good::Rope => &ROPE,
        }
    }
}

const FOOD: GoodSpec = GoodSpec {
    label: "Food",
    script_text: "Units of food.",
    weight: 1.0,
    warehouse_floor: 20.0,
    base_price: Some(2.0),
    gear: None,
    wear_blows: None,
};

const WOOD: GoodSpec = GoodSpec {
    label: "Wood",
    script_text: "Units of wood.",
    weight: 1.0,
    warehouse_floor: 25.0,
    base_price: Some(2.0),
    gear: None,
    wear_blows: None,
};

const STONE: GoodSpec = GoodSpec {
    label: "Stone",
    script_text: "Units of stone.",
    weight: 1.0,
    warehouse_floor: 25.0,
    base_price: Some(2.0),
    gear: None,
    wear_blows: None,
};

const IRON_ORE: GoodSpec = GoodSpec {
    label: "Iron ore",
    script_text: "Units of ironOre.",
    weight: 1.0,
    warehouse_floor: 10.0,
    base_price: Some(4.0),
    gear: None,
    wear_blows: None,
};

const IRON: GoodSpec = GoodSpec {
    label: "Iron",
    script_text: "Units of iron.",
    weight: 1.0,
    warehouse_floor: 5.0,
    base_price: Some(10.0),
    gear: None,
    wear_blows: None,
};

const GOLD_ORE: GoodSpec = GoodSpec {
    label: "Gold ore",
    script_text: "Units of goldOre.",
    weight: 1.0,
    warehouse_floor: 5.0,
    base_price: Some(8.0),
    gear: None,
    wear_blows: None,
};

const COINS: GoodSpec = GoodSpec {
    label: "Coins",
    script_text: "Units of coins.",
    weight: 0.02,
    warehouse_floor: 1_000.0,
    base_price: None,
    gear: None,
    wear_blows: None,
};

const SPEAR: GoodSpec = GoodSpec {
    label: "Spear",
    script_text: "Units of spear.",
    weight: 3.0,
    warehouse_floor: 2.0,
    base_price: Some(20.0),
    gear: Some(Gear::Weapon(WeaponSpec { attack: 4.0, two_handed: false, shot: None })),
    wear_blows: Some(400.0),
};

const SWORD: GoodSpec = GoodSpec {
    label: "Sword",
    script_text: "Units of sword.",
    weight: 3.0,
    warehouse_floor: 1.0,
    base_price: Some(30.0),
    gear: Some(Gear::Weapon(WeaponSpec { attack: 6.0, two_handed: false, shot: None })),
    wear_blows: Some(600.0),
};

const SHIELD: GoodSpec = GoodSpec {
    label: "Shield",
    script_text: "Units of shield.",
    weight: 4.0,
    warehouse_floor: 2.0,
    base_price: Some(22.0),
    gear: Some(Gear::Protection(Protection { kind: ProtectionKind::Shield, defence: 3.0 })),
    wear_blows: Some(300.0),
};

const ARMOUR: GoodSpec = GoodSpec {
    label: "Armour",
    script_text: "Units of armour.",
    weight: 8.0,
    warehouse_floor: 1.0,
    base_price: Some(90.0),
    gear: Some(Gear::Protection(Protection { kind: ProtectionKind::Armour, defence: 5.0 })),
    wear_blows: Some(400.0),
};

const COAL: GoodSpec = GoodSpec {
    label: "Coal",
    script_text: "Units of coal.",
    weight: 1.0,
    warehouse_floor: 10.0,
    base_price: Some(5.0),
    gear: None,
    wear_blows: None,
};

const STEEL: GoodSpec = GoodSpec {
    label: "Steel",
    script_text: "Units of steel.",
    weight: 1.0,
    warehouse_floor: 5.0,
    base_price: Some(20.0),
    gear: None,
    wear_blows: None,
};

const STEEL_SWORD: GoodSpec = GoodSpec {
    label: "Steel sword",
    script_text: "Units of steel sword.",
    weight: 3.0,
    warehouse_floor: 1.0,
    base_price: Some(50.0),
    gear: Some(Gear::Weapon(WeaponSpec { attack: 9.0, two_handed: false, shot: None })),
    wear_blows: Some(900.0),
};

const STEEL_SHIELD: GoodSpec = GoodSpec {
    label: "Steel shield",
    script_text: "Units of steel shield.",
    weight: 4.0,
    warehouse_floor: 1.0,
    base_price: Some(30.0),
    gear: Some(Gear::Protection(Protection { kind: ProtectionKind::Shield, defence: 5.0 })),
    wear_blows: Some(450.0),
};

const STEEL_ARMOUR: GoodSpec = GoodSpec {
    label: "Steel armour",
    script_text: "Units of steel armour.",
    weight: 8.0,
    warehouse_floor: 1.0,
    base_price: Some(160.0),
    gear: Some(Gear::Protection(Protection { kind: ProtectionKind::Armour, defence: 8.0 })),
    wear_blows: Some(600.0),
};

const TOOLS: GoodSpec = GoodSpec {
    label: "Tools",
    script_text: "Units of Tools.",
    weight: 2.0,
    warehouse_floor: 2.0,
    base_price: Some(25.0),
    gear: None,
    wear_blows: None,
};

const BOW: GoodSpec = GoodSpec {
    label: "Bow",
    script_text: "Units of bow.",
    weight: 2.0,
    warehouse_floor: 1.0,
    base_price: Some(12.0),
    gear: Some(Gear::Weapon(WeaponSpec {
        attack: 0.0,
        two_handed: true,
        shot: Some(Shot { reach: 8.0, ticks: 3.0, damage: 6.0, skill_limit: 2.0, pierce: 0.0 }),
    })),
    wear_blows: None,
};

const CROSSBOW: GoodSpec = GoodSpec {
    label: "Crossbow",
    script_text: "Units of crossbow.",
    weight: 4.0,
    warehouse_floor: 1.0,
    base_price: Some(30.0),
    gear: Some(Gear::Weapon(WeaponSpec {
        attack: 0.0,
        two_handed: true,
        shot: Some(Shot { reach: 5.0, ticks: 6.0, damage: 14.0, skill_limit: 0.25, pierce: 0.5 }),
    })),
    wear_blows: None,
};

const ARROWS: GoodSpec = GoodSpec {
    label: "Arrows",
    script_text: "Units of arrows.",
    weight: 0.1,
    warehouse_floor: 40.0,
    base_price: Some(1.0),
    gear: None,
    wear_blows: None,
};

const ROPE: GoodSpec = GoodSpec {
    label: "Rope",
    script_text: "Units of rope.",
    weight: 1.0,
    warehouse_floor: 10.0,
    base_price: Some(3.0),
    gear: None,
    wear_blows: None,
};
