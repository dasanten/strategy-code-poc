//! The world's health checks (`apps/server/src/invariants.ts`, ADR 0004): rules the simulation
//! must always keep. A broken invariant crashes nothing; it is reported as an error instead.
//!
//! The list is the TypeScript's `worldInvariants`, in its order, so a sampled tick checks the
//! same slice (`invariants_for_tick`). Checks whose rule lives in a module another ticket ports
//! are named here with `pending` and that ticket; they check nothing until it lands, and the
//! differential run (T86.14) turns them all on.

mod checks;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Stock, WorldState};
use serde_json::Value;

use crate::goods_made::tally_goods;
use crate::queries::names::good_name;
pub use crate::sight::InvariantViolation;

/// A rule the simulation must always keep (`Invariant`): its name, and the check that lists how
/// the world breaks it.
#[derive(Clone, Copy)]
pub struct Invariant {
    pub name: &'static str,
    pub check: fn(&WorldState, &TerrainMap) -> Vec<InvariantViolation>,
}

impl std::fmt::Debug for Invariant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.name)
    }
}

impl Invariant {
    /// What the world breaks of it now (`check`).
    pub fn check(&self, world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
        (self.check)(world, terrain)
    }
}

fn nothing(_: &WorldState, _: &TerrainMap) -> Vec<InvariantViolation> {
    Vec::new()
}

/// An invariant whose rule another ticket ports: named, so the list keeps its order, and empty
/// until that ticket lands.
const fn pending(name: &'static str) -> Invariant {
    Invariant { name, check: nothing }
}

/// Every world invariant, in the TypeScript's order (`worldInvariants`).
pub fn world_invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            name: "nothing-on-impassable-terrain",
            check: checks::nothing_on_impassable_terrain,
        },
        Invariant { name: "positions-on-map", check: checks::positions_on_map },
        Invariant { name: "trained-within-cap", check: checks::trained_within_cap },
        Invariant { name: "skills-within-cap", check: checks::skills_within_cap },
        Invariant { name: "health-and-hunger-in-range", check: checks::health_and_hunger_in_range },
        Invariant { name: "horse-stats-sound", check: checks::horse_stats_sound },
        Invariant { name: "ages-in-range", check: checks::ages_in_range },
        Invariant { name: "realms-have-leaders", check: checks::realms_have_leaders },
        Invariant {
            name: "leaders-serve-no-one",
            check: |w, _| crate::leader::leaders_serve_no_one(w),
        },
        Invariant {
            name: "resident-names-well-formed",
            check: |w, _| crate::renaming::resident_names_well_formed(w),
        },
        Invariant {
            name: "city-names-well-formed",
            check: |w, _| crate::renaming::city_names_well_formed(w),
        },
        Invariant {
            name: "horse-names-well-formed",
            check: |w, _| crate::renaming::horse_names_well_formed(w),
        },
        Invariant { name: "game-names-unique", check: |w, _| crate::names::game_names_unique(w) },
        Invariant {
            name: "city-game-names-unique",
            check: |w, _| crate::names::city_game_names_unique(w),
        },
        Invariant {
            name: "horse-offers-once",
            check: |w, _| crate::horse_grant::horse_offers_once(w),
        },
        // TODO(T86.6): `workplaceSettingsSound` in `workplace-settings.ts`.
        pending("workplace-settings-sound"),
        // TODO(T86.11): `waypointsSound` in `waypoints.ts`.
        pending("waypoints-sound"),
        Invariant { name: "buildings-in-place", check: checks::buildings_in_place },
        Invariant { name: "cities-from-buildings", check: checks::cities_from_buildings },
        Invariant { name: "outpost-storage-realms", check: checks::outpost_storage_realms },
        Invariant { name: "carried-within-capacity", check: checks::carried_within_capacity },
        Invariant { name: "goods-in-place", check: checks::goods_in_place },
        Invariant { name: "breed-orders-sound", check: checks::breed_orders_sound },
        Invariant { name: "kept-breedings-sound", check: checks::kept_breedings_sound },
        Invariant { name: "goods-in-whole-units", check: checks::goods_in_whole_units },
        Invariant { name: "carry-orders-done", check: checks::carry_orders_done },
        Invariant { name: "store-fetch-orders-sound", check: checks::store_fetch_orders_sound },
        Invariant { name: "sites-within-needs", check: checks::sites_within_needs },
        Invariant { name: "build-orders-on-sites", check: checks::build_orders_on_sites },
        Invariant { name: "work-orders-on-workplaces", check: checks::work_orders_on_workplaces },
        Invariant { name: "refilled-when-low", check: checks::refilled_when_low },
        Invariant { name: "teardowns-within-needs", check: checks::teardowns_within_needs },
        Invariant {
            name: "tear-down-orders-on-buildings",
            check: checks::tear_down_orders_on_buildings,
        },
        Invariant { name: "nodes-on-fitting-terrain", check: checks::nodes_on_fitting_terrain },
        Invariant { name: "realm-logs-in-order", check: checks::realm_logs_in_order },
        Invariant { name: "residents-in-cities", check: checks::residents_in_cities },
        Invariant { name: "npc-city-residents-unowned", check: checks::npc_city_residents_unowned },
        Invariant { name: "owners-exist", check: checks::owners_exist },
        Invariant {
            name: "city-residents-in-its-realm",
            check: checks::city_residents_in_its_realm,
        },
        Invariant { name: "relocate-orders-sound", check: checks::relocate_orders_sound },
        Invariant { name: "occupations-sound", check: checks::occupations_sound },
        Invariant { name: "npc-orders-allowed", check: checks::npc_orders_allowed },
        Invariant { name: "npc-fights-outsiders", check: checks::npc_fights_outsiders },
        Invariant { name: "city-workplaces-sound", check: checks::city_workplaces_sound },
        Invariant { name: "pairs-hold-together", check: checks::pairs_hold_together },
        Invariant { name: "carrying-doesnt-work", check: checks::carrying_doesnt_work },
        Invariant { name: "children-dont-work", check: checks::children_dont_work },
        Invariant { name: "children-carry-only-food", check: checks::children_carry_only_food },
        Invariant { name: "carriages-in-place", check: checks::carriages_in_place },
        Invariant { name: "riders-on-horses", check: checks::riders_on_horses },
        Invariant { name: "passengers-aboard", check: checks::passengers_aboard },
        Invariant { name: "drivers-on-carriages", check: checks::drivers_on_carriages },
        Invariant { name: "haul-routes-sound", check: checks::haul_routes_sound },
        Invariant { name: "alliances-sound", check: checks::alliances_sound },
        Invariant { name: "territory-sound", check: checks::territory_sound },
        Invariant { name: "dead-leave-loot", check: checks::dead_leave_loot },
        Invariant { name: "down-do-nothing", check: |w, _| crate::survival::down_do_nothing(w) },
        Invariant { name: "awake-alive", check: |w, _| crate::survival::awake_alive(w) },
        Invariant {
            name: "horses-down-lie-still",
            check: |w, _| crate::horses::horses_down_lie_still(w),
        },
        Invariant { name: "attack-orders-sound", check: checks::attack_orders_sound },
        Invariant { name: "armies-sound", check: |w, _| crate::armies::armies_sound(w) },
        Invariant { name: "contracts-sound", check: |w, _| crate::contracts::contracts_sound(w) },
        // TODO(T86.11): `demandsSound` in `demands.ts`.
        pending("demands-sound"),
        Invariant { name: "buy-orders-done", check: |w, _| crate::buying::buy_orders_done(w) },
        Invariant { name: "city-prices-sound", check: |w, _| crate::buying::city_prices_sound(w) },
        Invariant { name: "trade-orders-done", check: |w, _| crate::trading::trade_orders_done(w) },
        // TODO(T86.5): `tradesKeepGoods` in `trading.ts`.
        pending("trades-keep-goods"),
        // TODO(T86.5): `refusedTradeNothing` in `trading.ts`.
        pending("refused-trade-nothing"),
        // TODO(T86.5): `npcHorseSalesKeepPair` in `trading.ts`.
        pending("npc-horse-sales-keep-pair"),
        // TODO(T86.5): `npcHorsePurchasesWanted` in `trading.ts`.
        pending("npc-horse-purchases-wanted"),
        // TODO(T86.5): `npcTradesKeepReserve` in `trading.ts`.
        pending("npc-trades-keep-reserve"),
        // TODO(T86.5): `offersSound` in `offers.ts`.
        pending("offers-sound"),
        // TODO(T86.5): `offersKeepGoods` in `offers.ts`.
        pending("offers-keep-goods"),
        // TODO(T86.5): `tradeOrgOnlyBuysFood` in `offers.ts`.
        pending("trade-org-only-buys-food"),
        // TODO(T86.5): `acceptOrdersDone` in `offers.ts`.
        pending("accept-orders-done"),
        // TODO(T86.9): `deliveriesSound` in `deliveries.ts`.
        pending("deliveries-sound"),
        // TODO(T86.9): `transfersSound` in `transfers.ts`.
        pending("transfers-sound"),
        Invariant {
            name: "supply-lines-sound",
            check: |w, _| crate::armies::supply_lines_sound(w),
        },
        Invariant { name: "crimes-sound", check: checks::crimes_sound },
        Invariant { name: "standings-sound", check: |w, _| crate::standing::standings_sound(w) },
        Invariant {
            name: "join-requests-sound",
            check: |w, _| crate::persuasion::join_requests_sound(w),
        },
        Invariant {
            name: "former-players-sound",
            check: |w, _| crate::standing::former_players_sound(w),
        },
        Invariant { name: "gates-sound", check: checks::gates_sound },
        Invariant { name: "wall-damage-sound", check: checks::wall_damage_sound },
        Invariant { name: "climb-orders-sound", check: checks::climb_orders_sound },
        Invariant { name: "teachers-sound", check: checks::teachers_sound },
        Invariant { name: "trainees-sound", check: checks::trainees_sound },
        Invariant { name: "trade-org-sound", check: checks::trade_org_sound },
        // TODO(T86.9): `nothingLeftOfTheHq` in `hq-fall.ts`.
        pending("nothing-left-of-the-hq"),
        // TODO(T86.9): `caravansSound` in `caravans.ts`.
        pending("caravans-sound"),
        // TODO(T86.9): `tradersSound` in `traders.ts`.
        pending("traders-sound"),
        // TODO(T86.9): `traderStopsSound` in `trader-stops.ts`.
        pending("trader-stops-sound"),
        // TODO(T86.5): `traderTradesKeepFood` in `trading.ts`.
        pending("trader-trades-keep-food"),
        // TODO(T86.9): `routeRobberiesSound` in `caravans.ts`.
        pending("route-robberies-sound"),
        // TODO(T86.9): `tradeOrgArmySound` in `trade-org-army.ts`.
        pending("trade-org-army-sound"),
        Invariant { name: "npc-hire-sound", check: |w, _| crate::npc_hire::npc_hire_sound(w) },
        // TODO(T86.9): `punishmentsSound` in `trade-org-punishment.ts`.
        pending("punishments-sound"),
        Invariant {
            name: "npc-gate-shut-to-its-punishers",
            check: |w, t| crate::npc_defence::npc_gate_shut_to_its_punishers(w, t.size),
        },
        // TODO(T86.9): `supplyWagonsSound` in `supply-wagons.ts`.
        pending("supply-wagons-sound"),
        Invariant {
            name: "directives-sound",
            check: |w, _| crate::directives::directives_sound(w),
        },
        // TODO(T86.11): `buyOffsSound` in `directives.ts`.
        pending("buy-offs-sound"),
        Invariant {
            name: "buy-off-orders-done",
            check: |w, _| crate::directives::buy_off_orders_done(w),
        },
        // TODO(T86.9): `debtsSound` in `trade-org-debt.ts`.
        pending("debts-sound"),
        // TODO(T86.9): `wrecksSound` in `trade-org-wrecks.ts`.
        pending("wrecks-sound"),
        // TODO(T86.9): `citiesTakenSound` in `trade-org-takes.ts`.
        pending("cities-taken-sound"),
        // TODO(T86.9): `debtDemandsSound` in `trade-org-debt.ts`.
        pending("debt-demands-sound"),
        // TODO(T86.9): `debtPaymentsSound` in `trade-org-debt.ts`.
        pending("debt-payments-sound"),
        // TODO(T86.9): `debtOrdersDone` in `trade-org-debt.ts`.
        pending("debt-orders-done"),
        // TODO(T86.9): `hqRingsSound` in `hq-growth.ts`.
        pending("hq-rings-sound"),
        // TODO(T86.10): `cityPlansSound` in `npc-plan.ts`.
        pending("city-plans-sound"),
        // TODO(T86.10): `foundingPartiesSound` in `npc-founding.ts`.
        pending("founding-parties-sound"),
        // TODO(T86.10): `fullWaitSound` in `npc-founding.ts`.
        pending("full-wait-sound"),
        Invariant {
            name: "coins-short-only-with-income",
            check: |w, t| crate::npc_coins::coins_short_only_with_income(w, t.size),
        },
        Invariant {
            name: "npc-cities-have-halls",
            check: |w, _t| crate::npc_founding::npc_cities_have_halls(w),
        },
        Invariant {
            name: "city-layouts-sound",
            check: |w, _t| crate::city_layout::city_layouts_sound(w),
        },
        Invariant {
            name: "city-streets-sound",
            check: |w, _t| crate::city_layout::city_streets_sound(w),
        },
        Invariant {
            name: "inner-wall-leaves-a-way",
            check: |w, t| crate::npc_inner_wall::inner_wall_leaves_a_way(w, t),
        },
        // TODO(T86.10): `npcFarmersKept` in `npc-plan.ts`.
        pending("npc-farmers-kept"),
        // TODO(T86.10): `npcSurplusCapped` in `npc-plan.ts`.
        pending("npc-surplus-capped"),
        // TODO(T86.10): `npcSpareHandsWork` in `npc-plan.ts`.
        pending("npc-spare-hands-work"),
        // TODO(T86.10): `npcWorkplacesBounded` in `npc-plan.ts`.
        pending("npc-workplaces-bounded"),
        // TODO(T86.10): `npcRoadCrewSized` in `npc-roads.ts`.
        pending("npc-road-crew-sized"),
        Invariant { name: "npc-roads-once", check: |w, _t| crate::npc_roads::npc_roads_once(w) },
        Invariant {
            name: "npc-revivers",
            check: |w, t| crate::npc_revive::npc_revivers(w, t.size),
        },
        // TODO(T86.10): `npcScoutsSound` in `npc-scouts.ts`.
        pending("npc-scouts-sound"),
        Invariant { name: "npc-one-feeder", check: |w, _t| crate::npc_stable::npc_one_feeder(w) },
        Invariant {
            name: "trade-org-breeds-no-horses",
            check: |w, _t| crate::npc_stable::trade_org_breeds_no_horses(w),
        },
        // TODO(T86.10): `npcResidentsKeptGoing` in `npc-behaviour.ts`.
        pending("npc-residents-kept-going"),
        // TODO(T86.10): `npcIdleOffTheStorage` in `npc-behaviour.ts`.
        pending("npc-idle-off-the-storage"),
        // TODO(T86.10): `npcSoldiersOnPosts` in `npc-posts.ts`.
        pending("npc-soldiers-on-posts"),
        Invariant {
            name: "npc-patrols-sound",
            check: |w, _t| crate::npc_patrols::npc_patrols_sound(w),
        },
        Invariant {
            name: "npc-training-grounds-bounded",
            check: |w, t| crate::npc_training::npc_training_grounds_bounded(w, t.size),
        },
        Invariant {
            name: "npc-trains-its-soldiers",
            check: |w, _t| crate::npc_training::npc_trains_its_soldiers(w),
        },
        Invariant {
            name: "trade-org-sends-no-one",
            check: |w, _t| crate::npc_plan::trade_org_sends_no_one(w),
        },
        Invariant {
            name: "npc-traders-sound",
            check: |w, _t| crate::npc_trader::npc_traders_sound(w),
        },
        Invariant { name: "line-orders-sound", check: checks::line_orders_sound },
        Invariant { name: "paths-are-steps", check: checks::paths_are_steps },
        Invariant { name: "one-carrier-at-a-time", check: checks::game_default_carriers },
        Invariant { name: "one-fetcher-at-a-time", check: checks::game_default_fetchers },
        Invariant {
            name: "one-input-fetcher-at-a-time",
            check: checks::game_default_input_fetchers,
        },
        Invariant { name: "defaults-have-a-target", check: checks::game_default_targets },
        Invariant { name: "queues-sound", check: crate::queues::queues_sound },
        Invariant {
            name: "interrupted-runs-defence",
            check: |w, _| crate::defence::interrupted_sound(w),
        },
        Invariant {
            name: "given-under-attack-sound",
            check: |w, _| crate::defence::given_under_attack_sound(w),
        },
        Invariant {
            name: "struck-driver-drives-on",
            check: |w, _| crate::defence::struck_driver_drives_on(w),
        },
        Invariant {
            name: "defence-script-sound",
            check: |w, _| crate::defence::defence_script_sound(w),
        },
        // TODO(T86.7): `alarmsSound` in `alarms.ts`.
        pending("alarms-sound"),
        // TODO(T86.7): `alarmScriptSound` in `alarms.ts`.
        pending("alarm-script-sound"),
        // TODO(T86.10): `outsidersSound` in `outsiders.ts`.
        pending("outsiders-sound"),
        // TODO(T86.7): `alarmedAttackersSound` in `alarms.ts`.
        pending("alarmed-attackers-sound"),
        // TODO(T86.12): `scriptLogsSound` in `script-log.ts`.
        pending("script-logs-sound"),
    ]
}

/// Runs the invariants and lists every violation (`checkInvariants`).
pub fn check_invariants(
    world: &WorldState,
    terrain: &TerrainMap,
    invariants: &[Invariant],
) -> Vec<InvariantViolation> {
    invariants.iter().flat_map(|inv| inv.check(world, terrain)).collect()
}

/// Runs every world invariant (`checkInvariants(world, terrain)`).
pub fn check_all(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    check_invariants(world, terrain, &world_invariants())
}

/// The world invariants a tick checks (`invariantsForTick`): with every tick sampled, all of
/// them; otherwise, with `round = 1 / sample_rate`, the slice whose index matches
/// `tick % round`, so every invariant still runs once per `round` ticks and no tick runs them
/// all.
#[allow(clippy::neg_cmp_op_on_partial_ord)] // NaN takes none, as in the TypeScript.
pub fn invariants_for_tick(
    tick: u64,
    sample_rate: f64,
    invariants: &[Invariant],
) -> Vec<Invariant> {
    if sample_rate >= 1.0 {
        return invariants.to_vec();
    }
    if !(sample_rate > 0.0) {
        return Vec::new();
    }
    let round = crate::queries::js_round(1.0 / sample_rate) as u64;
    invariants
        .iter()
        .enumerate()
        .filter(|(i, _)| *i as u64 % round == tick % round)
        .map(|(_, inv)| *inv)
        .collect()
}

/// Whether this tick gets the checks that need its before and after (the goods tally and the
/// script runs), given the share of ticks to sample (`shouldCheckInvariants`).
pub fn should_check_invariants(sample_rate: f64, rand: &mut dyn FnMut() -> f64) -> bool {
    sample_rate >= 1.0 || rand() < sample_rate
}

/// Goods appear from nothing only at the stock floor (`goodsOnlyFromNothingAtTheFloor`,
/// `CONTEXT.md`: Stock floor, ADR 0003): across one tick, no good grows in the world by more than
/// work, buildings torn down or broken and the Trade Org's floor brought in (`made`).
pub fn goods_only_from_nothing_at_the_floor(
    before: &Stock,
    world: &WorldState,
    made: &Stock,
) -> Vec<InvariantViolation> {
    let after = tally_goods(world);
    let mut out = Vec::new();
    for (good, &n) in &after {
        let grew =
            n - before.get(good).copied().unwrap_or(0.0) - made.get(good).copied().unwrap_or(0.0);
        if grew > 1e-9 {
            out.push(InvariantViolation {
                invariant: "goods-only-from-nothing-at-the-floor".into(),
                message: format!(
                    "{} {} appeared from nothing at tick {}",
                    js_number(grew),
                    good_name(*good),
                    world.tick
                ),
                entity_ids: Vec::new(),
            });
        }
    }
    out
}

/// A number as JavaScript prints it in a template string: whole numbers without `.0`, `NaN`,
/// `Infinity`, others in their shortest form (Rust's `Display` gives the same digits below 1e21).
pub fn js_number(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        }
    } else if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{n:.0}")
    } else {
        n.to_string()
    }
}

/// A value as `JSON.stringify` writes it: whole numbers without `.0`.
pub fn js_json(v: &impl serde::Serialize) -> String {
    fn whole(v: Value) -> Value {
        match v {
            Value::Number(n) => match n.as_f64() {
                Some(f) if f.fract() == 0.0 && f.abs() < 9e15 => Value::from(f as i64),
                _ => Value::Number(n),
            },
            Value::Array(a) => Value::Array(a.into_iter().map(whole).collect()),
            Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, whole(v))).collect()),
            other => other,
        }
    }
    serde_json::to_value(v).map(whole).map(|v| v.to_string()).unwrap_or_default()
}

/// A violation of `invariant` about `ids`.
pub(crate) fn violation(invariant: &str, message: String, ids: &[&str]) -> InvariantViolation {
    InvariantViolation {
        invariant: invariant.into(),
        message,
        entity_ids: ids.iter().map(|s| s.to_string()).collect(),
    }
}

/// The world invariant with this name, to run on its own (`buildingsInPlace.check(...)`).
pub fn invariant_named(name: &str) -> Option<Invariant> {
    world_invariants().into_iter().find(|i| i.name == name)
}
