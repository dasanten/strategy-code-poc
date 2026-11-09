//! The NPC chain (`npc_chain`, `npc_coins`) against the frozen TypeScript: `src/npc/chain.json`,
//! written by `src/npc/gen-expected.mts`, holds for every city of the stepped fixture worlds its
//! shortages, what it lacks of its reserve, whether it earns Coins, its workplaces' surplus work,
//! its chain store and the Trade Organization's reserve and stock.

mod common;

use csp_shared::world::WorldState;
use csp_sim::npc_chain::{
    chain_store, own_workplaces, reserve_lacks, shortages, trade_org_reserve, warehouse_stock,
    Shortage, SurplusWork,
};
use csp_sim::npc_coins::earns_coins;
use serde_json::{json, Value};

use common::{assert_same_json, read_json, terrain_of};

fn shortages_json(s: &[Shortage]) -> Value {
    Value::Array(s.iter().map(|s| json!({ "good": s.good, "share": s.share })).collect())
}

#[test]
fn every_city_of_the_fixtures_is_short_of_what_it_is_short_of_in_typescript() {
    let expected: Value =
        serde_json::from_str(include_str!("../src/npc/chain.json")).expect("chain.json");
    for case in expected.as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let file = read_json(&format!("worlds/{name}.json"));
        let size = terrain_of(&file).size;
        let world: WorldState = serde_json::from_value(file["world"].clone()).unwrap();
        for want in case["cities"].as_array().unwrap() {
            let id = want["id"].as_str().unwrap();
            let city = world.cities.iter().find(|c| c.id == id).unwrap();
            let project = world.city_plans.get(id).and_then(|p| p.project.as_ref());
            let store = chain_store(&world, city);
            let surplus = SurplusWork::of(&world, city, store);
            let got = json!({
                "id": id,
                "shortages": shortages_json(&shortages(&world, city, size, project)),
                "lacks": shortages_json(&reserve_lacks(&world, city, None)),
                "earnsCoins": earns_coins(&world, city, size),
                "surplus": own_workplaces(&world, city)
                    .iter()
                    .map(|b| json!([b.id, surplus.full(&world, b)]))
                    .collect::<Vec<_>>(),
                "store": store.map(|b| b.id.clone()),
                "tradeOrgReserve": trade_org_reserve(&world, city),
                "warehouseStock": warehouse_stock(&world, city),
            });
            assert_same_json(&format!("{name} {id}"), want, &got);
        }
    }
}
