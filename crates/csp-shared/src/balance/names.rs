//! How long names may be.

balance! {
/// The longest realm name a Player may give, in characters after trimming (`CONTEXT.md`: Realm name).
pub const REALM_NAME_MAX_LENGTH: f64 = 30.0;

/// The longest name a Player may give a resident, the Leader included, in characters after trimming.
pub const RESIDENT_NAME_MAX_LENGTH: f64 = 30.0;

/// The longest name a Player may give a city of their realm, in characters after trimming.
pub const CITY_NAME_MAX_LENGTH: f64 = 30.0;

/// The longest name a Player may give a horse of their realm, in characters after trimming (`CONTEXT.md`: Renaming a horse).
pub const HORSE_NAME_MAX_LENGTH: f64 = 30.0;

/// The longest name a Player may give a waypoint, in characters after trimming (`CONTEXT.md`: Waypoint).
pub const WAYPOINT_NAME_MAX_LENGTH: f64 = 30.0;
}
