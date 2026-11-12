//! The world's health checks (`apps/server/src/invariants.ts`, ADR 0004): rules the simulation
//! must always keep. A broken invariant crashes nothing; it is reported as an error instead.
//!
//! The list is the TypeScript's `worldInvariants`, in its order, so a sampled tick checks the
//! same slice (`invariants_for_tick`). A few checks read what the TypeScript keeps beside the world
//! (the trades, offers, debt payments and buy-offs of the latest tick): they are named here with
//! `ledgered` and run with [`Ledgers`] (`check_with`); without them they find nothing, as the
//! TypeScript does before the first tick.

pub(crate) mod checks;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Stock, WorldState};
use serde_json::Value;

use crate::directives::BuyOffRecord;
use crate::goods_made::tally_goods;
use crate::offers::OfferLedger;
use crate::queries::names::good_name;
pub use crate::sight::InvariantViolation;
use crate::trade_org_debt::DebtLedger;
use crate::trading::TradeLedger;

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

/// What the TypeScript keeps beside the world for the invariants over a tick's trades, offers,
/// debt payments and buy-offs (`ledger`, `WeakMap`s keyed by the world). None is a ledger nothing
/// wrote to yet.
#[derive(Debug, Clone, Copy, Default)]
pub struct Ledgers<'a> {
    pub trades: Option<&'a TradeLedger>,
    pub offers: Option<&'a OfferLedger>,
    pub debt_payments: Option<&'a DebtLedger>,
    pub buy_offs: &'a [BuyOffRecord],
}

impl Invariant {
    /// What the world breaks of it now (`check`), with no ledgers.
    pub fn check(&self, world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
        self.check_with(world, terrain, &Ledgers::default())
    }

    /// What the world and the latest tick's ledgers break of it (`check`).
    pub fn check_with(
        &self,
        world: &WorldState,
        terrain: &TerrainMap,
        ledgers: &Ledgers,
    ) -> Vec<InvariantViolation> {
        match ledgered_check(self.name) {
            Some(check) => check(world, ledgers),
            None => (self.check)(world, terrain),
        }
    }
}

/// The checks over a tick's ledgers, by the name `ledgered` gave them.
fn ledgered_check(name: &str) -> Option<fn(&WorldState, &Ledgers) -> Vec<InvariantViolation>> {
    fn empty<T>(
        ledger: Option<&T>,
        check: fn(&T) -> Vec<InvariantViolation>,
    ) -> Vec<InvariantViolation> {
        ledger.map(check).unwrap_or_default()
    }
    Some(match name {
        "trades-keep-goods" => |_, l| empty(l.trades, crate::trading::trades_keep_goods),
        "refused-trade-nothing" => |_, l| empty(l.trades, crate::trading::refused_trade_nothing),
        "npc-horse-sales-keep-pair" => {
            |_, l| empty(l.trades, crate::trading::npc_horse_sales_keep_pair)
        }
        "npc-horse-purchases-wanted" => {
            |_, l| empty(l.trades, crate::trading::npc_horse_purchases_wanted)
        }
        "npc-trades-keep-reserve" => {
            |_, l| empty(l.trades, crate::trading::npc_trades_keep_reserve)
        }
        "trader-trades-keep-food" => {
            |_, l| empty(l.trades, crate::trading::trader_trades_keep_food)
        }
        "offers-keep-goods" => |_, l| empty(l.offers, crate::offers::offers_keep_goods),
        "trade-org-only-buys-food" => |w, l| {
            l.offers.map(|o| crate::offers::trade_org_only_buys_food(w, o)).unwrap_or_default()
        },
        "debt-payments-sound" => {
            |_, l| empty(l.debt_payments, crate::trade_org_debt::debt_payments_sound)
        }
        "buy-offs-sound" => |w, l| crate::directives::buy_offs_sound(w, l.buy_offs),
        _ => return None,
    })
}

fn nothing(_: &WorldState, _: &TerrainMap) -> Vec<InvariantViolation> {
    Vec::new()
}

/// An invariant over a tick's ledgers (`ledgered_check`): named here so the list keeps its order.
const fn ledgered(name: &'static str) -> Invariant {
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
        Invariant {
            name: "workplace-settings-sound",
            check: |w, _| crate::workplace_settings::workplace_settings_sound(w),
        },
        Invariant { name: "waypoints-sound", check: crate::waypoints::waypoints_sound },
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
        Invariant { name: "vessels-in-place", check: checks::vessels_in_place },
        Invariant { name: "riders-on-horses", check: checks::riders_on_horses },
        Invariant { name: "passengers-aboard", check: checks::passengers_aboard },
        Invariant { name: "vessel-passengers", check: checks::vessel_passengers },
        Invariant { name: "ship-crew", check: checks::ship_crew },
        Invariant { name: "drivers-on-carriages", check: checks::drivers_on_carriages },
        Invariant { name: "haul-routes-sound", check: checks::haul_routes_sound },
        Invariant { name: "water-haul-routes-sound", check: checks::water_haul_routes_sound },
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
        Invariant { name: "demands-sound", check: |w, _| crate::demands::demands_sound(w) },
        Invariant { name: "buy-orders-done", check: |w, _| crate::buying::buy_orders_done(w) },
        Invariant { name: "city-prices-sound", check: |w, _| crate::buying::city_prices_sound(w) },
        Invariant { name: "trade-orders-done", check: |w, _| crate::trading::trade_orders_done(w) },
        ledgered("trades-keep-goods"),
        ledgered("refused-trade-nothing"),
        ledgered("npc-horse-sales-keep-pair"),
        ledgered("npc-horse-purchases-wanted"),
        ledgered("npc-trades-keep-reserve"),
        Invariant { name: "offers-sound", check: |w, _| crate::offers::offers_sound(w) },
        // `offersKeepGoods` checks the scratch's offer ledger: `offers::offers_keep_goods`.
        ledgered("offers-keep-goods"),
        // `tradeOrgOnlyBuysFood` checks the scratch's offer ledger:
        // `offers::trade_org_only_buys_food`.
        ledgered("trade-org-only-buys-food"),
        Invariant {
            name: "accept-orders-done",
            check: |w, _| crate::offers::accept_orders_done(w),
        },
        Invariant {
            name: "deliveries-sound",
            check: |w, _| crate::deliveries::deliveries_sound(w),
        },
        Invariant { name: "transfers-sound", check: |w, _| crate::transfers::transfers_sound(w) },
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
        Invariant {
            name: "nothing-left-of-the-hq",
            check: |w, _| crate::hq_fall::nothing_left_of_the_hq(w),
        },
        Invariant {
            name: "caravans-sound",
            check: |w, t| crate::caravans::caravans_sound(w, t.size),
        },
        Invariant { name: "traders-sound", check: |w, t| crate::traders::traders_sound(w, t) },
        Invariant {
            name: "trader-stops-sound",
            check: |w, _| crate::trader_stops::trader_stops_sound(w),
        },
        ledgered("trader-trades-keep-food"),
        Invariant {
            name: "route-robberies-sound",
            check: |w, _| crate::caravans::route_robberies_sound(w),
        },
        Invariant {
            name: "trade-org-army-sound",
            check: |w, t| crate::trade_org_army::trade_org_army_sound(w, t.size),
        },
        Invariant { name: "npc-hire-sound", check: |w, _| crate::npc_hire::npc_hire_sound(w) },
        Invariant {
            name: "punishments-sound",
            check: |w, _| crate::trade_org_punishment::punishments_sound(w),
        },
        Invariant {
            name: "npc-gate-shut-to-its-punishers",
            check: |w, t| crate::npc_defence::npc_gate_shut_to_its_punishers(w, t.size),
        },
        Invariant {
            name: "supply-wagons-sound",
            check: |w, _| crate::supply_wagons::supply_wagons_sound(w),
        },
        Invariant {
            name: "directives-sound",
            check: |w, _| crate::directives::directives_sound(w),
        },
        ledgered("buy-offs-sound"),
        Invariant {
            name: "buy-off-orders-done",
            check: |w, _| crate::directives::buy_off_orders_done(w),
        },
        Invariant { name: "debts-sound", check: |w, _| crate::trade_org_debt::debts_sound(w) },
        Invariant { name: "wrecks-sound", check: |w, _| crate::trade_org_wrecks::wrecks_sound(w) },
        Invariant {
            name: "cities-taken-sound",
            check: |w, _| crate::trade_org_takes::cities_taken_sound(w),
        },
        Invariant {
            name: "debt-demands-sound",
            check: |w, _| crate::trade_org_debt::debt_demands_sound(w),
        },
        // `debtPaymentsSound` checks the scratch's ledger: `trade_org_debt::debt_payments_sound`.
        ledgered("debt-payments-sound"),
        Invariant {
            name: "debt-orders-done",
            check: |w, _| crate::trade_org_debt::debt_orders_done(w),
        },
        Invariant { name: "hq-rings-sound", check: crate::hq_growth::hq_rings_sound },
        Invariant { name: "city-plans-sound", check: |w, _t| crate::npc_plan::city_plans_sound(w) },
        Invariant {
            name: "founding-parties-sound",
            check: |w, _t| crate::npc_founding::founding_parties_sound(w),
        },
        Invariant {
            name: "full-wait-sound",
            check: |w, _t| crate::npc_founding::full_wait_sound(w),
        },
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
        Invariant { name: "npc-farmers-kept", check: |w, _t| crate::npc_plan::npc_farmers_kept(w) },
        Invariant {
            name: "npc-surplus-capped",
            check: |w, _t| crate::npc_plan::npc_surplus_capped(w),
        },
        Invariant {
            name: "npc-spare-hands-work",
            check: |w, _t| crate::npc_plan::npc_spare_hands_work(w),
        },
        Invariant {
            name: "npc-workplaces-bounded",
            check: |w, _t| crate::npc_plan::npc_workplaces_bounded(w),
        },
        Invariant {
            name: "npc-road-crew-sized",
            check: |w, _t| crate::npc_behaviour::npc_road_crew_sized(w),
        },
        Invariant { name: "npc-roads-once", check: |w, _t| crate::npc_roads::npc_roads_once(w) },
        Invariant {
            name: "npc-revivers",
            check: |w, t| crate::npc_revive::npc_revivers(w, t.size),
        },
        Invariant {
            name: "npc-scouts-sound",
            check: |w, t| crate::npc_scouts::npc_scouts_sound(w, t),
        },
        Invariant { name: "npc-one-feeder", check: |w, _t| crate::npc_stable::npc_one_feeder(w) },
        Invariant {
            name: "trade-org-breeds-no-horses",
            check: |w, _t| crate::npc_stable::trade_org_breeds_no_horses(w),
        },
        Invariant {
            name: "npc-residents-kept-going",
            check: |w, _t| crate::npc_behaviour::npc_residents_kept_going(w),
        },
        Invariant {
            name: "npc-idle-off-the-storage",
            check: |w, t| crate::npc_behaviour::npc_idle_off_the_storage(w, t),
        },
        Invariant {
            name: "npc-soldiers-on-posts",
            check: |w, t| crate::npc_behaviour::npc_soldiers_on_posts(w, t),
        },
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
        Invariant { name: "alarms-sound", check: |w, _| crate::alarms::alarms_sound(w) },
        Invariant {
            name: "alarm-script-sound",
            check: |w, _| crate::alarms::alarm_script_sound(w),
        },
        Invariant { name: "outsiders-sound", check: checks::outsiders_sound },
        Invariant {
            name: "alarmed-attackers-sound",
            check: |w, _| crate::alarms::alarmed_attackers_sound(w),
        },
        Invariant {
            name: "script-logs-sound",
            check: |w, _| crate::script_log::script_logs_sound(w),
        },
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

/// Runs the invariants with the latest tick's ledgers (`checkInvariants`, whose ledger checks read
/// what the TypeScript keeps beside the world).
pub fn check_invariants_with(
    world: &WorldState,
    terrain: &TerrainMap,
    invariants: &[Invariant],
    ledgers: &Ledgers,
) -> Vec<InvariantViolation> {
    invariants.iter().flat_map(|inv| inv.check_with(world, terrain, ledgers)).collect()
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
