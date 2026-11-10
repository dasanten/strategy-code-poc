//! `script-views.test.ts` and the plain parts of `script-bindings.test.ts`: every value the
//! queries and `me` hand a script holds exactly its view. The TypeScript world here has horses,
//! carriages and a wandering trader too, and adds fields of the server's own to its objects to see
//! them dropped; Rust's world types can't hold an undeclared field, and the horse, carriage and
//! trader cases come with T86.14's fixture worlds.

use super::*;
use crate::queues::tests::resident;
use crate::script_views::{script_value_problems, SCRIPT_VIEWS};
use crate::sight::{entities_in_sight, sight_of};
use crate::world::create_world;
use csp_lang::interpreter::run;
use csp_lang::{parse, Object};
use csp_shared::balance::{SCRIPT_MAX_CALL_DEPTH, SCRIPT_VALUE_LIMITS};
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{City, Directive, Pile, Realm, ResourceNode};
use serde_json::json;

const SIZE: i32 = 256;

fn from<T: serde::de::DeserializeOwned>(v: Json) -> T {
    serde_json::from_value(v).unwrap()
}

/// Realm r1 (Player 7) with a1, running a script as a looping queue's step, and a2; city c1 with
/// its town hall, a stocked storage and a construction site, and an outpost storage. Realm r2
/// (Player 8): b1 next to a1, and city c2 in sight. A pile, a node, an admin directive, a waypoint,
/// and a building and a city Player 7 last saw, out of sight now.
fn setup() -> (WorldState, TerrainMap) {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut w = create_world(&terrain, 1);
    w.tick = 50;
    w.nodes = vec![from::<ResourceNode>(json!({ "id": "n1", "kind": "forest", "x": 11, "y": 12 }))];
    w.realms.push(from::<Realm>(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })));
    w.realms.push(from::<Realm>(json!({ "id": "r2", "userId": 8, "leaderId": "b1" })));
    for (id, name, realm, hall) in [("c1", "Ashford", "r1", "h1"), ("c2", "Brill", "r2", "h2")] {
        w.cities.push(from::<City>(json!({ "id": id, "name": name, "realmId": realm, "townHallId": hall, "occupation": null })));
    }
    for b in [
        json!({ "id": "h1", "kind": "townHall", "cityId": "c1", "x": 12, "y": 10 }),
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 13, "y": 10, "stock": { "food": 5, "wood": 2 } }),
        json!({ "id": "site1", "kind": "house", "cityId": "c1", "x": 12, "y": 11, "site": { "delivered": { "wood": 2 }, "work": 1 } }),
        json!({ "id": "h2", "kind": "townHall", "cityId": "c2", "x": 8, "y": 10 }),
        json!({ "id": "s2", "kind": "storage", "cityId": "c2", "x": 8, "y": 11, "stock": { "stone": 3 } }),
        json!({ "id": "os1", "kind": "storage", "cityId": null, "realmId": "r1", "x": 6, "y": 8, "stock": { "food": 3 } }),
    ] {
        w.buildings.push(from(b));
    }
    for (id, owner, city, x, y) in [
        ("a1", "r1", "c1", 10.0, 10.0),
        ("a2", "r1", "c1", 10.0, 11.0),
        ("b1", "r2", "c2", 9.0, 10.0),
    ] {
        let mut r = resident(id, Some(owner), x, y);
        r.city_id = Some(city.into());
        r.born_at = -20.0 * TICKS_PER_GAME_YEAR;
        r.lifespan = 60.0;
        w.residents.push(r);
    }
    let a1 = &mut w.residents[0];
    a1.script = Some(from(json!({ "scriptId": 1, "memory": { "role": "gatherer" } })));
    a1.queue = Some(from(json!({
        "realmId": "r1", "steps": [{ "id": 1, "order": { "kind": "runScript", "scriptId": 1 }, "minutes": 30 }],
        "current": 0, "startedAt": 40, "loop": true, "nextStepId": 2
    })));
    w.piles.push(Pile {
        id: "p1".into(),
        x: 10.0,
        y: 10.0,
        goods: [(csp_shared::world::Good::Food, 5.0)].into_iter().collect(),
    });
    w.directives.push(from::<Directive>(json!({
        "id": "d1", "target": "r2", "withAlliance": false, "reason": "raiding", "givenBy": "admin", "givenAt": 1,
        "goals": [{ "kind": "city", "cityId": "c2", "city": "Brill", "met": false }, { "kind": "soldiers", "count": 2, "percent": 10 }],
        "soldiersKilled": 0, "price": 50
    })));
    w.last_seen.insert(7, from(json!([
        { "is": "building", "id": "far1", "kind": "farm", "cityId": "c9", "x": 200, "y": 200, "seenAt": 4 },
        { "is": "city", "id": "c9", "name": "Dunmore", "realmId": "r2", "townHallId": "h9", "occupation": null, "seenAt": 4 }
    ])));
    w.waypoints
        .insert(7, vec![Waypoint { id: "wp1".into(), name: "Pass".into(), x: 40.0, y: 3.0 }]);
    (w, terrain)
}

/// What each expression in `calls` answers in one run of a1's script.
fn answers(calls: &[(&str, &str)], prepare: impl FnOnce(&mut WorldState)) -> Map<String, Json> {
    let (mut world, terrain) = setup();
    prepare(&mut world);
    let index = WorldIndex::new(&world, SIZE);
    let sender = OrderSender::player(7, "Mara");
    let seen = || entities_in_sight(&world, &index, Some("r1"), None);
    let eyes = || sight_of(&world, &index, "r1", None);
    let explored = |_: i32, _: i32| true;
    let kinds = crate::orders::order_kinds();
    let memory = Object::new();
    let ctx = ScriptContext {
        world: &world,
        terrain: &terrain,
        index: &index,
        sender: &sender,
        resident_id: Some("a1"),
        army_id: None,
        memory: memory.clone(),
        seen: &seen,
        eyes: &eyes,
        explored: &explored,
        kinds: &kinds,
        edge: None,
        params: None,
    };
    let mut bound = bind_script(ctx).unwrap();
    let fields: Vec<String> = calls.iter().map(|(k, c)| format!("{k}: {c}")).collect();
    let program = parse(&format!("memory.out = {{{}}}", fields.join(", "))).unwrap();
    let limits = csp_lang::interpreter::ValueLimits {
        max_string_length: SCRIPT_VALUE_LIMITS.max_string_length as usize,
        max_list_length: SCRIPT_VALUE_LIMITS.max_list_length as usize,
        max_object_keys: SCRIPT_VALUE_LIMITS.max_object_keys as usize,
    };
    let options = csp_lang::interpreter::RunOptions {
        steps: 100_000,
        max_call_depth: SCRIPT_MAX_CALL_DEPTH as u32,
        limits,
    };
    let result = run(&program, &mut bound, &options).unwrap();
    assert!(matches!(result, csp_lang::interpreter::RunResult::Done { .. }), "{result:?}");
    let out = memory.borrow().get("out").cloned().unwrap();
    match csp_lang::plain_value(&out, usize::MAX).unwrap().value {
        Json::Object(m) => m,
        other => panic!("{other}"),
    }
}

fn returns_of(name: &str) -> ScriptType {
    binding(SCRIPT_API, name).unwrap().returns
}

#[test]
fn describe_every_field_of_everything_the_queries_and_me_hand_a_script() {
    let calls = [
        ("me", "me"),
        ("residents", "residents()"),
        ("buildings", "buildings()"),
        ("cities", "cities()"),
        ("horses", "horses()"),
        ("carriages", "carriages()"),
        ("traders", "traders()"),
        ("piles", "piles()"),
        ("nodes", "nodes()"),
        ("nodesInSight", "nodesInSight(\"forest\")"),
        ("lastSeen", "lastSeen()"),
        ("offers", "offers()"),
        ("directives", "directives()"),
        ("demands", "demands()"),
        ("waypoints", "waypoints()"),
        ("withMemory", "withMemory(\"role\", \"gatherer\")"),
        ("building", "building(\"s1\")"),
        ("buildingAt", "buildingAt(13, 10)"),
        ("inCityArea", "inCityArea(\"c1\", 13, 10)"),
        ("cityAreaAt", "cityAreaAt(13, 10)"),
        ("outsidersIn", "outsidersIn(\"c1\")"),
        ("pileAt", "pileAt(10, 10)"),
        ("outputOf", "outputOf(building(\"s1\"))"),
        ("materialsNeeded", "materialsNeeded(building(\"site1\"))"),
        ("terrainAt", "terrainAt(10, 10)"),
        ("distance", "distance(me, building(\"s1\"))"),
        ("floor", "floor(2.5)"),
        ("pickRandom", "pickRandom([\"food\"])"),
        ("fits", "fits(\"food\")"),
        ("inputToFetch", "inputToFetch(building(\"s1\"))"),
        ("breedingPair", "breedingPair(building(\"s1\"))"),
        ("storages", "storages()"),
        ("walkTime", "walkTime(me, building(\"s1\"))"),
        ("wayFood", "wayFood(me, building(\"s1\"))"),
        ("exploredEdge", "exploredEdge(me, \"north\")"),
        ("crewTile", "crewTile(building(\"s1\"))"),
        (
            "lineTiles",
            "lineTiles({building: \"road\", from: {x: 10, y: 12}, to: {x: 13, y: 12}}, me)",
        ),
        ("debt", "debt"),
        ("tick", "tick"),
        ("mapSize", "mapSize"),
        ("random", "random"),
    ];
    // Every name in the API but `memory`, `params` (the script's own) and the actions.
    let mut names: Vec<&str> = calls.iter().map(|(k, _)| *k).collect();
    names.sort();
    let mut api: Vec<&str> = SCRIPT_API
        .iter()
        .filter(|b| b.is != Is::Action && b.name != "memory" && b.name != "params")
        .map(|b| b.name)
        .collect();
    api.sort();
    assert_eq!(names, api);
    let out = answers(&calls, |_| {});
    let ids = |name: &str| -> Vec<String> {
        out[name]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap().to_string())
            .collect()
    };
    // Own things and others', so both are looked at.
    assert!(ids("residents").contains(&"a1".into()) && ids("residents").contains(&"b1".into()));
    for b in ["s1", "s2", "site1"] {
        assert!(ids("buildings").contains(&b.into()), "{b}");
    }
    assert_eq!(ids("lastSeen"), ["far1", "c9"]);
    for name in
        ["piles", "nodes", "nodesInSight", "directives", "waypoints", "withMemory", "lineTiles"]
    {
        assert!(!out[name].as_array().unwrap().is_empty(), "{name}");
    }
    assert_ne!(out["materialsNeeded"], json!([]));
    assert_eq!(ids("storages"), ["s1", "os1"]);
    // A queue shows where it is, not its steps.
    let queue = json!({ "step": 1, "steps": 1, "loop": true, "kind": "runScript", "task": null, "scriptId": 1, "minutes": 30, "startedAt": 40 });
    assert_eq!(out["me"]["queue"], queue);
    let a1 = out["residents"].as_array().unwrap().iter().find(|r| r["id"] == "a1").unwrap();
    assert_eq!(a1["queue"], queue);

    let problems: Vec<String> = calls
        .iter()
        .flat_map(|(name, _)| script_value_problems(out.get(*name), returns_of(name), name))
        .collect();
    assert_eq!(problems, Vec::<String>::new());
}

#[test]
fn hand_a_script_exactly_its_view() {
    let out = answers(
        &[
            ("name", "me.name"),
            ("strength", "me.stats.strength.base"),
            ("food", "building(\"s1\").stock.food"),
            ("role", "withMemory(\"role\", \"gatherer\")[0].script.memory.role"),
            ("task", "withMemory(\"role\", \"gatherer\")[0].script.task"),
        ],
        |_| {},
    );
    let (world, _) = setup();
    let a1 = &world.residents[0];
    assert_eq!(out["name"], json!(a1.name));
    assert_eq!(
        out["strength"].as_f64(),
        serde_json::to_value(&a1.stats).unwrap()["strength"]["base"].as_f64()
    );
    assert_eq!(out["food"].as_f64(), Some(5.0));
    assert_eq!(out["role"], json!("gatherer"));
    // `script.task` is no field of the view `withMemory` hands back.
    assert_eq!(out["task"], Json::Null);
}

#[test]
fn find_a_field_outside_its_view_a_missing_one_and_a_value_of_the_wrong_kind() {
    let node = json!({ "id": "n1", "kind": "forest", "x": 1, "y": 2, "secret": 3 });
    assert_eq!(
        script_value_problems(Some(&node), ScriptType::View("node"), "n"),
        ["n.secret is not in the node view"]
    );
    let short = json!({ "id": "n1", "kind": "forest", "x": 1 });
    assert_eq!(
        script_value_problems(Some(&short), ScriptType::View("node"), "n"),
        ["n.y is missing"]
    );
    let piles = json!([{ "id": "p", "x": 1, "y": "2", "goods": {} }]);
    assert_eq!(
        script_value_problems(Some(&piles), ScriptType::List(&ScriptType::View("pile")), "p"),
        ["p[0].y is a string, not a number"]
    );
    assert!(script_value_problems(Some(&Json::Null), ScriptType::View("node"), "n").is_empty());
}

#[test]
fn describe_every_view_and_field_and_say_when_a_field_is_null() {
    for view in SCRIPT_VIEWS {
        assert!(!view.description.is_empty(), "{}", view.name);
        let names: HashSet<&str> = view.fields.iter().map(|f| f.name).collect();
        assert_eq!(names.len(), view.fields.len(), "{} declares a field twice", view.name);
        for f in view.fields {
            assert!(!f.description.is_empty(), "{}.{}", view.name, f.name);
            assert!(f.null_when.is_none_or(|n| !n.is_empty()), "{}.{}", view.name, f.name);
        }
    }
}

#[test]
fn declare_every_field_the_games_default_scripts_read() {
    let declared: HashSet<&str> =
        SCRIPT_VIEWS.iter().flat_map(|v| v.fields.iter().map(|f| f.name)).collect();
    let word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    for (task, _, source) in crate::default_scripts::DEFAULT_SCRIPTS {
        let chars: Vec<char> = source.chars().collect();
        // A simple name scan: every `.name` read, but those of the script's own objects (a key in
        // an object it writes, or assigned to anywhere in it), of `memory`, and a list's `length`.
        let mut own: HashSet<String> = HashSet::from(["length".to_string()]);
        let mut read: Vec<String> = Vec::new();
        for i in 0..chars.len() {
            if chars[i] == '.'
                && chars.get(i + 1).is_some_and(|c| c.is_ascii_alphabetic() || *c == '_')
            {
                let name: String = chars[i + 1..].iter().take_while(|c| word(**c)).collect();
                let after: String = chars[i + 1 + name.len()..]
                    .iter()
                    .skip_while(|c| c.is_whitespace())
                    .take(2)
                    .collect();
                let before: String = chars[..i]
                    .iter()
                    .rev()
                    .take_while(|c| word(**c))
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
                if (after.starts_with('=') && !after.starts_with("==")) || before == "memory" {
                    own.insert(name.clone());
                }
                read.push(name);
            }
            if word(chars[i]) && (i == 0 || !word(chars[i - 1])) {
                let name: String = chars[i..].iter().take_while(|c| word(**c)).collect();
                let after: String = chars[i + name.len()..]
                    .iter()
                    .skip_while(|c| c.is_whitespace())
                    .take(1)
                    .collect();
                if after == ":" {
                    own.insert(name);
                }
            }
        }
        let undeclared: Vec<&String> =
            read.iter().filter(|n| !own.contains(*n) && !declared.contains(n.as_str())).collect();
        assert!(undeclared.is_empty(), "{task:?}: {undeclared:?}");
    }
}

/// Not a check: how long `me`, `building` and a run of a small script take, for the NPC script
/// speed (T86.14). `cargo test -p csp-sim --lib bench_bindings -- --ignored --nocapture`.
#[test]
#[ignore = "a measurement, not a check"]
fn bench_bindings() {
    let (world, terrain) = setup();
    let index = WorldIndex::new(&world, SIZE);
    let sender = OrderSender::player(7, "Mara");
    let seen = || entities_in_sight(&world, &index, Some("r1"), None);
    let eyes = || sight_of(&world, &index, "r1", None);
    let explored = |_: i32, _: i32| true;
    let kinds = crate::orders::order_kinds();
    let n = 20_000;
    let from = std::time::Instant::now();
    for _ in 0..n {
        let ctx = ScriptContext {
            world: &world,
            terrain: &terrain,
            index: &index,
            sender: &sender,
            resident_id: Some("a1"),
            army_id: None,
            memory: Object::new(),
            seen: &seen,
            eyes: &eyes,
            explored: &explored,
            kinds: &kinds,
            edge: None,
            params: None,
        };
        let mut bound = bind_script(ctx).unwrap();
        std::hint::black_box(csp_lang::interpreter::Host::global(&mut bound, "me"));
    }
    eprintln!("BENCH bind+me {:.2} us", from.elapsed().as_secs_f64() * 1e6 / n as f64);
    let r = &world.residents[0];
    let time = |label: &str, f: &dyn Fn()| {
        let from = std::time::Instant::now();
        for _ in 0..n {
            f();
        }
        eprintln!("BENCH {label} {:.2} us", from.elapsed().as_secs_f64() * 1e6 / n as f64);
    };
    time("to_json", &|| drop(std::hint::black_box(to_json(r))));
    let data = Json::Object(as_view(&world, to_json(r)));
    time("as_view", &|| drop(std::hint::black_box(as_view(&world, to_json(r)))));
    let ty = binding(SCRIPT_API, "me").unwrap().returns;
    time("view_value", &|| drop(std::hint::black_box(view_value(&data, ty))));
    time("from_json", &|| drop(std::hint::black_box(Value::from_json(&data))));
}

/// The worlds the TypeScript stepped (`fixtures/worlds`), for checks over many real residents.
fn fixture_worlds() -> Vec<WorldState> {
    ["village-0", "village-1440", "village-10080", "hq-0", "hq-1440", "hq-10080"]
        .iter()
        .map(|name| {
            let path = format!("{}/fixtures/worlds/{name}.json", env!("CARGO_MANIFEST_DIR"));
            let file: Json = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
            from(file["world"].clone())
        })
        .collect()
}

/// `me` built straight from the resident (#1092) is the value its plain data gives, for every
/// resident of the stepped worlds and of the test world, seen by its own side, another and none,
/// with what an alarm told it and without; and for the corners: struck by someone there or gone,
/// defence and Alarm scripts picked or off, Down, numbers that aren't finite.
#[test]
fn me_from_the_struct_is_me_from_its_plain_data() {
    let mut worlds = fixture_worlds();
    let (mut w, _) = setup();
    let base = w.residents[0].clone();
    let alarm = json!({ "kind": "theft", "cityId": "c1", "about": "b1", "realmId": "r2", "x": 1, "y": 2, "tick": 40 });
    let variants: Vec<Json> = vec![
        json!({ "struck": { "by": "b1", "tick": 44 } }),
        json!({ "struck": { "by": "gone", "tick": 44 } }),
        json!({ "defenceScriptId": 4, "alarmScriptId": "none" }),
        json!({ "alarmScriptId": 9, "downUntil": 80 }),
        json!({ "script": { "scriptId": 0, "task": "alarm", "memory": {}, "alarm": alarm } }),
    ];
    for (i, v) in variants.into_iter().enumerate() {
        let mut data = serde_json::to_value(&base).unwrap();
        for (k, x) in v.as_object().unwrap() {
            data[k] = x.clone();
        }
        let mut r: Resident = from(data);
        r.id = format!("v{i}");
        w.residents.push(r);
    }
    let mut odd = base.clone();
    odd.id = "odd".into();
    (odd.x, odd.hunger, odd.down_until) = (f64::NAN, f64::INFINITY, Some(f64::NAN));
    w.residents.push(odd);
    worlds.push(w);
    let ty = ScriptType::View("resident");
    let mut checked = 0;
    for world in &worlds {
        for r in &world.residents {
            for side in [r.owner.as_deref(), Some("elsewhere"), None] {
                for alarm in [true, false] {
                    let by_json = view_value(
                        &Json::Object(as_view(world, resident_data(world, r, side, alarm))),
                        ty,
                    );
                    let direct = resident_view(world, r, side, alarm);
                    assert_eq!(
                        format!("{direct:?}"),
                        format!("{by_json:?}"),
                        "{} {side:?} {alarm}",
                        r.id
                    );
                    checked += 1;
                }
            }
        }
    }
    assert!(checked > 500, "{checked}");
}
