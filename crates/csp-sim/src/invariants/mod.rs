//! The world's health checks (ADR 0004): rules the simulation must always keep. A broken
//! invariant crashes nothing; it is reported as an error instead.
//!
//! **Where a new invariant goes:** into the `INVARIANTS` list of its domain's file here, with its
//! check beside it (or in the module of the rule it checks). Nothing else needs an edit. A new
//! domain is a new file, its `mod` line and its line in [`DOMAINS`]; a test fails when one is
//! missing there. A helper that two domains need goes into `shared.rs`.
//!
//! A check that reads what a tick keeps beside the world (the trades, offers, debt payments and
//! buy-offs of the latest tick) is listed with `ledgered` and run with [`Ledgers`]
//! (`check_with`); without them it finds nothing.

pub mod buildings;
pub mod carriages;
pub mod cities;
pub mod construction;
pub mod fighting;
pub mod goods;
pub mod horses;
pub mod map;
pub mod realms;
pub mod residents;
pub mod scripts;
pub mod shared;
pub mod survival;
pub mod trade;
pub mod trade_org;
pub mod vessels;
pub mod walls;

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
    /// The check over the latest tick's ledgers, of an invariant listed with `ledgered`.
    with_ledgers: Option<LedgerCheck>,
}

type LedgerCheck = fn(&WorldState, &Ledgers) -> Vec<InvariantViolation>;

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
    pub lent_gear: &'a [crate::npc_hooks::LentGear],
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
        match self.with_ledgers {
            Some(check) => check(world, ledgers),
            None => (self.check)(world, terrain),
        }
    }
}

/// An invariant over the world alone.
pub const fn invariant(
    name: &'static str,
    check: fn(&WorldState, &TerrainMap) -> Vec<InvariantViolation>,
) -> Invariant {
    Invariant { name, check, with_ledgers: None }
}

/// An invariant over a tick's ledgers: without them it finds nothing.
pub const fn ledgered(name: &'static str, check: LedgerCheck) -> Invariant {
    fn nothing(_: &WorldState, _: &TerrainMap) -> Vec<InvariantViolation> {
        Vec::new()
    }
    Invariant { name, check: nothing, with_ledgers: Some(check) }
}

/// Every domain's invariants, by the name of its file.
const CORE_DOMAINS: &[(&str, &[Invariant])] = &[
    ("map", map::INVARIANTS),
    ("residents", residents::INVARIANTS),
    ("survival", survival::INVARIANTS),
    ("realms", realms::INVARIANTS),
    ("cities", cities::INVARIANTS),
    ("buildings", buildings::INVARIANTS),
    ("construction", construction::INVARIANTS),
    ("goods", goods::INVARIANTS),
    ("horses", horses::INVARIANTS),
    ("carriages", carriages::INVARIANTS),
    ("vessels", vessels::INVARIANTS),
    ("fighting", fighting::INVARIANTS),
    ("walls", walls::INVARIANTS),
    ("trade", trade::INVARIANTS),
    ("trade_org", trade_org::INVARIANTS),
];

/// Every domain's invariants, by the name of its file; the NPC ones (`csp-npc`) before `scripts`.
pub fn domains() -> Vec<(&'static str, &'static [Invariant])> {
    let mut all = CORE_DOMAINS.to_vec();
    if crate::npc_hooks::installed() {
        all.extend(crate::npc_hooks::npc_invariants());
    }
    all.push(("scripts", scripts::INVARIANTS));
    all
}

/// Every world invariant, domain by domain.
pub fn world_invariants() -> Vec<Invariant> {
    domains().into_iter().flat_map(|(_, list)| list.iter().copied()).collect()
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
pub fn violation(invariant: &str, message: String, ids: &[&str]) -> InvariantViolation {
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
