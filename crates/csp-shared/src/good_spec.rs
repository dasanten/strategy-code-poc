//! What a good's spec holds. The specs themselves, one block per good, are in
//! `balance/good_specs.rs`; the lists made from them in `goods.rs`.

/// Everything fixed about a good. A fact that does not apply to a good is `None`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GoodSpec {
    /// What the script view of a stock says of it.
    pub script_text: &'static str,
    /// What a unit weighs, in kg (`GOOD_WEIGHT`).
    pub weight: f64,
    /// A trading post's stock floor, in units (`WAREHOUSE_FLOOR`).
    pub warehouse_floor: f64,
    /// What a warehouse sells a unit for at its reference stock, in Coins
    /// (`WAREHOUSE_BASE_PRICE`); `None` for what has no price: Coins.
    pub base_price: Option<f64>,
    /// What it is as gear; `None` for what nobody equips.
    pub gear: Option<Gear>,
    /// How many blows a piece lasts (`WEAR_BLOWS`); `None` for what blows don't wear.
    pub wear_blows: Option<f64>,
}

/// What a good is as gear (`CONTEXT.md`: Weapons and armour, Equipment).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Gear {
    Weapon(WeaponSpec),
    Protection(Protection),
}

/// A weapon.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeaponSpec {
    /// What it adds to a blow (`WEAPON_ATTACK`).
    pub attack: f64,
    /// Whether it takes both hands, so the shield slot stays empty.
    pub two_handed: bool,
    /// How it shoots; `None` for one that only strikes.
    pub shot: Option<Shot>,
}

/// How a weapon shoots (`CONTEXT.md`: Ranged combat): its row in each of the `SHOT_*` tables.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shot {
    pub reach: f64,
    pub ticks: f64,
    pub damage: f64,
    pub skill_limit: f64,
    pub pierce: f64,
}

/// A shield or a piece of armour.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Protection {
    pub kind: ProtectionKind,
    /// What it takes off a blow (`PROTECTION_DEFENCE`).
    pub defence: f64,
}

/// The kinds of protection: a resident is protected by the best of each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtectionKind {
    Shield,
    Armour,
}

impl GoodSpec {
    /// What it is as a weapon, if it is one.
    pub const fn weapon(&self) -> Option<WeaponSpec> {
        match self.gear {
            Some(Gear::Weapon(weapon)) => Some(weapon),
            _ => None,
        }
    }

    /// What it is as protection, if it is any.
    pub const fn protection(&self) -> Option<Protection> {
        match self.gear {
            Some(Gear::Protection(protection)) => Some(protection),
            _ => None,
        }
    }
}
