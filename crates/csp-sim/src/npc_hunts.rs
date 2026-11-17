//! NPC cities hunting thieves (`CONTEXT.md`: Acting first, Crime and reputation). An NPC city sends
//! soldiers after residents it knows stole from it (seen by one of its residents, or the news
//! brought home), as long as they stay within its reach (`NPC_HUNT_REACH` of its home), to take
//! back what was taken: they strike the thief down, take the goods from the pile where the thief
//! fell and carry them into the city's storage. Only soldiers beyond its hall and gate posts go
//! (`posts_to_hold`), those on its wall first, so the posts that come first stay manned. A thief
//! who gets out of reach is let go. Only orders a Player could give (ADR 0002); the hunts are plain
//! data on the city's plan.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{NPC_HUNTERS_PER_THIEF, NPC_HUNT_REACH, SIGHT_RANGE};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    BuildingKind, City, CityHunt, CrimeKind, DropOrder, GoodsSpot, PickUpOrder, Resident,
    ResidentOrder, Stock, Tile, WalkOrder, WorldState,
};

use crate::combat::attack_order;
use crate::crimes::{known_thieves, organization_of};
use crate::npc_behaviour::npc_home;
use crate::npc_posts::{free_soldiers, posts_to_hold};
use crate::queries::building::pile_tile;
use crate::queries::names::{held, placed};
use crate::queries::residents::{can_work, is_armed};
use crate::sight::InvariantViolation;

/// A resident's tile.
fn tile_of(r: &Resident) -> (i32, i32) {
    (r.x as i32, r.y as i32)
}

/// Whether `a` is out after `t` for their NPC city (`CONTEXT.md`: Acting first): striking them is
/// taking back what was taken, no crime.
pub fn hunting(world: &WorldState, a: &Resident, t: &Resident) -> bool {
    if a.owner.is_some() {
        return false;
    }
    let Some(city) = a.city_id.as_ref() else { return false };
    world
        .city_plans
        .get(city)
        .and_then(|p| p.hunts.as_ref())
        .is_some_and(|h| h.iter().any(|h| h.resident_id == a.id && h.thief_id == t.id))
}

/// Everyone out after a thief for their city, by id.
pub fn hunters(world: &WorldState, city_id: &str) -> HashSet<String> {
    world
        .city_plans
        .get(city_id)
        .and_then(|p| p.hunts.as_ref())
        .into_iter()
        .flatten()
        .map(|h| h.resident_id.clone())
        .collect()
}

/// One tick of NPC cities hunting thieves (`CONTEXT.md`: Acting first). Run after their defence and
/// before their pass, so the pass leaves the hunters to it. `size` is the map's.
pub fn step_npc_hunts(world: &mut WorldState, size: i32) {
    // Only cities something was stolen from, or with soldiers still out: most ticks, none.
    let robbed: HashSet<&str> = world
        .crimes
        .iter()
        .filter(|c| c.kind == CrimeKind::Theft)
        .map(|c| c.victim_org.as_str())
        .collect();
    let ids: Vec<String> = world
        .cities
        .iter()
        .filter(|c| c.realm_id.is_none() && c.trade_org.is_none())
        .filter(|c| {
            robbed.contains(c.id.as_str())
                || world.city_plans.get(&c.id).is_some_and(|p| p.hunts.is_some())
        })
        .map(|c| c.id.clone())
        .collect();
    for id in ids {
        if !world.city_plans.contains_key(&id) {
            continue;
        }
        let Some(city) = world.cities.iter().find(|c| c.id == id).cloned() else { continue };
        keep_hunts(world, &city, size);
        send_hunters(world, &city, size);
    }
}

/// Where a city measures its reach from, and its storage, by index.
fn home_tile(world: &WorldState, city_id: &str) -> Option<(i32, i32)> {
    npc_home(world, city_id).map(|b| (b.x as i32, b.y as i32))
}

/// The city's finished storage, by index.
fn storage_of(world: &WorldState, city_id: &str) -> Option<usize> {
    world.buildings.iter().position(|b| {
        b.kind == BuildingKind::Storage && b.site.is_none() && b.city_id.as_deref() == Some(city_id)
    })
}

/// Whether a resident's order is a walk to this tile.
fn walking_to(r: &Resident, to: (i32, i32)) -> bool {
    matches!(&r.order, Some(ResidentOrder::WalkTo(o)) if (o.target.x as i32, o.target.y as i32) == to)
}

/// Takes each of a city's hunts a step on, and drops those that are over: the soldier gone,
/// disarmed or Down, the thief out of reach (let go), nothing left where they fell, or the goods
/// home.
fn keep_hunts(world: &mut WorldState, city: &City, size: i32) {
    let Some(hunts) = world.city_plans.get(&city.id).and_then(|p| p.hunts.clone()) else { return };
    let home = home_tile(world, &city.id);
    let index: HashMap<&str, usize> =
        world.residents.iter().enumerate().map(|(i, r)| (r.id.as_str(), i)).collect();
    let mut kept: Vec<CityHunt> = Vec::new();
    let mut orders: Vec<(usize, Option<ResidentOrder>)> = Vec::new();
    for mut h in hunts {
        let Some(&i) = index.get(h.resident_id.as_str()) else { continue };
        let r = &world.residents[i];
        let ours = r.owner.is_none() && r.city_id.as_ref() == Some(&city.id);
        if !ours || r.health <= 0.0 || r.down_until.is_some() || !is_armed(r) {
            continue;
        }
        // Fighting back, or called to an alarm, they see to that first.
        if r.script.is_some() {
            kept.push(h);
            continue;
        }
        if h.fell != Some(true) {
            let thief = index.get(h.thief_id.as_str()).map(|&t| &world.residents[t]);
            match thief.filter(|t| t.health > 0.0) {
                Some(t) => {
                    let at = tile_of(t);
                    let far =
                        home.is_none_or(|home| wrap_distance(size, home, at) > NPC_HUNT_REACH);
                    if far {
                        // Let go: they come home as soldiers do, and take their post.
                        orders.push((i, None));
                        continue;
                    }
                    h.last_at = Tile { x: f64::from(at.0), y: f64::from(at.1) };
                    if let Some(o) = chase(r, t, size) {
                        orders.push((i, Some(o)));
                    }
                    kept.push(h);
                    continue;
                }
                None => h.fell = Some(true),
            }
        }
        let fell_at = (h.last_at.x as i32, h.last_at.y as i32);
        if h.home != Some(true) {
            if tile_of(r) != fell_at {
                if !walking_to(r, fell_at) {
                    orders.push((i, Some(walk(fell_at))));
                }
                kept.push(h);
                continue;
            }
            // There: whatever of the goods the pile holds goes with them.
            let pile_at = pile_tile(world, fell_at.0, fell_at.1, size);
            let pile = world
                .piles
                .iter()
                .find(|p| (p.x as i32, p.y as i32) == pile_at)
                .map(|p| p.goods.clone())
                .unwrap_or_default();
            let take: Stock = h
                .goods
                .iter()
                .map(|(g, n)| (*g, n.min(held(&pile, *g))))
                .filter(|(_, n)| *n > 0.0)
                .collect();
            if take.is_empty() {
                orders.push((i, None));
                continue;
            }
            orders.push((
                i,
                Some(ResidentOrder::PickUp(PickUpOrder {
                    from: GoodsSpot::Ground,
                    goods: take.clone(),
                })),
            ));
            h.goods = take;
            h.home = Some(true);
            kept.push(h);
            continue;
        }
        // On their way home with what they took back.
        let Some(s) = storage_of(world, &city.id) else {
            orders.push((i, None));
            continue;
        };
        if matches!(r.order, Some(ResidentOrder::PickUp(_))) {
            kept.push(h);
            continue;
        }
        let load: Stock = h
            .goods
            .iter()
            .map(|(g, n)| (*g, n.min(held(&r.carried, *g))))
            .filter(|(_, n)| *n > 0.0)
            .collect();
        if load.is_empty() {
            orders.push((i, None));
            continue;
        }
        let b = &world.buildings[s];
        if is_at(tile_of(r), placed(b), size) {
            let to = GoodsSpot::Storage { storage_id: b.id.clone() };
            orders.push((i, Some(ResidentOrder::Drop(DropOrder { to, goods: load }))));
            continue;
        }
        let at = (b.x as i32, b.y as i32);
        if !walking_to(r, at) {
            orders.push((i, Some(walk(at))));
        }
        kept.push(h);
    }
    for (i, order) in orders {
        let r = &mut world.residents[i];
        r.order = order;
        r.script = None;
    }
    let plan = world.city_plans.get_mut(&city.id).expect("a plan");
    plan.hunts = (!kept.is_empty()).then_some(kept);
}

/// How far a thief may get from where a hunter out of sight of them is walking before the walk is
/// set again, in tiles: so a running thief doesn't cost a new path every tick.
const CHASE_SLACK: f64 = 8.0;

/// A hunter's next order after thief `t`, if it is to change: in sight, the attack; out of it, a
/// walk to where the thief is (an attack ends out of the attacker's sight, `combat`).
fn chase(r: &Resident, t: &Resident, size: i32) -> Option<ResidentOrder> {
    let at = tile_of(t);
    if wrap_distance(size, tile_of(r), at) <= SIGHT_RANGE {
        let after = matches!(&r.order, Some(ResidentOrder::Attack(o)) if o.target_id == t.id);
        return (!after).then(|| ResidentOrder::Attack(attack_order(&t.id, false, false)));
    }
    let near = matches!(&r.order, Some(ResidentOrder::WalkTo(o))
        if wrap_distance(size, (o.target.x as i32, o.target.y as i32), at) <= CHASE_SLACK);
    (!near).then(|| walk(at))
}

/// A walk to a tile.
fn walk(to: (i32, i32)) -> ResidentOrder {
    ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x: f64::from(to.0), y: f64::from(to.1) },
        path: None,
        progress: 0.0,
        army: None,
    })
}

/// What a city knows `thief` took from it in goods: its thefts by them it knows of or one of its
/// residents saw.
fn taken_by(world: &WorldState, city_id: &str, thief: &str) -> Stock {
    let ours: HashSet<&str> = world
        .residents
        .iter()
        .filter(|r| organization_of(r) == Some(city_id))
        .map(|r| r.id.as_str())
        .collect();
    let mut taken = Stock::new();
    for c in world.crimes.iter().filter(|c| {
        c.kind == CrimeKind::Theft
            && c.victim_org == city_id
            && c.culprit.resident_id == thief
            && (c.known_by.iter().any(|k| k == city_id)
                || c.witnesses.iter().any(|w| ours.contains(w.as_str())))
    }) {
        for (g, n) in c.goods.iter().flatten() {
            *taken.entry(*g).or_insert(0.0) += n;
        }
    }
    taken
}

/// Sends soldiers after the thieves a city knows of within its reach, up to
/// `NPC_HUNTERS_PER_THIEF` each, from those beyond its hall and gate posts: the last by id first,
/// who stand on its wall.
fn send_hunters(world: &mut WorldState, city: &City, size: i32) {
    let Some(home) = home_tile(world, &city.id) else { return };
    let thieves = known_thieves(world, &city.id);
    if thieves.is_empty() {
        return;
    }
    let targets: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            thieves.contains(&r.id)
                && r.health > 0.0
                && organization_of(r) != Some(city.id.as_str())
                && wrap_distance(size, home, tile_of(r)) <= NPC_HUNT_REACH
        })
        .collect();
    if targets.is_empty() {
        return;
    }
    let tick = world.tick as f64;
    let out = hunters(world, &city.id);
    let adults: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.owner.is_none()
                && r.city_id.as_ref() == Some(&city.id)
                && r.health > 0.0
                && can_work(r.born_at, tick)
                && !out.contains(&r.id)
        })
        .collect();
    let mut free = free_soldiers(world, city, &adults);
    free.sort_by(|&a, &b| world.residents[a].id.cmp(&world.residents[b].id));
    let held_posts = posts_to_hold(world, city) as usize;
    let mut spare: Vec<usize> = free.into_iter().skip(held_posts).collect();
    let mut new: Vec<CityHunt> = Vec::new();
    for t in targets {
        let thief = world.residents[t].id.clone();
        let after = world
            .city_plans
            .get(&city.id)
            .and_then(|p| p.hunts.as_ref())
            .into_iter()
            .flatten()
            .filter(|h| h.thief_id == thief && h.fell != Some(true))
            .count();
        let at = tile_of(&world.residents[t]);
        let goods = taken_by(world, &city.id, &thief);
        for _ in after..NPC_HUNTERS_PER_THIEF as usize {
            let Some(i) = spare.pop() else { break };
            let mut r = world.residents[i].clone();
            r.order = None;
            let order = chase(&r, &world.residents[t], size);
            world.residents[i].order = order;
            world.residents[i].script = None;
            new.push(CityHunt {
                resident_id: world.residents[i].id.clone(),
                thief_id: thief.clone(),
                goods: goods.clone(),
                last_at: Tile { x: f64::from(at.0), y: f64::from(at.1) },
                fell: None,
                home: None,
            });
        }
    }
    if new.is_empty() {
        return;
    }
    let plan = world.city_plans.get_mut(&city.id).expect("a plan");
    plan.hunts.get_or_insert_with(Vec::new).extend(new);
}

/// Invariant `npc-hunts-sound` (ADR 0004; `CONTEXT.md`: Acting first): only an NPC city that isn't
/// the Trade Organization's has soldiers out after thieves, none twice, never an empty list, and
/// right after a tick each of them a living resident of the city.
pub fn npc_hunts_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for city in &world.cities {
        let Some(hunts) = world.city_plans.get(&city.id).and_then(|p| p.hunts.as_ref()) else {
            continue;
        };
        let mut fail = |message: String, ids: Vec<String>| {
            out.push(InvariantViolation {
                invariant: "npc-hunts-sound".into(),
                message: format!("{} {message}", city.id),
                entity_ids: ids,
            })
        };
        let ids: Vec<String> = hunts.iter().map(|h| h.resident_id.clone()).collect();
        if hunts.is_empty() {
            fail("keeps an empty list of hunts".into(), vec![]);
        }
        if city.realm_id.is_some() || city.trade_org.is_some() {
            fail("isn\u{2019}t an NPC city of its own, and hunts thieves".into(), ids.clone());
        }
        if ids.iter().collect::<HashSet<_>>().len() < ids.len() {
            fail("has a soldier on two hunts".into(), ids.clone());
        }
        for h in hunts {
            let r = world.residents.iter().find(|x| x.id == h.resident_id);
            if r.is_some_and(|r| r.owner.is_some() || r.city_id.as_ref() != Some(&city.id)) {
                fail(
                    format!("has {} out hunting, who isn\u{2019}t its own", h.resident_id),
                    vec![h.resident_id.clone()],
                );
            }
            if h.goods.values().any(|n| *n < 0.0) {
                fail(
                    format!("takes back less than nothing with {}", h.resident_id),
                    vec![h.resident_id.clone()],
                );
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
