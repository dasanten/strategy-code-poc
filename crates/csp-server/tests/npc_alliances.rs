//! `npc-alliances.test.ts`, the case on the `diplomacyFor` view and shared walls. The rest of that
//! file is in `csp-sim/src/alliances/npc_tests.rs`.

use std::sync::Arc;

use csp_server::diplomacy::diplomacy_for;
use csp_shared::balance::NPC_ALLIANCE_JOIN_STANDING;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Building, City, Realm, WorldState};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue};
use csp_sim::queries::alliance::alliance_of;
use csp_sim::random::Mulberry32;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::standing::change_standing;
use csp_sim::walls::wall_map;
use csp_sim::world::create_world;
use serde_json::{json, Value};

const SIZE: i32 = 256;

fn resident(world: &mut WorldState, id: &str, owner: Option<&str>, x: f64, y: f64) {
    let city_id = owner.is_none().then_some("npc");
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner, city_id, x, y, tick: world.tick as f64 };
    world.residents.push(new_resident(&mut || m.next(), &fields, None));
}

/// A city of nobody with its town hall at (x, y) (`addCity`).
fn add_city(world: &mut WorldState, id: &str, name: &str, x: f64, y: f64, trade_org: Value) {
    let hall =
        json!({ "id": format!("{id}-hall"), "kind": "townHall", "cityId": id, "x": x, "y": y });
    world.buildings.push(serde_json::from_value::<Building>(hall).unwrap());
    let city = json!({
        "id": id, "name": name, "realmId": null, "townHallId": format!("{id}-hall"),
        "layout": (if trade_org.is_null() { json!("grid") } else { Value::Null }),
        "tradeOrg": trade_org,
    });
    world.cities.push(serde_json::from_value::<City>(city).unwrap());
}

fn order(world: &mut WorldState, terrain: &Arc<TerrainMap>, user_id: u64, o: Value) {
    let mut queue = OrderQueue::new(order_kinds(), Some(terrain.clone()));
    let sender = OrderSender::player(user_id, &format!("p{user_id}"));
    queue.receive(world, &sender, &json!("q"), &o);
    queue.apply_all(world);
}

#[test]
fn shares_walls_and_shows_as_an_npc_city_in_alliance_matters() {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let terrain = Arc::new(terrain);
    let mut world = create_world(&terrain, 1);
    for (id, user, leader) in [("r1", 1, "a1"), ("r2", 2, "b1")] {
        let realm = json!({ "id": id, "userId": user, "leaderId": leader });
        world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    }
    resident(&mut world, "a1", Some("r1"), 20.0, 20.0);
    resident(&mut world, "b1", Some("r2"), 160.0, 20.0);
    add_city(&mut world, "npc", "Dunmere", 80.0, 80.0, Value::Null);
    resident(&mut world, "n1", None, 84.0, 80.0);
    add_city(&mut world, "post", "Post", 200.0, 200.0, json!("post"));
    order(&mut world, &terrain, 1, json!({ "kind": "foundAlliance", "name": "North" }));
    let alliance = alliance_of(&world, "r1").expect("North").id.clone();
    order(&mut world, &terrain, 1, json!({ "kind": "inviteToAlliance", "realmId": "r2" }));
    order(&mut world, &terrain, 2, json!({ "kind": "acceptInvite", "allianceId": alliance }));
    for r in ["r1", "r2"] {
        change_standing(&mut world, "npc", r, NPC_ALLIANCE_JOIN_STANDING);
    }

    let wall = json!({ "id": "w", "kind": "wall", "cityId": "npc", "x": 88, "y": 88 });
    world.buildings.push(serde_json::from_value::<Building>(wall).unwrap());
    let view = diplomacy_for(&world, "r1", ["npc", "post"], Vec::new());
    let in_sight = serde_json::to_value(&view.realms_in_sight).unwrap();
    assert_eq!(in_sight, json!([{ "realmId": "npc", "realm": "Dunmere", "city": true }]));
    let wall_sides = |world: &WorldState| {
        wall_map(world, &terrain).tiles[&((88 * SIZE + 88) as usize)].realms.clone()
    };
    assert_eq!(wall_sides(&world), ["npc"]);
    order(&mut world, &terrain, 1, json!({ "kind": "inviteToAlliance", "realmId": "npc" }));
    assert_eq!(wall_sides(&world), ["r1", "r2", "npc"]);
    let view = diplomacy_for(&world, "r2", [], Vec::new());
    let last = view.alliance.expect("an alliance").members.last().cloned().expect("a member");
    let last = serde_json::to_value(last).unwrap();
    assert_eq!(last["realmId"], "npc");
    assert_eq!(last["realm"], "Dunmere");
    assert_eq!(last["city"], true);
    assert!(view.realms_in_sight.is_empty());
}
