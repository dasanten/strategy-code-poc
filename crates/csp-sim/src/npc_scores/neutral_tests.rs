//! With neutral weights the blended scores choose as the fixed bands did (ADR 0039): the jobs the
//! planning pass gave on staged cities before the blend are kept in `neutral.json`, and the pass
//! with `NpcJobWeights::NEUTRAL` must give the same. Set `CSP_WRITE_NEUTRAL=1` to write it anew,
//! only ever from a planner that chooses as the fixed bands did.

use std::collections::BTreeMap;

use csp_shared::balance::NpcJobWeights;
use csp_shared::world::{BuildingKind, Good, ResourceKind, Stock, WorldState};

use crate::npc_plan::plan_city;
use crate::npc_scores::with_job_weights;
use crate::npc_slow::big_city_fixture::big_city;
use crate::npc_slow::{add_workplace, past_reserve};
use crate::npc_test_world::{fill_houses, storage_of, village, FOREST};

const SNAPSHOT: &str = "src/npc_scores/neutral.json";

/// Each resident's job after a pass, as `kind@building`.
fn jobs_of(world: &WorldState, city: &str) -> BTreeMap<String, String> {
    world.city_plans[city]
        .jobs
        .iter()
        .map(|(id, j)| {
            let kind = serde_json::to_value(j.kind).expect("a kind");
            let at = j.building_id.clone().unwrap_or_default();
            (id.clone(), format!("{}@{at}", kind.as_str().unwrap_or("")))
        })
        .collect()
}

fn set_stock(world: &mut WorldState, city: &str, stock: Stock) {
    let s = storage_of(world, city);
    world.buildings[s].stock = Some(stock);
}

/// Three passes, the stock set before each, and the jobs after each.
fn passes(
    world: &mut WorldState,
    terrain: &csp_shared::terrain::TerrainMap,
    city: &str,
    stocks: &[Stock],
) -> Vec<BTreeMap<String, String>> {
    stocks
        .iter()
        .map(|stock| {
            set_stock(world, city, stock.clone());
            plan_city(world, city, Some(terrain), None, None);
            jobs_of(world, city)
        })
        .collect()
}

/// The village, full, everyone free at home, two lumber camps (one far), two quarries (one far)
/// and a smithy.
fn village_passes() -> Vec<BTreeMap<String, String>> {
    let mut v = village(None);
    fill_houses(&mut v.world, &v.city, &v.home);
    let (hx, hy) = (v.home.x, v.home.y);
    for r in &mut v.world.residents {
        (r.x, r.y, r.order, r.script) = (hx, hy, None, None);
    }
    let city = v.city.clone();
    let (fx, fy) = (f64::from(FOREST.0), f64::from(FOREST.1));
    let w = &mut v.world;
    let t = &mut v.terrain;
    add_workplace(w, t, &city, BuildingKind::LumberCamp, None, fx, fy);
    add_workplace(w, t, &city, BuildingKind::Quarry, Some(ResourceKind::Stone), fx + 30.0, fy);
    add_workplace(w, t, &city, BuildingKind::LumberCamp, Some(ResourceKind::Forest), fx + 4.0, fy);
    add_workplace(w, t, &city, BuildingKind::Quarry, Some(ResourceKind::Stone), fx, fy + 8.0);
    add_workplace(w, t, &city, BuildingKind::Smithy, None, fx, fy + 16.0);
    let none = Stock::new();
    let reserve = past_reserve(&v.world, &city, &[]);
    let mut fed = reserve.clone();
    fed.insert(Good::Wood, 0.0);
    passes(&mut v.world, &v.terrain, &city, &[none, fed, reserve])
}

/// The staged big city with a second camp, quarry and mine further out.
fn big_city_passes() -> Vec<BTreeMap<String, String>> {
    let mut s = big_city(None, 240);
    let city = s.city.clone();
    let east = 60.0 + csp_shared::balance::NPC_TOWN.size + 40.0;
    for (i, (kind, resource)) in [
        (BuildingKind::LumberCamp, ResourceKind::Forest),
        (BuildingKind::Quarry, ResourceKind::Stone),
        (BuildingKind::Mine, ResourceKind::IronOre),
    ]
    .into_iter()
    .enumerate()
    {
        let y = 70.0 + i as f64 * 10.0;
        add_workplace(&mut s.world, &mut s.terrain, &city, kind, Some(resource), east, y);
    }
    let reserve = past_reserve(&s.world, &city, &[]);
    let mut short = reserve.clone();
    for g in [Good::Wood, Good::Stone, Good::IronOre] {
        short.insert(g, 0.0);
    }
    let surplus = past_reserve(&s.world, &city, &[(Good::Wood, 2.0)]);
    passes(&mut s.world, &s.terrain, &city, &[short, reserve, surplus])
}

#[test]
fn neutral_weights_choose_as_the_fixed_bands_did_on_the_staged_cities() {
    let now = with_job_weights(NpcJobWeights::NEUTRAL, || {
        let mut m = BTreeMap::new();
        m.insert("village".to_string(), village_passes());
        m.insert("bigCity".to_string(), big_city_passes());
        m
    });
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(SNAPSHOT);
    if std::env::var("CSP_WRITE_NEUTRAL").is_ok() {
        std::fs::write(&path, serde_json::to_string_pretty(&now).expect("json") + "\n")
            .expect("written");
        return;
    }
    let kept: BTreeMap<String, Vec<BTreeMap<String, String>>> =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("the snapshot"))
            .expect("the snapshot");
    // Somebody must be working somewhere, or the snapshot shows nothing.
    assert!(kept["village"].iter().flat_map(|p| p.values()).any(|j| j.starts_with("work@")));
    assert_eq!(now, kept);
}
