//! Lent residents never turn on their own city (T96.4, `CONTEXT.md`: Hiring from an NPC city).

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, ContractSide, Good, MercenaryContract, ResidentOrder, Struck, WorldState,
};
use serde_json::{json, Value};

use super::{drop_orders_against_lender, lent_never_turn, WONT_TURN};
use crate::combat::{attack_order, request_strikes};
use crate::game_test_world::run_script;
use crate::order_sender::OrderSender;
use crate::orders::order_kinds;
use crate::queries::city_area::occupier_of;
use crate::queries::contract::is_lent_by;
use crate::queries::persuasion::respect_seen_by;
use crate::realm_test_world::{add_city, building, plains, resident, world_with_realms};

const SIZE: i32 = 64;

/// Realm 1 has hired `lent` (and `lent2`) from the NPC village `c1`, whose own `home` stands
/// beside them, with a wall `w1`, a gate `g1` and a house `h1`. `c2` is another village with its
/// resident `other`; `soldier` is realm 1's own.
fn setup() -> (WorldState, TerrainMap) {
    let terrain = plains(SIZE);
    let mut world = world_with_realms(&terrain, &[1]);
    add_city(&mut world, "c1", None, 30.0, 30.0, "Ashford");
    add_city(&mut world, "c2", None, 40.0, 30.0, "Brook");
    world.buildings.push(building("w1", BuildingKind::Wall, Some("c1"), 33.0, 30.0));
    world.buildings.push(building("g1", BuildingKind::Gate, Some("c1"), 33.0, 31.0));
    world.buildings.push(building("h1", BuildingKind::House, Some("c1"), 32.0, 32.0));
    world.buildings.push(building("w2", BuildingKind::Wall, Some("c2"), 37.0, 30.0));
    for (id, city, x, y) in [
        ("lent", "c1", 32.0, 30.0),
        ("lent2", "c1", 36.0, 30.0),
        ("home", "c1", 31.0, 31.0),
        ("other", "c2", 38.0, 31.0),
    ] {
        let mut r = resident(id, None, x, y);
        r.city_id = Some(city.into());
        world.residents.push(r);
    }
    world.residents.push(resident("soldier", Some("realm1"), 31.0, 30.0));
    world.contracts.push(MercenaryContract {
        id: "contract1".into(),
        lender_id: "c1".into(),
        hirer_id: "realm1".into(),
        offered_by: ContractSide::Hirer,
        resident_ids: vec!["lent".into(), "lent2".into()],
        days: 7.0,
        price_per_week: 1.0,
        storage_id: "none".into(),
        started_at: Some(0.0),
        paid_weeks: 1.0,
    });
    (world, terrain)
}

fn arm(world: &mut WorldState, id: &str) {
    let r = world.residents.iter_mut().find(|r| r.id == id).expect("the resident");
    r.carried.insert(Good::Sword, 1.0);
}

fn r_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut csp_shared::world::Resident {
    world.residents.iter_mut().find(|r| r.id == id).expect("the resident")
}

/// Player 1's order of `kind`, checked: `Err(reason)` when refused, else applied.
fn send(world: &mut WorldState, terrain: &TerrainMap, kind: &str, o: Value) -> Result<(), String> {
    let kinds = order_kinds();
    let k = kinds.get(kind).expect("an order kind");
    let mut fields = o;
    fields["kind"] = json!(kind);
    crate::realm_test_world::send(world, terrain, k.as_ref(), 1, fields)
}

#[test]
fn knows_who_an_npc_city_lent() {
    let (world, _) = setup();
    assert!(is_lent_by(&world, "lent", "c1"));
    assert!(!is_lent_by(&world, "lent", "c2"));
    assert!(!is_lent_by(&world, "home", "c1"));
    assert!(!is_lent_by(&world, "soldier", "c1"));
}

#[test]
fn refuse_by_hand_to_attack_their_citys_residents_walls_and_gates() {
    let (mut world, terrain) = setup();
    for target in ["home", "lent2", "w1", "g1"] {
        let o = json!({"residentId": "lent", "targetId": target});
        assert_eq!(send(&mut world, &terrain, "attack", o), Err(WONT_TURN.into()), "{target}");
    }
    assert_eq!(world.residents.iter().find(|r| r.id == "lent").unwrap().order, None);
    // Another city's resident and wall they go after; and the hirer's own residents still can.
    let o = json!({"residentId": "lent", "targetId": "other"});
    assert_eq!(send(&mut world, &terrain, "attack", o), Ok(()));
    let o = json!({"residentId": "lent", "targetId": "w2"});
    assert_eq!(send(&mut world, &terrain, "attack", o), Ok(()));
    let o = json!({"residentId": "soldier", "targetId": "home"});
    assert_eq!(send(&mut world, &terrain, "attack", o), Ok(()));
}

#[test]
fn refuse_by_hand_to_climb_their_citys_wall() {
    let (mut world, terrain) = setup();
    let o = json!({"residentId": "lent", "wallId": "w1"});
    assert_eq!(send(&mut world, &terrain, "climb", o), Err(WONT_TURN.into()));
    // Realm 1's own resident beside the wall climbs it.
    r_mut(&mut world, "soldier").x = 32.0;
    let o = json!({"residentId": "soldier", "wallId": "w1"});
    assert_eq!(send(&mut world, &terrain, "climb", o), Ok(()));
}

#[test]
fn refuse_by_hand_to_tear_down_their_citys_buildings() {
    let (mut world, terrain) = setup();
    r_mut(&mut world, "lent").y = 32.0;
    let o = json!({"residentId": "lent", "buildingId": "h1"});
    assert_eq!(send(&mut world, &terrain, "tearDown", o), Err(WONT_TURN.into()));
    r_mut(&mut world, "soldier").x = 32.0;
    r_mut(&mut world, "soldier").y = 32.0;
    let o = json!({"residentId": "soldier", "buildingId": "h1"});
    assert_eq!(send(&mut world, &terrain, "tearDown", o), Ok(()));
}

#[test]
fn refuse_the_same_orders_from_a_script() {
    let (world, terrain) = setup();
    let sender = OrderSender::player(1, "Player");
    for source in [
        "memory.answer = attack(\"home\")",
        "memory.answer = attack(\"g1\")",
        "memory.answer = climb(\"w1\")",
        "memory.answer = tearDown(\"h1\")",
    ] {
        let (answer, requests) = run_script(&world, &terrain, &sender, "lent", source);
        assert_eq!(answer, Some(json!(WONT_TURN)), "{source}");
        assert_eq!(requests, vec![], "{source}");
    }
}

#[test]
fn refuse_an_army_attack_on_their_citys_resident() {
    let (mut world, terrain) = setup();
    arm(&mut world, "lent");
    let o = json!({"name": "Host", "residentIds": ["lent", "soldier"]});
    assert_eq!(send(&mut world, &terrain, "formArmy", o), Ok(()));
    let army = world.armies[0].id.clone();
    let o = json!({"armyId": army, "targetId": "home"});
    assert_eq!(
        send(&mut world, &terrain, "armyAttack", o),
        Err(format!("Name of lent, {WONT_TURN}"))
    );
    let o = json!({"armyId": army, "targetId": "other"});
    assert_eq!(send(&mut world, &terrain, "armyAttack", o), Ok(()));
}

#[test]
fn still_fight_back_at_someone_of_their_city_who_struck_them() {
    let (mut world, terrain) = setup();
    let r = r_mut(&mut world, "lent");
    r.struck = Some(Struck { by: "home".into(), tick: 0.0 });
    r.interrupted = Some(serde_json::from_value(json!({"order": null})).expect("interrupted"));
    let o = json!({"residentId": "lent", "targetId": "home"});
    assert_eq!(send(&mut world, &terrain, "attack", o), Ok(()));
    let held = world.residents.iter().find(|r| r.id == "lent").unwrap().order.clone();
    assert!(matches!(held, Some(ResidentOrder::Attack(o)) if o.defending == Some(true)));
    // Fighting back is no order against the city: it stays.
    drop_orders_against_lender(&mut world);
    assert!(world.residents.iter().find(|r| r.id == "lent").unwrap().order.is_some());
    assert_eq!(lent_never_turn(&world), vec![]);
}

#[test]
fn an_order_that_slipped_through_ends_before_any_blow_and_the_invariant_catches_it() {
    let (mut world, _) = setup();
    arm(&mut world, "lent");
    r_mut(&mut world, "home").x = 33.0;
    r_mut(&mut world, "home").y = 30.0;
    r_mut(&mut world, "lent").order =
        Some(ResidentOrder::Attack(attack_order("home", false, false)));
    let found = lent_never_turn(&world);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].invariant, "lent-never-turn");
    assert_eq!(found[0].entity_ids, vec!["lent".to_string(), "home".to_string()]);
    drop_orders_against_lender(&mut world);
    assert_eq!(lent_never_turn(&world), vec![]);
    // No lent resident ever damages their city: no blow is even requested.
    let health = world.residents.iter().find(|r| r.id == "home").unwrap().health;
    for _ in 0..20 {
        drop_orders_against_lender(&mut world);
        assert_eq!(request_strikes(&mut world, SIZE), vec![]);
    }
    assert_eq!(world.residents.iter().find(|r| r.id == "home").unwrap().health, health);
}

#[test]
fn lent_residents_on_their_citys_town_hall_start_no_occupation() {
    let (mut world, _) = setup();
    for id in ["lent", "soldier"] {
        arm(&mut world, id);
    }
    for id in ["home", "lent", "lent2"] {
        r_mut(&mut world, id).x = 10.0;
    }
    let c1 = |w: &WorldState| w.cities.iter().find(|c| c.id == "c1").unwrap().clone();
    // Realm 1's own soldier alone on the hall occupies it.
    r_mut(&mut world, "soldier").x = 30.0;
    r_mut(&mut world, "soldier").y = 30.0;
    assert_eq!(occupier_of(&world, &c1(&world), SIZE), Some("realm1".into()));
    // A lent resident there alone occupies nothing, and beside the soldier holds it for nobody.
    r_mut(&mut world, "lent").x = 30.0;
    r_mut(&mut world, "lent").y = 30.0;
    assert_eq!(occupier_of(&world, &c1(&world), SIZE), None);
    r_mut(&mut world, "soldier").x = 10.0;
    assert_eq!(occupier_of(&world, &c1(&world), SIZE), None);
}

#[test]
fn lent_residents_never_count_toward_their_citys_respect_for_the_hirer() {
    let (mut world, _) = setup();
    world.buildings.retain(|b| b.kind != BuildingKind::Wall && b.kind != BuildingKind::Gate);
    for id in ["lent", "lent2", "soldier"] {
        arm(&mut world, id);
    }
    let c1 = world.cities.iter().find(|c| c.id == "c1").unwrap().clone();
    let with_lent = respect_seen_by(&world, &c1, "realm1", SIZE);
    assert!(with_lent > 0.0, "the hirer's own soldier counts");
    // However respect is weighed, the armed lent residents beside the soldier add nothing.
    world.residents.retain(|r| r.id != "lent" && r.id != "lent2");
    assert_eq!(respect_seen_by(&world, &c1, "realm1", SIZE), with_lent);
}
