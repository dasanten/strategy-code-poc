//! `npc-big-city.fixture.ts`: the staged big city, and what a run of it shows.

use std::collections::{BTreeMap, HashMap};

use csp_shared::balance::{
    ticks_for_age, NpcCitySize, HOUSING_ROOM, NPC_SURPLUS_CAP, NPC_TOWN, RECIPES,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, CityJobKind, CityLayout, Good, ResourceKind, WorldState,
};

use super::{add_node, add_workplace, unhurried_walking};
use crate::cities::update_city_membership;
use crate::city_layout::{layout_plan, GateAt};
use crate::npc_behaviour::npc_home;
use crate::npc_chain::own_workplaces;
use crate::npc_cities::{found_npc_city, taken_ground};
use crate::npc_test_world::{plains, Runner};
use crate::queries::city::city_residents;
use crate::queries::names::{kind_name, placed};
use crate::queries::npc_trade::{npc_reserve, npc_soldier_target};
use crate::queries::residents::{can_work, is_down};
use crate::random::{new_id, Mulberry32};
use crate::tick::Scratch;
use crate::world::create_world;

/// Residents of the staged city: about what production's big city has (`BIG_CITY_RESIDENTS`).
pub const BIG_CITY_RESIDENTS: f64 = 110.0;

/// Of them, children: not old enough to work for all of a 40-day run (`BIG_CITY_CHILDREN`).
const BIG_CITY_CHILDREN: usize = 14;

/// Tiles along each side of its wall: a town's, with its houses filling the inside.
const BIG_CITY_SIZE: f64 = NPC_TOWN.size;

/// The staged big city (`bigCity()`).
pub struct BigCity {
    pub world: WorldState,
    pub terrain: TerrainMap,
    pub city: String,
    /// Its home's id: its storage.
    pub home: String,
}

impl BigCity {
    pub fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the city")
    }

    pub fn home(&self) -> &Building {
        self.world.buildings.iter().find(|b| b.id == self.home).expect("the home")
    }

    pub fn home_mut(&mut self) -> &mut Building {
        let id = self.home.clone();
        self.world.buildings.iter_mut().find(|b| b.id == id).expect("the home")
    }
}

/// Puts up houses on its layout's spots, nearest its home first, until all its residents fit
/// (`buildHouses`).
fn build_houses(world: &mut WorldState, terrain: &TerrainMap, city: &str, home: &Building) {
    let c = world.cities.iter().find(|c| c.id == city).expect("the city").clone();
    let half = (BIG_CITY_SIZE / 2.0).floor() as i32;
    let plan = layout_plan(world, &c, home, Some(GateAt { dx: 0, dy: half }), terrain.size);
    let mut ground = taken_ground(world, terrain);
    let reach = half - 2;
    let (hx, hy) = (home.x as i32, home.y as i32);
    let mut spots = Vec::new();
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            spots.push((hx + dx, hy + dy, dx.abs().max(dy.abs())));
        }
    }
    // A stable sort, as `Array.prototype.sort`.
    spots.sort_by_key(|s| s.2);
    let room = HOUSING_ROOM.get("house").unwrap_or(1.0);
    let wanted = (BIG_CITY_RESIDENTS / room).ceil() as usize + 2;
    let mut houses = world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(city) && b.kind == BuildingKind::House)
        .count();
    for (x, y, _) in spots {
        if houses >= wanted {
            return;
        }
        if let Some(plan) = &plan {
            if !plan.spot(BuildingKind::House, x, y) {
                continue;
            }
        }
        let off = |tx: i32, ty: i32| plan.as_ref().is_none_or(|p| !p.street(tx, ty));
        if !ground.fits(BuildingKind::House, x, y, Some(&off)) {
            continue;
        }
        ground.take(BuildingKind::House, x, y);
        let id = new_id("b", &mut world.next_id);
        let house = crate::test_support::building(
            &id,
            BuildingKind::House,
            Some(city),
            f64::from(x),
            f64::from(y),
        );
        world.buildings.push(house);
        houses += 1;
    }
}

/// An NPC city of `BIG_CITY_RESIDENTS` alone on a Plains map of `map_size`, staged as production's
/// big city stood (ADR 0029): its soldiers armed, children among its residents, the farms it needs,
/// its whole chain built with a free node of each good for a second, and every good at its reserve
/// and half a village's surplus cap. Everyone starts free at home. With `layout` its houses follow
/// that one (`bigCity`).
pub fn big_city(layout: Option<CityLayout>, map_size: i32) -> BigCity {
    let mut terrain = plains(map_size);
    let mut world = create_world(&terrain, 1);
    let size =
        NpcCitySize { size: BIG_CITY_SIZE, residents: BIG_CITY_RESIDENTS, farms: 8.0, ..NPC_TOWN };
    let mut m = Mulberry32::new(29.0);
    let city = found_npc_city(&mut world, &terrain, &size, 60, 60, &mut || m.next(), None);
    if layout.is_some() {
        world.cities.iter_mut().find(|c| c.id == city).expect("the city").layout = layout;
    }
    let home = npc_home(&world, &city).expect("a home").clone();
    for (i, kind) in [BuildingKind::Smelter, BuildingKind::Smithy].into_iter().enumerate() {
        let (x, y) = (home.x + 6.0 + i as f64 * 4.0, home.y + 6.0);
        add_workplace(&mut world, &mut terrain, &city, kind, None, x, y);
    }
    build_houses(&mut world, &terrain, &city, &home);
    update_city_membership(&mut world, terrain.size);

    let east = 60.0 + BIG_CITY_SIZE + 14.0;
    for (i, (kind, resource)) in [
        (BuildingKind::LumberCamp, ResourceKind::Forest),
        (BuildingKind::Quarry, ResourceKind::Stone),
        (BuildingKind::Mine, ResourceKind::IronOre),
    ]
    .into_iter()
    .enumerate()
    {
        let y = 70.0 + i as f64 * 10.0;
        add_workplace(&mut world, &mut terrain, &city, kind, Some(resource), east, y);
    }
    for (i, kind) in
        [ResourceKind::Forest, ResourceKind::Stone, ResourceKind::IronOre].into_iter().enumerate()
    {
        add_node(&mut world, &mut terrain, kind, east + 10.0, 70.0 + i as f64 * 10.0);
    }

    let tick = world.tick as f64;
    let ids: Vec<String> = city_residents(&world, &city).iter().map(|r| r.id.clone()).collect();
    let children = &ids[ids.len().saturating_sub(BIG_CITY_CHILDREN)..];
    for r in world.residents.iter_mut().filter(|r| children.contains(&r.id)) {
        r.born_at = tick - ticks_for_age(5.0);
    }
    let adults: Vec<String> = world
        .residents
        .iter()
        .filter(|r| ids.contains(&r.id) && can_work(r.born_at, tick))
        .map(|r| r.id.clone())
        .collect();
    for r in world.residents.iter_mut().filter(|r| ids.contains(&r.id)) {
        (r.x, r.y, r.order, r.script) = (home.x, home.y, None, None);
    }
    let soldiers = npc_soldier_target(adults.len() as f64) as usize;
    for id in adults.iter().take(soldiers) {
        let r = world.residents.iter_mut().find(|r| &r.id == id).expect("an adult");
        r.carried.insert(Good::Spear, 1.0);
    }

    let c = world.cities.iter().find(|c| c.id == city).expect("the city");
    let reserve = npc_reserve(&world, c);
    let mut stock = reserve.clone();
    for (good, cap) in NPC_SURPLUS_CAP.0 {
        if *good == "goldOre" {
            continue;
        }
        let good: Good = serde_json::from_value(serde_json::json!(good)).expect("a good");
        stock.insert(good, reserve.get(&good).copied().unwrap_or(0.0) + (cap / 2.0).floor());
    }
    let home_id = home.id.clone();
    world.buildings.iter_mut().find(|b| b.id == home_id).expect("the home").stock = Some(stock);
    BigCity { world, terrain, city, home: home_id }
}

/// One count of the big city: who there is, what they're planned to do, who stands on the storage
/// (`BigCityCount`).
#[derive(Debug, Clone)]
pub struct BigCityCount {
    pub day: f64,
    pub residents: usize,
    pub adults: usize,
    pub on_storage: usize,
    /// Adults by the kind of their job in the last plan; `none` for one who has none yet.
    pub jobs: BTreeMap<String, usize>,
    /// Its finished workplaces by kind.
    pub places: BTreeMap<String, usize>,
}

fn job_name(kind: CityJobKind) -> String {
    serde_json::to_value(kind).expect("a job kind").as_str().expect("a name").to_string()
}

/// Counts the city as it stands (`countBigCity`).
pub fn count_big_city(s: &BigCity) -> BigCityCount {
    let world = &s.world;
    let tick = world.tick as f64;
    let home = s.home();
    let residents: Vec<_> =
        city_residents(world, &s.city).into_iter().filter(|r| !is_down(r.down_until)).collect();
    let adults: Vec<_> = residents.iter().filter(|r| can_work(r.born_at, tick)).collect();
    let planned = world.city_plans.get(&s.city);
    let mut jobs = BTreeMap::new();
    for r in &adults {
        let kind = planned
            .and_then(|p| p.jobs.get(&r.id))
            .map_or_else(|| "none".to_string(), |j| job_name(j.kind));
        *jobs.entry(kind).or_insert(0) += 1;
    }
    let mut places = BTreeMap::new();
    for b in own_workplaces(world, s.city()) {
        if b.site.is_none() {
            *places.entry(crate::queries::names::kind_name(b.kind).to_string()).or_insert(0) += 1;
        }
    }
    let size = s.terrain.size;
    let on_storage =
        residents.iter().filter(|r| is_at((r.x as i32, r.y as i32), placed(home), size)).count();
    BigCityCount {
        day: tick / TICKS_PER_GAME_DAY,
        residents: residents.len(),
        adults: adults.len(),
        on_storage,
        jobs,
        places,
    }
}

/// What a run of the big city reports: a count every `every_days`, and its planning time
/// (`BigCityRun`).
pub struct BigCityRun {
    pub counts: Vec<BigCityCount>,
    /// Time its planning took, in milliseconds per game hour.
    pub plan_ms_per_hour: f64,
}

/// Runs the world for `days` game days with unhurried walking, counting every `every_days`, and
/// calling `each_day` at the end of each game day and `each_tick` after each tick (`runBigCity`).
pub fn run_big_city(
    s: &mut BigCity,
    days: usize,
    every_days: usize,
    each_day: &mut dyn FnMut(&BigCity),
    each_tick: &mut dyn FnMut(&BigCity),
) -> BigCityRun {
    let mut runner = Runner { walking: unhurried_walking(&s.terrain), scratch: Scratch::default() };
    let mut counts = Vec::new();
    let mut ms = 0.0;
    for day in 1..=days {
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            let walking: &mut dyn crate::tick::Walk = &mut runner.walking;
            let stepped = crate::world::step_world(
                &mut s.world,
                &s.terrain,
                &mut runner.scratch,
                Some(walking),
                None,
            );
            ms += stepped.npc_plan_ms;
            each_tick(s);
        }
        if day % every_days == 0 {
            counts.push(count_big_city(s));
        }
        each_day(s);
    }
    BigCityRun { counts, plan_ms_per_hour: ms / (days * 24) as f64 }
}

/// A run as lines of text, for the log (`bigCityReport`).
pub fn big_city_report(run: &BigCityRun) -> String {
    let join = |m: &BTreeMap<String, usize>| {
        m.iter().map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join(", ")
    };
    let mut lines: Vec<String> = run
        .counts
        .iter()
        .map(|c| {
            format!(
                "day {}: {} residents, {} adults, {} on the storage; {}; built: {}",
                c.day,
                c.residents,
                c.adults,
                c.on_storage,
                join(&c.jobs),
                join(&c.places)
            )
        })
        .collect();
    let on: Vec<usize> = run.counts.iter().map(|c| c.on_storage).collect();
    let (least, most) = (on.iter().min().unwrap_or(&0), on.iter().max().unwrap_or(&0));
    lines.push(format!("on the storage: {least} to {most}"));
    lines.push(format!("planning: {:.2} ms per game hour", run.plan_ms_per_hour));
    lines.join("\n")
}

/// What the big city shows while it is watched (`BigCityHold`).
#[derive(Debug, Clone)]
pub struct BigCityHold {
    /// The most of its adults idle in any one plan, as a share of those it had then.
    pub idle_share: f64,
    /// The mean of that share over its plans.
    pub mean_idle_share: f64,
    /// The most of its adults, its soldiers aside, with no order and no script at any tick.
    pub still_share: f64,
    pub mean_still_share: f64,
    /// The longest anyone stood on its storage with no order and no script, in ticks; one fetching
    /// for their smelter or smithy isn't counted.
    pub longest_on_storage: usize,
    /// The job of whoever did: `child` for one too young for a job.
    pub longest_job: String,
    /// The most residents on its storage at any tick.
    pub most_on_storage: usize,
    /// Its planned farmers at the end of each game day.
    pub farmers: Vec<usize>,
    /// The biggest change in `farmers` from one game day to the next.
    pub farmer_swing: usize,
}

/// A watch of the big city from game day `from_day` on: whether it holds to its idle share
/// (`watchBigCity`). Call `tick` after every tick, then `hold`.
pub struct BigCityWatch {
    from_day: f64,
    shares: Vec<f64>,
    farmers: Vec<usize>,
    standing: HashMap<String, usize>,
    still_shares: f64,
    ticks: usize,
    still_share: f64,
    longest_on_storage: usize,
    longest_job: String,
    most_on_storage: usize,
    planned_at: Option<f64>,
}

impl BigCityWatch {
    pub fn new(from_day: f64) -> Self {
        BigCityWatch {
            from_day,
            shares: Vec::new(),
            farmers: Vec::new(),
            standing: HashMap::new(),
            still_shares: 0.0,
            ticks: 0,
            still_share: 0.0,
            longest_on_storage: 0,
            longest_job: "nobody".into(),
            most_on_storage: 0,
            planned_at: None,
        }
    }

    pub fn tick(&mut self, s: &BigCity) {
        let world = &s.world;
        let tick = world.tick as f64;
        if tick < self.from_day * TICKS_PER_GAME_DAY {
            return;
        }
        let plan = world.city_plans.get(&s.city);
        let job = |id: &str| plan.and_then(|p| p.jobs.get(id));
        let residents: Vec<_> =
            city_residents(world, &s.city).into_iter().filter(|r| !is_down(r.down_until)).collect();
        let adults: Vec<_> = residents.iter().filter(|r| can_work(r.born_at, tick)).collect();
        let count = |kind: CityJobKind| {
            adults.iter().filter(|r| job(&r.id).is_some_and(|j| j.kind == kind)).count()
        };
        if let Some(plan) = plan {
            if Some(plan.planned_at) != self.planned_at {
                self.planned_at = Some(plan.planned_at);
                self.shares.push(count(CityJobKind::Idle) as f64 / adults.len() as f64);
            }
        }
        if world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            self.farmers.push(count(CityJobKind::Farm));
        }
        let still = adults
            .iter()
            .filter(|r| {
                r.order.is_none()
                    && r.script.is_none()
                    && !job(&r.id).is_some_and(|j| {
                        matches!(
                            j.kind,
                            CityJobKind::Soldier | CityJobKind::Teach | CityJobKind::Train
                        )
                    })
            })
            .count();
        let share = still as f64 / adults.len() as f64;
        self.still_share = self.still_share.max(share);
        self.still_shares += share;
        self.ticks += 1;
        let fetching = |id: &str| {
            job(id)
                .and_then(|j| j.building_id.as_deref())
                .and_then(|b| world.buildings.iter().find(|x| x.id == b))
                .is_some_and(|place| RECIPES.get(kind_name(place.kind)).is_some())
        };
        let home = s.home();
        let size = s.terrain.size;
        let mut on = 0;
        for r in &residents {
            let here = is_at((r.x as i32, r.y as i32), placed(home), size);
            if here {
                on += 1;
            }
            if !here || r.order.is_some() || r.script.is_some() || fetching(&r.id) {
                self.standing.remove(&r.id);
                continue;
            }
            let stood = self.standing.get(&r.id).copied().unwrap_or(0) + 1;
            self.standing.insert(r.id.clone(), stood);
            if stood > self.longest_on_storage {
                self.longest_on_storage = stood;
                self.longest_job = if can_work(r.born_at, tick) {
                    job(&r.id).map_or_else(|| "none".to_string(), |j| job_name(j.kind))
                } else {
                    "child".into()
                };
            }
        }
        self.most_on_storage = self.most_on_storage.max(on);
    }

    pub fn hold(&self) -> BigCityHold {
        let farmers = self.farmers.clone();
        let farmer_swing = farmers.windows(2).map(|w| w[1].abs_diff(w[0])).max().unwrap_or(0);
        BigCityHold {
            idle_share: self.shares.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            mean_idle_share: self.shares.iter().sum::<f64>() / self.shares.len() as f64,
            still_share: self.still_share,
            mean_still_share: self.still_shares / self.ticks as f64,
            longest_on_storage: self.longest_on_storage,
            longest_job: self.longest_job.clone(),
            most_on_storage: self.most_on_storage,
            farmers,
            farmer_swing,
        }
    }
}

/// What a watch saw as lines of text, for the log (`bigCityHoldReport`).
pub fn big_city_hold_report(hold: &BigCityHold) -> String {
    let percent = |share: f64| format!("{:.1}%", share * 100.0);
    let farmers: Vec<String> = hold.farmers.iter().map(ToString::to_string).collect();
    [
        format!(
            "idle: at most {} of its adults, {} on average",
            percent(hold.idle_share),
            percent(hold.mean_idle_share)
        ),
        format!(
            "no order and no script, soldiers aside: at most {}, {} on average",
            percent(hold.still_share),
            percent(hold.mean_still_share)
        ),
        format!(
            "on the storage: at most {} at once; the longest anyone stood there {} ticks ({})",
            hold.most_on_storage, hold.longest_on_storage, hold.longest_job
        ),
        format!("farmers: {}; swing {}", farmers.join(", "), hold.farmer_swing),
    ]
    .join("\n")
}
