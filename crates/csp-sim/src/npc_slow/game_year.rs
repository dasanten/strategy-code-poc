//! The new world holds up on its own (T100.8, ADR 0035): a world generated at a reduced size with
//! the new land runs a game year with no Player, and with two Players' starting cities left on the
//! game's defaults for a game season. `--nocapture` shows how it went every ten game days.
//!
//! The year holds: no NPC city starved out, nobody of the Trade Organization starved, every
//! caravan made a round trip, every wandering trader went round its loop, and every invariant held
//! each game day; whether a daughter was founded is printed. The season holds: both Players' cities live,
//! nobody of theirs starved, and each has a Trade Org warehouse within its trader's reach.
//!
//! `GAME_YEAR_DAYS` runs fewer game days than a year, to look at a shorter stretch by hand; the
//! assertions at the end are only held to on the whole run.
//!
//! What can be judged on the day fails the run on that game day, naming the city (ADR 0040): an NPC
//! city with nobody left, a Trade Organization city (or, in the season, a Player's city) losing a
//! resident to hunger. Every invariant is held each game day too.
//!
//! The year run writes a checkpoint every 30 game days: the world as the server saves it (gzipped
//! JSON of `WorldState`) and what its `Watch` counted so far, to `GAME_YEAR_CHECKPOINTS` (by
//! default `target/game-year`). `GAME_YEAR_FROM=<dir>/day-030.world.json.gz` starts from one and
//! goes on to the end (or to `GAME_YEAR_DAYS`), holding the same things: resuming is the same run
//! tick for tick (`resuming_from_a_save_is_the_same_run`), so a late failure is looked at from the
//! last checkpoint before it.
//!
//! `GAME_YEAR_TRACE=<file>` writes a line a game day for each NPC city and one for each resident who
//! starves (where, doing what); `GAME_YEAR_WHO=<id>,<id>` adds a line a game hour for those residents.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use csp_shared::balance::{MAP_SIZE, NPC_TRADER_REACH};
use csp_shared::terrain::wrap_distance;
use csp_shared::terrain::TerrainMap;
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};
use csp_shared::world::{BuildingKind, Heading, WorldState};

use crate::invariants::check_all;
use crate::npc_test_world::Runner;
use crate::order_sender::OrderSender;
use crate::queues::{QueueHost, QueueRunner};
use crate::script_runner::default_host::DefaultScripts;
use crate::script_runner::Waiting;
use crate::starting_city::found_starting_city;
use crate::terrain_gen::generate_terrain;
use crate::tick::Scratch;
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

/// What a run saw, kept up tick by tick, and what fails it on the day; saved with each checkpoint.
#[derive(Default, Serialize, Deserialize)]
struct Watch {
    /// Game days run so far.
    day: usize,
    /// The NPC cities at the start.
    npc_at_start: Vec<String>,
    /// Cities that fail the run on the game day they have nobody left.
    must_live: Vec<String>,
    /// Cities that fail the run on the game day they lose a resident to hunger.
    must_not_starve: Vec<String>,
    /// Whether a Trade Organization city losing a resident to hunger fails the run on that day.
    trade_org_fed: bool,
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
        let mut watch = Watch { npc_at_start: npc_city_ids(world), ..Watch::default() };
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

    /// What fails the run today, if anything: a city that must live with nobody left, or one that
    /// must not starve having lost a resident to hunger.
    fn failure(&self, world: &WorldState) -> Option<String> {
        let name = |id: &str| {
            world.cities.iter().find(|c| c.id == id).map_or("gone", |c| c.name.as_str()).to_string()
        };
        if let Some(c) = self.must_live.iter().find(|c| people_of(world, c) == 0) {
            return Some(format!("{c} ({}) starved out: nobody left", name(c)));
        }
        let trade_org = world
            .cities
            .iter()
            .filter(|c| self.trade_org_fed && c.trade_org.is_some())
            .map(|c| &c.id);
        for c in self.must_not_starve.iter().chain(trade_org) {
            if let Some(n) = self.starved.get(c) {
                return Some(format!("{c} ({}) lost {n} residents to hunger", name(c)));
            }
        }
        None
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

/// The Players' side of a tick, as the server runs it (`run_tick`): their residents' queues move
/// on and their scripts run before the world steps. Without it a starting city's stable hand never
/// starts "Farm and feed" and starves on the farm (#1402).
struct Players {
    queues: QueueRunner,
    scripts: DefaultScripts,
}

/// The Players' order senders, by user id (`QueueHost`).
struct Senders(Vec<OrderSender>);

impl QueueHost for Senders {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        self.0.iter().find(|s| s.user_id == user_id).cloned()
    }
}

impl Players {
    fn new(terrain: &TerrainMap, users: &[u64]) -> Self {
        let terrain = Arc::new(terrain.clone());
        let senders: Vec<OrderSender> =
            users.iter().map(|&u| OrderSender::player(u, &format!("Player {u}"))).collect();
        let scripts = DefaultScripts::new(terrain.clone(), &senders);
        let queues =
            QueueRunner::new(Box::new(Senders(senders)), scripts.kinds.clone(), Some(terrain));
        Players { queues, scripts }
    }

    /// Moves the Players' queues on and runs their scripts, before the world steps.
    fn step(&mut self, world: &mut WorldState, scratch: &mut Scratch) {
        self.queues.run_all(world, scratch);
        assert_eq!(self.scripts.run_all(world, scratch), [], "tick {}", world.tick);
    }
}

/// Game days between checkpoints.
const CHECKPOINT_DAYS: usize = 30;

/// The runner the runs step `world` with, as a server that loads it does (`Game::new`): its
/// pathfinder finishes every search it is given, so a run comes out the same however busy the
/// machine is, and a run resumed from a checkpoint is the run that wrote it.
fn runner(world: &WorldState, terrain: &TerrainMap) -> Runner {
    let scratch = Scratch { waiting: Waiting::of(world), ..Scratch::default() };
    Runner { walking: super::unhurried_walking(terrain), scratch }
}

/// A world save as the server writes one (`saves::save_world`): gzipped JSON of the world.
fn world_save(world: &WorldState) -> Vec<u8> {
    use std::io::Write;
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(&serde_json::to_vec(world).expect("the world as JSON")).expect("gzip");
    gz.finish().expect("gzip")
}

fn world_from_save(save: &[u8]) -> WorldState {
    use std::io::Read;
    let mut json = Vec::new();
    flate2::read::GzDecoder::new(save).read_to_end(&mut json).expect("a gzipped save");
    serde_json::from_slice(&json).expect("a world save")
}

/// Where the year run writes its checkpoints: `GAME_YEAR_CHECKPOINTS`, else `target/game-year`.
fn checkpoint_dir() -> PathBuf {
    std::env::var_os("GAME_YEAR_CHECKPOINTS").map_or_else(
        || Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/game-year"),
        PathBuf::from,
    )
}

/// The watch saved beside a checkpoint's world.
fn watch_path(world: &Path) -> PathBuf {
    let name = world.file_name().and_then(|n| n.to_str()).expect("a checkpoint file name");
    world.with_file_name(name.replace(".world.json.gz", ".watch.json"))
}

/// Writes the world and the watch to `dir` as `day-NNN.world.json.gz` and `day-NNN.watch.json`.
fn write_checkpoint(dir: &Path, world: &WorldState, watch: &Watch) -> PathBuf {
    std::fs::create_dir_all(dir).expect("the checkpoint directory");
    let path = dir.join(format!("day-{:03}.world.json.gz", watch.day));
    std::fs::write(&path, world_save(world)).expect("a checkpoint");
    let json = serde_json::to_vec(watch).expect("the watch as JSON");
    std::fs::write(watch_path(&path), json).expect("the checkpoint's watch");
    path
}

/// A checkpoint's world and the watch beside it.
fn read_checkpoint(path: &Path) -> (WorldState, Watch) {
    let world = world_from_save(&std::fs::read(path).expect("a checkpoint"));
    let watch = std::fs::read(watch_path(path)).expect("the checkpoint's watch");
    (world, serde_json::from_slice(&watch).expect("a saved watch"))
}

/// Runs the world on to game day `to`, checking every invariant and what fails the run each game
/// day and saying how it goes every ten; with `checkpoints`, writes one there every
/// `CHECKPOINT_DAYS`.
fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    to: usize,
    watch: &mut Watch,
    mut players: Option<&mut Players>,
    checkpoints: Option<&Path>,
) {
    let mut runner = runner(world, terrain);
    let started = Instant::now();
    let mut trace = std::env::var("GAME_YEAR_TRACE")
        .ok()
        .map(|p| std::io::BufWriter::new(std::fs::File::create(p).expect("a trace file")));
    let who: Vec<String> = std::env::var("GAME_YEAR_WHO")
        .map(|ids| ids.split(',').map(str::to_string).collect())
        .unwrap_or_default();
    while watch.day < to {
        watch.day += 1;
        let day = watch.day;
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            if let Some(p) = players.as_deref_mut() {
                p.step(world, &mut runner.scratch);
            }
            let step = runner.step_with_result(world, terrain);
            let starved: Vec<_> = step.survival.died.clone();
            if let Some(t) = trace.as_mut() {
                trace_deaths(t, world, terrain, &starved);
                if world.tick.is_multiple_of(TRACE_WHO_TICKS) {
                    trace_who(t, world, &who);
                }
            }
            watch.tick(world, &starved);
        }
        watch.day(world);
        if let Some(t) = trace.as_mut() {
            trace_day(t, world, terrain, day);
            let _ = std::io::Write::flush(t);
        }
        let broken = check_all(world, terrain);
        // Who a broken invariant names: their city, when they were born and what they do.
        for id in broken.iter().flat_map(|v| &v.entity_ids) {
            if let Some(r) = world.residents.iter().find(|r| &r.id == id) {
                let job = r.city_id.as_ref().and_then(|c| world.city_plans.get(c)?.jobs.get(id));
                eprintln!(
                    "{id} {}: city {:?}, born day {:.0}, job {job:?}",
                    r.name,
                    r.city_id,
                    r.born_at / TICKS_PER_GAME_DAY
                );
            }
        }
        assert_eq!(broken, [], "day {day}");
        if let Some(failure) = watch.failure(world) {
            panic!("day {day}: {failure}");
        }
        if let Some(dir) = checkpoints.filter(|_| day.is_multiple_of(CHECKPOINT_DAYS)) {
            let path = write_checkpoint(dir, world, watch);
            eprintln!("day {day}: checkpoint {}", path.display());
        }
        if day.is_multiple_of(10) || day == to {
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

/// Ticks between two lines for each resident named in `GAME_YEAR_WHO`: a game hour.
const TRACE_WHO_TICKS: u64 = 60;

/// One line for each resident named in `GAME_YEAR_WHO` (ids, comma-separated), to
/// `GAME_YEAR_TRACE`: where they are, how fed, what they carry, their job and what they do.
fn trace_who(out: &mut impl std::io::Write, world: &WorldState, who: &[String]) {
    for id in who {
        let Some(r) = world.residents.iter().find(|r| &r.id == id) else { continue };
        let job = r.city_id.as_ref().and_then(|c| world.city_plans.get(c)?.jobs.get(id));
        let short = |s: String| s.chars().take(200).collect::<String>();
        let _ = writeln!(
            out,
            "t{} {id} at=({:.0},{:.0}) hunger={:.1} health={:.0} down={:?} carried={:?} \
             job={job:?} order={} script={}",
            world.tick,
            r.x,
            r.y,
            r.hunger,
            r.health,
            r.down_until,
            r.carried,
            short(format!("{:?}", r.order)),
            short(format!("{:?}", r.script)),
        );
    }
}

/// One line for each resident who starved this tick, to `GAME_YEAR_TRACE` if set: their city,
/// their job there, how far from its home they died, what they carried and what they were doing.
fn trace_deaths(
    out: &mut impl std::io::Write,
    world: &WorldState,
    terrain: &TerrainMap,
    died: &[csp_shared::world::Resident],
) {
    for r in died {
        let Some(city) = r.city_id.as_deref() else { continue };
        let job = world.city_plans.get(city).and_then(|p| p.jobs.get(&r.id));
        let from_home = crate::npc_behaviour::npc_home(world, city).map(|h| {
            wrap_distance(terrain.size, (h.x as i32, h.y as i32), (r.x as i32, r.y as i32))
        });
        let order = format!("{:?}", r.order);
        let _ = writeln!(
            out,
            "t{} died {} {city} job={job:?} from_home={from_home:?} at=({:.0},{:.0}) \
             carried={:?} order={}",
            world.tick,
            r.id,
            r.x,
            r.y,
            r.carried,
            order.chars().take(400).collect::<String>(),
        );
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
    let terrain = generate_terrain(SEED, SIZE);
    let terrain = &terrain;
    let (mut world, mut watch) = match std::env::var_os("GAME_YEAR_FROM") {
        Some(from) => {
            let (world, watch) = read_checkpoint(Path::new(&from));
            eprintln!("from day {}: {}", watch.day, Path::new(&from).display());
            (world, watch)
        }
        None => {
            let world = generate_world(terrain, SEED);
            let mut watch = Watch::new(&world);
            // An NPC city starving out, or the Trade Organization losing anyone to hunger, fails
            // the run on the day. An NPC city may lose one to hunger now and then (it is printed
            // at the end).
            watch.must_live = watch.npc_at_start.clone();
            watch.trade_org_fed = true;
            (world, watch)
        }
    };
    let npc_at_start: HashSet<String> = watch.npc_at_start.iter().cloned().collect();
    eprintln!(
        "{} NPC cities, {} caravans, {} wandering traders, {} residents",
        npc_at_start.len(),
        world.caravans.len(),
        world.traders.len(),
        world.residents.len()
    );
    let whole = (TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY) as usize;
    let days = days_to_run(whole);
    let dir = checkpoint_dir();
    eprintln!("checkpoints to {}", dir.display());
    run(&mut world, terrain, days, &mut watch, None, Some(&dir));

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
    // way (held each day too).
    for c in world.cities.iter().filter(|c| c.trade_org.is_some()) {
        assert_eq!(watch.starved.get(&c.id), None, "{} lost residents to hunger", c.id);
    }
    assert_eq!(watch.caravans_short(), Vec::<(&String, &usize)>::new());
    assert_eq!(watch.traders_short(&world), []);
    // Whether an NPC city founds a daughter in the year is printed above, not held to (#1379, its
    // open item): a party that sets out now gets there and founds one (#1438), but on this world
    // Larkspur, full but for its Stone from day 32, never gets a quarry (its project waits on a
    // smelter nobody builds), and the other cities stay short of Food or Wood. Founding is covered
    // by `big_city::on_a_map_with_room_founds_a_daughter_unaided_and_goes_on_feeding_itself`.
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
    // Both Players' cities live and lose nobody to hunger: either fails the run on the day.
    watch.must_live = cities.clone();
    watch.must_not_starve = cities.clone();
    let days = days_to_run(GAME_SEASON_DAYS);
    let mut players = Players::new(terrain, &[1, 2]);
    // No checkpoints: the Players' queues and scripts (`Players`) are not in the world save.
    run(&mut world, terrain, days, &mut watch, Some(&mut players), None);

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

/// A small world for the fast tests below, generated as for a new game: the Trade Organization's
/// HQ and a trading post, a caravan between them and a wandering trader. A map this small leaves
/// no room for the NPC cities the generator places on a bigger one, so an NPC village is founded
/// on a free starting site (as `rare_goods_tests` does).
fn small_world() -> (WorldState, TerrainMap) {
    use crate::npc_cities::{found_npc_city, give_npc_horses};
    use crate::random::Mulberry32;
    let terrain = generate_terrain(SEED, 1024);
    let mut world = generate_world(&terrain, SEED);
    let site = world
        .starting_sites
        .iter()
        .find(|s| s.city_id.is_none())
        .expect("a free starting site")
        .clone();
    let mut m = Mulberry32::new(7.0);
    let village = found_npc_city(
        &mut world,
        &terrain,
        &csp_shared::balance::NPC_VILLAGE,
        site.x,
        site.y,
        &mut || m.next(),
        None,
    );
    give_npc_horses(&mut world, &terrain, &village);
    assert!(!world.caravans.is_empty() && !world.traders.is_empty());
    (world, terrain)
}

/// Each top-level field of the world, by a hash of its JSON: two worlds are the same where these
/// are, and where they differ these name what.
fn fingerprint(world: &WorldState) -> BTreeMap<String, u64> {
    use std::hash::{Hash, Hasher};
    let serde_json::Value::Object(fields) = serde_json::to_value(world).expect("JSON") else {
        panic!("a world is a JSON object");
    };
    fields
        .into_iter()
        .map(|(k, v)| {
            let mut h = std::collections::hash_map::DefaultHasher::new();
            v.to_string().hash(&mut h);
            (k, h.finish())
        })
        .collect()
}

/// The fields of two fingerprints that differ.
fn differ(a: &BTreeMap<String, u64>, b: &BTreeMap<String, u64>) -> Vec<String> {
    let keys: HashSet<&String> = a.keys().chain(b.keys()).collect();
    let mut differ: Vec<String> =
        keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).cloned().collect();
    differ.sort();
    differ
}

/// The first few residents that differ between two worlds, with their fields that do: (id, field,
/// in one go, resumed).
fn residents_differ(a: &WorldState, b: &WorldState) -> Vec<(String, String, String, String)> {
    let mut out = Vec::new();
    for ra in &a.residents {
        let Some(rb) = b.residents.iter().find(|r| r.id == ra.id) else {
            out.push((ra.id.clone(), "(gone)".into(), String::new(), String::new()));
            continue;
        };
        let (serde_json::Value::Object(fa), serde_json::Value::Object(fb)) =
            (serde_json::to_value(ra).expect("JSON"), serde_json::to_value(rb).expect("JSON"))
        else {
            continue;
        };
        let keys: std::collections::BTreeSet<&String> = fa.keys().chain(fb.keys()).collect();
        for k in keys.into_iter().filter(|k| fa.get(*k) != fb.get(*k)) {
            let show = |v: Option<&serde_json::Value>| {
                let s = v.map_or("-".to_string(), |v| v.to_string());
                s.chars().take(300).collect::<String>()
            };
            out.push((ra.id.clone(), k.clone(), show(fa.get(k)), show(fb.get(k))));
        }
        if out.len() >= 6 {
            break;
        }
    }
    out
}

/// Ticks the resume test runs before the save, and on after it.
const RESUME_BEFORE: usize = 150;
const RESUME_AFTER: usize = 150;

#[test]
fn resuming_from_a_save_is_the_same_run() {
    let (mut world, terrain) = small_world();
    let mut r = runner(&world, &terrain);
    for _ in 0..RESUME_BEFORE {
        r.step(&mut world, &terrain);
    }
    let save = world_save(&world);

    // In one go: the same runner goes on.
    let mut went = Vec::with_capacity(RESUME_AFTER);
    for _ in 0..RESUME_AFTER {
        r.step(&mut world, &terrain);
        went.push(serde_json::to_vec(&world).expect("JSON"));
    }

    // From the save, as a server that restarts: a new runner and a world loaded from the save.
    let mut world = world_from_save(&save);
    let mut r = runner(&world, &terrain);
    for (t, then) in went.iter().enumerate() {
        r.step(&mut world, &terrain);
        if serde_json::to_vec(&world).expect("JSON") == *then {
            continue;
        }
        let then: WorldState = serde_json::from_slice(then).expect("a world");
        let differ = differ(&fingerprint(&then), &fingerprint(&world));
        let residents = residents_differ(&then, &world);
        panic!(
            "tick {} after the save (tick {}): {differ:?} differ; residents {residents:#?}",
            t + 1,
            world.tick
        );
    }
}

/// Every resident of `city` lies Down, about to die of hunger.
fn starving(world: &mut WorldState, city: &str) {
    let soon = world.tick as f64 + 5.0;
    for r in world.residents.iter_mut().filter(|r| r.city_id.as_deref() == Some(city)) {
        r.down_until = Some(soon);
    }
}

/// What a run of two game days from `world` fails with.
fn fails_with(mut world: WorldState, terrain: &TerrainMap, mut watch: Watch) -> String {
    let failed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run(&mut world, terrain, 2, &mut watch, None, None);
    }));
    let payload = failed.expect_err("the run fails");
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
        .expect("a message")
}

#[test]
fn an_npc_city_starving_out_fails_the_run_that_day() {
    let crate::npc_test_world::Village { mut world, terrain, city, .. } =
        crate::npc_test_world::village(None);
    let mut watch = Watch::new(&world);
    watch.must_live = watch.npc_at_start.clone();
    assert_eq!(watch.must_live, std::slice::from_ref(&city));
    starving(&mut world, &city);
    let failure = fails_with(world, &terrain, watch);
    assert!(failure.starts_with(&format!("day 1: {city} (")), "{failure}");
    assert!(failure.ends_with("starved out: nobody left"), "{failure}");
}

#[test]
fn the_trade_organization_losing_a_resident_to_hunger_fails_the_run_that_day() {
    let (mut world, terrain) = small_world();
    let mut watch = Watch::new(&world);
    watch.trade_org_fed = true;
    let hq = world.cities.iter().find(|c| c.trade_org.is_some()).expect("the HQ").id.clone();
    starving(&mut world, &hq);
    let failure = fails_with(world, &terrain, watch);
    assert!(failure.starts_with(&format!("day 1: {hq} (")), "{failure}");
    assert!(failure.ends_with("residents to hunger"), "{failure}");
}

#[test]
fn a_checkpoint_holds_the_world_and_what_the_run_counted() {
    let (world, _) = small_world();
    let mut watch = Watch::new(&world);
    watch.day = 30;
    watch.starved.insert("c1".into(), 2);
    let dir = std::env::temp_dir().join(format!("csp-checkpoint-{}", std::process::id()));
    let path = write_checkpoint(&dir, &world, &watch);
    assert!(path.ends_with("day-030.world.json.gz"), "{}", path.display());
    let (w, back) = read_checkpoint(&path);
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(differ(&fingerprint(&world), &fingerprint(&w)), Vec::<String>::new());
    assert_eq!(back.day, 30);
    assert_eq!(back.starved.get("c1"), Some(&2));
    assert_eq!(back.npc_at_start, watch.npc_at_start);
}
