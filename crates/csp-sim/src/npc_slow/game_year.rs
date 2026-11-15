//! The new world holds up on its own (T100.8, ADR 0035): a world generated at a reduced size with
//! the new land runs a game year with no Player, and with two Players' starting cities left on the
//! game's defaults for a game season. `--nocapture` shows how it went every ten game days.
//!
//! The year holds: no NPC city starved out, nobody of the Trade Organization starved, every
//! caravan made a round trip, every wandering trader went round its loop, an NPC city founded a
//! daughter, and every invariant held each game day. The season holds: both Players' cities live,
//! nobody of theirs starved, and each has a Trade Org warehouse within its trader's reach.
//!
//! `GAME_YEAR_DAYS` runs fewer game days than a year, to look at a shorter stretch by hand; the
//! assertions are only held to on the whole run.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use csp_shared::balance::{MAP_SIZE, NPC_TRADER_REACH};
use csp_shared::terrain::wrap_distance;
use csp_shared::terrain::TerrainMap;
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};
use csp_shared::world::{BuildingKind, Heading, WorldState};

use crate::invariants::check_all;
use crate::npc_test_world::Runner;
use crate::starting_city::found_starting_city;
use crate::terrain_gen::generate_terrain;
use crate::world::generate_world;

/// The world's seed and size: half the full map's side (`MAP_SIZE`), a quarter of its land. On a
/// map of 1536 the starting sites leave room for one NPC city at most; this one holds eight NPC
/// cities, four trading posts and all thirty starting sites.
const SEED: i64 = 2;
const SIZE: i32 = MAP_SIZE / 2;

/// The world to run, generated as for a new game.
fn new_world() -> (WorldState, TerrainMap) {
    let terrain = generate_terrain(SEED, SIZE);
    let world = generate_world(&terrain, SEED);
    (world, terrain)
}

/// A game season: a quarter of the game year.
const GAME_SEASON_DAYS: usize = (TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY / 4.0) as usize;

fn npc_city_ids(world: &WorldState) -> Vec<String> {
    world
        .cities
        .iter()
        .filter(|c| c.realm_id.is_none() && c.trade_org.is_none())
        .map(|c| c.id.clone())
        .collect()
}

fn people_of(world: &WorldState, city: &str) -> usize {
    world.residents.iter().filter(|r| r.city_id.as_deref() == Some(city)).count()
}

/// The finished Trade Org warehouses: the HQ's and every trading post's.
fn trade_warehouses(world: &WorldState) -> Vec<(i32, i32)> {
    world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Warehouse && b.site.is_none())
        .filter(|b| {
            world.cities.iter().any(|c| Some(&c.id) == b.city_id.as_ref() && c.trade_org.is_some())
        })
        .map(|b| (b.x as i32, b.y as i32))
        .collect()
}

/// What a run saw, kept up tick by tick.
#[derive(Default)]
struct Watch {
    /// Each caravan's ends reached: how often its heading turned.
    caravan_turns: HashMap<String, usize>,
    caravan_heading: HashMap<String, Heading>,
    /// Each wandering trader's stops reached, and the stop it is bound for.
    trader_reached: HashMap<String, HashSet<String>>,
    trader_bound: HashMap<String, String>,
    /// Residents of each city who starved to death.
    starved: HashMap<String, usize>,
    /// The most residents each city had.
    most: HashMap<String, usize>,
}

impl Watch {
    fn new(world: &WorldState) -> Self {
        let mut watch = Watch::default();
        for c in &world.caravans {
            watch.caravan_turns.insert(c.id.clone(), 0);
            watch.caravan_heading.insert(c.id.clone(), c.heading);
        }
        for t in &world.traders {
            watch.trader_reached.insert(t.id.clone(), HashSet::new());
            watch.trader_bound.insert(t.id.clone(), t.post_id.clone());
        }
        watch
    }

    fn tick(&mut self, world: &WorldState, died: &[csp_shared::world::Resident]) {
        for c in &world.caravans {
            let was = self.caravan_heading.insert(c.id.clone(), c.heading);
            if was.is_some_and(|h| h != c.heading) {
                *self.caravan_turns.entry(c.id.clone()).or_default() += 1;
            }
        }
        for t in &world.traders {
            let was = self.trader_bound.insert(t.id.clone(), t.post_id.clone());
            if let Some(was) = was.filter(|w| *w != t.post_id) {
                self.trader_reached.entry(t.id.clone()).or_default().insert(was);
            }
        }
        for r in died {
            if let Some(city) = &r.city_id {
                *self.starved.entry(city.clone()).or_default() += 1;
            }
        }
    }

    fn day(&mut self, world: &WorldState) {
        for c in &world.cities {
            let n = people_of(world, &c.id);
            let most = self.most.entry(c.id.clone()).or_default();
            *most = (*most).max(n);
        }
    }

    /// The caravans that have not been to both ends and back: turned at most once.
    fn caravans_short(&self) -> Vec<(&String, &usize)> {
        let mut short: Vec<_> = self.caravan_turns.iter().filter(|(_, n)| **n < 2).collect();
        short.sort();
        short
    }

    /// The wandering traders that have not reached every stop of their loop.
    fn traders_short(&self, world: &WorldState) -> Vec<(String, usize, usize)> {
        let mut short: Vec<_> = world
            .traders
            .iter()
            .filter_map(|t| {
                let reached = self
                    .trader_reached
                    .get(&t.id)
                    .map_or(0, |r| t.r#loop.iter().filter(|p| r.contains(*p)).count());
                (reached < t.r#loop.len()).then(|| (t.id.clone(), reached, t.r#loop.len()))
            })
            .collect();
        short.sort();
        short
    }
}

/// Runs the world for `days` game days, checking every invariant each game day and saying how it
/// goes every ten.
fn run(world: &mut WorldState, terrain: &TerrainMap, days: usize, watch: &mut Watch) {
    let mut runner = Runner::new(terrain);
    let started = Instant::now();
    let mut trace = std::env::var("GAME_YEAR_TRACE")
        .ok()
        .map(|p| std::io::BufWriter::new(std::fs::File::create(p).expect("a trace file")));
    for day in 1..=days {
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            let step = runner.step_with_result(world, terrain);
            let starved: Vec<_> = step.survival.died.clone();
            watch.tick(world, &starved);
        }
        watch.day(world);
        if let Some(t) = trace.as_mut() {
            trace_day(t, world, terrain, day);
            let _ = std::io::Write::flush(t);
        }
        assert_eq!(check_all(world, terrain), [], "day {day}");
        if day % 10 == 0 || day == days {
            let npc = npc_city_ids(world);
            let people: usize = npc.iter().map(|c| people_of(world, c)).sum();
            eprintln!(
                "day {day:>3} ({:>6.0} s): {} NPC cities, {people} in them, {} residents in all, \
                 {} starved, caravans short {}, traders short {}",
                started.elapsed().as_secs_f64(),
                npc.len(),
                world.residents.len(),
                watch.starved.values().sum::<usize>(),
                watch.caravans_short().len(),
                watch.traders_short(world).len(),
            );
        }
    }
}

/// One line a game day for each NPC city, to `GAME_YEAR_TRACE` if set: what holds back its
/// founding, what it builds, and what it holds against its reserve.
fn trace_day(out: &mut impl std::io::Write, world: &WorldState, terrain: &TerrainMap, day: usize) {
    use crate::npc_chain::own_workplaces;
    use crate::npc_founding::{founding_lacks, short_for_founding};
    use crate::queries::names::{good_name, held, kind_name};
    use crate::queries::npc_trade::{npc_city_stock, npc_reserve};
    use csp_shared::world::{CityJobKind, Good};
    for id in npc_city_ids(world) {
        let city = world.cities.iter().find(|c| c.id == id).expect("a city");
        let home = crate::npc_behaviour::npc_home(world, &id);
        let short: Vec<&str> = short_for_founding(world, city, home, terrain.size)
            .into_iter()
            .map(good_name)
            .collect();
        let lacks: Vec<String> = founding_lacks(world, city, home, terrain.size)
            .into_iter()
            .map(|s| format!("{}:{:.2}", good_name(s.good), s.share))
            .collect();
        let plan = world.city_plans.get(&id);
        let jobs =
            |k: CityJobKind| plan.map_or(0, |p| p.jobs.values().filter(|j| j.kind == k).count());
        let project = plan.and_then(|p| p.project.as_ref()).map(|p| format!("{p:?}"));
        let places: Vec<String> = own_workplaces(world, city)
            .into_iter()
            .map(|b| format!("{}{}", kind_name(b.kind), if b.site.is_some() { "*" } else { "" }))
            .collect();
        let stock = npc_city_stock(world, city);
        let reserve = npc_reserve(world, city);
        let goods: Vec<String> = [
            Good::Food,
            Good::Coins,
            Good::Wood,
            Good::Stone,
            Good::IronOre,
            Good::Iron,
            Good::Spear,
        ]
        .into_iter()
        .map(|g| format!("{}={:.0}/{:.0}", good_name(g), held(&stock, g), held(&reserve, g)))
        .collect();
        let _ = writeln!(
            out,
            "d{day} {id} {} n={} idle={} work={} build={} full_since={:?} short={short:?} \
             lacks={lacks:?} goods={goods:?} places={places:?} project={project:?}",
            city.name,
            people_of(world, &id),
            jobs(CityJobKind::Idle),
            jobs(CityJobKind::Work),
            jobs(CityJobKind::Build),
            plan.and_then(|p| p.full_since).map(|t| (t / TICKS_PER_GAME_DAY) as i64),
        );
    }
}

fn days_to_run(whole: usize) -> usize {
    std::env::var("GAME_YEAR_DAYS").ok().and_then(|d| d.parse().ok()).unwrap_or(whole)
}

#[test]
#[ignore = "about 50 min alone in release; see #1261"]
fn the_new_world_runs_a_game_year_on_its_own() {
    let (mut world, terrain) = new_world();
    let terrain = &terrain;
    let npc_at_start: HashSet<String> = npc_city_ids(&world).into_iter().collect();
    let mut watch = Watch::new(&world);
    eprintln!(
        "{} NPC cities, {} caravans, {} wandering traders, {} residents",
        npc_at_start.len(),
        world.caravans.len(),
        world.traders.len(),
        world.residents.len()
    );
    let whole = (TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY) as usize;
    let days = days_to_run(whole);
    run(&mut world, terrain, days, &mut watch);

    let npc_now = npc_city_ids(&world);
    let starved_out: Vec<(&String, usize)> =
        npc_at_start.iter().map(|c| (c, people_of(&world, c))).filter(|(_, n)| *n == 0).collect();
    let daughters: Vec<&String> = npc_now.iter().filter(|c| !npc_at_start.contains(*c)).collect();
    let starved: Vec<(&String, &usize)> = watch.starved.iter().collect();
    eprintln!("starved by city: {starved:?}");
    eprintln!("daughters: {daughters:?}");
    eprintln!("caravans short: {:?}", watch.caravans_short());
    eprintln!("traders short: {:?}", watch.traders_short(&world));
    if days < whole {
        return;
    }
    assert_eq!(starved_out, [], "NPC cities starved out");
    // The Trade Organization's crews go furthest across the land: none of them starves on the
    // way. An NPC city may lose one to hunger now and then (it is printed above).
    for c in world.cities.iter().filter(|c| c.trade_org.is_some()) {
        assert_eq!(watch.starved.get(&c.id), None, "{} lost residents to hunger", c.id);
    }
    assert_eq!(watch.caravans_short(), Vec::<(&String, &usize)>::new());
    assert_eq!(watch.traders_short(&world), []);
    assert!(!daughters.is_empty(), "no NPC city founded a daughter");
}

#[test]
#[ignore = "about 15 min alone in release; see #1261"]
fn two_players_on_the_defaults_last_a_game_season_on_the_new_world() {
    let (mut world, terrain) = new_world();
    let terrain = &terrain;
    let realms: Vec<String> = [1, 2]
        .into_iter()
        .map(|user| {
            let r = found_starting_city(&mut world, terrain, user, None);
            world.realms[r].id.clone()
        })
        .collect();
    let city_of = |world: &WorldState, realm: &str| {
        world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm)).cloned()
    };
    let cities: Vec<String> =
        realms.iter().map(|r| city_of(&world, r).expect("a starting city").id).collect();
    let mut watch = Watch::new(&world);
    let days = days_to_run(GAME_SEASON_DAYS);
    run(&mut world, terrain, days, &mut watch);

    let size = terrain.size;
    let warehouses = trade_warehouses(&world);
    for (realm, city) in realms.iter().zip(&cities) {
        assert!(world.realms.iter().any(|r| r.id == *realm), "{realm} ended");
        let c = city_of(&world, realm).expect("its city");
        assert_eq!(c.id, *city);
        let hall = world.buildings.iter().find(|b| b.id == c.town_hall_id).expect("a town hall");
        let at = (hall.x as i32, hall.y as i32);
        let nearest =
            warehouses.iter().map(|w| wrap_distance(size, at, *w)).fold(f64::MAX, f64::min);
        eprintln!(
            "{realm}: {} residents, {} starved, nearest Trade Org warehouse {nearest:.0} tiles",
            people_of(&world, city),
            watch.starved.get(city).copied().unwrap_or(0),
        );
        if days < GAME_SEASON_DAYS {
            continue;
        }
        assert!(people_of(&world, city) > 0, "{city} has nobody left");
        assert_eq!(watch.starved.get(city), None, "{city} lost residents to hunger");
        assert!(nearest <= NPC_TRADER_REACH, "{city}: nearest warehouse {nearest} tiles");
    }
}
