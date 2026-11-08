//! `apps/server/src/admin-map.test.ts`, its world view, places and inspection. "admin map API"
//! (the HTTP routes and their admin check) is the shell's (T87.5).

use std::collections::HashMap;

use csp_shared::world::{BuildingKind, Good, WorldState};
use serde_json::{json, Value};

use super::*;
use crate::realm_test_world::{add_city, building, plains, resident};
use crate::world::create_world;

const SIZE: i32 = 64;

struct Lookups;

impl AdminLookups for Lookups {
    fn account_of(&self, user_id: u64) -> Option<String> {
        (user_id == 1).then(|| "Mara".to_string())
    }
    fn script_name(&self, script_id: u64) -> Option<String> {
        (script_id == 1).then(|| "Miner".to_string())
    }
}

fn person(world: &mut WorldState, id: &str, owner: Option<&str>, city: &str, x: f64, y: f64) {
    let mut r = resident(id, owner, x, y);
    r.name = id.into();
    r.city_id = Some(city.into());
    world.residents.push(r);
}

/// Realm r1 (Player 1, Leader a1 at the top right corner, army Vanguard) with city c1 at the top
/// left, in the alliance North; the self-managed city n1 in the middle with a horse; the Trade Org
/// HQ near the bottom right with a caravan from its trading post p1 standing in the corner; a pile.
fn setup() -> WorldState {
    let mut world = create_world(&plains(SIZE), 1);
    world.nodes.clear();
    world.realms.push(
        serde_json::from_value(json!({"id": "r1", "userId": 1, "leaderId": "a1"}))
            .expect("a realm"),
    );
    let north = json!({"id": "al1", "name": "North", "leaderId": "r1",
        "members": [{"realmId": "r1", "joinedAt": 0, "leaving": null}], "invites": [], "army": []});
    world.alliances.push(serde_json::from_value(north).expect("an alliance"));
    add_city(&mut world, "c1", Some("r1"), 1.0, 1.0, "Ashford");
    add_city(&mut world, "n1", None, 40.0, 40.0, "Nook");
    world.cities[1].former_player =
        Some(serde_json::from_value(json!({"userId": 2, "tick": 0})).expect("a former Player"));
    add_city(&mut world, "hq", None, 50.0, 50.0, "Exchange");
    add_city(&mut world, "p1", None, 20.0, 50.0, "Ferry");
    for (id, org) in [("hq", "hq"), ("p1", "post")] {
        let c = world.cities.iter_mut().find(|c| c.id == id).expect("a city");
        c.trade_org = Some(serde_json::from_value(json!(org)).expect("a Trade Org city"));
        c.layout = None;
    }
    person(&mut world, "a1", Some("r1"), "c1", 62.0, 2.0);
    world.residents[0].script = Some(
        serde_json::from_value(json!({"scriptId": 1, "memory": {"trips": 3}})).expect("a script"),
    );
    person(&mut world, "n-1", None, "n1", 40.0, 41.0);
    person(&mut world, "d1", None, "hq", 63.0, 63.0);
    let mut horse: csp_shared::world::Horse = serde_json::from_value(json!({
        "id": "h1", "name": "Rowan", "realmId": null, "cityId": "n1", "x": 41, "y": 40, "hunger": 100, "health": 100,
        "stats": {"speed": 10, "strength": 10, "endurance": 10}, "bornAt": 0
    }))
    .expect("a horse");
    horse.city_id = Some("n1".into());
    world.horses.push(horse);
    let carriage = |id: &str, x: f64, load: Value| {
        serde_json::from_value::<csp_shared::world::Carriage>(
            json!({"id": id, "realmId": null, "cityId": "hq", "x": x, "y": x, "horseId": null, "load": load}),
        )
        .expect("a carriage")
    };
    world.carriages.push(carriage("k1", 63.0, json!({})));
    world.caravans.push(
        serde_json::from_value(json!({
            "id": "cv1", "postId": "p1", "carriageId": "k1", "driverId": "d1", "escortIds": [], "heading": "post",
            "stop": "storage", "toLoad": null, "holding": null, "job": null, "transfer": null
        }))
        .expect("a caravan"),
    );
    world.carriages.push(carriage("k2", 61.0, json!({"wood": 2})));
    world.traders.push(
        serde_json::from_value(json!({
            "id": "tr1", "carriageId": "k2", "driverId": "d2", "escortIds": [], "loop": ["p1"], "postId": "p1",
            "heading": "post", "stop": "warehouse", "plan": null, "holding": null, "misses": 0, "robberies": 0,
            "calls": null, "stand": null
        }))
        .expect("a trader"),
    );
    world.armies.push(
        serde_json::from_value(json!({"id": "ar1", "name": "Vanguard", "realmId": "r1", "memberIds": ["a1"], "order": null}))
            .expect("an army"),
    );
    world.piles.push(
        serde_json::from_value(json!({"id": "pl1", "x": 2, "y": 2, "goods": {"wood": 4}}))
            .expect("a pile"),
    );
    world
}

/// Whether `value` holds everything `pattern` has (`toMatchObject`): objects by the pattern's
/// keys, arrays element by element and of the same length, anything else equal.
fn matches(value: &Value, pattern: &Value) -> bool {
    match (value, pattern) {
        (Value::Object(v), Value::Object(p)) => {
            p.iter().all(|(k, pv)| v.get(k).is_some_and(|vv| matches(vv, pv)))
        }
        (Value::Array(v), Value::Array(p)) => {
            v.len() == p.len() && v.iter().zip(p).all(|(a, b)| matches(a, b))
        }
        // A JavaScript number is one kind: 40 and 40.0 are the same.
        (Value::Number(v), Value::Number(p)) => v.as_f64() == p.as_f64(),
        _ => value == pattern,
    }
}

#[track_caller]
fn assert_matches(value: &Value, pattern: Value) {
    assert!(matches(value, &pattern), "{value:#} does not match {pattern:#}");
}

fn view(world: &WorldState, x: i32, y: i32, w: i32, h: i32, cities_only: bool) -> Value {
    admin_world_view(world, SIZE, &AdminViewRequest { x, y, w, h, cities_only }, &Lookups)
}

fn ids(view: &Value) -> Vec<String> {
    let mut ids: Vec<String> = view["entities"]
        .as_array()
        .expect("entities")
        .iter()
        .map(|e| e["id"].as_str().expect("an id").to_string())
        .collect();
    ids.sort();
    ids
}

#[test]
fn gives_every_entity_in_a_rectangle_that_wraps_around_the_map_edges() {
    let world = setup();
    // From (60, 60), 8 × 8 tiles: x and y 60–63 and 0–3, the four corners of the map.
    let corner = view(&world, 60, 60, 8, 8, false);
    let mut want = vec!["a1", "ar1", "c1", "c1-hall", "cv1", "d1", "k1", "k2", "pl1", "tr1"];
    want.sort_unstable();
    assert_eq!(ids(&corner), want);
    assert_eq!(corner["tick"], json!(world.tick));
    // The same corner asked for from the other side of the edge.
    assert_eq!(ids(&view(&world, -4, -4, 8, 8, false)), ids(&corner));
    assert_eq!(ids(&view(&world, 38, 38, 6, 6, false)), vec!["h1", "n-1", "n1", "n1-hall"]);
}

#[test]
fn tags_each_entity_with_its_organization_and_names_those() {
    let world = setup();
    let all = view(&world, 0, 0, 64, 64, false);
    let org = |id: &str| {
        all["entities"]
            .as_array()
            .expect("entities")
            .iter()
            .find(|e| e["id"] == id)
            .expect("an entity")["org"]
            .clone()
    };
    for (id, want) in [
        ("a1", json!("r1")),
        ("c1", json!("r1")),
        ("c1-hall", json!("r1")),
        ("ar1", json!("r1")),
        ("n-1", json!("n1")),
        ("h1", json!("n1")),
        ("hq", json!(TRADE_ORGANIZATION)),
        ("d1", json!(TRADE_ORGANIZATION)),
        ("k1", json!(TRADE_ORGANIZATION)),
        ("cv1", json!(TRADE_ORGANIZATION)),
        ("pl1", Value::Null),
    ] {
        assert_eq!(org(id), want, "the Organization of {id}");
    }
    assert_eq!(
        all["orgs"],
        json!([
            {"id": "n1", "is": "city", "name": "Nook", "alliance": null},
            {"id": "r1", "is": "realm", "name": "a1", "account": "Mara", "alliance": {"id": "al1", "name": "North"}},
            {"id": TRADE_ORGANIZATION, "is": "tradeOrg", "name": TRADE_ORG_NAME, "alliance": null},
        ])
    );
}

#[test]
fn shows_a_script_by_name_and_memory_never_its_source() {
    let v = view(&setup(), 60, 0, 4, 4, false);
    let a1 = v["entities"]
        .as_array()
        .expect("entities")
        .iter()
        .find(|e| e["id"] == "a1")
        .expect("a1")
        .clone();
    assert_matches(
        &a1,
        json!({"is": "resident", "script": {"scriptId": 1, "name": "Miner", "memory": {"trips": 3}}}),
    );
    assert!(!v.to_string().contains("source"));
}

#[test]
fn gives_cities_alone_where_their_town_hall_stands_for_the_far_zoom() {
    let mut world = setup();
    // Nook has two houses and a house site; the site doesn't count.
    for (id, site) in [("nh1", false), ("nh2", false), ("nh3", true)] {
        let mut b = building(id, BuildingKind::House, Some("n1"), 41.0, 41.0);
        if site {
            b.site =
                Some(serde_json::from_value(json!({"delivered": {}, "work": 0})).expect("a site"));
        }
        world.buildings.push(b);
    }
    let v = view(&world, 0, 0, 64, 64, true);
    let entities = v["entities"].as_array().expect("entities");
    assert_eq!(
        entities.iter().map(|e| e["is"].clone()).collect::<Vec<_>>(),
        vec![json!("city"); 4]
    );
    let n1 = entities.iter().find(|e| e["id"] == "n1").expect("n1");
    assert_matches(n1, json!({"x": 40, "y": 40, "houses": 2, "org": "n1"}));
    assert_matches(entities.iter().find(|e| e["id"] == "c1").expect("c1"), json!({"houses": 0}));
}

#[test]
fn reads_a_rectangle_of_whole_numbers_capped_unless_for_cities_only() {
    let q = |x: i32, y: i32, w: i32, h: i32, cities_only: bool| {
        let path = admin_world_path(&AdminViewRequest { x, y, w, h, cities_only });
        let query: HashMap<String, String> = path
            .split('?')
            .nth(1)
            .expect("a query")
            .split('&')
            .map(|kv| {
                let (k, v) = kv.split_once('=').expect("key=value");
                (k.to_string(), v.to_string())
            })
            .collect();
        parse_admin_view(&query, SIZE)
    };
    let map = |pairs: &[(&str, &str)]| {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<HashMap<_, _>>()
    };
    assert_eq!(
        q(-5, 70, 10, 10, false),
        Ok(AdminViewRequest { x: -5, y: 70, w: 10, h: 10, cities_only: false })
    );
    assert_eq!(
        parse_admin_view(&map(&[("x", "1"), ("y", "1"), ("w", "10"), ("h", "10")]), 1000)
            .map(|v| v.w),
        Ok(10)
    );
    let wide = (ADMIN_VIEW_MAX_SIDE + 1).to_string();
    assert!(
        parse_admin_view(&map(&[("x", "0"), ("y", "0"), ("w", &wide), ("h", "1")]), 1000).is_err()
    );
    assert!(q(0, 0, 64, 64, true).is_ok_and(|v| v.cities_only));
    assert!(q(0, 0, 65, 64, true).is_err());
    assert!(q(0, 0, 0, 4, false).is_err());
    assert!(
        parse_admin_view(&map(&[("x", "1.5"), ("y", "0"), ("w", "4"), ("h", "4")]), SIZE).is_err()
    );
    assert!(parse_admin_view(&map(&[("y", "0"), ("w", "4"), ("h", "4")]), SIZE).is_err());
}

#[test]
fn lists_realms_npc_cities_the_trade_org_and_armies_for_the_whole_world() {
    assert_eq!(
        admin_places(&setup(), &Lookups),
        json!({
            "tick": 0,
            "realms": [{
                "id": "r1", "account": "Mara", "name": "a1", "alliance": {"id": "al1", "name": "North"},
                "leader": {"id": "a1", "name": "a1", "x": 62.0, "y": 2.0},
                "cities": [{"id": "c1", "name": "Ashford", "x": 1.0, "y": 1.0}],
            }],
            "npcCities": [{"id": "n1", "name": "Nook", "x": 40.0, "y": 40.0, "selfManaged": true, "alliance": null}],
            "tradeOrg": {
                "hq": {"id": "hq", "name": "Exchange", "x": 50.0, "y": 50.0},
                "posts": [{"id": "p1", "name": "Ferry", "x": 20.0, "y": 50.0}],
                "caravans": [{"id": "cv1", "name": "Ferry", "x": 63.0, "y": 63.0, "postId": "p1", "heading": "post"}],
                "traders": [{"id": "tr1", "name": "Ferry", "x": 61.0, "y": 61.0}],
            },
            "armies": [{"id": "ar1", "name": "Vanguard", "x": 62.0, "y": 2.0, "realmId": "r1", "realm": "a1"}],
        })
    );
}

fn inspect(world: &WorldState, kind: &str, id: &str) -> Option<Value> {
    admin_inspection(world, kind, id, &Lookups)
}

#[test]
fn shows_a_resident_with_their_organization_city_army_and_script_name_never_its_source() {
    let mut world = setup();
    world.residents[0].carried = [(Good::Spear, 1.0), (Good::Food, 2.0)].into_iter().collect();
    assert_matches(
        &inspect(&world, "resident", "a1").expect("a1"),
        json!({
            "is": "resident", "org": {"id": "r1", "is": "realm", "account": "Mara"},
            "city": {"id": "c1", "name": "Ashford"}, "army": {"id": "ar1", "name": "Vanguard"}, "caravan": null,
            "leader": true,
            "resident": {"carried": {"spear": 1.0, "food": 2.0}, "script": {"name": "Miner", "memory": {"trips": 3}}},
        }),
    );
    assert_matches(
        &inspect(&world, "resident", "d1").expect("d1"),
        json!({"org": {"is": "tradeOrg"}, "caravan": {"id": "cv1", "name": "Ferry"}, "leader": false}),
    );
    assert_eq!(inspect(&world, "resident", "gone"), None);
}

#[test]
fn shows_a_city_with_its_residents_buildings_storage_gates_and_soldiers() {
    let mut world = setup();
    let with = |mut b: csp_shared::world::Building,
                f: &dyn Fn(&mut csp_shared::world::Building)| {
        f(&mut b);
        b
    };
    world.buildings.push(with(building("s1", BuildingKind::Storage, Some("c1"), 2.0, 1.0), &|b| {
        b.stock = Some([(Good::Wood, 5.0), (Good::Food, 1.0)].into_iter().collect());
    }));
    world.buildings.push(with(building("s2", BuildingKind::Storage, Some("c1"), 3.0, 1.0), &|b| {
        b.stock = Some([(Good::Wood, 2.0)].into_iter().collect());
    }));
    world.buildings.push(with(building("g1", BuildingKind::Gate, Some("c1"), 4.0, 1.0), &|b| {
        b.closed = Some(true)
    }));
    world.buildings.push(building("g2", BuildingKind::Gate, Some("c1"), 5.0, 1.0));
    world.buildings.push(with(
        building("h-site", BuildingKind::House, Some("c1"), 6.0, 1.0),
        &|b| {
            b.site =
                Some(serde_json::from_value(json!({"delivered": {}, "work": 0})).expect("a site"));
        },
    ));
    person(&mut world, "c1-a", Some("r1"), "c1", 2.0, 2.0);
    world.residents.last_mut().expect("c1-a").carried.insert(Good::Sword, 1.0);
    assert_matches(
        &inspect(&world, "city", "c1").expect("c1"),
        json!({
            "is": "city", "org": {"id": "r1", "is": "realm"}, "city": {"name": "Ashford", "x": 1.0, "y": 1.0},
            "residents": [{"id": "a1", "name": "a1"}, {"id": "c1-a", "name": "c1-a"}],
            "buildings": [["gate", 2.0], ["storage", 2.0], ["townHall", 1.0]],
            "storage": {"wood": 7.0, "food": 1.0}, "gates": {"open": 1, "shut": 1}, "soldiers": 1,
        }),
    );
    assert_matches(
        &inspect(&world, "city", "n1").expect("n1"),
        json!({"org": {"id": "n1", "is": "city"}}),
    );
    assert_matches(&inspect(&world, "city", "hq").expect("hq"), json!({"org": {"is": "tradeOrg"}}));
}

#[test]
fn shows_a_wandering_trader_its_carriage_and_who_is_on_it() {
    let mut world = setup();
    let mut d2 = world.residents.iter().find(|r| r.id == "d1").expect("d1").clone();
    (d2.id, d2.name) = ("d2".into(), "Dee".into());
    world.residents.push(d2);
    assert_matches(
        &inspect(&world, "trader", "tr1").expect("tr1"),
        json!({
            "is": "trader", "org": {"is": "tradeOrg"}, "post": {"id": "p1", "name": "Ferry"},
            "loop": [{"id": "p1", "name": "Ferry"}], "carriage": {"id": "k2", "load": {"wood": 2.0}},
            "crew": [{"id": "d2", "name": "Dee"}],
        }),
    );
    assert_matches(
        &inspect(&world, "carriage", "k2").expect("k2"),
        json!({"org": {"is": "tradeOrg"}, "caravan": null, "driver": {"id": "d2"}, "trader": {"id": "tr1", "name": "Ferry"}}),
    );
    assert_matches(
        &inspect(&world, "resident", "d2").expect("d2"),
        json!({"caravan": null, "trader": {"id": "tr1", "name": "Ferry"}}),
    );
    assert_eq!(inspect(&world, "trader", "gone"), None);
    // Bound for the HQ it goes by the HQ's name, and is still found.
    world.traders[0].post_id = "hq".into();
    world.traders[0].r#loop = vec!["hq".into()];
    assert_eq!(
        admin_places(&world, &Lookups)["tradeOrg"]["traders"],
        json!([{"id": "tr1", "name": "Exchange", "x": 61.0, "y": 61.0}])
    );
}

#[test]
fn shows_carriages_caravans_armies_and_the_rest() {
    let mut world = setup();
    world.carriages[0].load = [(Good::Iron, 3.0)].into_iter().collect();
    assert_matches(
        &inspect(&world, "carriage", "k1").expect("k1"),
        json!({"is": "carriage", "org": {"is": "tradeOrg"}, "carriage": {"load": {"iron": 3.0}}, "driver": {"id": "d1"}, "caravan": {"id": "cv1", "name": "Ferry"}}),
    );
    assert_matches(
        &inspect(&world, "caravan", "cv1").expect("cv1"),
        json!({"is": "caravan", "post": {"id": "p1", "name": "Ferry"}, "carriage": {"id": "k1"}, "crew": [{"id": "d1"}]}),
    );
    world.armies[0].script =
        Some(serde_json::from_value(json!({"scriptId": 1, "memory": {}})).expect("a script"));
    assert_matches(
        &inspect(&world, "army", "ar1").expect("ar1"),
        json!({"is": "army", "org": {"id": "r1"}, "army": {"name": "Vanguard", "script": {"name": "Miner"}}, "members": [{"id": "a1", "x": 62.0, "y": 2.0}]}),
    );
    assert_matches(
        &inspect(&world, "building", "c1-hall").expect("the hall"),
        json!({"org": {"id": "r1"}, "city": {"name": "Ashford"}}),
    );
    assert_matches(&inspect(&world, "horse", "h1").expect("h1"), json!({"org": {"id": "n1"}}));
    assert_matches(
        &inspect(&world, "pile", "pl1").expect("pl1"),
        json!({"org": null, "pile": {"goods": {"wood": 4.0}}}),
    );
}
