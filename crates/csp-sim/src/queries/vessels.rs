//! Vessels on the water (`CONTEXT.md`: Water, Vessel, Building a boat, Beside a vessel): where
//! one stands, where a finished boat floats, what one holds, who is aboard and where they get off.
//! Read-only, like the other queries.

use std::collections::{HashSet, VecDeque};

use csp_shared::balance::{
    BOAT_CAPACITY, MAP_SIZE, PASSENGER_WEIGHT, SHIP_CAPACITY, SHIP_MIN_CREW,
};
use csp_shared::footprint::{covers, footprint_tiles, near_footprint};
use csp_shared::protocol::LoadLevel;
use csp_shared::terrain::{
    is_passable_terrain, is_sea, is_water, terrain_at, wrap, wrap_distance, TerrainMap,
};
use csp_shared::world::{Building, BuildingKind, Good, Resident, Vessel, VesselKind, WorldState};

use super::building::building_at;
use super::carriages::load_level;
use super::combat::in_contact;
use super::driving::carriage_of_resident;
use super::guard::guarded_by;
use super::names::placed;
use super::residents::{can_work, good_weight, stock_weight};
use crate::walls::is_wall_or_gate;

/// The eight tiles around one, the four straight ones first, so the nearest come first.
const AROUND: [(i32, i32); 8] =
    [(0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (1, 1), (-1, 1), (-1, -1)];

/// The most water tiles `launch_tile` looks through for a free one: a crowded shore, not a sea.
const LAUNCH_SEARCH: usize = 1024;

/// The vessel on a tile, if there is one (`CONTEXT.md`: Vessel: one vessel per tile).
pub fn vessel_at(world: &WorldState, x: i32, y: i32) -> Option<&Vessel> {
    world.vessels.iter().find(|v| v.x as i32 == x && v.y as i32 == y)
}

/// Most weight a vessel carries, in kg (`CONTEXT.md`: Boat, Ship).
pub fn vessel_capacity(v: &Vessel) -> f64 {
    match v.kind {
        VesselKind::Boat => BOAT_CAPACITY,
        VesselKind::Ship => SHIP_CAPACITY,
    }
}

/// The vessel of an id (`CONTEXT.md`: Vessel).
pub fn vessel_by_id<'w>(world: &'w WorldState, id: &str) -> Option<&'w Vessel> {
    world.vessels.iter().find(|v| v.id == id)
}

/// The vessel a resident is aboard, if it is one rather than a carriage (`CONTEXT.md`: Passenger,
/// Beside a vessel).
pub fn vessel_aboard<'w>(world: &'w WorldState, r: &Resident) -> Option<&'w Vessel> {
    vessel_by_id(world, r.aboard.as_deref()?)
}

/// Everyone aboard a vessel: its passengers, the one at its oars and its crew.
pub fn aboard_vessel<'w>(world: &'w WorldState, vessel_id: &str) -> Vec<&'w Resident> {
    world.residents.iter().filter(|r| r.aboard.as_deref() == Some(vessel_id)).collect()
}

/// The passengers aboard a vessel (`CONTEXT.md`: Passenger, Rowing, Crew): everyone aboard but its
/// rower and its crew.
pub fn vessel_passengers<'w>(world: &'w WorldState, vessel_id: &str) -> Vec<&'w Resident> {
    let v = vessel_by_id(world, vessel_id);
    let rower = v.and_then(|v| v.rower_id.as_deref());
    let crew = v.map_or(&[][..], |v| &v.crew_ids[..]);
    aboard_vessel(world, vessel_id)
        .into_iter()
        .filter(|r| Some(r.id.as_str()) != rower && !crew.contains(&r.id))
        .collect()
}

/// A ship's crew aboard it (`CONTEXT.md`: Crew), in the order they boarded.
pub fn vessel_crew<'w>(world: &'w WorldState, v: &Vessel) -> Vec<&'w Resident> {
    v.crew_ids
        .iter()
        .filter_map(|id| world.residents.iter().find(|r| &r.id == id))
        .filter(|r| r.aboard.as_deref() == Some(v.id.as_str()))
        .collect()
}

/// How many more crew a ship needs aboard to sail (`CONTEXT.md`: Crew: at least `SHIP_MIN_CREW`);
/// 0 once it has them. A boat needs none: its rower moves it.
pub fn crew_short(world: &WorldState, v: &Vessel) -> usize {
    if v.kind != VesselKind::Ship {
        return 0;
    }
    (SHIP_MIN_CREW as usize).saturating_sub(vessel_crew(world, v).len())
}

/// What a vessel is called in what the game says about it: "boat" or "ship".
pub fn vessel_name(v: &Vessel) -> &'static str {
    match v.kind {
        VesselKind::Boat => "boat",
        VesselKind::Ship => "ship",
    }
}

/// The finished haven a ship is docked at (`CONTEXT.md`: Docked): one whose footprint its water
/// tile touches, straight or diagonally. A boat docks nowhere: it lands at any shore.
pub fn docked_at<'w>(world: &'w WorldState, v: &Vessel) -> Option<&'w Building> {
    if v.kind != VesselKind::Ship {
        return None;
    }
    let at = (v.x as i32, v.y as i32);
    world.buildings.iter().find(|b| {
        b.kind == BuildingKind::Haven
            && b.site.is_none()
            && near_footprint(placed(b), at, 1, MAP_SIZE)
    })
}

/// What a vessel still holds, in kg (`CONTEXT.md`: Beside a vessel): its capacity less its goods
/// and a fixed weight for each passenger, as on a carriage; its rower and crew don't count
/// (Rowing, Crew).
pub fn vessel_room(world: &WorldState, v: &Vessel) -> f64 {
    let people = vessel_passengers(world, &v.id).len() as f64;
    vessel_capacity(v) - stock_weight(&v.load) - people * PASSENGER_WEIGHT
}

/// The resident at a vessel's oars, if they are aboard it (`CONTEXT.md`: Rowing).
pub fn rower_of<'w>(world: &'w WorldState, v: &Vessel) -> Option<&'w Resident> {
    let id = v.rower_id.as_deref()?;
    world.residents.iter().find(|r| r.id == id && r.aboard.as_deref() == Some(v.id.as_str()))
}

/// Whether a vessel is being rowed now: its rower holds a row order for it.
pub fn being_rowed(world: &WorldState, v: &Vessel) -> bool {
    rower_of(world, v).is_some_and(|r| {
        matches!(&r.order, Some(csp_shared::world::ResidentOrder::Row(o)) if o.vessel_id == v.id)
    })
}

/// The water tile a row order to (x, y) goes to (`CONTEXT.md`: Rowing): a water tile itself;
/// given a land tile, the free water tile beside it nearest the vessel (no other vessel on it),
/// a straight one before a diagonal one as near. `None` for a land tile with no free water beside.
pub fn row_target(
    world: &WorldState,
    map: &TerrainMap,
    v: &Vessel,
    x: i32,
    y: i32,
) -> Option<(i32, i32)> {
    let (x, y) = (wrap(x, map.size), wrap(y, map.size));
    if is_water(terrain_at(map, x, y)) {
        return Some((x, y));
    }
    let from = (v.x as i32, v.y as i32);
    let mut best: Option<((i32, i32), f64)> = None;
    for (dx, dy) in AROUND {
        let t = (wrap(x + dx, map.size), wrap(y + dy, map.size));
        if !is_water(terrain_at(map, t.0, t.1)) {
            continue;
        }
        if vessel_at(world, t.0, t.1).is_some_and(|o| o.id != v.id) {
            continue;
        }
        let d = wrap_distance(map.size, t, from);
        if best.is_none_or(|(_, b)| d < b - 1e-9) {
            best = Some((t, d));
        }
    }
    best.map(|(t, _)| t)
}

/// How many more whole units of a good fit on a vessel.
pub fn units_that_fit_vessel(world: &WorldState, v: &Vessel, good: Good) -> f64 {
    0f64.max((vessel_room(world, v) / good_weight(good) + 1e-9).floor())
}

/// Whether a vessel is of the resident's realm. One of nobody, or a resident of no Player, is of
/// no one's.
pub fn vessel_of_resident(v: &Vessel, r: &Resident) -> bool {
    carriage_of_resident(&v.realm_id, &None, r)
}

/// Whether (x, y) is beside the vessel (`CONTEXT.md`: Beside a vessel): touching a boat's water
/// tile, straight or diagonally, the vessel's own tile not among them; for a ship, on the haven
/// it is docked at (`CONTEXT.md`: Docked), so nothing is beside a ship at sea.
pub fn beside_vessel(world: &WorldState, v: &Vessel, x: f64, y: f64) -> bool {
    let (x, y) = (x as i32, y as i32);
    if v.kind == VesselKind::Ship {
        return docked_at(world, v).is_some_and(|h| covers(placed(h), x, y, MAP_SIZE));
    }
    let (vx, vy) = (v.x as i32, v.y as i32);
    (x, y) != (vx, vy) && in_contact(MAP_SIZE, (x, y), (vx, vy))
}

/// Whether a resident stands beside the vessel on land, not aboard it.
pub fn resident_beside_vessel(world: &WorldState, v: &Vessel, r: &Resident) -> bool {
    r.aboard.as_deref() != Some(v.id.as_str()) && beside_vessel(world, v, r.x, r.y)
}

/// Why a passenger can't get off onto (x, y) (`CONTEXT.md`: Beside a vessel: a free land tile
/// beside it; a ship only at a haven): it must be beside the vessel and be land anyone can stand
/// on, with no wall or gate on it.
pub fn shore_problem(
    world: &WorldState,
    map: &TerrainMap,
    v: &Vessel,
    x: i32,
    y: i32,
) -> Option<&'static str> {
    let (x, y) = (wrap(x, map.size), wrap(y, map.size));
    if !beside_vessel(world, v, f64::from(x), f64::from(y)) {
        return Some(match v.kind {
            VesselKind::Boat => "that tile is not beside the boat",
            VesselKind::Ship => "that tile is not on the haven the ship is docked at",
        });
    }
    if !is_passable_terrain(terrain_at(map, x, y)) {
        return Some("nobody can stand there");
    }
    if building_at(world, x, y, map.size).is_some_and(is_wall_or_gate) {
        return Some("a wall or gate stands there");
    }
    None
}

/// The free land tiles beside a vessel a passenger can get off onto: around a boat, the straight
/// ones first; for a ship, the tiles of the haven it is docked at, none at sea.
pub fn shore_tiles(world: &WorldState, map: &TerrainMap, v: &Vessel) -> Vec<(i32, i32)> {
    let tiles: Vec<(i32, i32)> = if v.kind == VesselKind::Ship {
        docked_at(world, v).map_or_else(Vec::new, |h| footprint_tiles(placed(h), map.size))
    } else {
        let (vx, vy) = (v.x as i32, v.y as i32);
        AROUND.iter().map(|(dx, dy)| (wrap(vx + dx, map.size), wrap(vy + dy, map.size))).collect()
    };
    tiles.into_iter().filter(|&(x, y)| shore_problem(world, map, v, x, y).is_none()).collect()
}

/// Where a passenger gets off a vessel when they don't say where: the free land tile beside it
/// nearest `toward` (a straight one before a diagonal one as near), else the first straight one.
/// `None` with no shore beside it (`CONTEXT.md`: Beside a vessel).
pub fn landing_tile(
    world: &WorldState,
    map: &TerrainMap,
    v: &Vessel,
    toward: Option<(i32, i32)>,
) -> Option<(i32, i32)> {
    let tiles = shore_tiles(world, map, v);
    let Some(to) = toward else { return tiles.first().copied() };
    let mut best: Option<((i32, i32), f64)> = None;
    for t in tiles {
        let d = wrap_distance(map.size, t, to);
        if best.is_none_or(|(_, b)| d < b - 1e-9) {
            best = Some((t, d));
        }
    }
    best.map(|(t, _)| t)
}

/// Whether a fight between `a` and `b` would be one between vessels, which there is none of
/// (`CONTEXT.md`: Fighting at a vessel): each aboard a vessel, not the same one. Those aboard
/// reach only those beside their vessel, and those aboard with them.
pub fn between_vessels(world: &WorldState, a: &Resident, b: &Resident) -> bool {
    match (vessel_aboard(world, a), vessel_aboard(world, b)) {
        (Some(va), Some(vb)) => va.id != vb.id,
        _ => false,
    }
}

/// Whether a resident of the realm `realm_id` rowing the vessel off would steal it (`CONTEXT.md`:
/// Stealing a carriage or horse): another organization's, or nobody's.
pub fn steals_vessel(v: &Vessel, realm_id: &str) -> bool {
    v.realm_id.as_deref() != Some(realm_id)
}

/// Why a resident can't row off in another organization's vessel for the realm `realm_id` now
/// (`CONTEXT.md`: Stealing a carriage or horse, its vessel part): grown, beside it and aboard
/// nothing, on no horse and driving nothing; nobody may row it or be aboard; and it mustn't be
/// guarded: an armed resident of its owner beside it and none of the thief's realm, the thief
/// themselves included.
pub fn row_off_problem(
    world: &WorldState,
    thief: &Resident,
    v: &Vessel,
    realm_id: &str,
) -> Option<String> {
    let problem = if v.kind == VesselKind::Ship {
        // `CONTEXT.md`: Sailing: a ship is stolen by sailing it off with a crew, never rowed.
        "a ship is sailed, not rowed"
    } else if !can_work(thief.born_at, world.tick as f64) {
        "children can’t steal"
    } else if thief.aboard.is_some() {
        "aboard another carriage or boat"
    } else if !beside_vessel(world, v, thief.x, thief.y) {
        "that boat is not beside the resident"
    } else if super::carriages::driven_carriage_id(thief).is_some() {
        "the driver can’t row"
    } else if thief.riding.is_some() {
        "no horse goes aboard: dismount first"
    } else if rower_of(world, v).is_some() {
        "someone is rowing that boat"
    } else if !aboard_vessel(world, &v.id).is_empty() {
        "someone is aboard that boat"
    } else if guarded_by(
        &world.residents,
        |r| resident_beside_vessel(world, v, r),
        |r| vessel_of_resident(v, r),
        |r| r.id == thief.id || r.owner.as_deref() == Some(realm_id),
    ) {
        "an armed resident guards that boat"
    } else {
        return None;
    };
    Some(problem.to_string())
}

/// Why a resident can't board a vessel now (`CONTEXT.md`: Beside a vessel, Passenger, What
/// vessels carry, Docked, Crew): a vessel of their realm beside them (a ship only docked, from
/// its haven), with room for one more passenger; not a rider (no horse goes aboard) or a driver.
/// As crew (`as_crew`), only aboard a ship and only grown, and they take no room.
pub fn board_vessel_problem(
    world: &WorldState,
    r: &Resident,
    v: &Vessel,
    as_crew: bool,
) -> Option<String> {
    let name = vessel_name(v);
    let problem = if r.aboard.as_deref() == Some(v.id.as_str()) {
        format!("already aboard that {name}")
    } else if r.aboard.is_some() {
        "already aboard another carriage or boat".into()
    } else if as_crew && v.kind != VesselKind::Ship {
        "only a ship takes a crew".into()
    } else if !vessel_of_resident(v, r) {
        format!("not a {name} of your realm")
    } else if v.kind == VesselKind::Ship && docked_at(world, v).is_none() {
        "the ship is not docked at a haven".into()
    } else if !beside_vessel(world, v, r.x, r.y) {
        match v.kind {
            VesselKind::Boat => "that boat is not beside the resident".into(),
            VesselKind::Ship => "not at the haven the ship is docked at".into(),
        }
    } else if super::carriages::driven_carriage_id(r).is_some() {
        "the driver can’t board".into()
    } else if r.riding.is_some() {
        "no horse goes aboard: dismount first".into()
    } else if as_crew && !can_work(r.born_at, world.tick as f64) {
        "children can’t crew a ship".into()
    } else if !as_crew && vessel_room(world, v) < PASSENGER_WEIGHT - 1e-9 {
        format!("the {name} is full")
    } else {
        return None;
    };
    Some(problem)
}

/// How heavily a vessel looks loaded to a Player who can't see its load.
pub fn vessel_load_level(v: &Vessel) -> LoadLevel {
    load_level(&v.load, vessel_capacity(v))
}

/// The finished haven a boat or ship site on (x, y) is laid out on (`CONTEXT.md`: Building a
/// boat, Building a ship): one whose footprint covers the tile.
pub fn haven_for(world: &WorldState, x: i32, y: i32, size: i32) -> Option<&Building> {
    building_at(world, x, y, size).filter(|b| b.kind == BuildingKind::Haven && b.site.is_none())
}

/// Whether a vessel of this kind may be on terrain `t` (`CONTEXT.md`: Vessel, Ship): a boat on
/// any water, a ship on Sea only.
pub fn floats_on(kind: VesselKind, t: u8) -> bool {
    match kind {
        VesselKind::Boat => is_water(t),
        VesselKind::Ship => is_sea(t),
    }
}

/// Where a vessel of `kind` finished at a site on (x, y) floats (`CONTEXT.md`: Building a boat,
/// Building a ship): the nearest free tile it may be on (water for a boat, Sea for a ship) next to
/// the site, a straight one before a diagonal one. With every such tile next to it taken, the
/// nearest free one further out over the water they join. `None` if there is none within
/// `LAUNCH_SEARCH` tiles, or the site touches none.
pub fn launch_tile(
    world: &WorldState,
    map: &TerrainMap,
    x: i32,
    y: i32,
    kind: VesselKind,
) -> Option<(i32, i32)> {
    let size = map.size;
    let taken: HashSet<(i32, i32)> =
        world.vessels.iter().map(|v| (v.x as i32, v.y as i32)).collect();
    let mut seen: HashSet<(i32, i32)> = HashSet::from([(x, y)]);
    let mut queue: VecDeque<(i32, i32)> = VecDeque::new();
    let push = |t: (i32, i32), seen: &mut HashSet<(i32, i32)>, q: &mut VecDeque<_>| {
        let t = (wrap(t.0, size), wrap(t.1, size));
        if seen.insert(t) && floats_on(kind, terrain_at(map, t.0, t.1)) {
            q.push_back(t);
        }
    };
    for (dx, dy) in AROUND {
        push((x + dx, y + dy), &mut seen, &mut queue);
    }
    let mut looked = 0;
    while let Some(t) = queue.pop_front() {
        if !taken.contains(&t) {
            return Some(t);
        }
        looked += 1;
        if looked >= LAUNCH_SEARCH {
            return None;
        }
        for (dx, dy) in AROUND {
            push((t.0 + dx, t.1 + dy), &mut seen, &mut queue);
        }
    }
    None
}
