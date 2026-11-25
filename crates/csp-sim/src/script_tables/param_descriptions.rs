//! What each type of a script's params accepts.

/// What each param type accepts, for the Wiki and the editor (`PARAM_DESCRIPTIONS`), in the
/// order of `SCRIPT_PARAM_TYPES`.
pub static PARAM_DESCRIPTIONS: &[(&str, &str)] = &[
    ("building", "One of my realm’s buildings, or a workplace or construction site of anyone’s I know: in sight, or as last seen."),
    ("storage", "One of my realm’s storages or stables, or one of its carriages."),
    ("number", "A whole number of zero or more, typed in; `= n` after the type gives it a default."),
    ("choice", "One of the words its line lists, `choice(north, east, south, west)`, picked from a list and read as that word; `= north` after the list gives it a default."),
    ("waypoint", "One of my waypoints, picked from a list or on the map, read as its `id`, `name`, `x` and `y`; unset once it is removed."),
];
