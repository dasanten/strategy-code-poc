//! An NPC city founds a daughter (`apps/server/src/npc-founding.ts`, `CONTEXT.md`: Full city,
//! Founding): once full, it sends a party with the materials of a town hall and a storage to a site
//! out of a realm's territory, and the party's town hall becomes a city of its own.

use std::collections::HashSet;
use std::f64::consts::PI;

use csp_shared::balance::{
    FOOD_PER_DAY, GOOD_WEIGHT, HOUSING_ROOM, MAP_SIZE, NPC_CITY_MIN_DISTANCE, NPC_FOUND_FOOD_DAYS,
    NPC_FOUND_FOOD_SURPLUS_SHARE, NPC_FOUND_GIVE_UP_DAYS, NPC_FOUND_REACH, NPC_FOUND_SAMPLES,
    NPC_FOUND_STANDING, NPC_FULL_DIP_DAYS, NPC_NODE_REACH, NPC_PLAN_TICKS, NPC_SURPLUS_CAP,
    NPC_VILLAGE, WALK_TICKS_PER_TILE,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::{wrap, wrap_distance, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, City, CityJob, CityJobKind, CityPlan, DropOrder, Good, GoodsSpot,
    PickUpOrder, ResidentOrder, Stock, Task, Tile, WalkOrder, WorldState,
};
use serde_json::json;

use crate::land_sites::{near_a_starting_site, starting_site_middles, FootReach};
use crate::npc_behaviour::{default_script, stop_work, Jobs};
use crate::npc_chain::{short_goods, Shortage};
use crate::npc_cities::{hall_tile, npc_site_fits_among, taken_ground, SiteWorld, FARM_RING};
use crate::npc_escort::{founding_escorts_wanted, spare_soldiers};
use crate::npc_scouts::knows_node;
use crate::placing::Ground;
use crate::queries::building::{build_materials, building_at, node_good};
use crate::queries::city::{city_residents, has_food_surplus};
use crate::queries::goods::carried_food;
use crate::queries::js_round;
use crate::queries::names::{held, held_in, kind_name, placed};
use crate::queries::npc_trade::{
    npc_city_stock, npc_founding_party_size, npc_full_days, npc_needs_scale, npc_reserve,
};
use crate::queries::residents::{carry_capacity, good_weight, is_armed, stock_weight};
use crate::random::{hash_str, Mulberry32};
use crate::sight::InvariantViolation;
use crate::standing::raise_standing_both_ways;

/// The ids of a city's founding party (`foundingParty`): those whose job is `found`.
pub fn founding_party(plan: Option<&CityPlan>) -> Vec<String> {
    let Some(plan) = plan else { return Vec::new() };
    plan.jobs
        .iter()
        .filter(|(_, j)| j.kind == CityJobKind::Found)
        .map(|(id, _)| id.clone())
        .collect()
}

/// A job of the given kind and nothing else.
fn job(kind: CityJobKind) -> CityJob {
    CityJob {
        kind,
        building_id: None,
        target_id: None,
        stable_id: None,
        ground_id: None,
        subject: None,
    }
}

/// What a founding party of `members` takes along (`foundingMaterials`): a town hall's and a
/// storage's materials, and a house for each `HOUSING_ROOM` past a village's residents.
pub fn founding_materials(members: Option<f64>) -> Stock {
    let members = members.unwrap_or(NPC_VILLAGE.residents);
    let mut out = Stock::new();
    let mut add = |goods: Stock, times: f64| {
        for (good, n) in goods {
            *out.entry(good).or_insert(0.0) += n * times;
        }
    };
    add(build_materials(BuildingKind::TownHall), 1.0);
    add(build_materials(BuildingKind::Storage), 1.0);
    let past = (members - NPC_VILLAGE.residents).max(0.0);
    add(
        build_materials(BuildingKind::House),
        (past / HOUSING_ROOM.get("house").unwrap_or(1.0)).ceil(),
    );
    out
}

/// The goods whose shortage keeps an NPC city from being full (`CONTEXT.md`: Full city): what
/// founding needs, Food and the Wood and Stone of houses, walls and the party. Its war chest and its
/// soldiers' gear and their chain don't (Daniel, 2026-11-18, #1379: they kept every city short all
/// year); it still works and buys them.
pub const FULL_CITY_GOODS: [Good; 3] = [Good::Food, Good::Wood, Good::Stone];

/// What keeps an NPC city from being full (`CONTEXT.md`: Full city): of what it is short of
/// (`short_goods`), the goods founding needs (`FULL_CITY_GOODS`).
pub fn short_for_founding(
    world: &WorldState,
    city: &City,
    _home: Option<&Building>,
    size: i32,
) -> Vec<Good> {
    short_goods(world, city, size, None)
        .into_iter()
        .filter(|g| FULL_CITY_GOODS.contains(g))
        .collect()
}

/// What an NPC city lacks of its founding party's materials above its reserve, the shortest first
/// (`CONTEXT.md`: Full city, T100.8). Only once nothing else keeps it from being full
/// (`short_for_founding`) and no party of its is out: then they count as short, so its spare hands
/// gather them (`share_out`) and it builds the workplace for one it can't get (`wanted`). Food,
/// Coins and weapons come first, as they keep it from being full; Food its surplus too: only once
/// it holds `NPC_FOUND_FOOD_SURPLUS_SHARE` of its Food surplus cap past its reserve. Each as a
/// share of its reserve and the materials together, like any shortage (`reserve_lacks`).
pub fn founding_lacks(
    world: &WorldState,
    city: &City,
    home: Option<&Building>,
    size: i32,
) -> Vec<Shortage> {
    if city.trade_org.is_some()
        || home.is_none()
        || !founding_party(world.city_plans.get(&city.id)).is_empty()
        || !short_for_founding(world, city, home, size).is_empty()
    {
        return Vec::new();
    }
    let materials = founding_materials(Some(npc_founding_party_size(
        city_residents(world, &city.id).len() as f64,
    )));
    // Once its hands gather them, they go on until Food runs short, not each time it dips under
    // the share of its surplus.
    if !holds_food_first(world, city) && !gathering(world, city, &materials) {
        return Vec::new();
    }
    let reserve = npc_reserve(world, city);
    let stock = npc_city_stock(world, city);
    let mut out: Vec<Shortage> = materials
        .iter()
        .map(|(good, n)| {
            let want = held(&reserve, *good) + n;
            Shortage { good: *good, share: (want - held(&stock, *good)) / want }
        })
        .filter(|s| s.share > 1e-9)
        .collect();
    out.sort_by(|a, b| b.share.total_cmp(&a.share));
    out
}

/// Whether a city holds the Food surplus that comes before its founding party's materials
/// (`CONTEXT.md`: Full city): `NPC_FOUND_FOOD_SURPLUS_SHARE` of its Food surplus cap past its
/// reserve.
pub fn holds_food_first(world: &WorldState, city: &City) -> bool {
    let cap = NPC_SURPLUS_CAP.get("food").unwrap_or(0.0) * npc_needs_scale(world, city);
    let past = held(&npc_city_stock(world, city), Good::Food)
        - held(&npc_reserve(world, city), Good::Food);
    past >= NPC_FOUND_FOOD_SURPLUS_SHARE * cap
}

/// Whether an NPC city is saving for its founding party (`CONTEXT.md`: Full city): its full wait
/// runs and no party of its is out. Never a Trade Org city.
pub fn saving_to_found(world: &WorldState, city: &City) -> bool {
    city.trade_org.is_none()
        && world
            .city_plans
            .get(&city.id)
            .is_some_and(|p| p.full_since.is_some() && founding_party(Some(p)).is_empty())
}

/// What an NPC city's walls and repairs leave in its storages (`CONTEXT.md`: Full city): its
/// reserve and, while it saves for its founding party (`saving_to_found`), the party's Stone on
/// top (Daniel, 2026-11-18, #1379: walls and repairs kept spending it, so no city held it).
pub fn kept_from_walls(world: &WorldState, city: &City) -> Stock {
    let mut kept = npc_reserve(world, city);
    if saving_to_found(world, city) {
        let party = founding_materials(Some(npc_founding_party_size(
            city_residents(world, &city.id).len() as f64,
        )));
        *kept.entry(Good::Stone).or_insert(0.0) += held(&party, Good::Stone);
    }
    kept
}

/// Whether the city's storages hold `goods` above what its walls and repairs leave there
/// (`kept_from_walls`).
pub fn holds_for_walls(world: &WorldState, city: &City, goods: &Stock) -> bool {
    let stock = npc_city_stock(world, city);
    let kept = kept_from_walls(world, city);
    goods.iter().all(|(good, n)| held(&stock, *good) - held(&kept, *good) >= *n)
}

/// Whether the city's last pass had hands at a workplace of one of `materials` (`founding_lacks`
/// asks only once nothing else is short, so they were gathering them for its founding party).
fn gathering(world: &WorldState, city: &City, materials: &Stock) -> bool {
    let Some(plan) = world.city_plans.get(&city.id) else { return false };
    plan.jobs.values().any(|j| {
        j.kind == CityJobKind::Work
            && j.building_id.as_ref().is_some_and(|id| {
                world.buildings.iter().find(|b| &b.id == id).is_some_and(|b| {
                    crate::npc_chain::chain_good(world, b)
                        .is_some_and(|g| materials.contains_key(&g))
                })
            })
    })
}

/// Whether a city would be full but for its materials (`fullButMaterials`).
pub fn full_but_materials(world: &WorldState, city: &City, plan: &CityPlan) -> bool {
    let Some(since) = plan.full_since else { return false };
    if !founding_party(Some(plan)).is_empty() {
        return false;
    }
    // Under Expand it counts as full sooner (`NPC_STANCE.expand_full_days`).
    let wait = npc_full_days(city_residents(world, &city.id).len() as f64)
        * crate::npc_stance::full_days_factor(city)
        * TICKS_PER_GAME_DAY;
    world.tick as f64 - since >= wait && has_food_surplus(world, city)
}

/// Whether a city is full (`isFull`, `CONTEXT.md`: Full city): it would be but for its materials,
/// and holds its founding party's above its reserve.
pub fn is_full(world: &WorldState, city: &City, plan: &CityPlan) -> bool {
    if !full_but_materials(world, city, plan) {
        return false;
    }
    let reserve = npc_reserve(world, city);
    let stock = npc_city_stock(world, city);
    let materials = founding_materials(Some(npc_founding_party_size(
        city_residents(world, &city.id).len() as f64,
    )));
    materials.iter().all(|(good, n)| held(&stock, *good) >= held(&reserve, *good) + n)
}

/// Who the founding part of a pass works with (`people`).
pub struct FoundingPeople<'a> {
    /// Those it gives orders to, the party aside.
    pub adults: &'a [usize],
    /// Spare hands the pass had nowhere to send.
    pub unneeded: &'a [usize],
    /// The party's members who live and belong to it.
    pub members: &'a [usize],
}

/// The founding part of an NPC city's planning pass (`planFounding`, `CONTEXT.md`: Full city,
/// Founding), after its jobs are shared out. The plan is `world.city_plans[city.id]`.
pub fn plan_founding(
    world: &mut WorldState,
    city: &City,
    jobs: &mut Jobs,
    people: FoundingPeople,
    home: Option<&Building>,
    terrain: Option<&TerrainMap>,
) {
    if city.trade_org.is_some() {
        return;
    }
    let tick = world.tick as f64;
    let party = founding_party(world.city_plans.get(&city.id));
    let plan = world.city_plans.get(&city.id).expect("a plan");
    if !party.is_empty() {
        for id in &party {
            jobs.insert(id.clone(), job(CityJobKind::Found));
        }
        let since = plan.full_since.unwrap_or(tick);
        if hall_stands(world, plan) {
            return;
        }
        if tick - since < NPC_FOUND_GIVE_UP_DAYS * TICKS_PER_GAME_DAY {
            return;
        }
        for id in &party {
            jobs.shift_remove(id);
        }
        for &i in people.members {
            let r = &mut world.residents[i];
            r.order = None;
            r.script = None;
            jobs.insert(r.id.clone(), job(CityJobKind::Idle));
        }
        let plan = world.city_plans.get_mut(&city.id).expect("a plan");
        plan.full_since = None;
        plan.founding_site = None;
        return;
    }
    if !short_for_founding(world, city, home, terrain.map_or(MAP_SIZE, |t| t.size)).is_empty() {
        let plan = world.city_plans.get_mut(&city.id).expect("a plan");
        if plan.full_since.is_none() {
            return;
        }
        let short_since = *plan.short_since.get_or_insert(tick);
        if tick - short_since <= NPC_FULL_DIP_DAYS * TICKS_PER_GAME_DAY {
            return;
        }
        plan.short_since = None;
        plan.full_since = None;
        plan.founding_site = None;
        return;
    }
    let plan = world.city_plans.get_mut(&city.id).expect("a plan");
    plan.short_since = None;
    if people.unneeded.is_empty() {
        plan.full_since = None;
        plan.founding_site = None;
        return;
    }
    plan.full_since.get_or_insert(tick);
    let (Some(terrain), Some(home)) = (terrain, home) else { return };
    if !is_full(world, city, &world.city_plans[&city.id]) {
        return;
    }
    let site = world.city_plans[&city.id].founding_site;
    if let Some(s) = &site {
        if !site_still_fits(world, terrain, (s.x as i32, s.y as i32), None) {
            world.city_plans.get_mut(&city.id).expect("a plan").founding_site = None;
        }
    }
    if world.city_plans[&city.id].founding_site.is_none() && daily_pass(world, city) {
        if let Some((x, y)) = find_founding_site(world, terrain, city, home) {
            let site = Tile { x: f64::from(x), y: f64::from(y) };
            world.city_plans.get_mut(&city.id).expect("a plan").founding_site = Some(site);
        }
    }
    let Some(site) = world.city_plans[&city.id].founding_site else { return };
    let home_at = (home.x as i32, home.y as i32);
    let walk =
        wrap_distance(terrain.size, home_at, (site.x as i32, site.y as i32)) * WALK_TICKS_PER_TILE;
    let near = |i: usize| {
        !far_out((world.residents[i].x as i32, world.residents[i].y as i32), home_at, terrain.size)
    };
    let site_at = (site.x as i32, site.y as i32);
    let Some(chosen) =
        pick_party(world, city, people.adults, people.unneeded, &near, jobs, (walk, site_at))
    else {
        // Too few at hand: its workers far out come home to set out (Daniel, 2026-11-18, #1379).
        call_home(world, people.adults, jobs, home_at, terrain.size);
        return;
    };
    for i in chosen {
        let r = &mut world.residents[i];
        r.order = None;
        r.script = None;
        r.interrupted = None;
        let id = r.id.clone();
        end_pair(world, i);
        jobs.insert(id, job(CityJobKind::Found));
    }
    // From now on `fullSince` is when the party set out.
    world.city_plans.get_mut(&city.id).expect("a plan").full_since = Some(tick);
}

/// Whether a job is that of a hand called home to set out with its city's founding party: idle,
/// naming the workplace it was called from (`CONTEXT.md`: Founding; Daniel, 2026-11-18, #1379).
/// They stand at home like the idle, but don't count as idle hands to give work to.
pub fn called_home(job: &CityJob) -> bool {
    job.kind == CityJobKind::Idle && job.building_id.is_some()
}

/// Calls home a full city's workers far out while its founding party can't be picked
/// (`CONTEXT.md`: Founding; Daniel, 2026-11-18, #1379: Millbrook held all its party took, but
/// five of its seven workers were at workplaces far out, so it never had a party to send): each
/// whose workplace or who themself is further from home than `far_out`.
fn call_home(
    world: &WorldState,
    adults: &[usize],
    jobs: &mut Jobs,
    home_at: (i32, i32),
    size: i32,
) {
    for &i in adults {
        let r = &world.residents[i];
        let Some(planned) = jobs.get(&r.id) else { continue };
        if planned.kind != CityJobKind::Work {
            continue;
        }
        let Some(at) = planned.building_id.clone() else { continue };
        let place = world.buildings.iter().find(|b| b.id == at);
        let far = far_out((r.x as i32, r.y as i32), home_at, size)
            || place.is_some_and(|b| far_out((b.x as i32, b.y as i32), home_at, size));
        if far {
            jobs.insert(r.id.clone(), CityJob { building_id: Some(at), ..job(CityJobKind::Idle) });
        }
    }
}

/// Whether this pass is a city's first of a game day (`dailyPass`).
fn daily_pass(world: &WorldState, city: &City) -> bool {
    ((world.tick as f64 + f64::from(hash_str(&city.id))) % TICKS_PER_GAME_DAY) < NPC_PLAN_TICKS
}

/// Whether the town hall stands finished on the plan's founding site (`hallStands`).
fn hall_stands(world: &WorldState, plan: &CityPlan) -> bool {
    let Some(site) = &plan.founding_site else { return false };
    building_at(world, site.x as i32, site.y as i32, MAP_SIZE)
        .is_some_and(|h| h.kind == BuildingKind::TownHall && h.site.is_none())
}

/// Whether a resident is too far from home to fetch their share of a founding party's load
/// (`farOut`).
pub fn far_out(r: (i32, i32), home: (i32, i32), size: i32) -> bool {
    wrap_distance(size, r, home) > NPC_NODE_REACH
}

/// The founding party (`pickParty`, `CONTEXT.md`: Founding, Escort): `npc_founding_party_size`
/// adults, its escort of soldiers (`founding_escorts_wanted`) as far as the city has them beyond
/// its hall and gates, the rest of its spare hands, its workers off the farms and those called
/// home, those with the most room on them first, then farmers beyond those who feed it
/// (`farmers_to_feed`), and as many more as it takes for their arms to hold the Food for the
/// walk and the first weeks and all the materials. None while there aren't enough.
/// `(walk_ticks, site)` is the way to the site.
fn pick_party(
    world: &WorldState,
    city: &City,
    adults: &[usize],
    unneeded: &[usize],
    near: &dyn Fn(usize) -> bool,
    jobs: &Jobs,
    (walk_ticks, site): (f64, (i32, i32)),
) -> Option<Vec<usize>> {
    let tick = world.tick as f64;
    let free = |i: usize| {
        let r = &world.residents[i];
        if r.carrying.is_some() || !near(i) {
            return false;
        }
        let partner =
            r.pair.as_ref().and_then(|p| world.residents.iter().find(|x| x.id == p.partner_id));
        partner.is_none_or(|p| p.carrying.is_none())
    };
    let food_weight = GOOD_WEIGHT.get("food").expect("a weight");
    // What they carry of their own Food counts as room: they take along what they need of it and
    // put the rest into the storage (`step_founders`).
    let (walk, stay) = founding_food(walk_ticks);
    let room = |i: usize| {
        let r = &world.residents[i];
        carry_capacity(r, tick) - stock_weight(&r.carried) + carried_food(r) * food_weight
    };
    let armed_now = |i: usize| is_armed(&world.residents[i]);
    // Its escort: soldiers beyond those on its hall and at its gates (`CONTEXT.md`: Escort).
    let mut armed: Vec<usize> =
        spare_soldiers(world, city, adults).into_iter().filter(|&i| free(i)).collect();
    armed.sort_by(|&a, &b| room(b).total_cmp(&room(a)));
    let mut rest: Vec<usize> = Vec::new();
    let mut seen = HashSet::new();
    let working =
        |i: usize| jobs.get(&world.residents[i].id).is_some_and(|j| j.kind == CityJobKind::Work);
    // Those the last pass called home (`call_home`) come along, whatever this one gave them, but
    // for the jobs that hold a resident (Daniel, 2026-11-18, #1379).
    let old = world.city_plans.get(&city.id).map(|p| &p.jobs);
    let called = |i: usize| {
        let id = &world.residents[i].id;
        old.and_then(|j| j.get(id)).is_some_and(called_home)
            && jobs.get(id).is_none_or(|j| {
                matches!(
                    j.kind,
                    CityJobKind::Idle | CityJobKind::Work | CityJobKind::Road | CityJobKind::Scout
                )
            })
    };
    for &i in unneeded
        .iter()
        .filter(|&&i| !armed_now(i) && free(i))
        .chain(adults.iter().filter(|&&i| !armed_now(i) && free(i) && (working(i) || called(i))))
    {
        if seen.insert(i) {
            rest.push(i);
        }
    }
    rest.sort_by(|&a, &b| room(b).total_cmp(&room(a)));
    // Then farmers beyond those who feed it (`farmers_to_feed`), those with the most room first
    // (Daniel, 2026-11-18, #1379).
    let farming =
        |i: usize| jobs.get(&world.residents[i].id).is_some_and(|j| j.kind == CityJobKind::Farm);
    let farmers = adults.iter().filter(|&&i| farming(i)).count();
    let spare_farmers =
        farmers.saturating_sub(crate::npc_plan::farmers_to_feed(world, city).ceil() as usize);
    let mut farm_hands: Vec<usize> =
        adults.iter().copied().filter(|&i| farming(i) && !armed_now(i) && free(i)).collect();
    farm_hands.sort_by(|&a, &b| room(b).total_cmp(&room(a)));
    rest.extend(farm_hands.into_iter().filter(|i| seen.insert(*i)).take(spare_farmers));
    let members = npc_founding_party_size(city_residents(world, &city.id).len() as f64) as usize;
    let escort = founding_escorts_wanted(world, city, members, site);
    let mut candidates = armed.into_iter().take(escort).chain(rest);
    let mut party: Vec<usize> = candidates.by_ref().take(members).collect();
    if party.len() < members {
        return None;
    }
    // Each carries a share of the materials and Food for the walk and the first weeks
    // (`CONTEXT.md`: Founding): as many more go as it takes to carry it all (Daniel, 2026-11-15,
    // T100.8). Those bring no house of their own; the daughter builds it later.
    let materials = stock_weight(&founding_materials(Some(members as f64)));
    let load = |n: usize| materials + n as f64 * (walk + stay) * food_weight;
    loop {
        if party.iter().map(|&i| room(i)).sum::<f64>() >= load(party.len()) {
            return Some(party);
        }
        party.push(candidates.next()?);
    }
}

/// A pair ends when one of them leaves to found a daughter (`endPair`).
fn end_pair(world: &mut WorldState, i: usize) {
    let id = world.residents[i].id.clone();
    if let Some(pair) = world.residents[i].pair.take() {
        if let Some(p) = world.residents.iter_mut().find(|x| x.id == pair.partner_id) {
            if p.pair.as_ref().is_some_and(|pp| pp.partner_id == id) {
                p.pair = None;
            }
        }
    }
}

/// The top-left tile of a village's square whose town hall stands at `hall` (`squareOf`).
fn square_of(hall: (i32, i32)) -> (i32, i32) {
    let (hx, hy) = hall_tile(0, 0, NPC_VILLAGE.size as i32);
    (hall.0 - hx, hall.1 - hy)
}

/// Whether a village laid out from its town hall at `hall` fits, out of sight or not, and never
/// straddles the map's joins (`siteStillFits`).
fn site_still_fits(
    world: &WorldState,
    terrain: &TerrainMap,
    hall: (i32, i32),
    ground: Option<&Ground>,
) -> bool {
    let (x, y) = square_of(hall);
    let far = terrain.size - NPC_VILLAGE.size as i32 - FARM_RING;
    if x < FARM_RING || y < FARM_RING || x > far || y > far {
        return false;
    }
    let among = SiteWorld::new(world).keeping(daughter_min_distance(terrain.size));
    match ground {
        Some(g) => npc_site_fits_among(&among, terrain, &NPC_VILLAGE, x, y, g, false),
        None => {
            let g = taken_ground(world, terrain);
            npc_site_fits_among(&among, terrain, &NPC_VILLAGE, x, y, &g, false)
        }
    }
}

/// How far a daughter stands from every city on a map of `size` (`CONTEXT.md`: Founding):
/// `NPC_CITY_MIN_DISTANCE` on a full-size map. On a smaller one of at least half its side, whose
/// cities stand closer together, it is scaled with the side (Daniel, 2026-11-15, T100.8), as the
/// starting sites' clearance is (`starting_site_clearance`). A test map smaller still keeps the
/// full distance: scaled further, a big mother's defence takes the daughter's armed founder for an
/// outsider, and a big city with room on a small map founds every few days.
pub fn daughter_min_distance(size: i32) -> f64 {
    let f = f64::from(size) / f64::from(MAP_SIZE);
    if (0.5..1.0).contains(&f) {
        NPC_CITY_MIN_DISTANCE * f
    } else {
        NPC_CITY_MIN_DISTANCE
    }
}

/// The good a city wants its daughter near (`lackedGood`): the first good of a node that no node
/// it knows of yields.
pub fn lacked_good(world: &WorldState, city: &City, home: (i32, i32), size: i32) -> Option<Good> {
    [Good::Wood, Good::Stone, Good::IronOre, Good::GoldOre].into_iter().find(|good| {
        !world.nodes.iter().any(|n| {
            node_good(n.kind) == *good && knows_node(city, home, (n.x as i32, n.y as i32), size)
        })
    })
}

/// A site for a city's daughter (`findFoundingSite`), by its town hall's tile: of
/// `NPC_FOUND_SAMPLES` random tiles between `daughter_min_distance` and `NPC_FOUND_REACH` from its
/// home, those where a village fits with no tile of it on a realm's territory, on land its people walk to
/// (never an island) and clear of the starting sites (`NPC_STARTING_SITE_CLEARANCE`); the one nearest a
/// node of the good it lacks wins, else the one nearest home.
pub fn find_founding_site(
    world: &WorldState,
    terrain: &TerrainMap,
    city: &City,
    home: &Building,
) -> Option<(i32, i32)> {
    let size = terrain.size;
    let mut m = Mulberry32::new(f64::from(hash_str(&format!("{}:{}", city.id, world.tick))));
    let ground = taken_ground(world, terrain);
    let span = NPC_VILLAGE.size as i32 + 2 * FARM_RING;
    let realms: HashSet<&String> = world.realms.iter().map(|r| &r.id).collect();
    let owners: std::cell::OnceCell<crate::queries::territory::Territory> =
        std::cell::OnceCell::new();
    let on_realm = |x: i32, y: i32| {
        let owners = &owners
            .get_or_init(|| crate::queries::territory::compute_territory(world, size))
            .owners;
        (0..span).any(|dy| {
            (0..span).any(|dx| {
                let t = csp_shared::terrain::tile_index(
                    size,
                    wrap(x - FARM_RING + dx, size),
                    wrap(y - FARM_RING + dy, size),
                );
                owners.get(&t).is_some_and(|o| realms.contains(o))
            })
        })
    };
    let home_at = (home.x as i32, home.y as i32);
    let good = lacked_good(world, city, home_at, size);
    let nodes: Vec<(i32, i32)> = match good {
        Some(g) => world
            .nodes
            .iter()
            .filter(|n| node_good(n.kind) == g)
            .map(|n| (n.x as i32, n.y as i32))
            .collect(),
        None => Vec::new(),
    };
    let score = |at: (i32, i32)| {
        if nodes.is_empty() {
            wrap_distance(size, home_at, at)
        } else {
            nodes.iter().map(|n| wrap_distance(size, at, *n)).fold(f64::INFINITY, f64::min)
        }
    };
    // The daughter stays on its mother's land, the mainland, and off the starting sites.
    let starting = starting_site_middles(world);
    let reach = (NPC_FOUND_REACH + NPC_VILLAGE.size) as i32 + 2 * FARM_RING;
    let walk: std::cell::OnceCell<FootReach> = std::cell::OnceCell::new();
    let walks_to = |(x, y): (i32, i32)| {
        walk.get_or_init(|| FootReach::from(terrain, home_at, reach)).reaches(x, y)
    };
    let mut best: Option<((i32, i32), f64)> = None;
    let half = (NPC_VILLAGE.size / 2.0).floor() as i32;
    let nearest = daughter_min_distance(size);
    for _ in 0..NPC_FOUND_SAMPLES as usize {
        let angle = m.next() * 2.0 * PI;
        let d = nearest + m.next() * (NPC_FOUND_REACH - nearest);
        let x = wrap(js_round(home.x + d * angle.cos()) as i32 - half, size);
        let y = wrap(js_round(home.y + d * angle.sin()) as i32 - half, size);
        let hall = hall_tile(x, y, NPC_VILLAGE.size as i32);
        if !site_still_fits(world, terrain, hall, Some(&ground)) {
            continue;
        }
        let s = score((x + half, y + half));
        if best.is_some_and(|b| s >= b.1) {
            continue;
        }
        if on_realm(x, y) {
            continue;
        }
        let middle = (f64::from(x + half), f64::from(y + half));
        if near_a_starting_site(&starting, size, middle) || !walks_to(hall) {
            continue;
        }
        best = Some((hall, s));
    }
    best.map(|b| b.0)
}

/// The Food a founding party's member carries (`foundingFood`), in whole units: for twice the walk
/// to the site, and for `NPC_FOUND_FOOD_DAYS` there. `(walk, stay)`.
pub fn founding_food(walk_ticks: f64) -> (f64, f64) {
    let walk = ((2.0 * walk_ticks / TICKS_PER_GAME_DAY) * FOOD_PER_DAY - 1e-9).ceil();
    (walk, (NPC_FOUND_FOOD_DAYS * FOOD_PER_DAY - 1e-9).ceil())
}

/// What a founding party still lacks of its materials beyond what its members who live carry
/// (`partyLacks`), as two parts: the town hall's, then the rest.
fn party_lacks(world: &WorldState, members: &[usize], size: f64) -> [Stock; 2] {
    let mut carried = Stock::new();
    for &i in members {
        let r = &world.residents[i];
        let picking = match &r.order {
            Some(ResidentOrder::PickUp(o)) => o.goods.clone(),
            _ => Stock::new(),
        };
        for stock in [&r.carried, &picking] {
            for (good, n) in stock {
                *carried.entry(*good).or_insert(0.0) += n;
            }
        }
    }
    let hall_materials = build_materials(BuildingKind::TownHall);
    let mut hall = Stock::new();
    let mut rest = Stock::new();
    for (good, n) in founding_materials(Some(size)) {
        let for_hall = held(&hall_materials, good);
        let lack = (n - held(&carried, good)).max(0.0);
        let h = (for_hall - held(&carried, good)).max(0.0);
        hall.insert(good, h);
        rest.insert(good, lack - h);
    }
    [hall, rest]
}

/// What the founding party does each tick (`stepFounders`), for its members that are idle: near
/// the storage, they first take from it, as much as fits: Food for the walk and their first weeks,
/// then what the party still lacks of its materials; then they build the town hall on the site by
/// the Build default.
pub fn step_founders(
    world: &mut WorldState,
    city_id: &str,
    members: &[usize],
    storage: Option<usize>,
    size: i32,
) {
    let plan = world.city_plans.get(city_id);
    let Some(site) = plan.and_then(|p| p.founding_site) else { return };
    // The materials of the usual party: those who come only to carry bring no house (T100.8).
    let party_size = npc_founding_party_size(city_residents(world, city_id).len() as f64)
        .min(founding_party(plan).len() as f64);
    let site_at = (site.x as i32, site.y as i32);
    for &i in members {
        let r = &world.residents[i];
        if r.order.is_some() || r.script.is_some() {
            continue;
        }
        let at = (r.x as i32, r.y as i32);
        if let Some(s) = storage {
            let store = &world.buildings[s];
            if wrap_distance(size, at, (store.x as i32, store.y as i32)) <= NPC_NODE_REACH {
                let walk = wrap_distance(size, at, site_at) * WALK_TICKS_PER_TILE;
                let (food_walk, food_stay) = founding_food(walk);
                let on_way = (food_walk - carried_food(r)).max(0.0);
                let stay = (food_walk + food_stay - carried_food(r) - on_way).max(0.0);
                let [hall, rest] = party_lacks(world, members, party_size);
                // Their own Food first, the walk's and the first weeks', so one full of
                // materials doesn't go without (T100.8); the party has the room for all of it.
                let parts = [
                    Stock::from([(Good::Food, on_way)]),
                    Stock::from([(Good::Food, stay)]),
                    hall,
                    rest,
                ];
                // Food of their own past that goes into the storage first, to make room for the
                // materials (T100.8).
                let spare = (carried_food(r) - food_walk - food_stay).floor();
                let load = load_for(world, i, &parts, store);
                if spare >= 1.0 || load.is_some() {
                    let (sid, sx, sy) = (store.id.clone(), store.x, store.y);
                    let here = is_at(at, placed(store), size);
                    let order = if here && spare >= 1.0 {
                        ResidentOrder::Drop(DropOrder {
                            to: GoodsSpot::Storage { storage_id: sid },
                            goods: Stock::from([(Good::Food, spare)]),
                        })
                    } else if let (true, Some(load)) = (here, load) {
                        ResidentOrder::PickUp(PickUpOrder {
                            from: GoodsSpot::Storage { storage_id: sid },
                            goods: load,
                        })
                    } else {
                        ResidentOrder::WalkTo(WalkOrder {
                            target: Tile { x: sx, y: sy },
                            path: None,
                            progress: 0.0,
                            army: None,
                        })
                    };
                    world.residents[i].order = Some(order);
                    continue;
                }
            }
        }
        let memory = json!({ "building": kind_name(BuildingKind::TownHall), "at": { "x": site.x, "y": site.y } });
        world.residents[i].script = Some(default_script(Task::Build, memory));
    }
}

/// What a member takes from the storage of `wanted` (`loadFor`): part by part in its order, as far
/// as the storage holds it and it fits; none if nothing.
fn load_for(world: &WorldState, i: usize, wanted: &[Stock], storage: &Building) -> Option<Stock> {
    let r = &world.residents[i];
    let mut room = carry_capacity(r, world.tick as f64) - stock_weight(&r.carried);
    let mut load = Stock::new();
    for part in wanted {
        for (good, units) in part {
            let left = held_in(storage.stock.as_ref(), *good).floor() - held(&load, *good);
            let w = good_weight(*good);
            let n = units.min((room / w + 1e-9).floor()).min(left);
            if n <= 0.0 {
                continue;
            }
            *load.entry(*good).or_insert(0.0) += n;
            room -= n * w;
        }
    }
    (!load.is_empty()).then_some(load)
}

/// The founding party's town hall stands (`foundDaughter`): it founded the daughter, an NPC city of
/// its own. The party's members who live move to it, its plan forgets the party, and mother and
/// daughter start at `NPC_FOUND_STANDING` toward each other. Returns the daughter's id, if founded
/// now.
pub fn found_daughter(world: &mut WorldState, city_id: &str) -> Option<String> {
    let plan = world.city_plans.get(city_id)?;
    let party = founding_party(Some(plan));
    let site = plan.founding_site?;
    if party.is_empty() || !hall_stands(world, plan) {
        return None;
    }
    let hall = building_at(world, site.x as i32, site.y as i32, MAP_SIZE).expect("the hall stands");
    let daughter = world.cities.iter().find(|c| Some(&c.id) == hall.city_id.as_ref())?;
    if daughter.id == city_id || daughter.realm_id.is_some() {
        return None;
    }
    let daughter = daughter.id.clone();
    let ids: HashSet<&String> = party.iter().collect();
    for r in &mut world.residents {
        if !ids.contains(&r.id)
            || r.city_id.as_deref() != Some(city_id)
            || r.owner.is_some()
            || r.health <= 0.0
        {
            continue;
        }
        r.city_id = Some(daughter.clone());
        // They leave the mother's defence behind: what it kept aside for them and its defence or
        // Alarm script end, and the daughter gives them their work (T100.8).
        let defending =
            matches!(r.script.as_ref().and_then(|s| s.task), Some(Task::Defend | Task::Alarm));
        if r.interrupted.take().is_some() || defending {
            r.order = None;
            r.script = None;
        }
        // One gone back to the mother's storage for materials comes to the daughter instead.
        let fetching =
            r.script.as_ref().and_then(|s| s.memory.get("fetch")).is_some_and(|v| !v.is_null());
        if fetching {
            stop_work(r);
        }
    }
    let plan = world.city_plans.get_mut(city_id).expect("a plan");
    for id in &party {
        plan.jobs.shift_remove(id);
    }
    plan.full_since = None;
    plan.founding_site = None;
    crate::temperament::inherit_temperament(world, city_id, &daughter);
    raise_standing_both_ways(world, city_id, &daughter, NPC_FOUND_STANDING);
    Some(daughter)
}

/// Invariant `npc-cities-have-halls` (`CONTEXT.md`: Town hall, Founding; ADR 0004): every city of
/// no realm, a daughter too, has its town hall, finished and its own.
pub fn npc_cities_have_halls(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .cities
        .iter()
        .filter(|c| c.realm_id.is_none())
        .filter(|c| {
            !world.buildings.iter().find(|b| b.id == c.town_hall_id).is_some_and(|h| {
                h.kind == BuildingKind::TownHall
                    && h.site.is_none()
                    && h.city_id.as_ref() == Some(&c.id)
            })
        })
        .map(|c| InvariantViolation {
            invariant: "npc-cities-have-halls".into(),
            message: format!("{}, a city of no realm, has no town hall of its own", c.id),
            entity_ids: vec![c.id.clone()],
        })
        .collect()
}

mod invariants;
pub use invariants::{founding_parties_sound, founding_site_clear, full_wait_sound};
#[cfg(test)]
mod tests;
