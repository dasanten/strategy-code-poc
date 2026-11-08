//! A new world and one step of it (`apps/server/src/world.ts`, ADR 0002): `create_world`, the
//! nearest free tile, and `step_world` with `step_rest`, every rule of a tick in its order.
//!
//! **The step is a skeleton the rule tickets fill (Epic 86).** Each rule is called here in the
//! TypeScript's order by its TypeScript name in Rust spelling, and each is, for now, a no-op stub
//! at the bottom of this file. A ticket that ports a rule deletes its stub and adds a `use` of
//! its module; it may change the arguments of its own call line (each stub takes what the
//! TypeScript passes, plus the tick's [`Scratch`]), and adds the field of [`StepResult`] it
//! returns (`survival`, `combat`, `horses_died`, `aging`, `captures`). Nothing else here needs to
//! change.

use std::collections::HashSet;

use csp_shared::terrain::{is_passable_terrain, terrain_at, wrap, TerrainMap};
use csp_shared::world::WorldState;

use crate::aging::{step_aging, AgingResult};
use crate::building::{request_building, resolve_building};
use crate::node_gen::place_resource_nodes;
use crate::spoilage::step_spoilage;
use crate::stock_floor::step_stock_floor;
use crate::survival::{keep_down_still, step_refill, step_survival, SurvivalResult};
use crate::teaching::step_teaching;
use crate::teardown::{request_tearing_down, resolve_tearing_down, Felled};
use crate::tick::{reborrow, Scratch, TickPhase, TickTimer, Walk};
use crate::training::step_training;
use crate::work::{request_work, resolve_work};

/// How many breaking changes to the script views there are so far (`SCRIPT_VIEW_CHANGES.length`).
// TODO(T86.12): `SCRIPT_VIEW_CHANGES.len()` once the script views are ported.
const SCRIPT_VIEW_CHANGES_LEN: f64 = 1.0;

/// A new world (`createWorld`): terrain's resource nodes and nobody yet. Each Player gets a realm
/// and starting city when they first connect (`foundStartingCity`).
pub fn create_world(terrain: &TerrainMap, seed: i64) -> WorldState {
    WorldState {
        tick: 0,
        seed,
        next_id: 1,
        residents: Vec::new(),
        nodes: place_resource_nodes(terrain, seed),
        realms: Vec::new(),
        cities: Vec::new(),
        buildings: Vec::new(),
        horses: Vec::new(),
        carriages: Vec::new(),
        piles: Vec::new(),
        events: Vec::new(),
        alliances: Vec::new(),
        armies: Vec::new(),
        contracts: Vec::new(),
        demands: Vec::new(),
        caravans: Vec::new(),
        traders: Vec::new(),
        deliveries: Vec::new(),
        transfers: Vec::new(),
        offers: Vec::new(),
        route_robberies: Default::default(),
        crimes: Vec::new(),
        standings: Vec::new(),
        join_requests: Vec::new(),
        punishments: Vec::new(),
        supply_wagons: Vec::new(),
        directives: Vec::new(),
        debts: Vec::new(),
        last_seen: Default::default(),
        // A new world's Players have nothing to be told of changes before it.
        script_view_changes: SCRIPT_VIEW_CHANGES_LEN,
        horse_offers_claimed: Vec::new(),
        waypoints: Default::default(),
        city_plans: Default::default(),
        workplace_settings: Default::default(),
    }
}

/// A world as the world generator makes it for a new game (`generateWorld`): `create_world`,
/// with the Trade Org HQ (`place_trade_org_hq`), its NPC cities (`place_npc_cities`) and then its
/// trading posts placed (`place_trading_posts`), with a caravan for each (`place_caravans`) and
/// wandering traders going round them (`place_traders`).
pub fn generate_world(terrain: &TerrainMap, seed: i64) -> WorldState {
    let mut world = create_world(terrain, seed);
    place_trade_org_hq(&mut world, terrain);
    place_npc_cities(&mut world, terrain);
    place_trading_posts(&mut world, terrain);
    place_caravans(&mut world);
    place_traders(&mut world, terrain.size);
    world
}

/// Whether a tile's terrain can be walked on (`isWalkable`).
pub fn is_walkable(terrain: &TerrainMap, x: i32, y: i32) -> bool {
    is_passable_terrain(terrain_at(terrain, x, y))
}

/// The walkable tile not in `occupied` closest to (x, y), searching outwards ring by ring across
/// the map's joins (`nearestFreeTile`). Panics if the whole map is full, which a real map never
/// is.
pub fn nearest_free_tile(
    terrain: &TerrainMap,
    occupied: &HashSet<(i32, i32)>,
    x: i32,
    y: i32,
) -> (i32, i32) {
    let free = |tx: i32, ty: i32| is_walkable(terrain, tx, ty) && !occupied.contains(&(tx, ty));
    for r in 0..terrain.size {
        for dy in -r..=r {
            for dx in -r..=r {
                if dx.abs().max(dy.abs()) != r {
                    continue;
                }
                let (tx, ty) = (wrap(x + dx, terrain.size), wrap(y + dy, terrain.size));
                if free(tx, ty) {
                    return (tx, ty);
                }
            }
        }
    }
    panic!("no free walkable tile left on the map")
}

/// What one step of the world did (`StepResult`). The rule tickets add their results here
/// (`survival`, `combat`, `horses_died`, `aging`, `captures`) as they port them.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StepResult {
    /// Actions requested this tick.
    pub actions: usize,
    /// Milliseconds the game-run cities spent planning (`planCity`; ADR 0016).
    pub npc_plan_ms: f64,
    /// The NPC cities' residents' scripts that ran this tick (`runNpcScripts`), for tick health.
    pub npc_script_runs: usize,
    /// Milliseconds spent noting who came into a City area (`stepOutsiders`), for tick health.
    pub outsiders_ms: f64,
    /// What survival did (`survival`): who died of hunger, which realms ended.
    pub survival: SurvivalResult,
    /// What aging did (`aging`): who died of old age, which realms ended, who grew up.
    pub aging: AgingResult,
}

/// Advances the world by one tick (`stepWorld`, ADR 0002): survival, horses, spoilage and the
/// stock floor; then the game's own cities, caravans, traders and armies give their residents
/// orders and the NPC scripts run; then everyone walks; then everything else they do and the
/// tick turns (`step_rest`); then Last seen; last, riders and passengers who lost their mount or
/// carriage get off and whatever anyone Down was given ends. The full order, rule by rule, is the
/// TypeScript's doc comment on `stepWorld`. Without `walking` nobody moves. With a `timer`, the
/// NPC planning (`Npc`), the walking (`Walking`), Last seen (`LastSeen`) and all the rest
/// (`Rest`) are timed as the parts of the tick's `World` phase (ADR 0004).
pub fn step_world(
    world: &mut WorldState,
    terrain: &TerrainMap,
    scratch: &mut Scratch,
    mut walking: Option<&mut dyn Walk>,
    timer: Option<&TickTimer>,
) -> StepResult {
    fn time<T>(timer: Option<&TickTimer>, phase: TickPhase, f: impl FnOnce() -> T) -> T {
        match timer {
            Some(t) => t.time(phase, f),
            None => f(),
        }
    }
    let size = terrain.size;
    // What the scripts saw is gone once the world steps (`SightCache`).
    scratch.new_sight_phase();
    let survival = time(timer, TickPhase::Rest, || {
        let survival = step_survival(world, terrain, scratch);
        step_horses(world, terrain, scratch);
        step_spoilage(world);
        step_stock_floor(world, &mut scratch.made);
        survival
    });
    let mut npc_plan_ms = 0.0;
    let npc_script_runs = time(timer, TickPhase::Npc, || {
        step_caravans(world, size, scratch);
        step_traders(world, size, terrain, scratch);
        step_npc_defence(world, size, scratch);
        step_trade_org_army(world, size, scratch);
        step_npc_hire(world, size, scratch);
        step_punishments(world, size, scratch);
        npc_plan_ms = step_npc_cities(world, size, terrain, reborrow(&mut walking), scratch);
        let runs = run_npc_scripts(world, terrain, scratch);
        // Whatever the game's own cities gave someone Down ends before they act on it.
        keep_down_still(world);
        runs
    });
    let steps = time(timer, TickPhase::Walking, || match reborrow(&mut walking) {
        Some(w) => w.walk(world, scratch),
        None => 0,
    });
    let result = time(timer, TickPhase::Rest, || step_rest(world, terrain, scratch, steps));
    time(timer, TickPhase::LastSeen, || {
        // Who sees what has changed since the NPC scripts ran: Last seen and sync share the new
        // sight (`SightCache`). Nobody moves or changes hands after this.
        scratch.new_sight_phase();
        step_last_seen(world, size, scratch);
    });
    time(timer, TickPhase::Rest, || {
        step_riders(world, scratch);
        step_passengers(world, scratch);
        // A fight or an army may have given someone Down an order; it ends with the tick.
        keep_down_still(world);
    });
    StepResult { npc_script_runs, npc_plan_ms, survival, ..result }
}

/// The rest of `step_world` once the residents walked (`stepRest`): everything else they do,
/// then the tick turns, up to Last seen. `steps` is how many steps the walking requested.
fn step_rest(
    world: &mut WorldState,
    terrain: &TerrainMap,
    scratch: &mut Scratch,
    steps: usize,
) -> StepResult {
    let size = terrain.size;
    // Relocating residents who stepped into their new city's area move in (`CONTEXT.md`:
    // Relocate).
    step_relocating(world, terrain, scratch);
    let strikes = request_strikes(world, size, scratch);
    let strikes_len = strikes.len();
    resolve_strikes(world, strikes, size, scratch);
    let climbs = request_climbing(world, scratch);
    let climbs_len = climbs.len();
    resolve_climbing(world, climbs, terrain, scratch);
    let mut carries = request_carrying(world, scratch);
    carries.extend(request_storing(world, scratch));
    carries.extend(request_hauling(world, size, scratch));
    carries.extend(request_road_materials(world, scratch));
    let carries_len = carries.len();
    resolve_carrying(world, carries, size, scratch);
    step_feeding(world, size, scratch);
    let payments = resolve_payments(world, scratch);
    let purchases = resolve_purchases(world, size, scratch);
    let trades = resolve_trades(world, size, scratch);
    let accepted = resolve_offers(world, scratch);
    let buy_offs = resolve_buy_offs(world, scratch);
    let debts_paid = resolve_debt_payments(world, scratch);
    let builds = request_building(world);
    let builds_len = builds.len();
    resolve_building(world, &builds, Some(terrain));
    let teardowns = request_tearing_down(world);
    let teardowns_len = teardowns.len();
    let wrecked = resolve_tearing_down(world, &teardowns, Some(terrain), scratch);
    count_wrecked(world, wrecked, scratch);
    let work = request_work(world);
    let work_len = work.len();
    resolve_work(world, &work, scratch);
    step_teaching(world, size);
    step_training(world, size);
    let breeding = request_breeding(world, scratch);
    let breeding_len = breeding.len();
    resolve_breeding(world, breeding, size, scratch);
    let births = request_births(world, scratch);
    let births_len = births.len();
    resolve_births(world, births, scratch);
    world.tick += 1;
    let aging = step_aging(world, size);
    answer_demands(world, size, scratch);
    step_alliances(world, scratch);
    step_captures(world, terrain, scratch);
    step_refill(world, size);
    step_directives(world, scratch);
    step_crimes(world, size, scratch);
    step_contracts(world, scratch);
    step_demands(world, scratch);
    step_standing(world, scratch);
    step_debts(world, scratch);
    step_persuasion(world, size, scratch);
    step_armies(world, size, scratch);
    // Who came into a City area, now that everyone has moved and nobody changes sides this tick.
    let outsiders_from = std::time::Instant::now();
    step_outsiders(world, size, scratch);
    let outsiders_ms = outsiders_from.elapsed().as_secs_f64() * 1000.0;
    // Workplace settings of buildings and realms that went this tick go with them.
    step_workplace_settings(world, scratch);
    // Offers follow what this tick took from their storages, or the storages themselves.
    step_offers(world, scratch);
    let actions = steps
        + strikes_len
        + climbs_len
        + carries_len
        + builds_len
        + teardowns_len
        + work_len
        + breeding_len
        + births_len
        + payments
        + purchases
        + trades
        + accepted
        + buy_offs
        + debts_paid;
    StepResult { actions, outsiders_ms, aging, ..StepResult::default() }
}

// ------------------------------------------------------------------------------------------------
// The hooks the rule tickets fill. Each is a no-op stub for now, named as the TypeScript names
// the rule, with the TypeScript's arguments and the tick's scratch. A request returns the
// actions it requested (counted in `StepResult::actions`), a resolve without a list returns how
// many it resolved. A ticket deletes its stubs and adds a `use` of its module.
// ------------------------------------------------------------------------------------------------

/// No action yet: what a stub request returns until its ticket ports it.
type NoAction = ();

// T86.9 (`trade-org.ts`, `trading-posts.ts`, `caravans.ts`, `traders.ts`): world generation.
fn place_trade_org_hq(_world: &mut WorldState, _terrain: &TerrainMap) {}
fn place_trading_posts(_world: &mut WorldState, _terrain: &TerrainMap) {}
fn place_caravans(_world: &mut WorldState) {}
fn place_traders(_world: &mut WorldState, _size: i32) {}

// T86.10 (`npc-cities.ts`): world generation.
fn place_npc_cities(_world: &mut WorldState, _terrain: &TerrainMap) {}

// T86.4 (`horses.ts`, `climbing.ts`, `riding.ts`, `passengers.ts`).
fn step_horses(_world: &mut WorldState, _terrain: &TerrainMap, _scratch: &mut Scratch) {}
fn request_climbing(_world: &mut WorldState, _scratch: &mut Scratch) -> Vec<NoAction> {
    Vec::new()
}
fn resolve_climbing(
    _world: &mut WorldState,
    _climbs: Vec<NoAction>,
    _terrain: &TerrainMap,
    _scratch: &mut Scratch,
) {
}
fn step_riders(_world: &mut WorldState, _scratch: &mut Scratch) {}
fn step_passengers(_world: &mut WorldState, _scratch: &mut Scratch) {}

// T86.5 (`carrying.ts`, `storing.ts`, `hauling.ts`, `road-line.ts`'s materials, `buying.ts`,
// `trading.ts`, `offers.ts`).
fn request_carrying(_world: &mut WorldState, _scratch: &mut Scratch) -> Vec<NoAction> {
    Vec::new()
}
fn request_storing(_world: &mut WorldState, _scratch: &mut Scratch) -> Vec<NoAction> {
    Vec::new()
}
fn request_hauling(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) -> Vec<NoAction> {
    Vec::new()
}
fn request_road_materials(_world: &mut WorldState, _scratch: &mut Scratch) -> Vec<NoAction> {
    Vec::new()
}
fn resolve_carrying(
    _world: &mut WorldState,
    _carries: Vec<NoAction>,
    _size: i32,
    _scratch: &mut Scratch,
) {
}
fn resolve_purchases(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) -> usize {
    0
}
fn resolve_trades(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) -> usize {
    0
}
fn resolve_offers(_world: &mut WorldState, _scratch: &mut Scratch) -> usize {
    0
}
fn step_offers(_world: &mut WorldState, _scratch: &mut Scratch) {}

// T86.6 (`building.ts`, `teardown.ts`, `work.ts`, `teaching.ts`, `training.ts`) is in its modules;
// `workplace-settings.ts` is not ported yet (T86.6 left it: its ticket does not name it).
fn step_workplace_settings(_world: &mut WorldState, _scratch: &mut Scratch) {}

// T86.7 (`combat.ts`, `armies.ts`, `capture.ts`, `crimes.ts`, `standing.ts`, `persuasion.ts`,
// `reviving.ts`).
fn request_strikes(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) -> Vec<NoAction> {
    Vec::new()
}
fn resolve_strikes(
    _world: &mut WorldState,
    _strikes: Vec<NoAction>,
    _size: i32,
    _scratch: &mut Scratch,
) {
}
fn step_feeding(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}
fn step_captures(_world: &mut WorldState, _terrain: &TerrainMap, _scratch: &mut Scratch) {}
fn step_crimes(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}
fn step_standing(_world: &mut WorldState, _scratch: &mut Scratch) {}
fn step_persuasion(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}
fn step_armies(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}

// T86.8 (`relocating.ts`, `breeding.ts`, `pairing.ts`).
fn step_relocating(_world: &mut WorldState, _terrain: &TerrainMap, _scratch: &mut Scratch) {}
fn request_breeding(_world: &mut WorldState, _scratch: &mut Scratch) -> Vec<NoAction> {
    Vec::new()
}
fn resolve_breeding(
    _world: &mut WorldState,
    _breeding: Vec<NoAction>,
    _size: i32,
    _scratch: &mut Scratch,
) {
}
fn request_births(_world: &mut WorldState, _scratch: &mut Scratch) -> Vec<NoAction> {
    Vec::new()
}
fn resolve_births(_world: &mut WorldState, _births: Vec<NoAction>, _scratch: &mut Scratch) {}

// T86.9 (`caravans.ts`, `traders.ts`, `trade-org-army.ts`, `trade-org-punishment.ts`,
// `trade-org-debt.ts`, `trade-org-wrecks.ts`).
fn step_caravans(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}
fn step_traders(
    _world: &mut WorldState,
    _size: i32,
    _terrain: &TerrainMap,
    _scratch: &mut Scratch,
) {
}
fn step_trade_org_army(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}
fn step_punishments(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}
fn resolve_debt_payments(_world: &mut WorldState, _scratch: &mut Scratch) -> usize {
    0
}
fn step_debts(_world: &mut WorldState, _scratch: &mut Scratch) {}
fn count_wrecked(_world: &mut WorldState, _wrecked: Vec<Felled>, _scratch: &mut Scratch) {}

// T86.10 (`npc-defence.ts`, `npc-hire.ts`, `npc-behaviour.ts`, `outsiders.ts`).
fn step_npc_defence(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}
fn step_npc_hire(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}
/// Returns the milliseconds the cities spent planning.
fn step_npc_cities(
    _world: &mut WorldState,
    _size: i32,
    _terrain: &TerrainMap,
    _walking: Option<&mut dyn Walk>,
    _scratch: &mut Scratch,
) -> f64 {
    0.0
}
fn step_outsiders(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}

// T86.11 (`alliances.ts`, `contracts.ts`, `demands.ts`, `directives.ts`).
fn step_alliances(_world: &mut WorldState, _scratch: &mut Scratch) {}
fn resolve_payments(_world: &mut WorldState, _scratch: &mut Scratch) -> usize {
    0
}
fn step_contracts(_world: &mut WorldState, _scratch: &mut Scratch) {}
fn answer_demands(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}
fn step_demands(_world: &mut WorldState, _scratch: &mut Scratch) {}
fn step_directives(_world: &mut WorldState, _scratch: &mut Scratch) {}
fn resolve_buy_offs(_world: &mut WorldState, _scratch: &mut Scratch) -> usize {
    0
}

// T86.12 (`script-runner.ts`). Returns how many NPC scripts ran.
fn run_npc_scripts(
    _world: &mut WorldState,
    _terrain: &TerrainMap,
    _scratch: &mut Scratch,
) -> usize {
    0
}

// T86.13 (`last-seen.ts`).
fn step_last_seen(_world: &mut WorldState, _size: i32, _scratch: &mut Scratch) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain_gen::generate_terrain;
    use csp_shared::terrain::wrap_delta;

    /// A small generated map for tests (`smallTerrain`).
    fn small_terrain() -> TerrainMap {
        generate_terrain(1, 128)
    }

    #[test]
    fn creates_the_same_world_from_the_same_seed() {
        let terrain = small_terrain();
        assert_eq!(create_world(&terrain, 7), create_world(&terrain, 7));
        assert_eq!(generate_world(&terrain, 7), generate_world(&terrain, 7));
    }

    #[test]
    fn starts_with_resource_nodes_and_nobody_yet() {
        // Nodes are a sixteenth per tile of what they were on the old grid: a small map has none.
        let world = create_world(&generate_terrain(1, 512), 1);
        assert!(!world.nodes.is_empty());
        assert_eq!(world.tick, 0);
        assert_eq!(world.next_id, 1);
        assert!(world.residents.is_empty());
        assert!(world.realms.is_empty());
        assert!(world.cities.is_empty());
        assert!(world.buildings.is_empty());
        assert!(world.horses.is_empty());
        assert!(world.carriages.is_empty());
        assert!(world.piles.is_empty());
        assert_eq!(world.script_view_changes, 1.0);
    }

    #[test]
    fn advances_the_tick_nobody_moves_without_an_order() {
        let terrain = small_terrain();
        let mut world = create_world(&terrain, 1);
        let mut scratch = Scratch::default();
        for _ in 0..50 {
            step_world(&mut world, &terrain, &mut scratch, None, None);
        }
        assert_eq!(world.tick, 50);
    }

    #[test]
    fn finds_the_nearest_free_passable_tile() {
        let terrain = small_terrain();
        let (x, y) = nearest_free_tile(&terrain, &HashSet::new(), 0, 0);
        assert!(is_walkable(&terrain, x, y));
        let taken = HashSet::from([(x, y)]);
        let next = nearest_free_tile(&terrain, &taken, x, y);
        assert_ne!(next, (x, y));
        let steps = |a: i32, b: i32| wrap_delta(a, b, terrain.size).abs();
        assert!(steps(next.0, x).max(steps(next.1, y)) <= 2);
    }
}
