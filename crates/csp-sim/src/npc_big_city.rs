//! The staged big city of `npc-big-city.test.ts` (`npc-big-city.fixture.ts`) and that file's four
//! slow simulations (#1038). Test code only.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use csp_shared::balance::{
    ticks_for_age, NpcCitySize, HOUSING_ROOM, NPC_FOUND_PARTY_MOST, NPC_PLAN_TICKS,
    NPC_SURPLUS_CAP, NPC_TOWN, NPC_VILLAGE, RECIPES, WORKPLACE_MAX_WORKERS,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, CityJobKind, Good, ResourceKind, ResourceNode, Stock, WorldState,
};

use crate::cities::update_city_membership;
use crate::city_layout::{layout_plan, GateAt};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_chain::own_workplaces;
use crate::npc_cities::{found_npc_city, taken_ground};
use crate::npc_founding::founding_party;
use crate::npc_plan::farmers_wanted;
use crate::npc_test_world::plains;
use crate::queries::city::{stored_food, surplus_food_line};
use crate::queries::names::{held, kind_name, placed};
use crate::queries::npc_trade::{npc_reserve, npc_soldier_target};
use crate::queries::residents::{can_work, is_down};
use crate::random::{new_id, Mulberry32};
use crate::tick::{Scratch, Walk};
use crate::walking::Walking;
use crate::world::{create_world, step_world};

/// Residents of the staged city: about what production's big city has.
pub const BIG_CITY_RESIDENTS: f64 = 110.0;

/// Of them, children: not old enough to work for all of a 40-day run.
const BIG_CITY_CHILDREN: usize = 14;

/// Tiles along each side of its wall: a town's, with its houses filling the inside.
const BIG_CITY_SIZE: f64 = NPC_TOWN.size;

/// The first game day a city that started full of work has to show it has found its feet.
const HOLDS_FROM_DAY: f64 = 30.0;

/// The most of its adults idle from then on.
const MOST_IDLE_SHARE: f64 = 0.15;

/// The most ticks anyone stands on the storage with nothing to do.
const LONGEST_ON_STORAGE: f64 = NPC_PLAN_TICKS + 5.0;

/// The most its farmers may change from one game day to the next.
fn most_farmer_swing() -> f64 {
    (NPC_FOUND_PARTY_MOST / 4.0).ceil() + 1.0
}

/// How long the city with only the farms it would build is run (#995).
const FARMS_RUN_DAYS: usize = 40;

/// The last game day its Food may still be short of its reserve.
const FOOD_SHORT_UNTIL_DAY: f64 = 15.0;

/// The first game day its farmers are held to `most_farmer_swing`, the shortage behind it.
const FARMS_STEADY_FROM_DAY: f64 = 20.0;

/// The terrain a node of each kind lies on (`NODE_TERRAINS[kind][0]`).
fn node_terrain(kind: ResourceKind) -> Terrain {
    match kind {
        ResourceKind::Forest => Terrain::Forest,
        ResourceKind::Stone | ResourceKind::IronOre => Terrain::Hills,
        ResourceKind::GoldOre => Terrain::Mountain,
    }
}

/// The workplace that works a node of each kind (`NODE_WORKPLACE`).
fn node_workplace(kind: ResourceKind) -> BuildingKind {
    match kind {
        ResourceKind::Forest => BuildingKind::LumberCamp,
        ResourceKind::Stone => BuildingKind::Quarry,
        ResourceKind::IronOre | ResourceKind::GoldOre => BuildingKind::Mine,
    }
}

pub struct Staged {
    pub world: WorldState,
    pub terrain: TerrainMap,
    pub city: String,
    pub home: String,
}

impl Staged {
    pub fn home(&self) -> &Building {
        self.world.buildings.iter().find(|b| b.id == self.home).unwrap()
    }
    pub fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).unwrap()
    }
}

/// A finished workplace of `kind`, on a node of `resource` when it digs or cuts.
fn workplace(
    s: &mut Staged,
    at: (i32, i32),
    kind: BuildingKind,
    resource: Option<ResourceKind>,
) {
    if let Some(r) = resource {
        let id = new_id("n", &mut s.world.next_id);
        s.world.nodes.push(ResourceNode { id, kind: r, x: at.0 as f64, y: at.1 as f64 });
        s.terrain.tiles[tile_index(s.terrain.size, at.0, at.1)] = node_terrain(r) as u8;
    }
    let id = new_id("b", &mut s.world.next_id);
    let place: Building = serde_json::from_value(serde_json::json!({
        "id": id, "kind": kind, "cityId": null, "x": at.0, "y": at.1,
    }))
    .unwrap();
    s.world.buildings.push(place);
    let ci = s.world.cities.iter().position(|c| c.id == s.city).unwrap();
    s.world.cities[ci].workplace_ids.get_or_insert_with(Vec::new).push(id);
}

/// Puts up houses on its layout's spots, nearest its home first, until all its residents fit.
fn build_houses(s: &mut Staged) {
    let home = s.home().clone();
    let gate = GateAt { dx: 0, dy: (BIG_CITY_SIZE / 2.0).floor() as i32 };
    let plan = layout_plan(&s.world, s.city(), &home, Some(gate), s.terrain.size);
    let mut ground = taken_ground(&s.world, &s.terrain);
    let reach = (BIG_CITY_SIZE / 2.0).floor() as i32 - 2;
    let mut spots = Vec::new();
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            spots.push((home.x as i32 + dx, home.y as i32 + dy, dx.abs().max(dy.abs())));
        }
    }
    spots.sort_by_key(|s| s.2);
    let room = HOUSING_ROOM.get("house").unwrap_or(1.0);
    let wanted = (BIG_CITY_RESIDENTS / room).ceil() as usize + 2;
    let mut houses = s
        .world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(s.city.as_str()) && b.kind == BuildingKind::House)
        .count();
    let mut new = Vec::new();
    for (x, y, _) in spots {
        if houses >= wanted {
            break;
        }
        if let Some(p) = &plan {
            if !p.spot(BuildingKind::House, x, y) {
                continue;
            }
        }
        let off = |tx: i32, ty: i32| plan.as_ref().is_none_or(|p| !p.street(tx, ty));
        if !ground.fits(BuildingKind::House, x, y, Some(&off)) {
            continue;
        }
        ground.take(BuildingKind::House, x, y);
        new.push((x, y));
        houses += 1;
    }
    drop(ground);
    for (x, y) in new {
        let id = new_id("b", &mut s.world.next_id);
        let house: Building = serde_json::from_value(serde_json::json!({
            "id": id, "kind": "house", "cityId": s.city, "x": x, "y": y,
        }))
        .unwrap();
        s.world.buildings.push(house);
    }
}

/// An NPC city of `BIG_CITY_RESIDENTS` alone on a Plains map, staged as production's big city
/// stood (ADR 0029): its soldiers armed, children among its residents, the farms it needs, its
/// whole chain built with a free node of each good for a second, and every good at its reserve and
/// half a village's surplus cap. Everyone starts free at home (`bigCity`).
pub fn big_city(map_size: i32) -> Staged {
    let terrain = plains(map_size);
    let mut world = create_world(&terrain, 1);
    let size = NpcCitySize {
        size: BIG_CITY_SIZE,
        residents: BIG_CITY_RESIDENTS,
        farms: 8.0,
        ..NPC_TOWN
    };
    let mut m = Mulberry32::new(29.0);
    let city = found_npc_city(&mut world, &terrain, &size, 60, 60, &mut || m.next(), None);
    let home = npc_home(&world, &city).unwrap().id.clone();
    let mut s = Staged { world, terrain, city, home };
    let (hx, hy) = (s.home().x as i32, s.home().y as i32);
    for (i, kind) in [BuildingKind::Smelter, BuildingKind::Smithy].into_iter().enumerate() {
        workplace(&mut s, (hx + 6 + i as i32 * 4, hy + 6), kind, None);
    }
    build_houses(&mut s);
    let map = s.terrain.size;
    update_city_membership(&mut s.world, map);

    let east = 60 + BIG_CITY_SIZE as i32 + 14;
    use ResourceKind::{Forest, IronOre, Stone};
    for (y, r) in [(70, Forest), (80, Stone), (90, IronOre)] {
        workplace(&mut s, (east, y), node_workplace(r), Some(r));
    }
    for (i, r) in [Forest, Stone, IronOre].into_iter().enumerate() {
        let at = (east + 10, 70 + i as i32 * 10);
        let id = new_id("n", &mut s.world.next_id);
        s.world.nodes.push(ResourceNode { id, kind: r, x: at.0 as f64, y: at.1 as f64 });
        s.terrain.tiles[tile_index(map, at.0, at.1)] = node_terrain(r) as u8;
    }

    let tick = s.world.tick as f64;
    let residents: Vec<usize> = s
        .world
        .residents
        .iter()
        .enumerate()
        .filter(|(_, r)| r.city_id.as_deref() == Some(s.city.as_str()))
        .map(|(i, _)| i)
        .collect();
    for &i in &residents[residents.len() - BIG_CITY_CHILDREN..] {
        s.world.residents[i].born_at = tick - ticks_for_age(5.0);
    }
    let adults: Vec<usize> =
        residents.iter().copied().filter(|&i| can_work(s.world.residents[i].born_at, tick)).collect();
    let (x, y) = (s.home().x, s.home().y);
    for &i in &residents {
        let r = &mut s.world.residents[i];
        r.x = x;
        r.y = y;
        r.order = None;
        r.script = None;
    }
    for &i in adults.iter().take(npc_soldier_target(adults.len() as f64) as usize) {
        s.world.residents[i].carried.insert(Good::Spear, 1.0);
    }

    let reserve = npc_reserve(&s.world, s.city());
    let mut stock: Stock = reserve.clone();
    for (name, cap) in NPC_SURPLUS_CAP.0 {
        if *name == "goldOre" {
            continue;
        }
        let good: Good = serde_json::from_value(serde_json::json!(name)).unwrap();
        stock.insert(good, held(&reserve, good) + (cap / 2.0).floor());
    }
    let hi = s.world.buildings.iter().position(|b| b.id == s.home).unwrap();
    s.world.buildings[hi].stock = Some(stock);
    s
}

/// One count of the big city (`BigCityCount`).
#[derive(Debug)]
pub struct Count {
    pub day: f64,
    pub residents: usize,
    pub adults: usize,
    pub on_storage: usize,
    pub jobs: BTreeMap<String, usize>,
    pub places: BTreeMap<String, usize>,
}

fn job_name(k: CityJobKind) -> String {
    serde_json::to_value(k).unwrap().as_str().unwrap().to_string()
}

/// Counts the city as it stands (`countBigCity`).
pub fn count(s: &Staged) -> Count {
    let tick = s.world.tick as f64;
    let residents: Vec<_> = s
        .world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(s.city.as_str()) && !is_down(r.down_until))
        .collect();
    let adults: Vec<_> = residents.iter().filter(|r| can_work(r.born_at, tick)).collect();
    let planned = s.world.city_plans.get(&s.city).map(|p| p.jobs.clone()).unwrap_or_default();
    let mut jobs = BTreeMap::new();
    for r in &adults {
        let kind = planned.get(&r.id).map_or("none".to_string(), |j| job_name(j.kind));
        *jobs.entry(kind).or_insert(0) += 1;
    }
    let mut places = BTreeMap::new();
    for b in own_workplaces(&s.world, s.city()) {
        if b.site.is_none() {
            *places.entry(kind_name(b.kind).to_string()).or_insert(0) += 1;
        }
    }
    let home = placed(s.home());
    let size = s.terrain.size;
    Count {
        day: tick / TICKS_PER_GAME_DAY,
        residents: residents.len(),
        adults: adults.len(),
        on_storage: residents.iter().filter(|r| is_at((r.x as i32, r.y as i32), home, size)).count(),
        jobs,
        places,
    }
}

/// Walking whose pathfinder finishes every search it is given (`unhurriedWalking`), so a run of
/// the same code always comes out the same.
pub struct Unhurried(pub Walking);

impl Unhurried {
    pub fn new(terrain: &TerrainMap) -> Self {
        Unhurried(Walking::new(Arc::new(terrain.clone())))
    }
}

impl Walk for Unhurried {
    fn walk(&mut self, world: &mut WorldState, scratch: &mut Scratch) -> usize {
        let steps = self.0.request_steps(world, scratch, f64::INFINITY);
        self.0.resolve(world, scratch, &steps);
        steps.len()
    }

    fn ways(&mut self) -> Option<&mut dyn crate::npc_roads::WayFinder> {
        Some(&mut self.0)
    }
}

/// Runs the world for `days` game days, counting every `every_days`, and calling `each_day` at the
/// end of each game day and `each_tick` after each tick (`runBigCity`).
pub fn run(
    s: &mut Staged,
    days: usize,
    every_days: usize,
    mut each_day: impl FnMut(&Staged),
    mut each_tick: impl FnMut(&Staged),
) -> Vec<Count> {
    let terrain = s.terrain.clone();
    let mut walking = Unhurried(Walking::new(Arc::new(terrain.clone())));
    let mut scratch = Scratch::default();
    let mut counts = Vec::new();
    for day in 1..=days {
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            step_world(&mut s.world, &terrain, &mut scratch, Some(&mut walking), None);
            each_tick(s);
        }
        if day % every_days == 0 {
            counts.push(count(s));
        }
        each_day(s);
    }
    counts
}

/// What the big city shows while it is watched (`BigCityHold`).
#[derive(Debug, Default)]
pub struct Hold {
    pub idle_share: f64,
    pub longest_on_storage: f64,
    pub farmer_swing: f64,
    pub farmers: Vec<usize>,
}

/// Watches the big city from game day `from_day` on (`watchBigCity`).
#[derive(Default)]
pub struct Watch {
    from_day: f64,
    shares: Vec<f64>,
    farmers: Vec<usize>,
    standing: HashMap<String, f64>,
    longest_on_storage: f64,
    planned_at: Option<f64>,
}

impl Watch {
    pub fn new(from_day: f64) -> Self {
        Watch { from_day, ..Watch::default() }
    }

    pub fn tick(&mut self, s: &Staged) {
        let w = &s.world;
        if (w.tick as f64) < self.from_day * TICKS_PER_GAME_DAY {
            return;
        }
        let tick = w.tick as f64;
        let plan = w.city_plans.get(&s.city);
        let jobs = plan.map(|p| p.jobs.clone()).unwrap_or_default();
        let residents: Vec<_> = w
            .residents
            .iter()
            .filter(|r| r.city_id.as_deref() == Some(s.city.as_str()) && !is_down(r.down_until))
            .collect();
        let adults: Vec<_> = residents.iter().filter(|r| can_work(r.born_at, tick)).collect();
        let count = |kind: CityJobKind| {
            adults.iter().filter(|r| jobs.get(&r.id).is_some_and(|j| j.kind == kind)).count()
        };
        if let Some(p) = plan {
            if Some(p.planned_at) != self.planned_at {
                self.planned_at = Some(p.planned_at);
                self.shares.push(count(CityJobKind::Idle) as f64 / adults.len() as f64);
            }
        }
        if w.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            self.farmers.push(count(CityJobKind::Farm));
        }
        let fetching = |id: &str| {
            let place = jobs.get(id).and_then(|j| j.building_id.as_ref());
            let place = place.and_then(|p| w.buildings.iter().find(|b| &b.id == p));
            place.is_some_and(|b| RECIPES.get(kind_name(b.kind)).is_some())
        };
        let home = placed(s.home());
        for r in &residents {
            let here = is_at((r.x as i32, r.y as i32), home, s.terrain.size);
            if !here || r.order.is_some() || r.script.is_some() || fetching(&r.id) {
                self.standing.remove(&r.id);
                continue;
            }
            let stood = self.standing.get(&r.id).copied().unwrap_or(0.0) + 1.0;
            self.standing.insert(r.id.clone(), stood);
            self.longest_on_storage = self.longest_on_storage.max(stood);
        }
    }

    pub fn hold(&self) -> Hold {
        let swing = self
            .farmers
            .windows(2)
            .map(|w| (w[1] as f64 - w[0] as f64).abs())
            .fold(0.0, f64::max);
        Hold {
            idle_share: self.shares.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            longest_on_storage: self.longest_on_storage,
            farmer_swing: swing,
            farmers: self.farmers.clone(),
        }
    }
}

pub fn sound(s: &Staged) {
    assert_eq!(check_all(&s.world, &s.terrain), []);
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    #[test]
    #[ignore = "timed in the PR"]
    fn with_no_room_and_no_warehouse_keeps_its_storage_clear_and_reports_its_jobs() {
        let mut s = big_city(240);
        let watch = RefCell::new(Watch::new(HOLDS_FROM_DAY));
        let counts = run(&mut s, 40, 5, sound, |s| watch.borrow_mut().tick(s));
        let hold = watch.borrow().hold();
        println!("{counts:#?}\n{hold:?}");
        assert_eq!(counts.len(), 8);
        assert!(hold.longest_on_storage <= LONGEST_ON_STORAGE, "{hold:?}");
        // Needs grow with the city: at most a second of each workplace on a node, and no more
        // farms than it was staged with, which is more than it needs.
        let places = &counts.last().unwrap().places;
        assert_eq!(places.get("farm"), Some(&8));
        for kind in ["lumberCamp", "quarry", "mine"] {
            assert_eq!(places.get(kind), Some(&2), "{kind}: {places:?}");
        }
    }

    struct Roomy {
        set_out: Option<f64>,
        party: Vec<String>,
        moved: Option<(f64, usize)>,
        kept_food: f64,
        kept_food_line: f64,
        hold: Hold,
    }

    /// The big city on a map with room, run to game day 40, and what it did about its first
    /// daughter (`roomyRun`).
    fn roomy_run() -> Roomy {
        let mut s = big_city(1300);
        let mut watch = Watch::new(HOLDS_FROM_DAY);
        let mut r = Roomy {
            set_out: None,
            party: Vec::new(),
            moved: None,
            kept_food: f64::INFINITY,
            kept_food_line: 0.0,
            hold: Hold::default(),
        };
        // Nothing is held for it: its scouts and road crew go out with Food and its crew lays
        // roads.
        run(&mut s, 40, 5, sound, |s| {
            watch.tick(s);
            if r.moved.is_some() {
                return;
            }
            let day = s.world.tick as f64 / TICKS_PER_GAME_DAY;
            let now = founding_party(s.world.city_plans.get(&s.city));
            if r.set_out.is_none() && !now.is_empty() {
                r.set_out = Some(day);
                r.party = now;
            }
            if r.set_out.is_some() {
                r.kept_food = r.kept_food.min(stored_food(&s.world, s.city()));
                r.kept_food_line = surplus_food_line(&s.world, s.city());
            }
            let daughter = s
                .world
                .cities
                .iter()
                .find(|c| c.id != s.city && c.realm_id.is_none() && c.trade_org.is_none());
            let people = daughter.map_or(0, |d| {
                s.world.residents.iter().filter(|x| x.city_id.as_deref() == Some(&d.id)).count()
            });
            if people > 0 {
                r.moved = Some((day, people));
            }
        });
        r.hold = watch.hold();
        r
    }

    /// One run of 40 game days for both of these: it takes minutes.
    fn roomy() -> &'static Roomy {
        static RUN: std::sync::OnceLock<std::sync::Mutex<Option<&'static Roomy>>> =
            std::sync::OnceLock::new();
        let cell = RUN.get_or_init(|| std::sync::Mutex::new(None));
        let mut seen = cell.lock().unwrap();
        *seen.get_or_insert_with(|| Box::leak(Box::new(roomy_run())))
    }

    #[test]
    #[ignore = "timed in the PR"]
    fn founds_a_daughter_unaided_and_goes_on_feeding_itself() {
        let r = roomy();
        println!("party of {} set out on day {:?}, moved {:?}", r.party.len(), r.set_out, r.moved);
        assert!(r.set_out.is_some());
        assert!(r.party.len() as f64 > NPC_VILLAGE.residents);
        assert_eq!(r.moved.map(|m| m.1), Some(r.party.len()));
        // What it gave the party leaves it Food enough: never short of a surplus for those who
        // stayed.
        assert!(r.kept_food > r.kept_food_line, "{} of {}", r.kept_food, r.kept_food_line);
    }

    #[test]
    #[ignore = "timed in the PR"]
    fn holds_its_idle_share_keeps_its_storage_clear_and_its_farmers_steady() {
        let hold = &roomy().hold;
        println!("{hold:?}");
        assert!(hold.idle_share <= MOST_IDLE_SHARE, "{hold:?}");
        assert!(hold.longest_on_storage <= LONGEST_ON_STORAGE, "{hold:?}");
        assert!(hold.farmer_swing <= most_farmer_swing(), "{hold:?}");
    }

    #[test]
    #[ignore = "timed in the PR"]
    fn with_only_the_farms_it_would_build_opens_more_until_food_is_no_longer_short_995() {
        let mut s = big_city(1300);
        let farms: Vec<String> = s
            .world
            .buildings
            .iter()
            .filter(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(s.city.as_str()))
            .map(|b| b.id.clone())
            .collect();
        let per_farm = WORKPLACE_MAX_WORKERS.get("farm").unwrap_or(1.0);
        let kept = (farmers_wanted(&s.world, s.city()) / per_farm).ceil() as usize;
        s.world.buildings.retain(|b| !farms[kept..].contains(&b.id));
        let watch = RefCell::new(Watch::new(FARMS_STEADY_FROM_DAY));
        let short_until = RefCell::new(0.0);
        run(
            &mut s,
            FARMS_RUN_DAYS,
            5,
            |s| {
                sound(s);
                let day = s.world.tick as f64 / TICKS_PER_GAME_DAY;
                let food = s.home().stock.as_ref().map_or(0.0, |st| held(st, Good::Food));
                let reserve = held(&npc_reserve(&s.world, s.city()), Good::Food);
                if food < reserve {
                    *short_until.borrow_mut() = day;
                }
            },
            |s| watch.borrow_mut().tick(s),
        );
        let hold = watch.borrow().hold();
        let short_until = *short_until.borrow();
        println!("Food short until day {short_until}\n{hold:?}");
        assert!(short_until <= FOOD_SHORT_UNTIL_DAY, "short until day {short_until}");
        assert!(hold.farmer_swing <= most_farmer_swing(), "{hold:?}");
    }
}
