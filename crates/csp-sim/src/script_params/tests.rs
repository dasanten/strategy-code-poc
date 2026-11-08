//! `script-params.test.ts`: the params in a script and the set-script-param order. Its cases over
//! the Work and Build defaults storing and fetching by their params run the whole game and come
//! with T86.14; the sight case belongs to the sync tests (Epic 87).

use std::sync::{Arc, Mutex};

use super::*;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queues::tests::resident;
use crate::script_runner::{ScriptHost, ScriptRunner};
use crate::scripts::RunnableScript;
use crate::tick::Scratch;
use crate::world::create_world;
use csp_shared::terrain::Terrain;
use csp_shared::world::{City, Realm};
use serde_json::json;

const SIZE: i32 = 32;
const SCRIPT: u64 = 1;
const MARA: u64 = 1;

const READS: &str = "param home: building\nparam store: storage\nmemory.home = params.home\nmemory.store = params.store\n";

/// Script 1 is Mara's, with the source in the shared slot as its active version.
struct Host(Arc<Mutex<String>>);

impl ScriptLibrary for Host {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        (id == SCRIPT).then(|| RunnableScript {
            user_id: MARA,
            name: "Test".into(),
            version: 1,
            source: self.0.lock().unwrap().clone(),
            follows_default: false,
            task: None,
        })
    }
}

impl ScriptHost for Host {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        ScriptLibrary::script(self, id)
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        Some(OrderSender::player(user_id, "Mara"))
    }
    fn explored(&self, _: u64, _: i32, _: i32) -> bool {
        true
    }
}

fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).unwrap()
}

/// Mara's realm r1 with city c1, a farm at (6, 6) and worker w1 on it running script 1.
fn farm_world() -> (WorldState, Arc<TerrainMap>) {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    world.realms.push(from::<Realm>(json!({ "id": "r1", "userId": MARA, "leaderId": "w1" })));
    world.cities.push(from::<City>(json!({ "id": "c1", "name": "Ashford", "realmId": "r1", "townHallId": "c1-hall", "occupation": null })));
    world.buildings.push(from(
        json!({ "id": "c1-hall", "kind": "townHall", "cityId": "c1", "x": 20, "y": 6 }),
    ));
    world
        .buildings
        .push(from(json!({ "id": "farm", "kind": "farm", "cityId": "c1", "x": 6, "y": 6 })));
    let mut w = resident("w1", Some("r1"), 6.0, 6.0);
    w.city_id = Some("c1".into());
    w.script = Some(from(json!({ "scriptId": SCRIPT, "memory": { "workplaceId": "farm" } })));
    world.residents.push(w);
    (world, Arc::new(terrain))
}

fn storage(world: &mut WorldState, id: &str, x: f64, y: f64) {
    world.buildings.push(from(
        json!({ "id": id, "kind": "storage", "cityId": "c1", "x": x, "y": y, "stock": {} }),
    ));
}

fn runner(terrain: &Arc<TerrainMap>, source: &Arc<Mutex<String>>) -> ScriptRunner {
    ScriptRunner::new(terrain.clone(), Arc::new(Host(source.clone())), order_kinds())
}

fn source(text: &str) -> Arc<Mutex<String>> {
    Arc::new(Mutex::new(text.to_string()))
}

fn memory(world: &WorldState) -> Value {
    Value::Object(world.residents[0].script.as_ref().unwrap().memory.clone())
}

fn picked(world: &WorldState) -> Value {
    serde_json::to_value(&world.residents[0].script_params).unwrap()
}

fn set_params(world: &mut WorldState, v: Value) {
    world.residents[0].script_params = Some(from(v));
}

#[test]
fn params_read_null_while_unset_and_what_was_picked_once_picked() {
    let (mut world, terrain) = farm_world();
    storage(&mut world, "s1", 12.0, 6.0);
    let mut runner = runner(&terrain, &source(READS));
    let mut scratch = Scratch::default();
    assert_eq!(runner.run_all(&mut world, &mut scratch, true), vec![]);
    assert_eq!(memory(&world)["home"], Value::Null);
    assert_eq!(memory(&world)["store"], Value::Null);
    set_params(&mut world, json!({ "1": { "home": "farm", "store": "s1" } }));
    assert_eq!(runner.run_all(&mut world, &mut scratch, true), vec![]);
    assert_eq!(memory(&world)["home"]["id"], "farm");
    assert_eq!(memory(&world)["home"]["kind"], "farm");
    assert_eq!(memory(&world)["store"]["id"], "s1");
}

#[test]
fn params_read_null_once_the_one_picked_is_gone_and_drop_it() {
    let (mut world, terrain) = farm_world();
    storage(&mut world, "s1", 12.0, 6.0);
    set_params(&mut world, json!({ "1": { "home": "farm", "store": "s1" } }));
    world.buildings.retain(|b| b.id != "s1");
    runner(&terrain, &source(READS)).run_all(&mut world, &mut Scratch::default(), false);
    assert_eq!(memory(&world)["store"], Value::Null);
    assert_eq!(picked(&world), json!({ "1": { "home": "farm" } }));
}

#[test]
fn params_read_null_for_one_no_longer_of_the_realm_or_of_the_wrong_type() {
    let (mut world, terrain) = farm_world();
    world.cities.push(from(json!({ "id": "c2", "name": "Elsewhere", "realmId": "r2", "townHallId": "none", "occupation": null })));
    world
        .buildings
        .push(from(json!({ "id": "theirs", "kind": "storage", "cityId": "c2", "x": 9, "y": 9 })));
    // The farm is no storage.
    set_params(&mut world, json!({ "1": { "home": "theirs", "store": "farm" } }));
    runner(&terrain, &source(READS)).run_all(&mut world, &mut Scratch::default(), false);
    assert_eq!(memory(&world)["home"], Value::Null);
    assert_eq!(memory(&world)["store"], Value::Null);
}

#[test]
fn params_drop_a_param_removed_from_the_script_a_new_one_starts_unset() {
    let (mut world, terrain) = farm_world();
    storage(&mut world, "s1", 12.0, 6.0);
    set_params(&mut world, json!({ "1": { "home": "farm", "store": "s1" } }));
    let text = source(READS);
    let mut runner = runner(&terrain, &text);
    let mut scratch = Scratch::default();
    runner.run_all(&mut world, &mut scratch, false);
    *text.lock().unwrap() =
        "param store: storage\nparam other: building\nmemory.other = params.other".into();
    runner.run_all(&mut world, &mut scratch, false);
    assert_eq!(picked(&world), json!({ "1": { "store": "s1" } }));
    assert_eq!(memory(&world)["other"], Value::Null);
    *text.lock().unwrap() = "memory.none = true".into();
    runner.run_all(&mut world, &mut scratch, false);
    assert_eq!(world.residents[0].script_params, None);
}

#[test]
fn a_number_param_reads_its_default_while_unset_the_value_set_and_the_default_once_cleared() {
    let (mut world, terrain) = farm_world();
    let text = "param foodAt: number = 3\nmemory.foodAt = params.foodAt";
    let slot = source(text);
    let mut runner = runner(&terrain, &slot);
    let kind = SetScriptParamOrder { library: Arc::new(Host(slot.clone())) };
    let sender = OrderSender::player(MARA, "Mara");
    let set = |value: Option<f64>| -> OrderRequest {
        let mut o = json!({ "kind": "setScriptParam", "residentId": "w1", "scriptId": SCRIPT, "name": "foodAt" });
        match value {
            None => o["targetId"] = Value::Null,
            Some(v) => o["value"] = json!(v),
        }
        from(o)
    };
    let mut scratch = Scratch::default();
    assert_eq!(runner.run_all(&mut world, &mut scratch, true), vec![]);
    assert_eq!(memory(&world)["foodAt"].as_f64(), Some(3.0));
    for value in [7.0, 0.0] {
        assert_eq!(kind.validate(&world, &sender, &set(Some(value)), None), None);
        kind.apply(&mut world, &sender, &set(Some(value)), None);
        assert_eq!(runner.run_all(&mut world, &mut scratch, true), vec![]);
        assert_eq!(memory(&world)["foodAt"].as_f64(), Some(value));
    }
    assert_eq!(kind.validate(&world, &sender, &set(None), None), None);
    kind.apply(&mut world, &sender, &set(None), None);
    assert_eq!(world.residents[0].script_params, None);
    assert_eq!(runner.run_all(&mut world, &mut scratch, true), vec![]);
    assert_eq!(memory(&world)["foodAt"].as_f64(), Some(3.0));
}

#[test]
fn params_drop_a_value_that_no_longer_fits_its_params_type() {
    let (mut world, terrain) = farm_world();
    set_params(&mut world, json!({ "1": { "home": 4, "store": "farm" } }));
    let text = "param home: building\nparam store: number\nmemory.n = params.store";
    runner(&terrain, &source(text)).run_all(&mut world, &mut Scratch::default(), false);
    assert_eq!(world.residents[0].script_params, None);
    assert_eq!(memory(&world)["n"], Value::Null);
}

fn order(name: &str, target: Option<&str>, script_id: u64) -> OrderRequest {
    from(
        json!({ "kind": "setScriptParam", "residentId": "w1", "scriptId": script_id, "name": name, "targetId": target }),
    )
}

#[test]
fn the_set_script_param_order_picks_a_value_that_fits_and_clears_it_with_null() {
    let (mut world, _) = farm_world();
    storage(&mut world, "s1", 12.0, 6.0);
    world.carriages.push(from(json!({ "id": "k1", "realmId": "r1", "cityId": null, "x": 7, "y": 6, "horseId": null, "load": {} })));
    let kind = SetScriptParamOrder { library: Arc::new(Host(source(READS))) };
    let sender = OrderSender::player(MARA, "Mara");
    for o in [
        order("store", Some("s1"), SCRIPT),
        order("store", Some("k1"), SCRIPT),
        order("home", Some("s1"), SCRIPT),
    ] {
        assert_eq!(kind.validate(&world, &sender, &o, None), None);
    }
    kind.apply(&mut world, &sender, &order("store", Some("k1"), SCRIPT), None);
    kind.apply(&mut world, &sender, &order("home", Some("farm"), SCRIPT), None);
    assert_eq!(picked(&world), json!({ "1": { "store": "k1", "home": "farm" } }));
    kind.apply(&mut world, &sender, &order("store", None, SCRIPT), None);
    kind.apply(&mut world, &sender, &order("home", None, SCRIPT), None);
    assert_eq!(world.residents[0].script_params, None);
    assert_eq!(script_params_sound(&world), vec![]);
}

#[test]
fn the_set_script_param_order_turns_down_what_doesnt_fit() {
    let (mut world, _) = farm_world();
    world.cities.push(from(json!({ "id": "c2", "name": "Elsewhere", "realmId": "r2", "townHallId": "none", "occupation": null })));
    world
        .buildings
        .push(from(json!({ "id": "theirs", "kind": "storage", "cityId": "c2", "x": 9, "y": 9 })));
    let kind = SetScriptParamOrder { library: Arc::new(Host(source(READS))) };
    let sender = OrderSender::player(MARA, "Mara");
    let check = |o: OrderRequest, s: &OrderSender| kind.validate(&world, s, &o, None);
    assert_eq!(
        check(order("store", Some("farm"), SCRIPT), &sender).as_deref(),
        Some("must be a storage, a stable or a carriage of yours")
    );
    assert_eq!(
        check(order("home", Some("theirs"), SCRIPT), &sender).as_deref(),
        Some("must be a building of yours, or a workplace or construction site you know")
    );
    assert_eq!(
        check(order("away", Some("farm"), SCRIPT), &sender).as_deref(),
        Some("the script has no such param")
    );
    assert_eq!(
        check(order("home", Some("farm"), 9), &sender).as_deref(),
        Some("not the script they run")
    );
    let tobin = OrderSender::player(2, "Tobin");
    assert_eq!(
        check(order("home", Some("farm"), SCRIPT), &tobin).as_deref(),
        Some("not one of your residents")
    );
}

#[test]
fn the_set_script_param_order_keeps_a_whole_number_and_refuses_anything_else() {
    let (mut world, _) = farm_world();
    let kind = SetScriptParamOrder {
        library: Arc::new(Host(source("param home: building\nparam take: number"))),
    };
    let sender = OrderSender::player(MARA, "Mara");
    let typed = |name: &str, value: Value| -> OrderRequest {
        from(
            json!({ "kind": "setScriptParam", "residentId": "w1", "scriptId": SCRIPT, "name": name, "value": value }),
        )
    };
    for n in [0, 12] {
        assert_eq!(kind.validate(&world, &sender, &typed("take", json!(n)), None), None);
    }
    kind.apply(&mut world, &sender, &typed("take", json!(12)), None);
    assert_eq!(picked(&world)["1"]["take"].as_f64(), Some(12.0));
    assert_eq!(script_params_sound(&world), vec![]);
    kind.apply(&mut world, &sender, &order("take", None, SCRIPT), None);
    assert_eq!(world.residents[0].script_params, None);
    for v in [json!(-1), json!(1.5), json!("3"), Value::Null] {
        assert_eq!(
            kind.validate(&world, &sender, &typed("take", v), None).as_deref(),
            Some("must be a whole number of zero or more")
        );
    }
    assert_eq!(
        kind.validate(&world, &sender, &order("take", Some("farm"), SCRIPT), None).as_deref(),
        Some("must be a whole number of zero or more")
    );
    assert_eq!(
        kind.validate(&world, &sender, &typed("home", json!(3)), None).as_deref(),
        Some("takes no number or word")
    );
}

#[test]
fn a_number_value_is_sound_only_as_a_whole_number_of_zero_or_more() {
    let (mut world, _) = farm_world();
    set_params(&mut world, json!({ "1": { "take": -2 } }));
    assert_eq!(script_params_sound(&world).len(), 1);
    set_params(&mut world, json!({ "1": { "take": 2.5 } }));
    assert_eq!(script_params_sound(&world).len(), 1);
    set_params(&mut world, json!({ "1": { "take": 2, "home": "farm" } }));
    assert_eq!(script_params_sound(&world), vec![]);
}

#[test]
fn the_set_script_param_order_leaves_the_script_running() {
    let (mut world, terrain) = farm_world();
    let mut kinds = order_kinds();
    kinds.insert("setScriptParam", SetScriptParamOrder { library: Arc::new(Host(source(READS))) });
    let mut queue = OrderQueue::new(kinds, Some(terrain));
    let sender = OrderSender::player(MARA, "Mara");
    let o = json!({ "kind": "setScriptParam", "residentId": "w1", "scriptId": SCRIPT, "name": "home", "targetId": "farm" });
    assert_eq!(
        queue.receive(&world, &sender, &json!("a"), &o),
        OrderReply::Ack { request_id: "a".into() }
    );
    queue.apply_all(&mut world);
    assert_eq!(world.residents[0].script.as_ref().map(|s| s.script_id), Some(SCRIPT));
    assert_eq!(picked(&world), json!({ "1": { "home": "farm" } }));
}
