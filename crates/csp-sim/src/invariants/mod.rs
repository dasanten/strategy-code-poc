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
        // TODO(T86.8): `leadersServeNoOne` in `leader.ts`.
        pending("leaders-serve-no-one"),
        // TODO(T86.8): `residentNamesWellFormed` in `renaming.ts`.
        pending("resident-names-well-formed"),
        // TODO(T86.8): `cityNamesWellFormed` in `renaming.ts`.
        pending("city-names-well-formed"),
        // TODO(T86.8): `horseNamesWellFormed` in `renaming.ts`.
        pending("horse-names-well-formed"),
        // TODO(T86.8): `gameNamesUnique` in `names.ts`.
        pending("game-names-unique"),
        // TODO(T86.8): `cityGameNamesUnique` in `names.ts`.
        pending("city-game-names-unique"),
        // TODO(T86.8): `horseOffersOnce` in `horse-grant.ts`.
        pending("horse-offers-once"),
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
        // TODO(T86.3): `downDoNothing` in `survival.ts`.
        pending("down-do-nothing"),
        // TODO(T86.3): `awakeAlive` in `survival.ts`.
        pending("awake-alive"),
        // TODO(T86.4): `horsesDownLieStill` in `horses.ts`.
        pending("horses-down-lie-still"),
        Invariant { name: "attack-orders-sound", check: checks::attack_orders_sound },
        // TODO(T86.7): `armiesSound` in `armies.ts`.
        pending("armies-sound"),
        // TODO(T86.11): `contractsSound` in `contracts.ts`.
        pending("contracts-sound"),
        // TODO(T86.11): `demandsSound` in `demands.ts`.
        pending("demands-sound"),
        // TODO(T86.5): `buyOrdersDone` in `buying.ts`.
        pending("buy-orders-done"),
        // TODO(T86.5): `cityPricesSound` in `buying.ts`.
        pending("city-prices-sound"),
        // TODO(T86.5): `tradeOrdersDone` in `trading.ts`.
        pending("trade-orders-done"),
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
        // TODO(T86.7): `supplyLinesSound` in `armies.ts`.
        pending("supply-lines-sound"),
        Invariant { name: "crimes-sound", check: checks::crimes_sound },
        // TODO(T86.7): `standingsSound` in `standing.ts`.
        pending("standings-sound"),
        // TODO(T86.7): `joinRequestsSound` in `persuasion.ts`.
        pending("join-requests-sound"),
        // TODO(T86.7): `formerPlayersSound` in `standing.ts`.
        pending("former-players-sound"),
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
        // TODO(T86.10): `npcHireSound` in `npc-hire.ts`.
        pending("npc-hire-sound"),
        // TODO(T86.9): `punishmentsSound` in `trade-org-punishment.ts`.
        pending("punishments-sound"),
        // TODO(T86.10): `npcGateShutToItsPunishers` in `npc-defence.ts`.
        pending("npc-gate-shut-to-its-punishers"),
        // TODO(T86.9): `supplyWagonsSound` in `supply-wagons.ts`.
        pending("supply-wagons-sound"),
        // TODO(T86.11): `directivesSound` in `directives.ts`.
        pending("directives-sound"),
        // TODO(T86.11): `buyOffsSound` in `directives.ts`.
        pending("buy-offs-sound"),
        // TODO(T86.11): `buyOffOrdersDone` in `directives.ts`.
        pending("buy-off-orders-done"),
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
        // TODO(T86.10): `coinsShortOnlyWithIncome` in `npc-coins.ts`.
        pending("coins-short-only-with-income"),
        // TODO(T86.10): `npcCitiesHaveHalls` in `npc-founding.ts`.
        pending("npc-cities-have-halls"),
        // TODO(T86.10): `cityLayoutsSound` in `city-layout.ts`.
        pending("city-layouts-sound"),
        // TODO(T86.10): `cityStreetsSound` in `city-layout.ts`.
        pending("city-streets-sound"),
        // TODO(T86.10): `innerWallLeavesAWay` in `npc-inner-wall.ts`.
        pending("inner-wall-leaves-a-way"),
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
        // TODO(T86.10): `npcRoadsOnce` in `npc-roads.ts`.
        pending("npc-roads-once"),
        // TODO(T86.10): `npcRevivers` in `npc-revive.ts`.
        pending("npc-revivers"),
        // TODO(T86.10): `npcScoutsSound` in `npc-scouts.ts`.
        pending("npc-scouts-sound"),
        // TODO(T86.10): `npcOneFeeder` in `npc-stable.ts`.
        pending("npc-one-feeder"),
        // TODO(T86.10): `tradeOrgBreedsNoHorses` in `npc-stable.ts`.
        pending("trade-org-breeds-no-horses"),
        // TODO(T86.10): `npcResidentsKeptGoing` in `npc-behaviour.ts`.
        pending("npc-residents-kept-going"),
        // TODO(T86.10): `npcIdleOffTheStorage` in `npc-behaviour.ts`.
        pending("npc-idle-off-the-storage"),
        // TODO(T86.10): `npcSoldiersOnPosts` in `npc-posts.ts`.
        pending("npc-soldiers-on-posts"),
        // TODO(T86.10): `npcPatrolsSound` in `npc-patrols.ts`.
        pending("npc-patrols-sound"),
        // TODO(T86.10): `npcTrainingGroundsBounded` in `npc-training.ts`.
        pending("npc-training-grounds-bounded"),
        // TODO(T86.10): `npcTrainsItsSoldiers` in `npc-training.ts`.
        pending("npc-trains-its-soldiers"),
        // TODO(T86.10): `tradeOrgSendsNoOne` in `npc-plan.ts`.
        pending("trade-org-sends-no-one"),
        // TODO(T86.10): `npcTradersSound` in `npc-trader.ts`.
        pending("npc-traders-sound"),
        Invariant { name: "line-orders-sound", check: checks::line_orders_sound },
        Invariant { name: "paths-are-steps", check: checks::paths_are_steps },
        Invariant { name: "one-carrier-at-a-time", check: checks::game_default_carriers },
        Invariant { name: "one-fetcher-at-a-time", check: checks::game_default_fetchers },
        Invariant {
            name: "one-input-fetcher-at-a-time",
            check: checks::game_default_input_fetchers,
        },
        Invariant { name: "defaults-have-a-target", check: checks::game_default_targets },
        // TODO(T86.2): `queuesSound` in `queues.ts`.
        pending("queues-sound"),
        // TODO(T86.7): `interruptedSound` in `defence.ts`.
        pending("interrupted-runs-defence"),
        // TODO(T86.7): `givenUnderAttackSound` in `defence.ts`.
        pending("given-under-attack-sound"),
        // TODO(T86.7): `struckDriverDrivesOn` in `defence.ts`.
        pending("struck-driver-drives-on"),
        // TODO(T86.7): `defenceScriptSound` in `defence.ts`.
        pending("defence-script-sound"),
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
