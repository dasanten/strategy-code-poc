//! Where an NPC city's soldiers stand between fights (`apps/server/src/npc-posts.ts`,
//! `CONTEXT.md`: Soldier posts; ADR 0029): first on its town hall, then at its gates and along its
//! wall. Nothing about it is stored: their posts follow from their ids and what the city has,
//! worked out in the pass that sends them.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{NPC_POST_AROUND_HALL, NPC_SOLDIERS_AT_GATE, NPC_SOLDIERS_ON_HALL};
use csp_shared::footprint::{covers, footprint_tiles, FOOTPRINT};
use csp_shared::terrain::{
    is_passable_terrain, terrain_at, tile_index, wrap, wrap_delta, TerrainMap,
};
use csp_shared::world::{
    Building, BuildingKind, City, CityJobKind, ResidentOrder, Task, WorldState,
};

use crate::npc_founding::founding_party;
use crate::queries::city::town_hall_of;
use crate::queries::names::{kind_name, placed};
use crate::queries::residents::is_armed;
use crate::random::hash_str;

/// A soldier's post (`SoldierPost`): where their id puts them, and the tiles that count as being
/// on it, by tile index.
#[derive(Debug, Clone, PartialEq)]
pub struct SoldierPost {
    /// The tile they walk to.
    pub at: (i32, i32),
    /// What counts as on this post: one standing or going to any of them stays.
    pub tiles: std::rc::Rc<HashSet<usize>>,
}

/// Whether a city's soldiers stand posts (`standsPosts`): an NPC city with its town hall up, not
/// the Trade Org's.
pub fn stands_posts(world: &WorldState, city: &City) -> bool {
    city.trade_org.is_none() && town_hall_of(world, city).is_some_and(|h| h.site.is_none())
}

/// Those of a city's `adults` who take a post (`freeSoldiers`): its armed adults at hand and not
/// at a script, so not on alarm or training, nor teaching.
pub fn free_soldiers(world: &WorldState, city: &City, adults: &[usize]) -> Vec<usize> {
    let jobs = world.city_plans.get(&city.id).map(|p| &p.jobs);
    soldiers_at_hand(world, city, adults)
        .into_iter()
        .filter(|&i| {
            let r = &world.residents[i];
            let kind = jobs.and_then(|j| j.get(&r.id)).map(|j| j.kind);
            r.script.is_none()
                && kind != Some(CityJobKind::Teach)
                && kind != Some(CityJobKind::Train)
        })
        .collect()
}

/// The armed adults of a city's `adults` it can put somewhere (`soldiersAtHand`): not at any script
/// but the Train default, so not on alarm; not fighting, carrying a child, Down, on a round, nor
/// its traders or founding party.
pub fn soldiers_at_hand(world: &WorldState, city: &City, adults: &[usize]) -> Vec<usize> {
    let plan = world.city_plans.get(&city.id);
    let party: HashSet<String> = founding_party(plan).into_iter().collect();
    let traders: HashSet<&String> = plan
        .and_then(|p| p.traders.as_ref())
        .into_iter()
        .flatten()
        .map(|t| &t.resident_id)
        .collect();
    let on_round: HashSet<&String> = plan
        .and_then(|p| p.patrols.as_ref())
        .into_iter()
        .flatten()
        .map(|p| &p.resident_id)
        .collect();
    adults
        .iter()
        .copied()
        .filter(|&i| {
            let r = &world.residents[i];
            is_armed(&r.carried)
                && r.down_until.is_none()
                && r.script.as_ref().is_none_or(|s| s.task == Some(Task::Train))
                && r.carrying.is_none()
                && !matches!(r.order, Some(ResidentOrder::Attack(_)))
                && !party.contains(&r.id)
                && !traders.contains(&r.id)
                && !on_round.contains(&r.id)
        })
        .collect()
}

/// How many soldiers it takes to hold the posts on a city's hall and at its finished gates
/// (`postsToHold`), which come first.
pub fn posts_to_hold(world: &WorldState, city: &City) -> f64 {
    let gates = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Gate && b.city_id.as_ref() == Some(&city.id) && b.site.is_none()
        })
        .count();
    NPC_SOLDIERS_ON_HALL + NPC_SOLDIERS_AT_GATE * gates as f64
}

/// The posts of a city's `soldiers` (`soldierPosts`), by resident id; none for a city whose
/// soldiers stand none. In order of id, the first `NPC_SOLDIERS_ON_HALL` stand on the hall and the
/// next `NPC_SOLDIERS_AT_GATE` at each gate; the rest spread along its wall, each on the tile their
/// id hashes to. A city with too little wall for them adds the ground around its hall to it.
pub fn soldier_posts(
    world: &WorldState,
    city: &City,
    soldiers: &[usize],
    size: i32,
    terrain: Option<&TerrainMap>,
) -> HashMap<String, SoldierPost> {
    let mut posts = HashMap::new();
    if !stands_posts(world, city) || soldiers.is_empty() {
        return posts;
    }
    let hall = town_hall_of(world, city).expect("stands posts");
    let hall_tiles = footprint_tiles(placed(hall), size);
    let ids = |tiles: &[(i32, i32)]| {
        std::rc::Rc::new(tiles.iter().map(|t| tile_index(size, t.0, t.1)).collect::<HashSet<_>>())
    };
    let on_hall = ids(&hall_tiles);
    let mut ranked: Vec<&String> = soldiers.iter().map(|&i| &world.residents[i].id).collect();
    ranked.sort();
    let pick = |list: &[(i32, i32)], id: &str| list[hash_str(id) as usize % list.len()];

    let on_hall_n = NPC_SOLDIERS_ON_HALL as usize;
    for id in ranked.iter().take(on_hall_n) {
        posts.insert(
            id.to_string(),
            SoldierPost { at: pick(&hall_tiles, id), tiles: on_hall.clone() },
        );
    }
    let mut taken = on_hall_n;
    let (gates, walls) = reachable_walls(world, city, size);
    let at_gate = NPC_SOLDIERS_AT_GATE as usize;
    for gate in gates {
        let at = (gate.x as i32, gate.y as i32);
        let tiles = ids(&[at]);
        for id in ranked.iter().skip(taken).take(at_gate) {
            posts.insert(id.to_string(), SoldierPost { at, tiles: tiles.clone() });
        }
        taken += at_gate;
    }
    let rest: Vec<&&String> = ranked.iter().skip(taken).collect();
    if rest.is_empty() {
        return posts;
    }
    let along: Vec<(i32, i32)> = walls.iter().map(|w| (w.x as i32, w.y as i32)).collect();
    let spots = if along.len() >= rest.len() {
        along
    } else {
        let mut s = along;
        s.extend(around_hall(world, hall, size, terrain));
        s
    };
    // With no ground free around it either, the hall is all there is.
    let tiles = if spots.is_empty() { hall_tiles } else { spots };
    let on_them = ids(&tiles);
    for id in rest {
        posts.insert(id.to_string(), SoldierPost { at: pick(&tiles, id), tiles: on_them.clone() });
    }
    posts
}

/// A city's finished gates, and those of its finished walls a soldier can get onto
/// (`reachableWalls`): a stretch joined side to side to a gate, in order of id.
pub fn reachable_walls<'w>(
    world: &'w WorldState,
    city: &City,
    size: i32,
) -> (Vec<&'w Building>, Vec<&'w Building>) {
    let mut gates = Vec::new();
    let mut walls: HashMap<usize, &Building> = HashMap::new();
    for b in &world.buildings {
        if b.city_id.as_ref() != Some(&city.id) || b.site.is_some() {
            continue;
        }
        if b.kind == BuildingKind::Gate {
            gates.push(b);
        } else if b.kind == BuildingKind::Wall {
            walls.insert(tile_index(size, b.x as i32, b.y as i32), b);
        }
    }
    let mut reached: Vec<&Building> = Vec::new();
    let mut todo: Vec<&Building> = gates.clone();
    let mut seen = HashSet::new();
    while let Some(b) = todo.pop() {
        let (x, y) = (b.x as i32, b.y as i32);
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let t = tile_index(size, wrap(x + dx, size), wrap(y + dy, size));
            let Some(wall) = walls.get(&t) else { continue };
            if !seen.insert(t) {
                continue;
            }
            reached.push(wall);
            todo.push(wall);
        }
    }
    // A set order, whichever way the search went: their ids must give them the same tile each pass.
    reached.sort_by(|a, b| a.id.cmp(&b.id));
    (gates, reached)
}

/// The tiles within `NPC_POST_AROUND_HALL` of a town hall one can stand on (`aroundHall`): not on
/// another building, a road aside, nor on ground nobody walks on.
fn around_hall(
    world: &WorldState,
    hall: &Building,
    size: i32,
    terrain: Option<&TerrainMap>,
) -> Vec<(i32, i32)> {
    let reach = NPC_POST_AROUND_HALL as i32;
    let side = FOOTPRINT.get(kind_name(hall.kind)).expect("a footprint");
    // Nothing further off can cover one of these tiles.
    let widest = FOOTPRINT.0.iter().map(|(_, s)| *s).max().unwrap_or(1);
    let far = reach + side + widest;
    let (hx, hy) = (hall.x as i32, hall.y as i32);
    let nearby: Vec<&Building> = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind != BuildingKind::Road
                && wrap_delta(hx, b.x as i32, size).abs() <= far
                && wrap_delta(hy, b.y as i32, size).abs() <= far
        })
        .collect();
    let mut out = Vec::new();
    for dy in -reach..side + reach {
        for dx in -reach..side + reach {
            let x = wrap(hx + dx, size);
            let y = wrap(hy + dy, size);
            if nearby.iter().any(|b| covers(placed(b), x, y, size)) {
                continue;
            }
            if terrain.is_some_and(|t| !is_passable_terrain(terrain_at(t, x, y))) {
                continue;
            }
            out.push((x, y));
        }
    }
    out
}
