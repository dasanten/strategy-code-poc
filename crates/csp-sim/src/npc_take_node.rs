//! Taking a node an NPC city lacks (`CONTEXT.md`: Taking a node, Stance, Holding a workplace; Epic
//! 98, T98.10). An NPC city in Expand short of a good it has no workplace for already builds on the
//! nearest free node of it that it knows (`chain_project`); here:
//!
//! - **Escort:** the crew building on a node out of its City area gets `NPC_SITE_ESCORTS` of its
//!   soldiers beyond its hall and gate posts along, who stand at the site until the project is done.
//! - **Taking:** with no free node of that good known, a militarist city in Expand goes for the
//!   nearest workplace on one that a realm holds (its workers or armed residents within
//!   `NPC_NODE_GUARD_RANGE`), out of that realm's shelter and in no city, when the soldiers it can
//!   spare outweigh those guards `NPC_TAKE_OUTWEIGH_TIMES` over (at least `NPC_TAKE_PARTY_MIN` of
//!   them). They strike the holder's residents there, an attack like any other and a crime against
//!   the holder, until none is left up; then the workplace is the city's (`City.workplace_ids`) and
//!   its own workers move in as to any of its workplaces. With none of its soldiers left up it calls
//!   it off.
//!
//! Only orders a Player could give (ADR 0002); both are plain data on the city's plan.

use std::collections::HashSet;

use csp_shared::balance::{
    road_crew_food, NPC_NODE_GUARD_RANGE, NPC_SITE_ESCORTS, NPC_TAKE_OUTWEIGH_TIMES,
    NPC_TAKE_PARTY_MIN, WALK_TICKS_PER_TILE,
};
use csp_shared::terrain::{wrap_distance, TerrainMap};
use csp_shared::world::{
    Building, City, CityProject, Good, NodeTaking, Resident, ResidentOrder, Stance, Temperament,
    WorldState,
};

use crate::npc_acting_first::take_way_food;
use crate::npc_behaviour::npc_home;
use crate::npc_chain::{makes, short_goods};
use crate::npc_demands::sheltered;
use crate::npc_growth::{nearest_node, on_node};
use crate::npc_hunts::{chase, walk, walking_to};
use crate::npc_plan::plan_due;
use crate::npc_posts::{free_soldiers, posts_to_hold};
use crate::npc_scouts::knows_node;
use crate::npc_stance::stance_of;
use crate::queries::building::{max_workers, node_good, workplace_node};
use crate::queries::city::for_sale;
use crate::queries::city_area::in_city_area;
use crate::queries::names::held;
use crate::queries::persuasion::fighter_strength;
use crate::queries::residents::{can_work, is_armed, is_down};
use crate::sight::InvariantViolation;

fn tile_of(r: &Resident) -> (i32, i32) {
    (r.x as i32, r.y as i32)
}

fn tile_of_building(b: &Building) -> (i32, i32) {
    (b.x as i32, b.y as i32)
}

/// The soldiers a city has out on its node business: taking one, or with a crew building on one.
pub fn out_on_node(world: &WorldState, city_id: &str) -> HashSet<String> {
    let Some(plan) = world.city_plans.get(city_id) else { return HashSet::new() };
    plan.taking
        .iter()
        .flat_map(|t| t.soldier_ids.iter())
        .chain(plan.site_escort.iter().flatten())
        .cloned()
        .collect()
}

/// Whether `r` is up and can fight for the city that sent them.
fn still_fights(r: &Resident, city_id: &str) -> bool {
    r.owner.is_none()
        && r.city_id.as_deref() == Some(city_id)
        && r.health > 0.0
        && !is_down(r.down_until)
        && is_armed(r)
}

/// The residents of `org` holding the workplace `b`: up and within `NPC_NODE_GUARD_RANGE` of it,
/// working it or not: they are driven out once none is left there.
fn holders_at(world: &WorldState, b: &Building, org: &str, size: i32) -> Vec<usize> {
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.owner.as_deref() == Some(org)
                && r.health > 0.0
                && !is_down(r.down_until)
                && wrap_distance(size, tile_of(r), tile_of_building(b)) <= NPC_NODE_GUARD_RANGE
        })
        .collect()
}

fn works(r: &Resident, b: &Building) -> bool {
    matches!(&r.order, Some(ResidentOrder::WorkAt(o)) if o.building_id == b.id)
}

/// The realm holding the workplace `b`, and the strength of its residents there: a realm whose
/// residents work it, else one whose armed residents stand by it. None while nobody does.
pub fn holder_of(world: &WorldState, b: &Building, size: i32) -> Option<(String, f64)> {
    let near = |r: &Resident| {
        r.health > 0.0
            && !is_down(r.down_until)
            && wrap_distance(size, tile_of(r), tile_of_building(b)) <= NPC_NODE_GUARD_RANGE
    };
    let realm = |r: &Resident| {
        r.owner.as_deref().filter(|o| world.realms.iter().any(|x| x.id == *o)).map(str::to_string)
    };
    let org =
        world.residents.iter().filter(|r| near(r) && works(r, b)).find_map(realm).or_else(
            || world.residents.iter().filter(|r| near(r) && is_armed(r)).find_map(realm),
        )?;
    let strength = holders_at(world, b, &org, size)
        .iter()
        .map(|&i| fighter_strength(&world.residents[i]))
        .sum();
    Some((org, strength))
}

/// The city's adults who can be sent: grown, up, not already out on its node business.
fn adults(world: &WorldState, city: &City) -> Vec<usize> {
    let tick = world.tick as f64;
    let out = out_on_node(world, &city.id);
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.owner.is_none()
                && r.city_id.as_ref() == Some(&city.id)
                && r.health > 0.0
                && can_work(r.born_at, tick)
                && !out.contains(&r.id)
        })
        .collect()
}

/// The soldiers a city can spare beyond its hall and gate posts, those to send first last (the
/// wall posts, the highest ids, as for a hunt).
fn spare_soldiers(world: &WorldState, city: &City) -> Vec<usize> {
    let mut free = free_soldiers(world, city, &adults(world, city));
    free.sort_by(|&a, &b| world.residents[a].id.cmp(&world.residents[b].id));
    free.into_iter().skip(posts_to_hold(world, city) as usize).collect()
}

/// The workplace a city would go to take now, with its holder and their strength there
/// (`CONTEXT.md`: Taking a node): for a militarist city in Expand, short of a good it has no
/// workplace for and knows no free node of, the nearest workplace on a node of it that it knows,
/// in no city and no city's, held by a realm out of its shelter.
pub fn node_to_take(
    world: &WorldState,
    city: &City,
    terrain: &TerrainMap,
) -> Option<(usize, String, f64)> {
    let militarist =
        crate::temperament::temperament_of(world.seed, city) == Some(Temperament::Militarist);
    if !for_sale(city) || stance_of(city) != Stance::Expand || !militarist {
        return None;
    }
    let home = npc_home(world, &city.id)?.clone();
    let home_at = tile_of_building(&home);
    let project = world.city_plans.get(&city.id).and_then(|p| p.project.as_ref());
    let goods: Vec<_> = short_goods(world, city, terrain.size, project)
        .into_iter()
        .filter(|&g| {
            !makes(world, city, g) && nearest_node(world, city, &home, terrain, g).is_none()
        })
        .collect();
    if goods.is_empty() {
        return None;
    }
    let claimed: HashSet<&String> =
        world.cities.iter().flat_map(|c| c.workplace_ids.iter().flatten()).collect();
    let mut best: Option<(usize, String, f64, f64)> = None;
    for (i, b) in world.buildings.iter().enumerate() {
        if b.city_id.is_some() || b.site.is_some() || claimed.contains(&b.id) {
            continue;
        }
        if max_workers(b.kind).is_none() {
            continue;
        }
        let Some(node) = workplace_node(world, b) else { continue };
        let at = (node.x as i32, node.y as i32);
        if !goods.contains(&node_good(node.kind)) || !knows_node(city, home_at, at, terrain.size) {
            continue;
        }
        let d = wrap_distance(terrain.size, home_at, tile_of_building(b));
        if best.as_ref().is_some_and(|x| d >= x.3) {
            continue;
        }
        let Some((org, strength)) = holder_of(world, b, terrain.size) else { continue };
        if sheltered(world, &org) {
            continue;
        }
        best = Some((i, org, strength, d));
    }
    best.map(|(i, org, s, _)| (i, org, s))
}

/// Sends soldiers to take the workplace `node_to_take` names, when those it can spare far
/// outweigh its guards: from the last of its spare soldiers on, until they come to
/// `NPC_TAKE_OUTWEIGH_TIMES` the guards' strength and at least `NPC_TAKE_PARTY_MIN` of them.
fn start_taking(world: &mut WorldState, city: &City, terrain: &TerrainMap) {
    let Some((bi, holder, guards)) = node_to_take(world, city, terrain) else { return };
    let mut spare = spare_soldiers(world, city);
    let mut party = Vec::new();
    let mut strength = 0.0;
    while strength < NPC_TAKE_OUTWEIGH_TIMES * guards || party.len() < NPC_TAKE_PARTY_MIN as usize {
        let Some(i) = spare.pop() else { return };
        strength += fighter_strength(&world.residents[i]);
        party.push(i);
    }
    let b = world.buildings[bi].clone();
    for &i in &party {
        world.residents[i].order = Some(walk(tile_of_building(&b)));
        world.residents[i].script = None;
    }
    let taking = NodeTaking {
        building_id: b.id,
        holder,
        soldier_ids: party.iter().map(|&i| world.residents[i].id.clone()).collect(),
    };
    if let Some(plan) = world.city_plans.get_mut(&city.id) {
        plan.taking = Some(taking);
    }
}

/// Takes a city's taking a step on: its soldiers strike the holder's residents at the workplace;
/// with none of them left up there it is the city's, with none of its soldiers left it is called
/// off. Either way its soldiers are free again.
fn keep_taking(world: &mut WorldState, city: &City, size: i32) {
    let Some(mut t) = world.city_plans.get(&city.id).and_then(|p| p.taking.clone()) else {
        return;
    };
    t.soldier_ids
        .retain(|id| world.residents.iter().any(|r| &r.id == id && still_fights(r, &city.id)));
    let b = world.buildings.iter().find(|b| b.id == t.building_id).cloned();
    let targets = b.as_ref().map(|b| holders_at(world, b, &t.holder, size)).unwrap_or_default();
    let done = b.is_none() || targets.is_empty() || t.soldier_ids.is_empty();
    if done {
        for id in &t.soldier_ids {
            if let Some(r) = world.residents.iter_mut().find(|r| &r.id == id) {
                r.order = None;
            }
        }
        if let (Some(b), true) = (&b, targets.is_empty() && !t.soldier_ids.is_empty()) {
            let c = world.cities.iter_mut().find(|c| c.id == city.id).expect("the city");
            let ids = c.workplace_ids.get_or_insert_with(Vec::new);
            if !ids.contains(&b.id) {
                ids.push(b.id.clone());
            }
        }
        if let Some(plan) = world.city_plans.get_mut(&city.id) {
            plan.taking = None;
        }
        return;
    }
    for id in &t.soldier_ids {
        let Some(i) = world.residents.iter().position(|r| &r.id == id) else { continue };
        if world.residents[i].script.is_some() {
            continue;
        }
        let me = tile_of(&world.residents[i]);
        let nearest = targets
            .iter()
            .copied()
            .min_by(|&a, &b| {
                let da = wrap_distance(size, me, tile_of(&world.residents[a]));
                let db = wrap_distance(size, me, tile_of(&world.residents[b]));
                da.total_cmp(&db)
            })
            .expect("targets");
        if let Some(order) = chase(&world.residents[i], &world.residents[nearest], size) {
            world.residents[i].order = Some(order);
        }
    }
    if let Some(plan) = world.city_plans.get_mut(&city.id) {
        plan.taking = Some(t);
    }
}

/// The site of the city's project when it is a workplace on a node out of its City area.
fn far_node_site(world: &WorldState, city: &City, size: i32) -> Option<(i32, i32)> {
    let p = world.city_plans.get(&city.id)?.project.as_ref()?;
    let CityProject::Build { building, x, y, .. } = p else { return None };
    (on_node(*building) && !in_city_area(world, &city.id, *x, *y, size))
        .then_some((*x as i32, *y as i32))
}

/// Sends `NPC_SITE_ESCORTS` of a city's spare soldiers to the site of its project, when it is in
/// Expand and builds on a node out of its City area, and it has none there yet.
fn start_escort(world: &mut WorldState, city: &City, size: i32) {
    if stance_of(city) != Stance::Expand || out_escort(world, &city.id) {
        return;
    }
    let Some(site) = far_node_site(world, city, size) else { return };
    // Not one on their way home for Food from an escort before (#1414).
    let mut spare: Vec<usize> = spare_soldiers(world, city)
        .into_iter()
        .filter(|&i| {
            let home = npc_home(world, &city.id).map(|h| (h.x as i32, h.y as i32));
            home.is_none_or(|h| !walking_to(&world.residents[i], h))
        })
        .collect();
    let mut ids = Vec::new();
    for _ in 0..NPC_SITE_ESCORTS as usize {
        let Some(i) = spare.pop() else { break };
        world.residents[i].order = Some(walk(site));
        world.residents[i].script = None;
        ids.push(world.residents[i].id.clone());
    }
    if let (false, Some(plan)) = (ids.is_empty(), world.city_plans.get_mut(&city.id)) {
        plan.site_escort = Some(ids);
    }
}

fn out_escort(world: &WorldState, city_id: &str) -> bool {
    world.city_plans.get(city_id).is_some_and(|p| p.site_escort.is_some())
}

/// Keeps a city's escort at its site while it builds on a node out of its City area; once that is
/// done or given up, they are free again.
fn keep_escort(world: &mut WorldState, city: &City, size: i32) {
    let Some(mut ids) = world.city_plans.get(&city.id).and_then(|p| p.site_escort.clone()) else {
        return;
    };
    ids.retain(|id| world.residents.iter().any(|r| &r.id == id && still_fights(r, &city.id)));
    let site = far_node_site(world, city, size);
    if site.is_none() || ids.is_empty() {
        for id in &ids {
            if let Some(r) = world.residents.iter_mut().find(|r| &r.id == id) {
                r.order = None;
            }
        }
        if let Some(plan) = world.city_plans.get_mut(&city.id) {
            plan.site_escort = None;
        }
        return;
    }
    let site = site.expect("checked");
    let home = npc_home(world, &city.id).map(|h| (h.x as i32, h.y as i32));
    let mut fed_out: Vec<String> = Vec::new();
    for id in &ids {
        let Some(i) = world.residents.iter().position(|r| &r.id == id) else { continue };
        let r = &world.residents[i];
        let away = wrap_distance(size, tile_of(r), site) > 2.0;
        let fighting = matches!(r.order, Some(ResidentOrder::Attack(_)));
        if r.script.is_some() || fighting {
            continue;
        }
        // Down to what the walk home eats, they go home for Food and leave the escort; the city
        // sends others (#1414: escorts stood at a stalled far site until they starved, and the
        // next ones after them).
        if let Some(home) = home {
            let walk_home = wrap_distance(size, tile_of(r), home) * WALK_TICKS_PER_TILE;
            let out = !in_city_area(world, &city.id, r.x, r.y, size);
            if out && held(&r.carried, Good::Food) < road_crew_food(walk_home) {
                fed_out.push(id.clone());
                world.residents[i].order = Some(walk(home));
                continue;
            }
        }
        // Setting out, they take the Food for the way there and back first.
        let r = &world.residents[i];
        let (x, y) = (f64::from(site.0), f64::from(site.1));
        if (r.order.is_none() || walking_to(r, site)) && take_way_food(world, i, (x, y), size) {
            continue;
        }
        let r = &mut world.residents[i];
        if away && !walking_to(r, site) && r.order.is_none() {
            r.order = Some(walk(site));
        }
    }
    ids.retain(|id| !fed_out.contains(id));
    if let Some(plan) = world.city_plans.get_mut(&city.id) {
        plan.site_escort = Some(ids);
    }
}

/// One tick of NPC cities taking nodes (`stepNpcTakeNodes`), after hunts: each takes its taking and
/// escort a step on; at its planning pass it sends an escort, and goes to take a node.
pub fn step_npc_take_nodes(world: &mut WorldState, terrain: &TerrainMap) {
    let size = terrain.size;
    for ci in 0..world.cities.len() {
        let city = world.cities[ci].clone();
        if !world.city_plans.contains_key(&city.id) {
            continue;
        }
        keep_taking(world, &city, size);
        keep_escort(world, &city, size);
        if !for_sale(&city) || !plan_due(world, &city.id) {
            continue;
        }
        start_escort(world, &city, size);
        if world.city_plans.get(&city.id).is_some_and(|p| p.taking.is_none()) {
            start_taking(world, &city, terrain);
        }
    }
}

/// Takings and site escorts hold together (`npc-takings-sound`, `CONTEXT.md`: Taking a node): each
/// soldier is the city's own and out on one of them only; a taking goes against a realm, out of its
/// shelter, never the city itself or the Trade Organization.
pub fn npc_takings_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for (city_id, plan) in &world.city_plans {
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "npc-takings-sound".into(),
                message,
                entity_ids: vec![city_id.clone()],
            });
        };
        if plan.site_escort.as_ref().is_some_and(Vec::is_empty) {
            fail(format!("city {city_id} has an escort of nobody"));
        }
        let mut seen = HashSet::new();
        let ids = plan
            .taking
            .iter()
            .flat_map(|t| t.soldier_ids.iter())
            .chain(plan.site_escort.iter().flatten());
        for id in ids {
            if !seen.insert(id) {
                fail(format!("{id} is out twice for city {city_id}"));
            }
            let own = world
                .residents
                .iter()
                .any(|r| &r.id == id && r.owner.is_none() && r.city_id.as_ref() == Some(city_id));
            if !own {
                fail(format!("{id}, out for city {city_id}, is none of its own"));
            }
        }
        if let Some(t) = &plan.taking {
            if !world.realms.iter().any(|r| r.id == t.holder) {
                fail(format!("city {city_id} takes a node of {}, which is no realm", t.holder));
            }
            if sheltered(world, &t.holder) {
                fail(format!("city {city_id} takes a node of {}, in its shelter", t.holder));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
