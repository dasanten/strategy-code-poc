//! Alliances and territory.

balance! {
/// How long after a realm says it leaves an alliance, or the alliance leader removes it, it stops
/// being a member (`CONTEXT.md`: Alliance): one real hour, time enough for the others to react.
pub const ALLIANCE_LEAVE_DELAY: f64 = 3600.0;

/// How long after its owner recalls a soldier or carriage from the alliance army it is theirs to
/// command again (`CONTEXT.md`: Alliance army): one real hour.
pub const ALLIANCE_RECALL_DELAY: f64 = 3600.0;

/// The standing an NPC city must hold toward every member of an alliance to accept its
/// invitation (`CONTEXT.md`: NPC city in an alliance): half the way to the best. Some 25
/// paid contract weeks, or a lot of trade, earn it from neutral.
pub const NPC_ALLIANCE_JOIN_STANDING: f64 = 50.0;

/// The standing toward a member below which an NPC city leaves its alliance on its own
/// (`CONTEXT.md`: NPC city in an alliance): a theft and an attack from neutral, so standing merely
/// drifting back to neutral never makes it go.
pub const NPC_ALLIANCE_LEAVE_STANDING: f64 = -20.0;

/// Control a city projects before counting anyone in it (`CONTEXT.md`: Territory), so even an
/// empty city holds the ground it stands on.
pub const TERRITORY_CITY_BASE: f64 = 5.0;

/// Control a guarded workplace projects before counting its workers and guards.
pub const TERRITORY_WORKPLACE_BASE: f64 = 2.0;

/// Control each resident adds: of a city, one living there; of a workplace, one working it.
pub const TERRITORY_PER_RESIDENT: f64 = 1.0;

/// Control each armed resident adds on top: of a city, one living there and standing in its area
/// (its garrison); of a workplace, one of its holder's guarding it. Soldiers count most.
pub const TERRITORY_PER_ARMED: f64 = 3.0;

/// How far control reaches, in tiles, per square root of its strength: a city of 5 control reaches
/// 17 tiles, one of 30 forty-three, one of 100 eighty.
pub const TERRITORY_REACH_PER_ROOT: f64 = 8.0;

/// The farthest any one city or workplace projects control, in tiles.
pub const TERRITORY_MAX_REACH: f64 = 96.0;
}
