//! The wall queries of `packages/shared/src/walls.ts` that combat and respect need (`CONTEXT.md`:
//! Walls in combat). Movement's wall map (`wallMap`, `mayStep`, `climbLanding`) is T86.6's to
//! add here.

use csp_shared::balance::{BROKEN_MATERIALS_RETURNED, BUILD_MATERIALS, WALL_STRENGTH};
use csp_shared::world::{Building, BuildingKind, Resident, Stock, WorldState};

use super::alliance::allied;
use super::names::{good_of, kind_name};

/// Whose side a resident is on at walls and gates (`wallSide`): their realm, or for a resident of
/// an NPC city, that city. None for a resident of nobody.
pub fn wall_side(r: &Resident) -> Option<&str> {
    r.owner.as_deref().or(r.city_id.as_deref())
}

/// Whether a building is a finished wall or gate (`isWallOrGate`).
pub fn is_wall_or_gate(b: &Building) -> bool {
    matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate) && b.site.is_none()
}

/// Whether a resident stands on a wall of their own side or an ally's (`onOwnWall`).
pub fn on_own_wall(world: &WorldState, r: &Resident) -> bool {
    let wall = world
        .buildings
        .iter()
        .find(|b| b.x == r.x && b.y == r.y && b.kind == BuildingKind::Wall && b.site.is_none());
    let city = wall.and_then(|w| world.cities.iter().find(|c| Some(&c.id) == w.city_id.as_ref()));
    let (Some(city), Some(side)) = (city, wall_side(r)) else { return false };
    allied(world, city.realm_id.as_deref().unwrap_or(&city.id), side)
}

/// Damage a finished wall or gate takes before it falls (`wallStrength`).
pub fn wall_strength(b: &Building) -> f64 {
    if b.kind == BuildingKind::Gate {
        WALL_STRENGTH.gate
    } else {
        WALL_STRENGTH.wall
    }
}

/// Damage a wall or gate can still take before it falls (`wallStrengthLeft`).
pub fn wall_strength_left(b: &Building) -> f64 {
    0f64.max(wall_strength(b) - b.damage.unwrap_or(0.0))
}

/// Goods left on the tile of a wall or gate that was broken (`brokenReturns`):
/// `BROKEN_MATERIALS_RETURNED` of its materials, in whole units.
pub fn broken_returns(b: &Building) -> Stock {
    let mut out = Stock::new();
    if let Some(materials) = BUILD_MATERIALS.get(kind_name(b.kind)) {
        for (good, units) in materials.0 {
            let back = (units * BROKEN_MATERIALS_RETURNED).floor();
            if back > 0.0 {
                out.insert(good_of(good).expect("a material is a good"), back);
            }
        }
    }
    out
}

/// The finished wall or gate `wall_id` that a resident of `realm_id` may break or climb
/// (`foreignWall`): one of another realm's city, or of none; or why not.
pub fn foreign_wall<'w>(
    world: &'w WorldState,
    realm_id: Option<&str>,
    wall_id: &str,
) -> Result<&'w Building, &'static str> {
    let b = world
        .buildings
        .iter()
        .find(|x| x.id == wall_id)
        .filter(|b| matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate))
        .ok_or("no such wall or gate")?;
    if b.site.is_some() {
        return Err("that wall is not finished yet");
    }
    let city = world.cities.iter().find(|c| Some(&c.id) == b.city_id.as_ref());
    if let Some(own) = city.and_then(|c| c.realm_id.as_deref()) {
        if Some(own) == realm_id {
            return Err("that is one of your own walls");
        }
    }
    Ok(b)
}
