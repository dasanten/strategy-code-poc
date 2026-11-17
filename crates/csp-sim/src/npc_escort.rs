//! Escorts (`CONTEXT.md`: Escort; Epic 97): soldiers an NPC city sends along with its own people on
//! the road. A town's trader takes `NPC_TRADER_ESCORTS` per run (a village's goes alone); a
//! founding party takes `NPC_FOUND_ESCORT_SHARE` of its size, at least one, in place of its one
//! armed member. Only soldiers beyond those on the hall and at the gates go.
//!
//! A trader's escort is kept on the run (`CityTrader.escort_ids`), walks where the trader walks and
//! fights whoever goes for them; the trader waits for them between legs, and they come home
//! together. A founding party's soldiers are members of the party, so they stay as the daughter's
//! first soldiers; its armed members fight for the rest on the way.

use std::collections::HashSet;

use csp_shared::balance::{
    set_out_food, CARAVAN_GUARD_RANGE, MAP_SIZE, NPC_ESCORT_TOWN_RESIDENTS, NPC_FOUND_ESCORT_SHARE,
    NPC_TRADER_ESCORTS, WALK_TICKS_PER_TILE,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::{wrap_delta, wrap_distance};
use csp_shared::world::{
    City, CityTrader, Good, GoodsSpot, PickUpOrder, ResidentOrder, Stock, WorldState,
};

use crate::combat::attack_order;
use crate::npc_behaviour::walk_to;
use crate::npc_posts::{free_soldiers, posts_to_hold};
use crate::queries::city::city_residents;
use crate::queries::combat::in_contact;
use crate::queries::goods::units_that_fit;
use crate::queries::names::{held, held_in, placed};
use crate::queries::residents::is_armed;
use crate::sight::InvariantViolation;
use crate::world_index::resident_index;

/// Soldiers more a city sends along on a way it knows to be dangerous (`CONTEXT.md`: Escort): by
/// the danger places it remembers by the way from its town hall (`npc_threat::danger_escorts`), and
/// more under Fortify (`NPC_STANCE.fortify_escorts`).
pub fn escorts_for_danger(world: &WorldState, city: &City, to: (i32, i32)) -> usize {
    crate::npc_threat::danger_escorts(world, city, to, MAP_SIZE)
        + crate::npc_stance::extra_escorts(city)
}

/// How many soldiers a city's trader takes along on a run to `to` (`CONTEXT.md`: Escort): a
/// town's `NPC_TRADER_ESCORTS`, and more on a dangerous way; a village's none.
pub fn trader_escorts_wanted(world: &WorldState, city: &City, to: (i32, i32)) -> usize {
    if (city_residents(world, &city.id).len() as f64) < NPC_ESCORT_TOWN_RESIDENTS {
        return 0;
    }
    NPC_TRADER_ESCORTS as usize + escorts_for_danger(world, city, to)
}

/// How many soldiers a founding party of `members` takes to `site` (`CONTEXT.md`: Escort): in
/// proportion to its size, at least one, more on a dangerous way, never more than the party.
pub fn founding_escorts_wanted(
    world: &WorldState,
    city: &City,
    members: usize,
    site: (i32, i32),
) -> usize {
    let share = ((members as f64 * NPC_FOUND_ESCORT_SHARE).floor() as usize).max(1);
    (share + escorts_for_danger(world, city, site)).min(members)
}

/// The soldiers of a city's `adults` it can send along (`CONTEXT.md`: Escort): its free soldiers
/// beyond those its hall and gates take. Posts go in order of id (`soldier_posts`), so these are
/// the last by id, and the hall and gates keep theirs once they go.
pub fn spare_soldiers(world: &WorldState, city: &City, adults: &[usize]) -> Vec<usize> {
    let mut free = free_soldiers(world, city, adults);
    free.sort_by(|&a, &b| world.residents[a].id.cmp(&world.residents[b].id));
    free.into_iter().skip(posts_to_hold(world, city) as usize).collect()
}

/// The ids of a city's soldiers out as a trader's escort.
pub fn escorts_out(world: &WorldState, city_id: &str) -> HashSet<String> {
    world
        .city_plans
        .get(city_id)
        .and_then(|p| p.traders.as_ref())
        .into_iter()
        .flatten()
        .flat_map(|t| t.escort_ids.iter().cloned())
        .collect()
}

/// Gives a city's run just planned for `trader` its escort (`CONTEXT.md`: Escort), of the soldiers
/// it can spare, nearest the trader first. A run to a trader visiting the city stays in it and
/// takes none.
pub fn escort_run(world: &mut WorldState, city: &City, adults: &[usize], trader: &str, size: i32) {
    let Some(run) = run_of(world, &city.id, trader) else { return };
    if run.visiting_id.is_some() {
        return;
    }
    let to = run
        .warehouse_id
        .as_ref()
        .and_then(|id| world.buildings.iter().find(|b| &b.id == id))
        .map(|b| (b.x as i32, b.y as i32));
    let Some(to) = to else { return };
    let wanted = trader_escorts_wanted(world, city, to);
    if wanted == 0 {
        return;
    }
    let Some(t) = resident_index(world, trader) else { return };
    let at = (world.residents[t].x as i32, world.residents[t].y as i32);
    let mut spare = spare_soldiers(world, city, adults);
    spare.sort_by(|&a, &b| {
        let d = |i: usize| {
            wrap_distance(size, at, (world.residents[i].x as i32, world.residents[i].y as i32))
        };
        d(a).total_cmp(&d(b))
    });
    let ids: Vec<String> =
        spare.into_iter().take(wanted).map(|i| world.residents[i].id.clone()).collect();
    for id in &ids {
        if let Some(i) = resident_index(world, id) {
            world.residents[i].order = None;
        }
    }
    if let Some(run) = run_of_mut(world, &city.id, trader) {
        run.escort_ids = ids;
    }
}

/// The run a resident is on as trader.
fn run_of<'w>(world: &'w WorldState, city_id: &str, trader: &str) -> Option<&'w CityTrader> {
    world.city_plans.get(city_id)?.traders.as_ref()?.iter().find(|t| t.resident_id == trader)
}

fn run_of_mut<'w>(
    world: &'w mut WorldState,
    city_id: &str,
    trader: &str,
) -> Option<&'w mut CityTrader> {
    world
        .city_plans
        .get_mut(city_id)?
        .traders
        .as_mut()?
        .iter_mut()
        .find(|t| t.resident_id == trader)
}

/// The run a resident is escorting, if any.
pub fn escorting<'w>(world: &'w WorldState, city_id: &str, id: &str) -> Option<&'w CityTrader> {
    world
        .city_plans
        .get(city_id)?
        .traders
        .as_ref()?
        .iter()
        .find(|t| t.escort_ids.iter().any(|e| e == id))
}

/// Whether a trader waits for their escort before their next leg (`CONTEXT.md`: Escort: it keeps
/// pace with them): one of it who lives and is on their feet is out of contact with them.
pub fn escort_lags(world: &WorldState, city_id: &str, trader: usize, size: i32) -> bool {
    escort_beyond(world, city_id, trader, 1, size)
}

/// Tiles an escort may fall behind a walking trader before the trader stops for them.
const ESCORT_PACE_TILES: i32 = 2;

/// Whether one of the trader's escort who lives and is on their feet is more than `reach` tiles
/// from them, either way.
fn escort_beyond(world: &WorldState, city_id: &str, trader: usize, reach: i32, size: i32) -> bool {
    let t = &world.residents[trader];
    let Some(run) = run_of(world, city_id, &t.id) else { return false };
    let at = (t.x as i32, t.y as i32);
    run.escort_ids.iter().any(|id| {
        resident_index(world, id).is_some_and(|i| {
            let e = &world.residents[i];
            let (ex, ey) = (e.x as i32, e.y as i32);
            e.health > 0.0
                && e.down_until.is_none()
                && e.city_id.as_deref() == Some(city_id)
                && (wrap_delta(at.0, ex, size).abs() > reach
                    || wrap_delta(at.1, ey, size).abs() > reach)
        })
    })
}

/// A walking trader whose escort has fallen behind stands where they are, their walk kept, until
/// it catches up (`CONTEXT.md`: Escort: it keeps pace with them). Returns whether they wait.
pub fn wait_for_escort(world: &mut WorldState, city_id: &str, trader: usize, size: i32) -> bool {
    if !matches!(world.residents[trader].order, Some(ResidentOrder::WalkTo(_))) {
        return false;
    }
    if !escort_beyond(world, city_id, trader, ESCORT_PACE_TILES, size) {
        return false;
    }
    if let Some(ResidentOrder::WalkTo(o)) = world.residents[trader].order.as_mut() {
        o.progress = 0.0;
    }
    true
}

/// Who goes for those a city guards (`guarded`, by index) near `at`: alive, none of `crew`,
/// attacking one of them without being hit first, or robbing one who is Down.
fn threats(world: &WorldState, crew: &HashSet<&str>, at: (f64, f64), size: i32) -> Vec<usize> {
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            if r.health <= 0.0 || crew.contains(r.id.as_str()) {
                return false;
            }
            let goes_for = match &r.order {
                Some(ResidentOrder::Attack(o)) => {
                    o.defending != Some(true) && crew.contains(o.target_id.as_str())
                }
                Some(ResidentOrder::PickUp(PickUpOrder {
                    from: GoodsSpot::Resident { resident_id },
                    ..
                })) => crew.contains(resident_id.as_str()),
                _ => false,
            };
            goes_for
                && wrap_distance(size, at_of(r), (at.0 as i32, at.1 as i32)) <= CARAVAN_GUARD_RANGE
        })
        .collect()
}

fn at_of(r: &csp_shared::world::Resident) -> (i32, i32) {
    (r.x as i32, r.y as i32)
}

/// Guard `g` fights whoever goes for `crew` near `at` (`CONTEXT.md`: Escort), the nearest first;
/// one fighting someone who has gone far off lets them go. A guard at a script is left to it
/// unless `interrupt`, when a fight stops it. Returns whether they are fighting now.
fn guard(
    world: &mut WorldState,
    crew: &HashSet<&str>,
    g: usize,
    at: (f64, f64),
    interrupt: bool,
    size: i32,
) -> bool {
    let r = &world.residents[g];
    if r.health <= 0.0 || r.down_until.is_some() || (r.script.is_some() && !interrupt) {
        return false;
    }
    let here = (at.0 as i32, at.1 as i32);
    if let Some(ResidentOrder::Attack(o)) = &r.order {
        let far = world.residents.iter().find(|x| x.id == o.target_id).is_none_or(|x| {
            x.health <= 0.0 || wrap_distance(size, at_of(x), here) > CARAVAN_GUARD_RANGE
        });
        if far {
            world.residents[g].order = None;
        }
        return !far;
    }
    if !is_armed(r) {
        return false;
    }
    let me = at_of(r);
    let nearest = threats(world, crew, at, size).into_iter().min_by(|&a, &b| {
        let d = |i: usize| wrap_distance(size, me, at_of(&world.residents[i]));
        d(a).total_cmp(&d(b))
    });
    let Some(n) = nearest else { return false };
    let target = world.residents[n].id.clone();
    let r = &mut world.residents[g];
    r.script = None;
    r.order = Some(ResidentOrder::Attack(attack_order(&target, false, true)));
    true
}

/// One tick of a trader's escort `i` (`CONTEXT.md`: Escort): they fight for the trader, take the
/// Food for the way from the storage as they set out, and walk where the trader walks. Returns
/// whether they had something to do as escort; one whose trader is gone goes back to being a
/// soldier of the city.
pub fn run_escort(
    world: &mut WorldState,
    city_id: &str,
    i: usize,
    storage: Option<usize>,
    size: i32,
) -> bool {
    let id = world.residents[i].id.clone();
    let Some(run) = escorting(world, city_id, &id).cloned() else { return false };
    let Some(t) = resident_index(world, &run.resident_id).filter(|&t| {
        world.residents[t].health > 0.0 && world.residents[t].city_id.as_deref() == Some(city_id)
    }) else {
        return false;
    };
    // On alarm, they get back to it when their Alarm script hands back.
    if world.residents[i].script.is_some() {
        return true;
    }
    let at = (world.residents[t].x, world.residents[t].y);
    let crew: HashSet<&str> =
        run.escort_ids.iter().map(String::as_str).chain([run.resident_id.as_str()]).collect();
    if guard(world, &crew, i, at, false, size) {
        return true;
    }
    if !matches!(world.residents[i].order, None | Some(ResidentOrder::WalkTo(_))) {
        return true;
    }
    // Setting out, they take the Food for the way as the trader does.
    let outbound = !run.sells.is_empty() || run.offer.is_some();
    if let (Some(s), true, None) = (storage, outbound, &world.residents[i].order) {
        if let Some(load) = way_food(world, i, s, run.warehouse_id.as_deref(), size) {
            world.residents[i].order = Some(load);
            return true;
        }
    }
    // Where the trader walks, or where they stand.
    let tr = &world.residents[t];
    let target = match &tr.order {
        Some(ResidentOrder::WalkTo(o)) => (o.target.x, o.target.y),
        _ => (tr.x, tr.y),
    };
    let e = &world.residents[i];
    let going =
        matches!(&e.order, Some(ResidentOrder::WalkTo(o)) if (o.target.x, o.target.y) == target);
    let standing = !matches!(tr.order, Some(ResidentOrder::WalkTo(_)));
    if standing && in_contact(size, at_of(e), (tr.x as i32, tr.y as i32)) {
        if e.order.is_some() && !going {
            world.residents[i].order = None;
        }
        return true;
    }
    if !going {
        walk_to(&mut world.residents[i], target);
    }
    true
}

/// The pick-up of the Food escort `i` at storage `s` lacks for the way to `to` and back, if they
/// stand at it and it has some.
fn way_food(
    world: &WorldState,
    i: usize,
    s: usize,
    to: Option<&str>,
    size: i32,
) -> Option<ResidentOrder> {
    let e = &world.residents[i];
    let store = &world.buildings[s];
    let me = at_of(e);
    if !is_at(me, placed(store), size) {
        return None;
    }
    let to = world.buildings.iter().find(|b| Some(b.id.as_str()) == to)?;
    let need =
        set_out_food(wrap_distance(size, me, (to.x as i32, to.y as i32)) * WALK_TICKS_PER_TILE)
            - held(&e.carried, Good::Food);
    let units = need
        .min(held_in(store.stock.as_ref(), Good::Food))
        .min(units_that_fit(e, Good::Food, world.tick as f64))
        .floor();
    (units >= 1.0).then(|| {
        ResidentOrder::PickUp(PickUpOrder {
            from: GoodsSpot::Storage { storage_id: store.id.clone() },
            goods: Stock::from([(Good::Food, units)]),
        })
    })
}

/// A founding party's armed members fight for the rest on the way (`CONTEXT.md`: Escort), leaving
/// the Build default for it; `step_founders` sets them on again once the fight is over.
pub fn guard_party(world: &mut WorldState, members: &[usize], size: i32) {
    let armed: Vec<usize> =
        members.iter().copied().filter(|&i| is_armed(&world.residents[i])).collect();
    if armed.is_empty() {
        return;
    }
    let ids: Vec<String> = members.iter().map(|&i| world.residents[i].id.clone()).collect();
    let crew: HashSet<&str> = ids.iter().map(String::as_str).collect();
    // The party spreads out between the storage and the site: each guards those near them.
    for g in armed {
        let at = (world.residents[g].x, world.residents[g].y);
        guard(world, &crew, g, at, true, size);
    }
}

/// Invariant `npc-escorts-sound` (`CONTEXT.md`: Escort; ADR 0004): an escort is of the city that
/// sends it, guards one run only and is not its trader, nor in its founding party; a run a village
/// sent just now has none.
pub fn npc_escorts_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let tick = world.tick as f64;
    let mut push = |message: String, ids: Vec<String>| {
        out.push(InvariantViolation {
            invariant: "npc-escorts-sound".into(),
            message,
            entity_ids: ids,
        })
    };
    for (city_id, plan) in &world.city_plans {
        let runs = plan.traders.as_deref().unwrap_or(&[]);
        let traders: HashSet<&String> = runs.iter().map(|t| &t.resident_id).collect();
        let party: HashSet<String> =
            crate::npc_founding::founding_party(Some(plan)).into_iter().collect();
        let mut seen: HashSet<&String> = HashSet::new();
        let village = (city_residents(world, city_id).len() as f64) < NPC_ESCORT_TOWN_RESIDENTS;
        for t in runs {
            if village && t.since == tick && !t.escort_ids.is_empty() {
                push(
                    format!("{city_id}, a village, sent trader {} with an escort", t.resident_id),
                    vec![city_id.clone(), t.resident_id.clone()],
                );
            }
            for e in &t.escort_ids {
                if !seen.insert(e) || traders.contains(e) || party.contains(e) {
                    push(
                        format!("{city_id}'s escort {e} guards more than one run, or goes as more"),
                        vec![city_id.clone(), e.clone()],
                    );
                }
                let Some(r) = world.residents.iter().find(|r| &r.id == e) else { continue };
                if r.health > 0.0 && r.owner.is_none() && r.city_id.as_ref() != Some(city_id) {
                    push(
                        format!("{city_id}'s escort {e} is not of the city"),
                        vec![city_id.clone(), e.clone()],
                    );
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
