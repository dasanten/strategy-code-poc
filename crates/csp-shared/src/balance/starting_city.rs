//! What a starting city has.

use super::*;

balance! {
/// Tiles along each side of a starting city, wall included: 27×27 tiles inside the wall. An odd
/// number, so its storage has a middle tile.
pub const START_CITY_SIZE: f64 = 29.0;

/// Residents in a starting city, the Leader included.
pub const START_RESIDENTS: f64 = 8.0;

/// Residents each kind of building houses (`CONTEXT.md`: House, Free housing). Only houses so far;
/// later housing buildings (a palace, a castle) add their room here.
pub const HOUSING_ROOM: Table<f64> = Table(&[("house", 4.0)]);

/// Houses a starting city gets beyond what its residents need.
pub const START_SPARE_HOUSES: f64 = 1.0;

/// Food in a starting city's storage, in kg: about 25 game days for its residents.
pub const START_FOOD: f64 = 100.0;

/// Coins in a starting city's storage (`CONTEXT.md`: Starting city, Rare goods): a heartland has no
/// gold, so a new Player starts with enough for a first trade at its trading post, such as a
/// spear or a few days' Food.
pub const START_COINS: f64 = 50.0;

/// Food each resident of a starting city carries, in units: four game days' meals, so they have
/// something to eat while the farm's first harvest comes in (`CONTEXT.md`: Eating).
pub const START_CARRIED_FOOD: f64 = 2.0;

/// Iron Spears each grown resident of a starting city (the Leader too) starts with, so they are
/// armed and defend from the first tick (`CONTEXT.md`: Starting city). Children get none.
pub const START_SPEARS: f64 = 1.0;

/// Wood in a starting city's storage (`CONTEXT.md`: Starting city): enough for a first building,
/// such as a house, in the first minute.
pub const START_WOOD: f64 = 40.0;

/// Stone in a starting city's storage (`CONTEXT.md`: Starting city): with `START_WOOD`, a storage's
/// Stone or most of a quarry.
pub const START_STONE: f64 = 20.0;

/// Sets of Tools in a starting city's storage (`CONTEXT.md`: Starting city, Tools): two, so two
/// residents work faster from the start.
pub const START_TOOLS: f64 = 2.0;

/// Horses in a starting city's stable: two, so a resident can breed them (`CONTEXT.md`: Starting city).
pub const START_HORSES: f64 = 2.0;

/// Food in a starting city's stable, in units: 20 game days for its horses, time to start
/// bringing it food from the farm.
pub const START_STABLE_FOOD: f64 = 30.0;
}
