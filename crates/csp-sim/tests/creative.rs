//! Creative actions (T117.3, `CONTEXT.md`: Creative mode, ADR 0043): goods given and taken, and
//! finish now, which leaves the world as finishing at normal speed would. Every invariant holds
//! after each action; none of them is an order kind or a script call.

mod build_common;

use build_common::*;
use csp_shared::balance::{BUILD_MATERIALS, CARRIAGE_CAPACITY};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, Carriage, Good, ResidentOrder, Stat, Stock, WorldState,
};
use csp_sim::creative::{finish_now, give_goods, take_goods, CREATIVE_ACTIONS};
use csp_sim::orders::order_kinds;
use csp_sim::queries::balance::training_gain;
use csp_sim::queries::building::road_at;
use csp_sim::script_tables::{ARMY_SCRIPT_API, SCRIPT_API};
use serde_json::json;

/// Realm r1 (Player 7) with its city c1 (town hall on (10, 10)) and its resident w1 on (x, y).
fn city_world(x: f64, y: f64) -> (WorldState, TerrainMap, Orders) {
    let terrain = plains(24);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "w1"));
    add_city(&mut world, "c1", Some("r1"), 10.0, 10.0);
    resident(&mut world, "w1", x, y);
    world.residents[0].city_id = Some("c1".into());
    (world, terrain, Orders::default())
}

fn held(stock: Option<&Stock>, good: Good) -> f64 {
    stock.and_then(|s| s.get(&good)).copied().unwrap_or(0.0)
}

/// What of a building the finishing decides: kind, place, site, realm and city.
fn finished_part(b: &Building) -> serde_json::Value {
    json!([b.kind, b.x, b.y, b.site, b.realm_id, b.city_id])
}

#[test]
fn goods_given_and_taken_land_in_a_storage_and_never_go_below_none() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    let mut storage = building("s1", BuildingKind::Storage, 14.0, 10.0);
    storage.city_id = Some("c1".into());
    world.buildings.push(storage);
    let stock = |w: &WorldState| w.buildings.iter().find(|b| b.id == "s1").unwrap().stock.clone();

    assert_eq!(give_goods(&mut world, "s1", Good::Wood, 100.0), Ok(100.0));
    assert_eq!(held(stock(&world).as_ref(), Good::Wood), 100.0);
    assert_sound(&world, &terrain);
    assert_eq!(take_goods(&mut world, "s1", Good::Wood, 30.0), Ok(30.0));
    assert_eq!(held(stock(&world).as_ref(), Good::Wood), 70.0);
    // Never below none: only what is there is taken, and the good is gone.
    assert_eq!(take_goods(&mut world, "s1", Good::Wood, 500.0), Ok(70.0));
    assert_eq!(stock(&world).unwrap().get(&Good::Wood), None);
    assert_eq!(take_goods(&mut world, "s1", Good::Stone, 5.0), Ok(0.0));
    assert_sound(&world, &terrain);

    // Whole units only, and only where goods are kept.
    assert!(give_goods(&mut world, "s1", Good::Wood, 1.5).is_err());
    assert!(give_goods(&mut world, "s1", Good::Wood, 0.0).is_err());
    assert!(give_goods(&mut world, "s1", Good::Wood, -3.0).is_err());
    assert!(give_goods(&mut world, "c1-hall", Good::Wood, 10.0).is_err());
    assert!(give_goods(&mut world, "nowhere", Good::Wood, 10.0).is_err());
    assert_sound(&world, &terrain);
}

#[test]
fn goods_given_and_taken_land_in_a_carriage_up_to_what_it_holds() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    world.carriages.push(Carriage {
        id: "k1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 6.0,
        y: 6.0,
        horse_id: None,
        load: Stock::new(),
    });
    let load = |w: &WorldState| w.carriages[0].load.clone();
    assert_eq!(give_goods(&mut world, "k1", Good::Food, 20.0), Ok(20.0));
    assert_eq!(held(Some(&load(&world)), Good::Food), 20.0);
    assert_sound(&world, &terrain);
    // More than it holds is refused, and nothing changes.
    let too_much = CARRIAGE_CAPACITY; // Stone weighs more than a kilogram a unit.
    assert!(give_goods(&mut world, "k1", Good::Stone, too_much).is_err());
    assert_eq!(held(Some(&load(&world)), Good::Stone), 0.0);
    assert_eq!(take_goods(&mut world, "k1", Good::Food, 25.0), Ok(20.0));
    assert!(load(&world).is_empty());
    assert_sound(&world, &terrain);
}

/// w1 lays out a house on (14, 13), next to the city's town hall, and stands there with its order.
fn house_site() -> (WorldState, TerrainMap, Orders, String) {
    let (mut world, terrain, mut orders) = city_world(14.0, 13.0);
    let o = json!({ "kind": "build", "residentId": "w1", "building": "house" });
    assert_eq!(order(&mut world, &mut orders, &player(7), o, &terrain), Ok(()));
    let id = site_of(&world).expect("the house site").id.clone();
    assert!(matches!(&world.residents[0].order, Some(ResidentOrder::Build(_))));
    (world, terrain, orders, id)
}

#[test]
fn finish_now_leaves_a_house_as_building_it_at_normal_speed_would() {
    let (mut now, terrain, _, id) = house_site();
    let mut normal = now.clone();

    assert!(finish_now(&mut now, &id, Some(&terrain)).is_ok());
    let house = now.buildings.iter().find(|b| b.id == id).unwrap();
    assert!(house.site.is_none(), "the house is built");
    assert!(now.residents[0].order.is_none(), "the builder is freed");
    assert_sound(&now, &terrain);

    // At normal speed: w1 has the materials and works until the house is done.
    let materials: Stock = serde_json::from_value(json!(BUILD_MATERIALS.get("house").unwrap()))
        .expect("the house's materials");
    let site = normal.buildings.iter_mut().find(|b| b.id == id).unwrap();
    site.site.as_mut().unwrap().delivered = materials;
    run_walking(&mut normal, &terrain, 50_000, |w| w.residents[0].order.is_none());
    let built = normal.buildings.iter().find(|b| b.id == id).unwrap();
    assert!(built.site.is_none());
    assert_eq!(finished_part(house), finished_part(built));
    assert_eq!(now.cities, normal.cities);
    // A finished site is nothing left to finish.
    assert!(finish_now(&mut now, &id, Some(&terrain)).is_err());
}

#[test]
fn finish_now_builds_the_rest_of_a_road_line_and_frees_its_builder() {
    let map = plains(10);
    let mut world = empty_world(&map);
    world.realms.push(realm("r1", 7, "w1"));
    resident(&mut world, "w1", 1.0, 1.0);
    let stone = BUILD_MATERIALS.get("road").unwrap().get("stone").unwrap();
    world.residents[0].carried = Stock::from([(Good::Stone, 3.0 * stone)]);
    let mut orders = Orders::default();
    let line = json!({
        "kind": "roadLine", "residentId": "w1", "from": { "x": 2, "y": 1 }, "to": { "x": 5, "y": 1 }
    });
    assert_eq!(orders.receive(&world, &player(7), line, &map), Ok(()));
    orders.apply_all(&mut world, &map);
    // Walk to the first tile and lay out its site.
    run_walking(&mut world, &map, 5_000, |w| site_of(w).is_some());
    let id = site_of(&world).unwrap().id.clone();

    let done = finish_now(&mut world, &id, Some(&map)).unwrap();
    assert!(done.contains("3 more tiles"), "{done}");
    for x in 2..=5 {
        assert!(road_at(&world, x, 1).is_some_and(|b| b.site.is_none()), "road on ({x}, 1)");
    }
    assert!(world.residents[0].order.is_none(), "the line is done");
    assert_sound(&world, &map);
}

#[test]
fn finish_now_trains_every_trainee_as_far_as_their_teacher_takes_them() {
    let terrain = plains(16);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "t1"));
    world.buildings.push(building("g1", BuildingKind::TrainingGround, 3.0, 3.0));
    for (id, x, y) in [("t1", 4.0, 4.0), ("a1", 3.0, 3.0), ("a2", 5.0, 5.0)] {
        let i = resident(&mut world, id, x, y);
        world.residents[i].stats.strength = Stat { base: 10.0, trained: 0.0 };
    }
    world.residents[0].stats.strength = Stat { base: 15.0, trained: 0.0 };
    let mut orders = Orders::default();
    let teach =
        json!({ "kind": "teach", "residentId": "t1", "buildingId": "g1", "subject": "strength" });
    assert_eq!(orders.receive(&world, &player(7), teach, &terrain), Ok(()));
    orders.apply_all(&mut world, &terrain);
    for id in ["a1", "a2"] {
        let train = json!({ "kind": "train", "residentId": id, "buildingId": "g1" });
        assert_eq!(orders.receive(&world, &player(7), train, &terrain), Ok(()));
    }
    orders.apply_all(&mut world, &terrain);

    assert_eq!(
        finish_now(&mut world, "g1", Some(&terrain)),
        Ok("2 trainees finished training.".into())
    );
    let tick = world.tick as f64;
    let teacher = world.residents[0].clone();
    for r in &world.residents[1..] {
        assert!(r.order.is_none(), "{} is freed", r.id);
        assert!(r.stats.strength.trained > 0.0, "{} trained", r.id);
        // A tick more would teach them nothing.
        let more = training_gain(r, &teacher, csp_shared::world::TrainingSubject::Strength, tick);
        assert!(more <= 1e-9, "{} could still gain {more}", r.id);
    }
    // The teacher goes on teaching, as at normal speed.
    assert!(matches!(world.residents[0].order, Some(ResidentOrder::Teach(_))));
    assert_sound(&world, &terrain);
    assert_eq!(finish_now(&mut world, "g1", Some(&terrain)), Err("Nobody trains here.".into()));
}

#[test]
fn finish_now_refuses_what_has_nothing_to_finish() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    assert!(finish_now(&mut world, "c1-hall", Some(&terrain)).is_err());
    assert!(finish_now(&mut world, "nowhere", Some(&terrain)).is_err());
    assert_sound(&world, &terrain);
}

#[test]
fn no_creative_action_is_an_order_kind_or_a_script_call() {
    let kinds = order_kinds();
    for name in CREATIVE_ACTIONS {
        assert!(!kinds.contains(name), "{name} is an order kind");
        assert!(SCRIPT_API.iter().all(|b| b.name != name), "{name} is in the script API");
        assert!(ARMY_SCRIPT_API.iter().all(|b| b.name != name), "{name} is in the army API");
    }
}
