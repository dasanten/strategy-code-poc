//! Relocating (`CONTEXT.md`: Relocate, Group), ported from `apps/server/src/relocating.ts`: a
//! resident of the Player's realm walks to another of its cities and moves in on stepping into its
//! area. The order is a plain `validate`/`apply` pair for the order queue (T86.2) to wire.

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::{is_passable_terrain, terrain_at, wrap_distance, TerrainMap};
use csp_shared::world::{
    BuildingKind, OrderEnded, OrderEndedKind, RealmEventWhat, RelocateOrder, Resident,
    ResidentOrder, Tile, WorldState,
};

use crate::pending::{ordered_resident, record_event, Sender};
use crate::queries::city::town_hall_of;
use crate::queries::city_area::{city_area_tiles, free_housing, in_city_area};
use crate::queries::people::relocate_problem;

/// The input of a relocate order (`RelocateRequest`): which resident, the realm's city they move
/// to, and the group they relocate with, their own id among them, when given to a group.
#[derive(Debug, Clone, Default)]
pub struct RelocateRequest {
    pub resident_id: Option<String>,
    pub city_id: Option<String>,
    /// `Some(None)` for a `group` that is no list of ids.
    pub group: Option<Option<Vec<String>>>,
}

/// The residents a relocate order is checked for (`groupOf`): `r` alone, or the group named,
/// which must hold `r` and only residents the sender may order, each once. Indices.
fn group_of(
    world: &WorldState,
    sender: &Sender,
    r: usize,
    ids: &Option<Option<Vec<String>>>,
) -> Option<Vec<usize>> {
    let Some(ids) = ids else { return Some(vec![r]) };
    let ids = ids.as_ref()?;
    let unique: std::collections::HashSet<&String> = ids.iter().collect();
    if !ids.contains(&world.residents[r].id) || unique.len() != ids.len() {
        return None;
    }
    ids.iter().map(|id| ordered_resident(world, sender, Some(id))).collect()
}

/// `relocate.validate`: as `relocateProblem` allows, free housing counting the residents already
/// on their way; an NPC city relocates nobody.
pub fn validate_relocate(
    world: &WorldState,
    sender: &Sender,
    o: &RelocateRequest,
) -> Option<String> {
    let realm = if sender.npc_city_id.is_none() {
        world.realms.iter().find(|r| r.user_id == sender.user_id)
    } else {
        None
    };
    let r = ordered_resident(world, sender, o.resident_id.as_deref());
    let group = r.and_then(|r| group_of(world, sender, r, &o.group));
    let (Some(realm), Some(group)) = (realm, group) else {
        return Some("not one of your residents".into());
    };
    let residents: Vec<&Resident> = group.iter().map(|&i| &world.residents[i]).collect();
    relocate_problem(world, &realm.id, &residents, o.city_id.as_deref())
}

/// `relocate.apply`: only sets the resident's order, heading for the nearest tile of the city's
/// area. A resident carrying a child gets none.
pub fn apply_relocate(world: &mut WorldState, o: &RelocateRequest, terrain: Option<&TerrainMap>) {
    let Some(ri) = world.residents.iter().position(|x| Some(&x.id) == o.resident_id.as_ref())
    else {
        return;
    };
    let Some(city) = world.cities.iter().position(|c| Some(&c.id) == o.city_id.as_ref()) else {
        return;
    };
    if world.residents[ri].carrying.is_some() {
        return;
    }
    let r = &world.residents[ri];
    let target = nearest_area_tile(world, city, (r.x, r.y), terrain).unwrap_or((r.x, r.y));
    let city_id = world.cities[city].id.clone();
    let r = &mut world.residents[ri];
    // How their last store, fetch or relocate ended goes with a new one.
    r.order_ended = None;
    r.order = Some(ResidentOrder::Relocate(RelocateOrder {
        city_id,
        target: Tile { x: target.0, y: target.1 },
        path: None,
        progress: 0.0,
    }));
}

/// The tile of a city's area nearest to `from` that a resident can stand on (`nearestAreaTile`):
/// passable land, as far as `terrain` tells, with no wall or gate. None when its area has none.
pub fn nearest_area_tile(
    world: &WorldState,
    city: usize,
    from: (f64, f64),
    terrain: Option<&TerrainMap>,
) -> Option<(f64, f64)> {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    let walled: std::collections::HashSet<(i32, i32)> = world
        .buildings
        .iter()
        .filter(|b| matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate))
        .map(|b| (b.x as i32, b.y as i32))
        .collect();
    let mut best = None;
    let mut best_distance = f64::INFINITY;
    for (x, y) in city_area_tiles(world, &world.cities[city].id, size) {
        if walled.contains(&(x, y)) {
            continue;
        }
        if terrain.is_some_and(|t| !is_passable_terrain(terrain_at(t, x, y))) {
            continue;
        }
        let d = wrap_distance(size, (from.0 as i32, from.1 as i32), (x, y));
        if d < best_distance {
            best = Some((f64::from(x), f64::from(y)));
            best_distance = d;
        }
    }
    best
}

/// Moves relocating residents in (`stepRelocating`), after the tick's steps: one standing in the
/// area of the city they relocate to becomes its resident if it is still their realm's and has
/// free housing; if not, their order ends and the realm log says why. One whose city is gone stops
/// too. One heading for a tile its city's area no longer holds heads for the nearest one it does.
pub fn step_relocating(world: &mut WorldState, terrain: &TerrainMap) {
    for ri in 0..world.residents.len() {
        let Some(ResidentOrder::Relocate(o)) = &world.residents[ri].order else { continue };
        let (city_id, target) = (o.city_id.clone(), o.target);
        let Some(ci) = world.cities.iter().position(|c| c.id == city_id) else {
            fail_relocating(world, ri, &city_id, None, "the city is gone");
            continue;
        };
        let r = &world.residents[ri];
        if in_city_area(world, &city_id, r.x, r.y, terrain.size) {
            move_in(world, ri, ci);
            continue;
        }
        if in_city_area(world, &city_id, target.x, target.y, terrain.size) {
            continue;
        }
        let to = nearest_area_tile(world, ci, (r.x, r.y), Some(terrain))
            .or_else(|| town_hall_of(world, &world.cities[ci]).map(|h| (h.x, h.y)));
        let Some(to) = to else {
            let name = world.cities[ci].name.clone();
            fail_relocating(world, ri, &city_id, Some(name), "the city is gone");
            continue;
        };
        if let Some(ResidentOrder::Relocate(o)) = &mut world.residents[ri].order {
            o.target = Tile { x: to.0, y: to.1 };
            o.path = None;
            o.progress = 0.0;
        }
    }
}

/// A relocating resident steps into the city's area (`moveIn`): they move in while it is still
/// their realm's and has free housing, ending any pair, and their order is done.
fn move_in(world: &mut WorldState, ri: usize, ci: usize) {
    let city = &world.cities[ci];
    let (city_id, name) = (city.id.clone(), city.name.clone());
    if city.realm_id != world.residents[ri].owner {
        fail_relocating(world, ri, &city_id, Some(name), "it is no longer your realm’s");
        return;
    }
    if free_housing(world, &city_id) <= 0.0 {
        fail_relocating(world, ri, &city_id, Some(name), "no free housing");
        return;
    }
    let me = world.residents[ri].id.clone();
    if let Some(partner_id) = world.residents[ri].pair.as_ref().map(|p| p.partner_id.clone()) {
        if let Some(partner) = world.residents.iter_mut().find(|x| x.id == partner_id) {
            if partner.pair.as_ref().is_some_and(|p| p.partner_id == me) {
                partner.pair = None;
            }
        }
    }
    let r = &mut world.residents[ri];
    r.pair = None;
    r.city_id = Some(city_id);
    end_relocating(world, ri, None);
}

/// Ends a relocate order, saying how it ended (`endRelocating`): `reason` None when they moved in.
fn end_relocating(world: &mut WorldState, ri: usize, reason: Option<&str>) {
    let tick = world.tick as f64;
    let r = &mut world.residents[ri];
    r.order = None;
    r.order_ended = Some(OrderEnded {
        kind: OrderEndedKind::Relocate,
        tick,
        reason: reason.map(str::to_string),
    });
}

/// A relocate order ends without moving in (`failRelocating`); the log says why.
fn fail_relocating(
    world: &mut WorldState,
    ri: usize,
    city_id: &str,
    city: Option<String>,
    reason: &str,
) {
    end_relocating(world, ri, Some(reason));
    let r = &world.residents[ri];
    let what = RealmEventWhat::RelocateFailed {
        resident_id: r.id.clone(),
        name: r.name.clone(),
        city_id: city_id.to_string(),
        city,
        reason: reason.to_string(),
    };
    let owner = r.owner.clone();
    record_event(world, owner.as_deref(), what);
}

#[cfg(test)]
mod tests;
