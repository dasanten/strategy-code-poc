//! Paying an NPC city's demand (`CONTEXT.md`: NPC demand, Demand): by a Transfer to the city,
//! which settles its threat and standing toward the payer. From the fixture
//! `fixtures/trade/transfers.json`.

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;
mod transfers_fixture;

use csp_shared::balance::{NPC_DEMAND_COINS, NPC_DEMAND_REFUSED_STANDING};
use csp_shared::world::{Building, Good, WorldState};
use csp_sim::demands::{demands_sound, send_npc_demand, step_demands};
use csp_npc::npc_demands::npc_demands_sound;
use csp_sim::queries::standing::standing_of;
use csp_sim::standing::change_standing;
use serde_json::{json, Value};
use transfers_fixture::{add_city, setup, Fixture, IVO};

const NPC: &str = "npc1";

/// An NPC city with a storage near Mara's, which holds a threat from Ivo and thinks little of him,
/// and has sent him its demand.
fn demanded() -> (Fixture, String) {
    let mut s = setup();
    let (x, y) = s.xy(&s.storage);
    add_city(&mut s.world, NPC, "Ironhold", x, y + 12.0);
    let storage: Building = serde_json::from_value(json!({
        "id": "npc1-storage", "kind": "storage", "cityId": NPC, "x": x + 3.0, "y": y + 12.0,
    }))
    .unwrap();
    s.world.buildings.push(storage);
    let to_storage = s.to_storage.clone();
    s.b_mut(&to_storage).stock = Some([(Good::Coins, 3_000.0)].into_iter().collect());
    let other = s.other.clone();
    let city = s.world.cities.iter_mut().find(|c| c.id == NPC).unwrap();
    city.threats = Some([(other.clone(), 40.0)].into_iter().collect());
    change_standing(&mut s.world, NPC, &other, -20.0);
    send_npc_demand(&mut s.world, NPC, &other);
    let id = s.world.demands.last().unwrap().id.clone();
    (s, id)
}

fn accept(s: &mut Fixture, id: &str, hand_over: Value) -> String {
    s.send(IVO, json!({ "kind": "acceptDemand", "demandId": id, "handOver": hand_over }))
}

fn threat(world: &WorldState, org: &str) -> Option<f64> {
    let city = world.cities.iter().find(|c| c.id == NPC).unwrap();
    city.threats.as_ref().and_then(|t| t.get(org).copied())
}

#[test]
fn an_npc_citys_demand_is_paid_by_a_transfer_to_it_which_settles_threat_and_standing() {
    let (mut s, id) = demanded();
    assert_eq!(npc_demands_sound(&s.world), vec![]);
    assert_eq!(demands_sound(&s.world), vec![]);
    let to_city = s.to_city.clone();
    let way = json!({ "way": "transfer", "fromCityId": to_city, "toCityId": NPC });
    assert_eq!(accept(&mut s, &id, way), "ack");
    assert!(s.world.demands.is_empty());
    let made: Vec<_> = s
        .world
        .transfers
        .iter()
        .map(|t| (t.realm_id.clone(), t.to_realm_id.clone(), t.to_city_id.clone(), t.good, t.units))
        .collect();
    assert_eq!(
        made,
        vec![(s.other.clone(), NPC.into(), NPC.into(), Good::Coins, NPC_DEMAND_COINS)]
    );
    assert_eq!(threat(&s.world, &s.other), None);
    assert_eq!(standing_of(&s.world, NPC, &s.other), 0.0);
}

#[test]
fn an_npc_city_fetches_nothing_set_aside() {
    let (mut s, id) = demanded();
    let storage = s.to_storage.clone();
    let reason = accept(&mut s, &id, json!({ "way": "setAside", "storageId": storage }));
    assert!(reason.contains("send it by a Transfer"), "{reason}");
    assert_eq!(s.world.demands.len(), 1);
}

#[test]
fn refusing_an_npc_citys_demand_turns_it_hostile_and_keeps_its_threat() {
    let (mut s, id) = demanded();
    assert_eq!(s.send(IVO, json!({ "kind": "declineDemand", "demandId": id })), "ack");
    assert_eq!(standing_of(&s.world, NPC, &s.other), NPC_DEMAND_REFUSED_STANDING);
    assert_eq!(threat(&s.world, &s.other), Some(40.0));
}

#[test]
fn letting_an_npc_citys_demand_lapse_turns_it_hostile_too() {
    let (mut s, _) = demanded();
    s.world.tick = s.world.demands[0].deadline as u64;
    step_demands(&mut s.world);
    assert!(s.world.demands.is_empty());
    assert_eq!(standing_of(&s.world, NPC, &s.other), NPC_DEMAND_REFUSED_STANDING);
}
