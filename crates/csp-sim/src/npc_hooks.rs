//! T1719 experiment (throwaway): what the core needs of the NPC modules, now in `csp-npc`. The types
//! it names live here; every function it calls is a hook `csp_npc::install` sets.

use std::collections::HashSet;
use std::sync::OnceLock;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, City, CityPlan, CityProject, CrimeKind, Demand, Good, Resident, ResidentOrder,
    RunningScript, Stance, Task, TradeOrgCity, WorldState,
};
use csp_shared::balance::NpcCitySize;
use serde_json::Value;

use crate::invariants::Invariant;
use crate::pathfinding::{PathResult, Point};
use crate::placing::Ground;
use crate::queries::city::town_hall_of;
use crate::residents::Rand;
use crate::sight::InvariantViolation;
use crate::walking::Walking;

pub use crate::starting_city::FARM_RING;

/// A good a city is short of (was `npc_chain::Shortage`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shortage {
    pub good: Good,
    pub share: f64,
}

/// Gear lent residents took along this tick (was `npc_hire::LentGear`).
#[derive(Debug, Clone, PartialEq)]
pub struct LentGear {
    pub contract_id: String,
    pub city_id: String,
    pub resident_id: String,
    pub good: Good,
    pub left: f64,
    pub reserve: f64,
}

/// What a road crew asks for a way (was `npc_roads::WayFinder`).
pub trait WayFinder {
    fn way(
        &mut self,
        key: &str,
        from: Point,
        to: Point,
        side: Option<&str>,
        area: Option<HashSet<usize>>,
    ) -> PathResult;
}

/// The way finder for one call, borrowed again from an optional one (as `tick::reborrow`).
pub fn reborrow<'s>(ways: &'s mut Option<&mut dyn WayFinder>) -> Option<&'s mut dyn WayFinder> {
    match ways {
        Some(w) => Some(&mut **w),
        None => None,
    }
}

impl WayFinder for Walking {
    fn way(
        &mut self,
        key: &str,
        from: Point,
        to: Point,
        side: Option<&str>,
        area: Option<HashSet<usize>>,
    ) -> PathResult {
        Walking::way(self, key, from, to, side, area)
    }
}

/// What `npc_site_fits` reads of the world besides the ground (was `npc_cities::SiteWorld`).
pub struct SiteWorld {
    pub halls: Vec<(f64, f64)>,
    pub players: Vec<(f64, f64)>,
    pub min_distance: f64,
}

impl SiteWorld {
    pub fn new(world: &WorldState) -> Self {
        SiteWorld {
            halls: world
                .cities
                .iter()
                .filter_map(|c| town_hall_of(world, c))
                .map(|h| (h.x, h.y))
                .collect(),
            players: world
                .residents
                .iter()
                .filter(|r| r.owner.is_some())
                .map(|r| (r.x, r.y))
                .collect(),
            min_distance: csp_shared::balance::NPC_CITY_MIN_DISTANCE,
        }
    }

    pub fn keeping(self, min_distance: f64) -> Self {
        SiteWorld { min_distance, ..self }
    }

    pub fn players_only(world: &WorldState) -> Self {
        SiteWorld { halls: Vec::new(), ..SiteWorld::new(world) }
    }
}

type InvariantDomains = Vec<(&'static str, &'static [Invariant])>;

/// Every NPC function the core calls.
pub struct NpcHooks {
    pub founding_party: fn(Option<&CityPlan>) -> Vec<String>,
    pub mother_fetch: fn(&WorldState, Option<&str>, &str) -> Option<csp_shared::world::Stock>,
    pub supplying_mother: for<'w> fn(&'w WorldState, &str) -> Option<&'w City>,
    pub hunting: fn(&WorldState, &Resident, &Resident) -> bool,
    pub walk_to: fn(&mut Resident, (f64, f64)),
    pub npc_home: for<'w> fn(&'w WorldState, &str) -> Option<&'w Building>,
    pub is_npc_order: fn(&ResidentOrder) -> bool,
    pub workplace_of: fn(&Resident) -> Option<String>,
    pub default_script: fn(Task, Value) -> RunningScript,
    pub note_crime_known: fn(&mut WorldState, &str, &str, CrimeKind),
    pub note_losses: fn(&mut WorldState, &[Resident], i32),
    pub npc_demand_ended: fn(&mut WorldState, &Demand, bool),
    pub plan_due: fn(&WorldState, &str) -> bool,
    pub marching_for: fn(&WorldState, &str, Option<&str>) -> Option<String>,
    pub reserve_lacks: fn(&WorldState, &City, Option<&CityProject>) -> Vec<Shortage>,
    pub chain_good: fn(&WorldState, &Building) -> Option<Good>,
    pub own_workplaces: for<'w> fn(&'w WorldState, &City) -> Vec<&'w Building>,
    pub trade_org_reserve: fn(&WorldState, &City) -> csp_shared::world::Stock,
    pub knows_node: fn(&City, (i32, i32), (i32, i32), i32) -> bool,
    pub scout_edge: fn(
        &WorldState,
        &City,
        &Resident,
        i32,
        &dyn Fn(i32, i32) -> bool,
        &[(i32, i32)],
    ) -> Option<(i32, i32)>,
    pub scout_ended: fn(&mut City, Option<&str>),
    pub soldiers_factor: fn(&City) -> f64,
    pub stance_of: fn(&City) -> Stance,
    pub wall_stone_set_aside: fn(&WorldState, &City) -> f64,
    pub found_npc_city:
        fn(&mut WorldState, &TerrainMap, &NpcCitySize, i32, i32, &mut Rand, Option<TradeOrgCity>) -> String,
    pub give_npc_horses: fn(&mut WorldState, &TerrainMap, &str),
    pub npc_site_fits_among:
        fn(&SiteWorld, &TerrainMap, &NpcCitySize, i32, i32, &Ground, bool) -> bool,
    pub taken_ground: for<'t> fn(&WorldState, &'t TerrainMap) -> Ground<'t>,
    pub house_tile: fn(
        &WorldState,
        &City,
        &Building,
        &TerrainMap,
        csp_shared::world::BuildingKind,
    ) -> Option<(i32, i32)>,
    pub attackers_of: fn(&WorldState, &City, i32) -> Vec<usize>,
    pub go_after_nearest: fn(&mut WorldState, usize, &[usize], &[usize], i32),
    pub step_npc_hunts: fn(&mut WorldState, i32),
    pub step_npc_take_nodes: fn(&mut WorldState, &TerrainMap),
    pub step_npc_acting_first: fn(&mut WorldState, i32),
    pub step_npc_retaliate: fn(&mut WorldState, i32),
    pub step_threat: fn(&mut WorldState, i32),
    pub step_stances: fn(&mut WorldState, i32),
    pub step_npc_demands: fn(&mut WorldState),
    pub step_npc_defence: fn(&mut WorldState, i32),
    pub step_npc_hire: fn(&mut WorldState, i32) -> Vec<LentGear>,
    pub step_npc_cities:
        fn(&mut WorldState, i32, Option<&TerrainMap>, Option<&mut dyn WayFinder>) -> f64,
    pub threat_sound: fn(&WorldState) -> Vec<InvariantViolation>,
    pub trade_org_breeds_no_horses: fn(&WorldState) -> Vec<InvariantViolation>,
    pub trade_org_sends_no_one: fn(&WorldState) -> Vec<InvariantViolation>,
    pub npc_invariants: fn() -> InvariantDomains,
}

static HOOKS: OnceLock<NpcHooks> = OnceLock::new();

/// Sets the hooks once; later calls keep the first.
pub fn install(hooks: NpcHooks) {
    let _ = HOOKS.set(hooks);
}

pub fn hooks() -> &'static NpcHooks {
    HOOKS.get().expect("NPC hooks not installed: call csp_npc::install()")
}

pub fn installed() -> bool {
    HOOKS.get().is_some()
}

macro_rules! forward {
    ($( $name:ident ( $($a:ident : $t:ty),* ) $(-> $r:ty)? ;)*) => {
        $( pub fn $name($($a: $t),*) $(-> $r)? { (hooks().$name)($($a),*) } )*
    };
}

forward! {
    founding_party(plan: Option<&CityPlan>) -> Vec<String>;
    mother_fetch(w: &WorldState, c: Option<&str>, s: &str) -> Option<csp_shared::world::Stock>;
    hunting(w: &WorldState, a: &Resident, t: &Resident) -> bool;
    walk_to(r: &mut Resident, to: (f64, f64));
    is_npc_order(o: &ResidentOrder) -> bool;
    workplace_of(r: &Resident) -> Option<String>;
    default_script(task: Task, memory: Value) -> RunningScript;
    note_crime_known(w: &mut WorldState, v: &str, c: &str, k: CrimeKind);
    note_losses(w: &mut WorldState, k: &[Resident], s: i32);
    npc_demand_ended(w: &mut WorldState, d: &Demand, p: bool);
    plan_due(w: &WorldState, c: &str) -> bool;
    marching_for(w: &WorldState, id: &str, c: Option<&str>) -> Option<String>;
    reserve_lacks(w: &WorldState, c: &City, p: Option<&CityProject>) -> Vec<Shortage>;
    chain_good(w: &WorldState, b: &Building) -> Option<Good>;
    trade_org_reserve(w: &WorldState, c: &City) -> csp_shared::world::Stock;
    knows_node(c: &City, h: (i32, i32), n: (i32, i32), s: i32) -> bool;
    scout_edge(w: &WorldState, c: &City, r: &Resident, s: i32, e: &dyn Fn(i32, i32) -> bool, k: &[(i32, i32)]) -> Option<(i32, i32)>;
    scout_ended(c: &mut City, r: Option<&str>);
    soldiers_factor(c: &City) -> f64;
    stance_of(c: &City) -> Stance;
    wall_stone_set_aside(w: &WorldState, c: &City) -> f64;
    found_npc_city(w: &mut WorldState, t: &TerrainMap, k: &NpcCitySize, x: i32, y: i32, r: &mut Rand, o: Option<TradeOrgCity>) -> String;
    give_npc_horses(w: &mut WorldState, t: &TerrainMap, c: &str);
    npc_site_fits_among(a: &SiteWorld, t: &TerrainMap, k: &NpcCitySize, x: i32, y: i32, g: &Ground, o: bool) -> bool;
    house_tile(w: &WorldState, c: &City, h: &Building, t: &TerrainMap, k: csp_shared::world::BuildingKind) -> Option<(i32, i32)>;
    attackers_of(w: &WorldState, c: &City, s: i32) -> Vec<usize>;
    go_after_nearest(w: &mut WorldState, i: usize, a: &[usize], o: &[usize], s: i32);
    step_npc_hunts(w: &mut WorldState, s: i32);
    step_npc_take_nodes(w: &mut WorldState, t: &TerrainMap);
    step_npc_acting_first(w: &mut WorldState, s: i32);
    step_npc_retaliate(w: &mut WorldState, s: i32);
    step_threat(w: &mut WorldState, s: i32);
    step_stances(w: &mut WorldState, s: i32);
    step_npc_demands(w: &mut WorldState);
    step_npc_defence(w: &mut WorldState, s: i32);
    step_npc_hire(w: &mut WorldState, s: i32) -> Vec<LentGear>;
    step_npc_cities(w: &mut WorldState, s: i32, t: Option<&TerrainMap>, ways: Option<&mut dyn WayFinder>) -> f64;
    threat_sound(w: &WorldState) -> Vec<InvariantViolation>;
    trade_org_breeds_no_horses(w: &WorldState) -> Vec<InvariantViolation>;
    trade_org_sends_no_one(w: &WorldState) -> Vec<InvariantViolation>;
    npc_invariants() -> InvariantDomains;
}

pub fn supplying_mother<'w>(world: &'w WorldState, daughter: &str) -> Option<&'w City> {
    (hooks().supplying_mother)(world, daughter)
}

pub fn npc_home<'w>(world: &'w WorldState, city_id: &str) -> Option<&'w Building> {
    (hooks().npc_home)(world, city_id)
}

pub fn own_workplaces<'w>(world: &'w WorldState, city: &City) -> Vec<&'w Building> {
    (hooks().own_workplaces)(world, city)
}

pub fn taken_ground<'t>(world: &WorldState, terrain: &'t TerrainMap) -> Ground<'t> {
    (hooks().taken_ground)(world, terrain)
}
