//! One tick of NPC city behaviour (`stepNpcCities` and `runCity` of `npc-behaviour.ts`).

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use csp_shared::balance::{
    set_out_food, GOOD_WEIGHT, HOME_FOOD_LOW, OWN_FOOD, WALK_TICKS_PER_TILE, WORK_OUTPUT_PER_DAY,
};
use csp_shared::footprint::is_at;
use csp_shared::goods::{PROTECTION, WEAPONS};
use csp_shared::terrain::{tile_index, wrap_distance, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, CityJob, CityJobKind, DropOrder, Good, GoodsSpot, PickUpOrder,
    ResidentOrder, Stock, Task, WorldState,
};
use serde_json::{json, Value};

use super::{default_script, haul, npc_home, put_to_work, stop_work, walk_to, workplace_of};
use crate::npc_chain::{chain_store_index, holds_batch, warehouse_for};
use crate::npc_founding::{found_daughter, founding_party, step_founders};
use crate::npc_growth::{
    city_grows, city_project, is_builder, no_farm, no_storage_yet, npc_builders,
    stop_builders_who_cant_go_on, take_part,
};
use crate::npc_patrols::{next_stop, share_patrols};
use crate::npc_plan::{food_short, plan_city, plan_due, project_done, run_residents, Places};
use crate::npc_posts::{free_soldiers, soldier_posts, stands_posts, SoldierPost};
use crate::npc_revive::{revive_target, run_reviver};
use crate::npc_roads::{lay_road, on_road_work, WayFinder};
use crate::npc_scouts::{give_up_site, send_scout, step_scouts};
use crate::npc_stable::{start_feeding, steer_feeder, Steer};
use crate::npc_trader::run_trader;
use crate::npc_training::{go_train, steer_training};
use crate::queries::building::{has_input, recipe_for, recipe_input};
use crate::queries::city::{city_residents, in_city_area};
use crate::queries::goods::units_that_fit;
use crate::queries::horses::{owns_horse, HorseOwner};
use crate::queries::names::{good_name, held, held_in, kind_name, placed};
use crate::queries::npc_trade::{npc_horses_wanted, NPC_SMITHY_WEAPON};
use crate::queries::residents::{can_work, carry_capacity, is_armed, stock_weight};
use crate::queries::warehouse::warehouse_keeps;
use crate::random::hash_str;
use crate::survival::refill_source;
use crate::walk_time::walk_time;
use crate::world_index::{building_by_id, building_index};

/// One tick of NPC city behaviour (`stepNpcCities`, `CONTEXT.md`: NPC city): each city run by the
/// game keeps itself alive. Plans of cities the game no longer runs are dropped. Returns the
/// milliseconds spent planning, for the tick health.
pub fn step_npc_cities(
    world: &mut WorldState,
    size: i32,
    terrain: Option<&TerrainMap>,
    mut ways: Option<&mut dyn WayFinder>,
) -> f64 {
    let runs: HashSet<String> =
        world.cities.iter().filter(|c| c.realm_id.is_none()).map(|c| c.id.clone()).collect();
    world.city_plans.retain(|id, _| runs.contains(id));
    let residents = run_residents(world);
    let mut plan_ms = 0.0;
    let ids: Vec<String> =
        world.cities.iter().filter(|c| c.realm_id.is_none()).map(|c| c.id.clone()).collect();
    for id in ids {
        if let Some(people) = residents.get(&id) {
            plan_ms += run_city(
                world,
                &id,
                people.clone(),
                size,
                terrain,
                crate::npc_roads::reborrow(&mut ways),
            );
        }
    }
    plan_ms
}

/// What a city's plan says of a resident's job.
fn job_of(world: &WorldState, city_id: &str, i: usize) -> Option<CityJob> {
    world.city_plans.get(city_id)?.jobs.get(&world.residents[i].id).cloned()
}

/// A resident's tile.
fn tile(world: &WorldState, i: usize) -> (i32, i32) {
    (world.residents[i].x as i32, world.residents[i].y as i32)
}

/// What an NPC city does each tick (`runCity`). Returns the milliseconds spent planning.
fn run_city(
    world: &mut WorldState,
    city_id: &str,
    mut people: Vec<usize>,
    size: i32,
    terrain: Option<&TerrainMap>,
    mut ways: Option<&mut dyn WayFinder>,
) -> f64 {
    let mut plan_ms = 0.0;
    if world.city_plans.contains_key(city_id) {
        step_scouts(world, city_id, &people, size);
    }
    if plan_due(world, city_id) {
        let start = Instant::now();
        plan_city(
            world,
            city_id,
            terrain,
            Some(people.clone()),
            crate::npc_roads::reborrow(&mut ways),
        );
        plan_ms += start.elapsed().as_secs_f64() * 1000.0;
    }
    let tick = world.tick as f64;
    let storage = world.buildings.iter().position(|b| {
        b.kind == BuildingKind::Storage && b.site.is_none() && b.city_id.as_deref() == Some(city_id)
    });
    // Its founding party moves to the daughter once the town hall stands, and goes by the founding
    // until then, apart from the rest.
    if world.city_plans.contains_key(city_id) && found_daughter(world, city_id).is_some() {
        people.retain(|&i| world.residents[i].city_id.as_deref() == Some(city_id));
    }
    let party: HashSet<String> =
        founding_party(world.city_plans.get(city_id)).into_iter().collect();
    if !party.is_empty() {
        let members: Vec<usize> =
            people.iter().copied().filter(|&i| party.contains(&world.residents[i].id)).collect();
        step_founders(world, city_id, &members, storage, size);
    }
    let Some(city) = world.cities.iter().find(|c| c.id == city_id).cloned() else { return plan_ms };
    // Materials and a smith's input: a Trade Org city's from its warehouse.
    let store = chain_store_index(world, &city);
    let adults: Vec<usize> = people
        .iter()
        .copied()
        .filter(|&i| {
            let r = &world.residents[i];
            can_work(r.born_at, tick) && r.down_until.is_none() && !party.contains(&r.id)
        })
        .collect();
    let planned_at = world.city_plans.get(city_id).map(|p| p.planned_at);
    let passed = planned_at == Some(tick);
    let houses: Vec<Building> = houses_to_stand_at(world, &city);

    stop_builders_who_cant_go_on(world, &adults, store);
    for &i in &adults {
        // On alarm, they get back to all this when their Alarm script hands back.
        if world.residents[i].script.as_ref().is_some_and(|s| s.task == Some(Task::Alarm)) {
            continue;
        }
        send_to_warehouse(world, &city, i);
        let busy = matches!(
            world.residents[i].order,
            Some(ResidentOrder::WorkAt(_))
                | Some(ResidentOrder::Build(_))
                | Some(ResidentOrder::TearDown(_))
        );
        if busy
            && held(&world.residents[i].carried, Good::Food) < HOME_FOOD_LOW
            && refill_source(world, &world.residents[i], size).is_none()
        {
            stop_work(&mut world.residents[i]);
        }
        // Home at the storage with the load stored, a carrier is free; one bringing the crew's Food
        // back goes back by the Work default.
        let r = &world.residents[i];
        let carry = r
            .script
            .as_ref()
            .filter(|s| s.script_id == 0)
            .and_then(|s| s.memory.get("carry"))
            .and_then(Value::as_object);
        if let Some(carry) = carry {
            let crew_food = carry.get("crewFood").and_then(Value::as_f64).is_some_and(|n| n >= 1.0);
            let stored = carry.get("stored") == Some(&Value::Bool(true));
            let storing = matches!(r.order, Some(ResidentOrder::Store(_)));
            let at_storage =
                storage.is_some_and(|s| is_at(tile(world, i), placed(&world.buildings[s]), size));
            if stored && !crew_food && !storing && at_storage {
                stop_work(&mut world.residents[i]);
            }
        }
        // Stuck in the Build default, a builder is free.
        let r = &world.residents[i];
        let built = r
            .script
            .as_ref()
            .filter(|s| s.script_id == 0 && s.task == Some(Task::Build))
            .map(|s| s.memory.clone());
        if let Some(memory) = &built {
            if memory.get("stuck") == Some(&Value::Bool(true)) {
                stop_work(&mut world.residents[i]);
            }
        }
        // No way to a site on a far node: the city gives its sector up.
        if let Some(memory) = &built {
            if !on_road_work(&world.residents[i]) {
                if let Some(at) = no_way_out(&world.residents[i], memory) {
                    if give_up_site(world, city_id, at, size) {
                        stop_work(&mut world.residents[i]);
                    }
                }
            }
        }
        // Done breeding, a breeder is free too.
        let bred = world.residents[i]
            .script
            .as_ref()
            .filter(|s| s.script_id == 0 && s.task == Some(Task::Breed))
            .map(|s| s.memory.get("done") == Some(&Value::Bool(true)));
        if bred == Some(true) {
            stop_work(&mut world.residents[i]);
        }
        let job = job_of(world, city_id, i);
        // The pass just now gave them something to do: they don't finish the walk to their house.
        if passed
            && job.as_ref().is_some_and(|j| j.kind != CityJobKind::Idle)
            && walking_to_house(&world.residents[i], &houses, size)
        {
            world.residents[i].order = None;
        }
        let at = workplace_of(&world.residents[i]);
        let moved = job.as_ref().is_some_and(|j| j.kind != CityJobKind::Soldier)
            && at.is_some()
            && at != job.as_ref().and_then(|j| j.building_id.clone());
        if moved && world.residents[i].carrying.is_none() && passed {
            stop_work(&mut world.residents[i]);
        }
        // At the training ground, or now to be: the pass just now may have moved them.
        if passed {
            steer_training(world, &city, i, job.as_ref());
        }
        // Off the road crew, they leave the road to it.
        if on_road_work(&world.residents[i])
            && job.as_ref().is_none_or(|j| j.kind != CityJobKind::Road)
            && passed
        {
            stop_work(&mut world.residents[i]);
        }
        // The pass just now called a scout off: they come home with what they saw, below.
        let exploring =
            world.residents[i].script.as_ref().is_some_and(|s| s.task == Some(Task::Explore));
        if exploring && passed && job.as_ref().is_none_or(|j| j.kind != CityJobKind::Scout) {
            stop_work(&mut world.residents[i]);
        }
        if job.as_ref().is_some_and(|j| j.kind == CityJobKind::Revive) {
            let r = &world.residents[i];
            let at_work = r.script.is_some()
                || matches!(
                    r.order,
                    Some(ResidentOrder::Build(_)) | Some(ResidentOrder::TearDown(_))
                );
            if at_work && passed {
                stop_work(&mut world.residents[i]);
            }
            if matches!(world.residents[i].order, Some(ResidentOrder::WalkTo(_)))
                && revive_target(world, job.as_ref()).is_none()
            {
                world.residents[i].order = None;
            }
        }
        // Done feeding the stable, a feeder is free too.
        if steer_feeder(world, &city, i, job.as_ref(), passed) == Some(Steer::Stop) {
            stop_work(&mut world.residents[i]);
        }
        // At a workplace that processes goods with nothing left to process, with none in the store,
        // they get their next job.
        let at = workplace_of(&world.residents[i]);
        let working = matches!(world.residents[i].order, Some(ResidentOrder::WorkAt(_)));
        if let Some(place) = at.filter(|_| working).and_then(|id| building_index(world, &id)) {
            let pb = &world.buildings[place];
            if processes(pb.kind)
                && !input_left(world, pb, i)
                && !input_in(pb, store.map(|s| &world.buildings[s]))
            {
                stop_work(&mut world.residents[i]);
            }
        }
        work_by_default(world, i);
    }

    let home = npc_home(world, city_id).cloned();
    let mut places = Places::new(world, &people);
    let has_posts = stands_posts(world, &city);
    let mut posts: Option<HashMap<String, SoldierPost>> = None;
    if passed && world.city_plans.contains_key(city_id) {
        share_patrols(world, &city, &adults, size, terrain);
    }
    let jobs = world.city_plans.get(city_id).map(|p| p.jobs.clone()).unwrap_or_default();
    let kind_of = |id: &String| jobs.get(id).map(|j| j.kind);
    // The road crew is apart from its builders.
    let crew: Vec<usize> = adults
        .iter()
        .copied()
        .filter(|&i| kind_of(&world.residents[i].id) == Some(CityJobKind::Road))
        .collect();
    let building = adults
        .iter()
        .filter(|&&i| {
            is_builder(&world.residents[i])
                && kind_of(&world.residents[i].id) != Some(CityJobKind::Road)
        })
        .count();
    let mut free = npc_builders(world, &city) - building as f64;
    // The project, picked anew once the planned one is finished: a site search, so once a tick.
    let mut checked = false;
    let mut project =
        |world: &mut WorldState, plan_ms: &mut f64| -> Option<csp_shared::world::CityProject> {
            let (Some(terrain), Some(home)) = (terrain, home.as_ref()) else { return None };
            let current = world.city_plans.get(city_id)?.project.clone();
            if !checked && current.as_ref().is_some_and(|p| project_done(world, p)) {
                let start = Instant::now();
                let grows = city_grows(world, &city, &adults);
                let next = if !food_short(world, &city) || no_farm(world, &city) {
                    city_project(world, &city, home, terrain, grows)
                } else {
                    None
                };
                world.city_plans.get_mut(city_id).expect("a plan").project = next;
                *plan_ms += start.elapsed().as_secs_f64() * 1000.0;
            }
            checked = true;
            world.city_plans.get(city_id)?.project.clone()
        };

    for &i in &adults {
        let rid = world.residents[i].id.clone();
        let job = jobs.get(&rid).cloned();
        let armed = is_armed(&world.residents[i].carried);
        // The pass just now gave a soldier another post: a walk to their old one ends here.
        if passed && has_posts && armed {
            let post = post_of(world, &city, &adults, size, terrain, &mut posts, &rid);
            if walking_off_post(&world.residents[i], post.as_ref(), size) {
                world.residents[i].order = None;
            }
        }
        if world.residents[i].order.is_some() || world.residents[i].script.is_some() {
            continue;
        }
        // A scout called off comes home with what they saw before anything else, but for one of the
        // city's Down, who can't wait.
        let scouting = world
            .city_plans
            .get(city_id)
            .and_then(|p| p.scouts.as_ref())
            .is_some_and(|s| s.contains_key(&rid));
        if scouting
            && !matches!(
                job.as_ref().map(|j| j.kind),
                Some(CityJobKind::Scout) | Some(CityJobKind::Revive)
            )
        {
            if let Some(h) = &home {
                let (x, y) = tile(world, i);
                if !in_city_area(world, city_id, x, y, size) {
                    walk_to(&mut world.residents[i], (h.x, h.y));
                    continue;
                }
            }
        }
        let trading = city.trade_org.is_none()
            && world
                .city_plans
                .get(city_id)
                .and_then(|p| p.traders.as_ref())
                .is_some_and(|t| t.iter().any(|t| t.resident_id == rid));
        if trading {
            run_trader(world, &city, i, storage, size);
            continue;
        }
        // Carrying a child, they get no work and stand at a house; a load goes into the storage first.
        if world.residents[i].carrying.is_some() {
            match stowing(world, &city, i, storage, None) {
                Some((to, load)) => put_away(world, i, to, load, size),
                None => stand_idle(world, &city, i, &houses, home.as_ref(), size, passed),
            }
            continue;
        }
        if run_reviver(world, i, job.as_ref(), storage, size) {
            continue;
        }
        if job.as_ref().is_some_and(|j| j.kind == CityJobKind::Road)
            && world.city_plans.contains_key(city_id)
            && lay_road(world, &city, i, &crew, store, size)
        {
            continue;
        }
        if free > 0.0
            && (!armed || no_storage_yet(world, &city))
            && carries_materials(&world.residents[i], &city)
        {
            if let Some(p) = project(world, &mut plan_ms) {
                if take_part(world, i, &p, store, true) {
                    free -= 1.0;
                    continue;
                }
            }
        }
        let input = input_of(world, job.as_ref());
        let stow = stowing(world, &city, i, storage, input.as_ref());
        // A soldier keeps spare Food on them and eats it where they stand.
        if let Some((to, load)) = stow {
            if !(has_posts && armed && only_food(&load)) {
                put_away(world, i, to, load, size);
                continue;
            }
        }
        let soldier = armed || job.as_ref().is_some_and(|j| j.kind == CityJobKind::Soldier);
        let stands_at_house = !soldier
            && job.as_ref().is_none_or(|j| j.kind == CityJobKind::Idle)
            && !houses.is_empty();
        let on_post = has_posts && armed;
        let food = storage.map_or(0.0, |s| held_in(world.buildings[s].stock.as_ref(), Good::Food));
        if let Some(s) = storage {
            if food > 0.0
                && held(&world.residents[i].carried, Good::Food) < OWN_FOOD
                && !stands_at_house
                && !on_post
            {
                let sb = &world.buildings[s];
                if is_at(tile(world, i), placed(sb), size) {
                    let units = food.min(OWN_FOOD - held(&world.residents[i].carried, Good::Food));
                    let from = GoodsSpot::Storage { storage_id: sb.id.clone() };
                    world.residents[i].order = Some(ResidentOrder::PickUp(PickUpOrder {
                        from,
                        goods: Stock::from([(Good::Food, units)]),
                    }));
                } else {
                    let to = (sb.x, sb.y);
                    walk_to(&mut world.residents[i], to);
                }
                continue;
            }
        }
        if !soldier {
            if let Some(j) = job.as_ref().filter(|j| j.kind == CityJobKind::Feed) {
                if start_feeding(world, &city, i, j) {
                    continue;
                }
            }
            if breed_horses(world, &city, i) {
                continue;
            }
            let done = city.scouted.as_ref().is_some_and(|s| s.done == Some(true));
            if job.as_ref().is_some_and(|j| j.kind == CityJobKind::Scout)
                && !done
                && world.city_plans.contains_key(city_id)
            {
                send_scout(world, city_id, i);
                continue;
            }
            if job.as_ref().is_some_and(|j| j.kind == CityJobKind::Build) && free > 0.0 {
                if let Some(p) = project(world, &mut plan_ms) {
                    if take_part(world, i, &p, store, false) {
                        free -= 1.0;
                        continue;
                    }
                }
            }
            if let Some(bid) = job.as_ref().and_then(|j| j.building_id.clone()) {
                if let Some(place) = building_index(world, &bid) {
                    if world.buildings[place].site.is_none()
                        && places.room(&world.buildings[place]) > 0.0
                    {
                        if let Some(input) = &input {
                            if !take_input(world, i, input, store, size) {
                                if let Some(h) = &home {
                                    let (x, y) = tile(world, i);
                                    if !in_city_area(world, city_id, x, y, size) {
                                        walk_to(&mut world.residents[i], (h.x, h.y));
                                    }
                                }
                                continue;
                            }
                        }
                        if world.residents[i].order.is_some() {
                            continue;
                        }
                        if storage
                            .is_none_or(|s| take_set_out_food(world, i, place, s, size, terrain))
                        {
                            let pb = world.buildings[place].clone();
                            put_to_work(&mut world.residents[i], &pb);
                            places.take(&pb);
                        }
                        continue;
                    }
                }
            }
        }
        if go_train(world, &city, i, job.as_ref(), passed, size) {
            continue;
        }
        let stop = if on_post {
            world.city_plans.get_mut(city_id).and_then(|p| next_stop(p, &rid))
        } else {
            None
        };
        if let Some(stop) = stop {
            walk_to(&mut world.residents[i], stop);
        } else if on_post {
            let post = post_of(world, &city, &adults, size, terrain, &mut posts, &rid);
            stand_post(world, &city, i, post.as_ref(), home.as_ref(), size, passed);
        } else if soldier {
            come_home(world, &city, i, home.as_ref(), size);
        } else {
            stand_idle(world, &city, i, &houses, home.as_ref(), size, passed);
        }
    }
    // A city with no house leaves its children be, as they refill anywhere in its area.
    if !houses.is_empty() {
        for &i in &people {
            let r = &world.residents[i];
            if !can_work(r.born_at, tick)
                && r.down_until.is_none()
                && r.order.is_none()
                && r.script.is_none()
            {
                stand_idle(world, &city, i, &houses, home.as_ref(), size, passed);
            }
        }
    }
    plan_ms
}

/// A soldier's post, worked out at most once a tick and only when one is to be sent (`postOf`).
fn post_of(
    world: &WorldState,
    city: &City,
    adults: &[usize],
    size: i32,
    terrain: Option<&TerrainMap>,
    posts: &mut Option<HashMap<String, SoldierPost>>,
    id: &str,
) -> Option<SoldierPost> {
    let posts = posts.get_or_insert_with(|| {
        soldier_posts(world, city, &free_soldiers(world, city, adults), size, terrain)
    });
    posts.get(id).cloned()
}

/// The finished houses an NPC city's idle stand at (`housesToStandAt`); a Trade Org city's don't.
fn houses_to_stand_at(world: &WorldState, city: &City) -> Vec<Building> {
    if city.trade_org.is_some() {
        return Vec::new();
    }
    world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::House
                && b.site.is_none()
                && b.city_id.as_ref() == Some(&city.id)
        })
        .cloned()
        .collect()
}

/// Sends a resident outside their city's area home (`comeHome`).
fn come_home(world: &mut WorldState, city: &City, i: usize, home: Option<&Building>, size: i32) {
    let (x, y) = tile(world, i);
    if let Some(h) = home {
        if !in_city_area(world, &city.id, x, y, size) {
            walk_to(&mut world.residents[i], (h.x, h.y));
        }
    }
}

/// A resident with nothing to do goes to stand at a house (`standIdle`), the one their id hashes
/// to; one at any of the city's houses stays. In the city's area they set off only when its pass
/// just ran.
fn stand_idle(
    world: &mut WorldState,
    city: &City,
    i: usize,
    houses: &[Building],
    home: Option<&Building>,
    size: i32,
    passed: bool,
) {
    if houses.is_empty() {
        return come_home(world, city, i, home, size);
    }
    let (x, y) = tile(world, i);
    if !passed && in_city_area(world, &city.id, x, y, size) {
        return;
    }
    if !houses.iter().any(|h| is_at((x, y), placed(h), size)) {
        let h = &houses[hash_str(&world.residents[i].id) as usize % houses.len()];
        walk_to(&mut world.residents[i], (h.x, h.y));
    }
}

/// A soldier with nothing to do goes to their post (`standPost`), and one on it stays.
fn stand_post(
    world: &mut WorldState,
    city: &City,
    i: usize,
    post: Option<&SoldierPost>,
    home: Option<&Building>,
    size: i32,
    passed: bool,
) {
    let (x, y) = tile(world, i);
    if !passed && in_city_area(world, &city.id, x, y, size) {
        return;
    }
    let Some(post) = post else { return come_home(world, city, i, home, size) };
    if !post.tiles.contains(&tile_index(size, x, y)) {
        walk_to(&mut world.residents[i], (f64::from(post.at.0), f64::from(post.at.1)));
    }
}

/// Whether a soldier is on a walk that doesn't end on their post, with no load to put away first
/// (`walkingOffPost`).
fn walking_off_post(
    r: &csp_shared::world::Resident,
    post: Option<&SoldierPost>,
    size: i32,
) -> bool {
    let (Some(ResidentOrder::WalkTo(o)), None, Some(post)) = (&r.order, &r.script, post) else {
        return false;
    };
    let load = haul(r, None);
    !post.tiles.contains(&tile_index(size, o.target.x as i32, o.target.y as i32))
        && load.as_ref().is_none_or(only_food)
}

/// Whether a load is Food and nothing else (`onlyFood`).
fn only_food(load: &Stock) -> bool {
    load.keys().all(|g| *g == Good::Food)
}

/// Whether a resident is on a walk that ends at one of these houses (`walkingToHouse`).
fn walking_to_house(r: &csp_shared::world::Resident, houses: &[Building], size: i32) -> bool {
    let Some(ResidentOrder::WalkTo(o)) = &r.order else { return false };
    houses.iter().any(|h| is_at((o.target.x as i32, o.target.y as i32), placed(h), size))
}

/// Where a builder's walk out to their site ended short of it (`noWayOut`): the site, if so.
fn no_way_out(
    r: &csp_shared::world::Resident,
    memory: &serde_json::Map<String, Value>,
) -> Option<(i32, i32)> {
    let present = |k: &str| memory.get(k).is_some_and(|v| !v.is_null());
    if r.order.is_some() || present("fetch") || present("food") {
        return None;
    }
    let at = memory.get("at")?.as_object()?;
    let (x, y) = (at.get("x")?.as_f64()?, at.get("y")?.as_f64()?);
    (r.x != x || r.y != y).then_some((x as i32, y as i32))
}

/// Takes a load to a storage or warehouse (`putAway`): at it, the drop; away from it, the walk
/// there first.
fn put_away(world: &mut WorldState, i: usize, to: usize, load: Stock, size: i32) {
    let b = &world.buildings[to];
    if is_at(tile(world, i), placed(b), size) {
        let to = GoodsSpot::Storage { storage_id: b.id.clone() };
        world.residents[i].order = Some(ResidentOrder::Drop(DropOrder { to, goods: load }));
    } else {
        let at = (b.x, b.y);
        walk_to(&mut world.residents[i], at);
    }
}

/// A worker on a bare work-at order goes on by the Work default (`workByDefault`).
fn work_by_default(world: &mut WorldState, i: usize) {
    let r = &world.residents[i];
    let Some(ResidentOrder::WorkAt(o)) = &r.order else { return };
    if r.script.is_some() {
        return;
    }
    let mut memory = json!({ "workplaceId": o.building_id });
    let smithy = world
        .buildings
        .iter()
        .find(|b| b.id == o.building_id)
        .is_some_and(|b| b.kind == BuildingKind::Smithy);
    let makes = o.makes.or(smithy.then_some(NPC_SMITHY_WEAPON));
    if let Some(makes) = makes {
        memory["makes"] = json!(good_name(makes));
    }
    world.residents[i].script = Some(default_script(Task::Work, memory));
}

/// Whether a resident carries goods a site could take (`carriesMaterials`).
fn carries_materials(r: &csp_shared::world::Resident, city: &City) -> bool {
    r.carried.iter().any(|(good, units)| {
        *good != Good::Food
            && *units > 0.0
            && (WORK_OUTPUT_PER_DAY.get(good_name(*good)).is_some()
                || (city.trade_org.is_some() && back_to_warehouse(*good)))
    })
}

/// Two fed horses of the city in a stable a resident there can breed (`breedingPair`).
fn breeding_pair(world: &WorldState, stable: &Building, city_id: &str) -> Option<[String; 2]> {
    let [a, b] =
        crate::queries::breeding::breeding_pair(world, stable, HorseOwner::City(city_id), None)?;
    Some([a.id.clone(), b.id.clone()])
}

/// Has one of the city's residents breed its horses (`breedHorses`). Whether they were given it.
fn breed_horses(world: &mut WorldState, city: &City, i: usize) -> bool {
    if city.trade_org.is_some() || food_short(world, city) {
        return false;
    }
    let horses = world.horses.iter().filter(|h| owns_horse(HorseOwner::City(&city.id), h)).count();
    let foals = city_residents(world, &city.id)
        .iter()
        .filter(|x| x.script.as_ref().is_some_and(|s| s.task == Some(Task::Breed)))
        .count();
    if (horses + foals) as f64 >= npc_horses_wanted(world, city) {
        return false;
    }
    for stable in &world.buildings {
        if stable.kind != BuildingKind::Stable
            || stable.site.is_some()
            || stable.city_id.as_ref() != Some(&city.id)
        {
            continue;
        }
        let tending = world.residents.iter().any(|x| {
            x.script.as_ref().is_some_and(|s| {
                s.task == Some(Task::Breed)
                    && s.memory.get("stableId").and_then(Value::as_str) == Some(stable.id.as_str())
            })
        });
        let breeding = world
            .residents
            .iter()
            .any(|x| matches!(&x.order, Some(ResidentOrder::Breed(o)) if o.stable_id == stable.id));
        if tending || breeding {
            continue;
        }
        let Some(pair) = breeding_pair(world, stable, &city.id) else { continue };
        let memory = json!({ "stableId": stable.id, "horseIds": pair });
        world.residents[i].script = Some(default_script(Task::Breed, memory));
        return true;
    }
    false
}

/// Before a resident sets out for a workplace, they take the Food for the walk there and back and
/// their first days of work from the storage (`takeSetOutFood`). Whether they set out now.
fn take_set_out_food(
    world: &mut WorldState,
    i: usize,
    place: usize,
    storage: usize,
    size: i32,
    terrain: Option<&TerrainMap>,
) -> bool {
    let food = held_in(world.buildings[storage].stock.as_ref(), Good::Food);
    if food <= 0.0 {
        return true;
    }
    let r = &world.residents[i];
    let pb = &world.buildings[place];
    let at = tile(world, i);
    let walk = match terrain {
        Some(t) => walk_time(world, t, &|_, _| true, r, at, (pb.x as i32, pb.y as i32)),
        None => wrap_distance(size, at, (pb.x as i32, pb.y as i32)) * WALK_TICKS_PER_TILE,
    };
    let short = set_out_food(walk) - held(&r.carried, Good::Food);
    if short <= 1e-9 {
        return true;
    }
    let sb = &world.buildings[storage];
    if !is_at(at, placed(sb), size) {
        let to = (sb.x, sb.y);
        walk_to(&mut world.residents[i], to);
        return false;
    }
    let units = food.min(short).min(units_that_fit(r, Good::Food, world.tick as f64));
    if units <= 0.0 {
        return true;
    }
    let from = GoodsSpot::Storage { storage_id: sb.id.clone() };
    world.residents[i].order = Some(ResidentOrder::PickUp(PickUpOrder {
        from,
        goods: Stock::from([(Good::Food, units)]),
    }));
    true
}

/// A Trade Org city's carrier takes the load to the warehouse that keeps it (`sendToWarehouse`).
fn send_to_warehouse(world: &mut WorldState, city: &City, i: usize) {
    if city.trade_org.is_none() {
        return;
    }
    let Some(script) = world.residents[i].script.as_ref().filter(|s| s.script_id == 0) else {
        return;
    };
    let Some(carry) = script.memory.get("carry").and_then(Value::as_object) else { return };
    if carry.get("stored") == Some(&Value::Bool(true)) {
        return;
    }
    let Some(goods) = carry.get("goods").and_then(Value::as_array) else { return };
    let goods: Vec<Good> =
        goods.iter().filter_map(|g| serde_json::from_value(g.clone()).ok()).collect();
    let Some(w) = warehouse_for(world, city, &goods).map(|w| w.id.clone()) else { return };
    if let Some(carry) = world.residents[i]
        .script
        .as_mut()
        .and_then(|s| s.memory.get_mut("carry"))
        .and_then(Value::as_object_mut)
    {
        carry.insert("storageId".into(), json!(w));
    }
}

/// What one batch uses up at the workplace that processes goods a job is at (`inputOf`).
fn input_of(world: &WorldState, job: Option<&CityJob>) -> Option<Stock> {
    let id = job?.building_id.as_ref()?;
    let place = building_by_id(world, id)?;
    if !processes(place.kind) {
        return None;
    }
    let makes = (place.kind == BuildingKind::Smithy).then(|| good_name(NPC_SMITHY_WEAPON));
    recipe_for(place.kind, makes).map(|r| recipe_input(r).into_iter().collect())
}

/// Whether a worker at a workplace that processes goods can go on (`inputLeft`).
fn input_left(world: &WorldState, place: &Building, i: usize) -> bool {
    let makes = (place.kind == BuildingKind::Smithy).then(|| good_name(NPC_SMITHY_WEAPON));
    let Some(recipe) = recipe_for(place.kind, makes) else { return true };
    if has_input(world, place, recipe) {
        return true;
    }
    recipe_input(recipe).iter().any(|(g, _)| held(&world.residents[i].carried, *g) > 0.0)
}

/// Whether a store holds a batch of what a workplace that processes goods uses up (`inputIn`).
fn input_in(place: &Building, store: Option<&Building>) -> bool {
    let makes = (place.kind == BuildingKind::Smithy).then(|| good_name(NPC_SMITHY_WEAPON));
    recipe_for(place.kind, makes).is_some_and(|r| {
        holds_batch(store.and_then(|s| s.stock.as_ref()), &recipe_input(r).into_iter().collect())
    })
}

/// Before a resident sets out for a workplace that processes goods, they take its `input` from the
/// storage (`takeInput`). Whether they carry a batch, or have just been given the pick-up.
fn take_input(
    world: &mut WorldState,
    i: usize,
    input: &Stock,
    storage: Option<usize>,
    size: i32,
) -> bool {
    let r = &world.residents[i];
    if holds_batch(Some(&r.carried), input) {
        return true;
    }
    let Some(s) = storage else { return false };
    let sb = &world.buildings[s];
    if !holds_batch(sb.stock.as_ref(), input) {
        return false;
    }
    if !is_at(tile(world, i), placed(sb), size) {
        let to = (sb.x, sb.y);
        walk_to(&mut world.residents[i], to);
        return true;
    }
    let batch = stock_weight(input);
    let food_weight = GOOD_WEIGHT.get("food").expect("a weight");
    let room =
        carry_capacity(r, world.tick as f64) - stock_weight(&r.carried) - OWN_FOOD * food_weight;
    let mut batches = (room / batch).floor();
    for (g, n) in input {
        batches = batches.min((held_in(sb.stock.as_ref(), *g) / n).floor());
    }
    if batches < 1.0 {
        return false;
    }
    let goods: Stock = input.iter().map(|(g, n)| (*g, n * batches)).collect();
    let from = GoodsSpot::Storage { storage_id: sb.id.clone() };
    world.residents[i].order = Some(ResidentOrder::PickUp(PickUpOrder { from, goods }));
    true
}

/// Whether a workplace processes goods (`RECIPES[kind]`).
fn processes(kind: BuildingKind) -> bool {
    csp_shared::balance::RECIPES.get(kind_name(kind)).is_some()
}

/// Whether a Trade Org city's warehouse takes a good back from an idle resident
/// (`backToWarehouse`): all but Food and the weapons and armour that stay on them.
fn back_to_warehouse(good: Good) -> bool {
    good != Good::Food
        && !WEAPONS.contains(&good_name(good))
        && !PROTECTION.contains(&good_name(good))
}

/// What an idle resident has to put away and where it goes, if anything (`stowing`): where in
/// `world.buildings` it goes, and the load.
fn stowing(
    world: &WorldState,
    city: &City,
    i: usize,
    storage: Option<usize>,
    input: Option<&Stock>,
) -> Option<(usize, Stock)> {
    let r = &world.residents[i];
    if city.trade_org.is_some() {
        let goods: Vec<Good> = r
            .carried
            .iter()
            .filter(|(g, n)| {
                **n > 0.0 && back_to_warehouse(**g) && input.is_none_or(|i| !i.contains_key(*g))
            })
            .map(|(g, _)| *g)
            .collect();
        if let Some(to) = warehouse_for(world, city, &goods) {
            let keeps = warehouse_keeps(world, to);
            let load: Stock = goods
                .iter()
                .filter(|g| keeps.contains(g))
                .map(|g| (*g, held(&r.carried, *g)))
                .collect();
            let to = building_index(world, &to.id).expect("a warehouse");
            return Some((to, load));
        }
    }
    let s = storage?;
    haul(r, input).map(|load| (s, load))
}
