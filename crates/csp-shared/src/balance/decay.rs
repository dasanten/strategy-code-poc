//! Teardown, decay, repair and ruins.

use super::*;

balance! {
/// Tearing down takes less work than building (`CONTEXT.md`: Tearing down): this share of the
/// building's `BUILD_WORK`, or of the work put into an unfinished site so far.
pub const TEARDOWN_WORK_SHARE: f64 = 0.5;

/// Share of a finished building's materials left in its pile when it is torn down, rounded down
/// to whole units. An unfinished site leaves all its delivered materials.
pub const TEARDOWN_MATERIALS_RETURNED: f64 = 0.5;

/// Game days a finished building of each kind takes to lose all its condition, unrepaired
/// (`CONTEXT.md`: Decay): it loses an even share each game day, used or not. A city left alone for
/// a real month (1800 game days) is still there: its buildings may be worn, but none has fallen to
/// ruin from decay alone (Daniel, 2026-11-17). Decay only: Food and defence while away are the
/// Player's own scripts. Roads and the wooden walls and gates go fastest, in
/// 45 real days; farms in 60; timber buildings in 75; storages, workplaces on a node, training
/// grounds and havens in 90; the town hall in 120; those mostly of stone (warehouse, smelter, mint,
/// smithy) in 180. A kind not listed (a carriage, boat or ship site) never decays.
pub const DECAY_DAYS: Table<f64> = Table(&[
    ("road", 2700.0),
    ("wall", 2700.0),
    ("gate", 2700.0),
    ("farm", 3600.0),
    ("house", 4500.0),
    ("stable", 4500.0),
    ("lumberCamp", 4500.0),
    ("storage", 5400.0),
    ("trainingGround", 5400.0),
    ("haven", 5400.0),
    ("quarry", 5400.0),
    ("mine", 5400.0),
    ("townHall", 7200.0),
    ("warehouse", 10800.0),
    ("smelter", 10800.0),
    ("mint", 10800.0),
    ("smithy", 10800.0),
]);

/// Share of its condition lost from which a building reads worn, rather than good
/// (`CONTEXT.md`: Decay), and can be repaired: a road after about eleven real days.
pub const DECAY_WORN: f64 = 0.25;

/// Share of its condition lost from which a building reads nearly a ruin.
pub const DECAY_NEARLY_RUIN: f64 = 0.75;

/// Share of a building's materials a repair takes (`CONTEXT.md`: Repairing), rounded up to whole
/// units of each good: a tile of road or wall a unit, a house 5 Wood.
pub const REPAIR_MATERIALS_SHARE: f64 = 0.25;

/// Share of a building's `BUILD_WORK` a repair takes: less than building it, and less than
/// tearing it down (`TEARDOWN_WORK_SHARE`).
pub const REPAIR_WORK_SHARE: f64 = 0.25;

/// Game days a ruin stands before it collapses (`CONTEXT.md`: Ruin): "a long while more", a real
/// month (Daniel, 2026-11-17), time enough to notice it and rebuild it.
pub const RUIN_COLLAPSE_DAYS: f64 = 1800.0;

/// Share of a building's materials rebuilding its ruin takes (`CONTEXT.md`: Ruin), rounded up to
/// whole units: more than a repair, less than a new one.
pub const REBUILD_MATERIALS_SHARE: f64 = 0.5;

/// Share of a building's `BUILD_WORK` rebuilding its ruin takes: more than a repair, less than
/// building it new.
pub const REBUILD_WORK_SHARE: f64 = 0.5;

/// Share of a building's materials that lies on its tiles once its ruin collapses, rounded down
/// to whole units, as when it is torn down (`TEARDOWN_MATERIALS_RETURNED`).
pub const COLLAPSE_MATERIALS_LEFT: f64 = 0.25;
}
