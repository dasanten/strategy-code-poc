//! `workplace-settings.test.ts`: the set-work-settings order, dropping settings and their
//! invariant. Its "working by Workplace settings" cases run the Work default through the whole
//! tick and come with T86.14.

use super::*;
use crate::default_scripts::default_script;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queues::tests::resident;
use crate::world::create_world;
use csp_shared::terrain::Terrain;
use csp_shared::world::{City, Realm};

const SIZE: i32 = 32;
const MARA: u64 = 1;
const BO: u64 = 2;

const WORK_SCRIPT: &str = "param workplace: building\nparam out: storage // where the output goes\nparam take: number = 3\nmemory.done = true\n";

/// Each Player's scripts: their Work default, a work script and one that isn't.
struct Host;

impl WorkSettingsHost for Host {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        let (_, work) = default_script(Task::Work);
        let s = |user_id: u64, name: &str, source: &str, task: Option<Task>| RunnableScript {
            user_id,
            name: name.into(),
            version: 1,
            source: source.into(),
            follows_default: task.is_some(),
            task,
        };
        Some(match id {
            10 => s(MARA, "Work", work, Some(Task::Work)),
            11 => s(MARA, "Farming", WORK_SCRIPT, None),
            12 => s(MARA, "Home", "param home: building\n", None),
            20 => s(BO, "Work", work, Some(Task::Work)),
            _ => return None,
        })
    }
    fn default_script(&self, user_id: u64, _: Task) -> u64 {
        if user_id == MARA {
            10
        } else {
            20
        }
    }
}

fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).unwrap()
}

/// Mara's realm r1 with city c1, a farm and storage s1; Bo's realm r2 with city c2 and storage s2,
/// whose Player remembers Mara's farm but not her storage.
fn two_realms() -> WorldState {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    world.realms.push(from::<Realm>(json!({ "id": "r1", "userId": MARA, "leaderId": "m1" })));
    world.realms.push(from::<Realm>(json!({ "id": "r2", "userId": BO, "leaderId": "b1" })));
    for (c, realm, x, y) in [("c1", "r1", 20, 6), ("c2", "r2", 6, 24)] {
        world.cities.push(from::<City>(json!({ "id": c, "name": c, "realmId": realm, "townHallId": format!("{c}-hall"), "occupation": null })));
        world.buildings.push(from(
            json!({ "id": format!("{c}-hall"), "kind": "townHall", "cityId": c, "x": x, "y": y }),
        ));
    }
    world
        .buildings
        .push(from(json!({ "id": "farm", "kind": "farm", "cityId": "c1", "x": 6, "y": 6 })));
    world.buildings.push(from(
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 12, "y": 6, "stock": {} }),
    ));
    world.buildings.push(from(
        json!({ "id": "s2", "kind": "storage", "cityId": "c2", "x": 12, "y": 24, "stock": {} }),
    ));
    world.residents.push(resident("m1", Some("r1"), 6.0, 6.0));
    world.residents.push(resident("b1", Some("r2"), 6.0, 24.0));
    world.last_seen.insert(BO, from(json!([{ "is": "building", "id": "farm", "kind": "farm", "cityId": "c1", "x": 6, "y": 6, "seenAt": 0 }])));
    world
}

fn order(fields: Value) -> Value {
    let mut o = json!({ "kind": "setWorkSettings", "buildingId": "farm" });
    for (k, v) in fields.as_object().unwrap() {
        o[k] = v.clone();
    }
    o
}

/// Sends the orders in turn, each applied before the next; the answers that were turned down.
fn send(world: &mut WorldState, orders: &[(u64, Value)]) -> Vec<String> {
    let mut kinds = order_kinds();
    kinds.insert("setWorkSettings", SetWorkSettingsOrder { host: Arc::new(Host) });
    let mut q = OrderQueue::new(kinds, None);
    let mut rejected = Vec::new();
    for (user, o) in orders {
        let sender = OrderSender::player(*user, "Mara");
        if let OrderReply::Rejected { reason, .. } = q.receive(world, &sender, &json!("a"), o) {
            rejected.push(reason);
        }
        q.apply_all(world);
    }
    rejected
}

fn settings(world: &WorldState) -> Value {
    serde_json::to_value(&world.workplace_settings).unwrap()
}

#[test]
fn keeps_settings_per_realm_and_per_workplace() {
    let mut world = two_realms();
    world
        .buildings
        .push(from(json!({ "id": "mine", "kind": "mine", "cityId": "c1", "x": 6, "y": 12 })));
    let rejected = send(
        &mut world,
        &[
            (MARA, order(json!({ "scriptId": 11, "params": { "out": "s1", "take": 5 } }))),
            (MARA, order(json!({ "buildingId": "mine", "params": { "foodTake": 2 } }))),
            (BO, order(json!({ "params": { "storage": "s2" } }))),
        ],
    );
    assert_eq!(rejected, Vec::<String>::new());
    assert_eq!(
        settings(&world),
        json!({
            "r1": { "farm": { "scriptId": 11, "params": { "out": "s1", "take": 5.0 } }, "mine": { "params": { "foodTake": 2.0 } } },
            "r2": { "farm": { "params": { "storage": "s2" } } }
        })
    );
    assert_eq!(workplace_settings_sound(&world), vec![]);
}

#[test]
fn sets_and_clears_values_one_by_one_keeping_the_others() {
    let mut world = two_realms();
    send(
        &mut world,
        &[
            (MARA, order(json!({ "params": { "storage": "s1", "foodTake": 4 } }))),
            (MARA, order(json!({ "params": { "foodTake": null } }))),
        ],
    );
    assert_eq!(settings(&world), json!({ "r1": { "farm": { "params": { "storage": "s1" } } } }));
    send(&mut world, &[(MARA, order(json!({ "params": { "storage": null } })))]);
    assert_eq!(settings(&world), json!({}));
}

#[test]
fn switching_the_work_script_starts_its_values_over_the_work_default_is_kept_as_none() {
    let mut world = two_realms();
    send(&mut world, &[(MARA, order(json!({ "params": { "storage": "s1" } })))]);
    send(&mut world, &[(MARA, order(json!({ "scriptId": 11 })))]);
    assert_eq!(settings(&world), json!({ "r1": { "farm": { "scriptId": 11 } } }));
    send(
        &mut world,
        &[
            (MARA, order(json!({ "params": { "take": 2 } }))),
            (MARA, order(json!({ "scriptId": 11 }))),
        ],
    );
    assert_eq!(
        settings(&world),
        json!({ "r1": { "farm": { "scriptId": 11, "params": { "take": 2.0 } } } })
    );
    send(&mut world, &[(MARA, order(json!({ "scriptId": 10 })))]);
    assert_eq!(settings(&world), json!({}));
    send(
        &mut world,
        &[(MARA, order(json!({ "scriptId": 11 }))), (MARA, order(json!({ "scriptId": null })))],
    );
    assert_eq!(settings(&world), json!({}));
}

#[test]
fn checks_the_values_against_the_script_it_switches_to() {
    let mut world = two_realms();
    assert_eq!(
        send(&mut world, &[(MARA, order(json!({ "scriptId": 11, "params": { "out": "s1" } })))]),
        Vec::<String>::new()
    );
    // `out` is no param of the Work default.
    assert_eq!(
        send(&mut world, &[(MARA, order(json!({ "scriptId": null, "params": { "out": "s1" } })))]),
        ["out: the script has no such param"]
    );
}

#[test]
fn turns_down_what_is_no_workplace_or_one_the_realm_does_not_know() {
    let mut world = two_realms();
    world
        .buildings
        .push(from(json!({ "id": "far", "kind": "mine", "cityId": "c1", "x": 28, "y": 28 })));
    let rejected = send(
        &mut world,
        &[
            (MARA, order(json!({ "buildingId": "s1", "params": {} }))),
            (MARA, order(json!({ "buildingId": "gone", "params": {} }))),
            (BO, order(json!({ "buildingId": "far", "params": {} }))),
        ],
    );
    assert_eq!(rejected, vec!["not a workplace or construction site of one you know"; 3]);
}

#[test]
fn takes_a_construction_site_of_a_workplace_kind() {
    let mut world = two_realms();
    world.buildings.push(from(json!({ "id": "site", "kind": "smelter", "cityId": "c1", "x": 14, "y": 14, "site": { "delivered": {}, "work": 0 } })));
    assert_eq!(
        send(
            &mut world,
            &[(MARA, order(json!({ "buildingId": "site", "params": { "foodTake": 1 } })))]
        ),
        Vec::<String>::new()
    );
    assert_eq!(settings(&world)["r1"]["site"], json!({ "params": { "foodTake": 1.0 } }));
}

#[test]
fn turns_down_a_script_that_is_no_work_script_or_not_theirs() {
    let mut world = two_realms();
    assert_eq!(
        send(
            &mut world,
            &[(MARA, order(json!({ "scriptId": 12 }))), (BO, order(json!({ "scriptId": 11 })))]
        ),
        [
            "not a work script: it declares no `param workplace: building`",
            "not one of your scripts with a version that can run"
        ]
    );
}

#[test]
fn turns_down_workplace_and_values_that_do_not_fit_or_are_not_the_realms() {
    let mut world = two_realms();
    let rejected = send(
        &mut world,
        &[
            (MARA, order(json!({ "params": { "workplace": "farm" } }))),
            (MARA, order(json!({ "params": { "foodTake": -1 } }))),
            (BO, order(json!({ "params": { "storage": "s1" } }))),
            (MARA, order(json!({ "params": { "nope": 1 } }))),
        ],
    );
    assert_eq!(
        rejected,
        [
            "workplace: is the workplace itself",
            "foodTake: must be a whole number of zero or more",
            "storage: must be a storage, a stable or a carriage of yours",
            "nope: the script has no such param",
        ]
    );
    assert_eq!(settings(&world), json!({}));
}

#[test]
fn drops_them_with_the_building_values_naming_what_is_gone_and_realms_that_ended() {
    let mut world = two_realms();
    world
        .buildings
        .push(from(json!({ "id": "mine", "kind": "mine", "cityId": "c1", "x": 6, "y": 12 })));
    send(
        &mut world,
        &[
            (MARA, order(json!({ "params": { "storage": "s1", "foodTake": 2 } }))),
            (MARA, order(json!({ "buildingId": "mine", "params": { "storage": "s1" } }))),
            (BO, order(json!({ "params": { "foodTake": 1 } }))),
        ],
    );
    world.buildings.retain(|b| b.id != "mine" && b.id != "s1");
    let mut scratch = Scratch::default();
    step_workplace_settings(&mut world, &mut scratch);
    assert_eq!(
        settings(&world),
        json!({ "r1": { "farm": { "params": { "foodTake": 2.0 } } }, "r2": { "farm": { "params": { "foodTake": 1.0 } } } })
    );
    world.realms.retain(|r| r.id != "r2");
    step_workplace_settings(&mut world, &mut scratch);
    assert_eq!(settings(&world), json!({ "r1": { "farm": { "params": { "foodTake": 2.0 } } } }));
}

#[test]
fn flags_settings_of_no_realm_or_no_workplace_empty_groups_and_bad_values() {
    let mut world = two_realms();
    assert_eq!(workplace_settings_sound(&world), vec![]);
    world.workplace_settings = from(json!({
        "gone": { "farm": { "params": { "foodTake": 1 } } },
        "r1": { "s1": { "scriptId": 11 }, "farm": { "scriptId": 0, "params": { "workplace": "farm", "x": -1 } } },
        "r2": {}
    }));
    let messages: Vec<String> =
        workplace_settings_sound(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        [
            "gone, no realm, keeps workplace settings",
            "realm r1 keeps settings for s1, no workplace",
            "realm r1 keeps script 0 for farm",
            "realm r1 keeps a workplace value for farm",
            "realm r1 keeps a value for farm that is no id or whole number",
            "realm r2 keeps an empty group",
        ]
    );
}
