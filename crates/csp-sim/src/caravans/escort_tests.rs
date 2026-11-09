//! `apps/server/src/caravan-escorts.test.ts`, ported one to one.

use std::sync::Arc;

use csp_shared::balance::{
    CARAVAN_ESCORTS, CARAVAN_ESCORTS_MAX, CARAVAN_FOOD, CARAVAN_FOOD_PER_ESCORT,
    CARAVAN_GUARD_RANGE, CARAVAN_ROBBERIES_PER_ESCORT, MAX_HEALTH,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{CrimeKind, Good, Heading, ResidentOrder, Stock, WorldState};
use serde_json::{json, Value};

use super::*;
use crate::combat::attack_order;
use crate::invariants::check_all;
use crate::queries::carriages::caravan_food_for;
use crate::queries::names::held_in;
use crate::queries::residents::is_armed;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::starting_city::found_starting_city;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trading_posts::found_trading_post;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

struct Route {
    world: WorldState,
    terrain: TerrainMap,
    post: String,
    /// The caravan's index.
    caravan: usize,
    realm: String,
    hq_warehouse: usize,
}

/// The Trade Org HQ at (128, 128), one trading post with its caravan, and a Player's realm.
fn route() -> Route {
    let terrain = plains(512);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    found_trade_org_hq(&mut world, &terrain, 128, 128, &mut || m.next());
    let post = found_trading_post(&mut world, &terrain, 320, 320, None, &mut || m.next());
    place_caravans(&mut world);
    let ri = found_starting_city(&mut world, &terrain, 7, None);
    let realm = world.realms[ri].id.clone();
    let caravan = 0;
    let hq_warehouse = route_end(&world, &post, Heading::Hq).warehouse.unwrap();
    Route { world, terrain, post, caravan, realm, hq_warehouse }
}

fn by_id<'w>(world: &'w WorldState, id: &str) -> &'w csp_shared::world::Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

fn by_id_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut csp_shared::world::Resident {
    world.residents.iter_mut().find(|r| r.id == id).unwrap()
}

fn carriage_of(world: &WorldState, ci: usize) -> usize {
    world.carriages.iter().position(|k| k.id == world.caravans[ci].carriage_id).unwrap()
}

fn order_of(v: Value) -> ResidentOrder {
    serde_json::from_value(v).unwrap()
}

/// The caravan out on its way at (240, 240), heading for the post, its escort armed with spears:
/// a carriage away from the HQ, whose own soldiers don't come into it. Returns the carriage's
/// index.
fn on_the_way(world: &mut WorldState, ci: usize) -> usize {
    let ki = carriage_of(world, ci);
    let horse = world.carriages[ki].horse_id.clone();
    world.carriages[ki].x = 240.0;
    world.carriages[ki].y = 240.0;
    if let Some(h) = world.horses.iter_mut().find(|h| Some(&h.id) == horse.as_ref()) {
        h.x = 240.0;
        h.y = 240.0;
    }
    let c = world.caravans[ci].clone();
    let crew: Vec<String> = c.driver_id.iter().chain(&c.escort_ids).cloned().collect();
    for id in &crew {
        let r = by_id_mut(world, id);
        r.x = 240.0;
        r.y = 240.0;
    }
    for id in &c.escort_ids {
        by_id_mut(world, id).carried.insert(Good::Spear, 1.0);
    }
    world.caravans[ci].heading = Heading::Post;
    world.caravans[ci].stop = serde_json::from_value(json!("storage")).unwrap();
    world.carriages[ki].load =
        [(Good::Food, CARAVAN_FOOD), (Good::Iron, 20.0)].into_iter().collect();
    ki
}

/// A grown resident of the Player's realm at (x, y).
fn outsider(world: &mut WorldState, realm: &str, id: &str, x: f64, y: f64) -> usize {
    let city =
        world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm)).unwrap().id.clone();
    let mut m = Mulberry32::new(17.0);
    let fields = NewResident { id, owner: Some(realm), city_id: Some(&city), x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    world.residents.push(r);
    world.residents.len() - 1
}

fn step(s: &mut Route, walking: &mut Walking, scratch: &mut Scratch) {
    step_world(&mut s.world, &s.terrain, scratch, Some(walking), None);
}

fn walking(s: &Route) -> Walking {
    Walking::new(Arc::new(s.terrain.clone()))
}

fn threats(s: &Route, ki: usize) -> Vec<String> {
    caravan_threats(&s.world, Convoy::Caravan(s.caravan), ki, s.terrain.size)
        .into_iter()
        .map(|i| s.world.residents[i].id.clone())
        .collect()
}

// caravan escorts

#[test]
fn arm_themselves_at_the_hq_goods_warehouse_before_the_caravan_sets_off() {
    let mut s = route();
    s.world.buildings[s.hq_warehouse]
        .stock
        .get_or_insert_with(Stock::new)
        .insert(Good::Spear, 10.0);
    let (mut w, mut sc) = (walking(&s), Scratch::default());
    for _ in 0..50 {
        step(&mut s, &mut w, &mut sc);
    }
    for id in &s.world.caravans[s.caravan].escort_ids {
        assert!(is_armed(&by_id(&s.world, id).carried));
    }
    let spears = held_in(s.world.buildings[s.hq_warehouse].stock.as_ref(), Good::Spear);
    assert_eq!(spears, 10.0 - CARAVAN_ESCORTS);
    assert!(s.world.crimes.is_empty());
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

#[test]
fn defend_their_caravan_against_a_robber_which_is_no_crime() {
    let mut s = route();
    let ki = on_the_way(&mut s.world, s.caravan);
    let realm = s.realm.clone();
    let thief = outsider(&mut s.world, &realm, "thief", 240.0, 240.0);
    let kid = s.world.carriages[ki].id.clone();
    s.world.residents[thief].order = Some(order_of(json!({
        "kind": "pickUp", "from": { "kind": "carriage", "carriageId": kid }, "goods": { "iron": 5 },
    })));
    assert_eq!(threats(&s, ki), ["thief"]);
    let (mut w, mut sc) = (walking(&s), Scratch::default());
    step(&mut s, &mut w, &mut sc);
    for id in s.world.caravans[s.caravan].escort_ids.clone() {
        let o = &by_id(&s.world, &id).order;
        assert!(
            matches!(o, Some(ResidentOrder::Attack(a)) if a.target_id == "thief" && a.defending == Some(true)),
            "{o:?}"
        );
    }
    for _ in 0..300 {
        if !s.world.residents.iter().any(|r| r.id == "thief") {
            break;
        }
        step(&mut s, &mut w, &mut sc);
    }
    // The unarmed robber was beaten off: killed, or fled home hurt.
    let left = s.world.residents.iter().find(|r| r.id == "thief");
    assert!(left.is_none_or(|t| t.health < MAX_HEALTH));
    let escorts = s.world.caravans[s.caravan].escort_ids.clone();
    assert!(s.world.crimes.iter().all(|c| !escorts.contains(&c.culprit.resident_id)));
    assert!(s
        .world
        .crimes
        .iter()
        .any(|c| c.kind == CrimeKind::Theft && c.culprit.resident_id == "thief"));
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

#[test]
fn defend_its_driver_against_an_attacker_and_the_carriage_waits_for_them() {
    let mut s = route();
    let ki = on_the_way(&mut s.world, s.caravan);
    let realm = s.realm.clone();
    let raider = outsider(&mut s.world, &realm, "raider", 241.0, 240.0);
    let driver = s.world.caravans[s.caravan].driver_id.clone().unwrap();
    s.world.residents[raider].carried.insert(Good::Spear, 1.0);
    s.world.residents[raider].order =
        Some(ResidentOrder::Attack(attack_order(&driver, false, false)));
    assert_eq!(threats(&s, ki), ["raider"]);
    let (mut w, mut sc) = (walking(&s), Scratch::default());
    step(&mut s, &mut w, &mut sc);
    for id in s.world.caravans[s.caravan].escort_ids.clone() {
        let o = &by_id(&s.world, &id).order;
        assert!(matches!(o, Some(ResidentOrder::Attack(a)) if a.target_id == "raider"), "{o:?}");
    }
    let kid = s.world.carriages[ki].id.clone();
    by_id_mut(&mut s.world, &driver).order = Some(order_of(json!({
        "kind": "drive", "carriageId": kid, "target": { "x": 320, "y": 320 }, "path": null, "progress": 0,
    })));
    assert_eq!(waiting_for_escort(&s.world, s.terrain.size), HashSet::from([driver]));
}

#[test]
fn leave_alone_who_is_far_from_the_carriage_fighting_back_or_of_the_trade_organization() {
    let mut s = route();
    let ki = on_the_way(&mut s.world, s.caravan);
    let realm = s.realm.clone();
    let c = s.world.caravans[s.caravan].clone();
    let driver = c.driver_id.clone().unwrap();
    let far = outsider(&mut s.world, &realm, "far", 240.0 + CARAVAN_GUARD_RANGE + 1.0, 240.0);
    s.world.residents[far].order = Some(ResidentOrder::Attack(attack_order(&driver, false, false)));
    let back = outsider(&mut s.world, &realm, "back", 241.0, 240.0);
    s.world.residents[back].order =
        Some(ResidentOrder::Attack(attack_order(&c.escort_ids[0], true, true)));
    let kid = s.world.carriages[ki].id.clone();
    by_id_mut(&mut s.world, &driver).order = Some(order_of(json!({
        "kind": "pickUp", "from": { "kind": "carriage", "carriageId": kid }, "goods": { "iron": 1 },
    })));
    assert!(threats(&s, ki).is_empty());
}

#[test]
fn give_up_a_chase_that_leads_too_far_from_the_carriage() {
    let mut s = route();
    on_the_way(&mut s.world, s.caravan);
    let realm = s.realm.clone();
    let thief = outsider(&mut s.world, &realm, "thief", 60.0 + CARAVAN_GUARD_RANGE + 2.0, 60.0);
    let escort = s.world.caravans[s.caravan].escort_ids[0].clone();
    let tid = s.world.residents[thief].id.clone();
    by_id_mut(&mut s.world, &escort).order =
        Some(ResidentOrder::Attack(attack_order(&tid, false, true)));
    let (mut w, mut sc) = (walking(&s), Scratch::default());
    step(&mut s, &mut w, &mut sc);
    assert!(!matches!(by_id(&s.world, &escort).order, Some(ResidentOrder::Attack(_))));
}

// escorts per route

#[test]
fn grow_with_how_often_the_route_was_robbed_up_to_a_most() {
    let mut world = create_world(&plains(8), 1);
    assert_eq!(caravan_escorts_wanted(&world, "p"), CARAVAN_ESCORTS);
    let mut wanted = |n: f64| {
        world.route_robberies.insert("p".into(), n);
        caravan_escorts_wanted(&world, "p")
    };
    assert_eq!(wanted(CARAVAN_ROBBERIES_PER_ESCORT - 1.0), CARAVAN_ESCORTS);
    assert_eq!(wanted(CARAVAN_ROBBERIES_PER_ESCORT), CARAVAN_ESCORTS + 1.0);
    assert_eq!(wanted(3.0 * CARAVAN_ROBBERIES_PER_ESCORT), CARAVAN_ESCORTS + 3.0);
    assert_eq!(wanted(1_000.0), CARAVAN_ESCORTS_MAX);
    assert_eq!(caravan_food_for(CARAVAN_ESCORTS), CARAVAN_FOOD);
    assert_eq!(
        caravan_food_for(CARAVAN_ESCORTS + 2.0),
        CARAVAN_FOOD + 2.0 * CARAVAN_FOOD_PER_ESCORT
    );
}

#[test]
fn a_route_robbed_more_often_gets_more_escorts_armed_from_the_hq() {
    let mut s = route();
    s.world.buildings[s.hq_warehouse]
        .stock
        .get_or_insert_with(Stock::new)
        .insert(Good::Spear, 20.0);
    let post = s.post.clone();
    s.world.route_robberies.insert(post, 2.0 * CARAVAN_ROBBERIES_PER_ESCORT);
    let first = s.world.caravans[s.caravan].escort_ids.clone();
    let (mut w, mut sc) = (walking(&s), Scratch::default());
    let ki = carriage_of(&s.world, s.caravan);
    let (hx, hy) = (s.world.buildings[s.hq_warehouse].x, s.world.buildings[s.hq_warehouse].y);
    let ready = |s: &Route| {
        let ids = &s.world.caravans[s.caravan].escort_ids;
        ids.len() as f64 == CARAVAN_ESCORTS + 2.0
            && ids.iter().all(|id| is_armed(&by_id(&s.world, id).carried))
    };
    for _ in 0..2_000 {
        if ready(&s) {
            break;
        }
        step(&mut s, &mut w, &mut sc);
        // The caravan waits at the warehouse for its new escorts to come and arm themselves.
        assert_eq!((s.world.carriages[ki].x, s.world.carriages[ki].y), (hx, hy));
    }
    let ids = s.world.caravans[s.caravan].escort_ids.clone();
    assert_eq!(ids.len() as f64, CARAVAN_ESCORTS + 2.0);
    assert_eq!(ids[..CARAVAN_ESCORTS as usize], first[..]);
    let hq = s.world.buildings[s.hq_warehouse].city_id.clone();
    for id in &ids {
        let r = by_id(&s.world, id);
        assert_eq!((r.owner.as_ref(), r.city_id.as_ref()), (None, hq.as_ref()));
        assert!(is_armed(&r.carried));
    }
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

#[test]
fn flag_a_caravan_with_more_escorts_than_its_route_gets() {
    let mut s = route();
    let c = s.world.caravans[s.caravan].clone();
    let driver = c.driver_id.clone().unwrap();
    let city = by_id(&s.world, &driver).city_id.clone();
    let extra = s
        .world
        .residents
        .iter()
        .find(|r| {
            r.owner.is_none()
                && r.city_id == city
                && !c.escort_ids.contains(&r.id)
                && r.id != driver
        })
        .unwrap()
        .id
        .clone();
    s.world.caravans[s.caravan].escort_ids.push(extra);
    let got = caravans_sound(&s.world, s.terrain.size);
    assert_eq!(got.len(), 1, "{got:?}");
    assert!(got[0].message.contains("more than the 2 of its route"), "{}", got[0].message);
}
