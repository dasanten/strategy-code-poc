//! `apps/server/src/what-joins.test.ts`, ported (T86.17, part 5): what joins a city a realm gets
//! (`CONTEXT.md`: What joins with a city). The three ways an NPC city comes in each run the
//! TypeScript's `describe.each` cases.

use std::sync::Arc;

use csp_shared::balance::AVERAGE_HORSE_STATS;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, Carriage, Good, Horse, HorseStats, JoinRequest, Occupation, ResidentOrder, Stock,
    WorldState,
};
use serde_json::json;

use super::capture_city;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::city::city_price;
use crate::queries::city_area::{in_city_area, OCCUPATION_TICKS};
use crate::queries::trade_org::trade_org_hq;
use crate::survival::end_realm;
use crate::tick::Scratch;
use crate::trading_posts::trading_posts;
use crate::world::{create_world, generate_world, step_world};

const SIZE: i32 = 64;

fn terrain() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

fn buyer() -> OrderSender {
    OrderSender::player(7, "Mara")
}

/// One `stepWorld` with no walking.
fn step(world: &mut WorldState, terrain: &TerrainMap) {
    step_world(world, terrain, &mut Scratch::default(), None, None);
}

/// A grown resident at (x, y).
fn resident(
    world: &mut WorldState,
    id: &str,
    owner: Option<&str>,
    x: f64,
    y: f64,
    city: Option<&str>,
) {
    let i = crate::test_world::resident(world, id, owner, x, y);
    world.residents[i].stats.agility.base = 1.0;
    world.residents[i].city_id = city.map(str::to_string);
}

fn horse(
    world: &mut WorldState,
    id: &str,
    realm: Option<&str>,
    city: Option<&str>,
    x: f64,
    y: f64,
) {
    let s = AVERAGE_HORSE_STATS;
    world.horses.push(Horse {
        id: id.into(),
        name: "Rowan".into(),
        realm_id: realm.map(str::to_string),
        city_id: city.map(str::to_string),
        x,
        y,
        hunger: 100.0,
        health: 100.0,
        stats: HorseStats { speed: s.speed, strength: s.strength, endurance: s.endurance },
        born_at: 0.0,
        down_until: None,
    });
}

fn carriage(
    world: &mut WorldState,
    id: &str,
    realm: Option<&str>,
    city: Option<&str>,
    x: f64,
    y: f64,
    horse_id: Option<&str>,
) {
    world.carriages.push(Carriage {
        id: id.into(),
        realm_id: realm.map(str::to_string),
        city_id: city.map(str::to_string),
        x,
        y,
        horse_id: horse_id.map(str::to_string),
        load: Stock::new(),
    });
}

fn stable(world: &mut WorldState, id: &str, city: &str, x: f64, y: f64) {
    let i = crate::test_world::building(world, id, BuildingKind::Stable, Some(city), x, y);
    world.buildings[i].stock = Some(Stock::new());
}

/// Who owns a horse or carriage: (realm, city).
fn owner_of(world: &WorldState, id: &str) -> (Option<String>, Option<String>) {
    if let Some(h) = world.horses.iter().find(|h| h.id == id) {
        return (h.realm_id.clone(), h.city_id.clone());
    }
    let k = world.carriages.iter().find(|k| k.id == id).expect("a horse or carriage");
    (k.realm_id.clone(), k.city_id.clone())
}

fn joined() -> (Option<String>, Option<String>) {
    (Some("r1".into()), None)
}

fn city_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut csp_shared::world::City {
    world.cities.iter_mut().find(|c| c.id == id).unwrap()
}

fn live<'w>(world: &'w WorldState, id: &str) -> &'w csp_shared::world::Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

fn assert_sound(world: &WorldState, t: &TerrainMap) {
    let broken: Vec<String> = crate::invariants::check_all(world, t)
        .iter()
        .map(|v| format!("{}: {}", v.invariant, v.message))
        .collect();
    assert!(broken.is_empty(), "{broken:?}");
}

/// Realm r1 (Player 7, Leader a1, far away) and the NPC city npc, its town hall on (20..22,
/// 20..22), where n1 lives, with a stable st past its area.
fn npc_city() -> (WorldState, TerrainMap) {
    let t = terrain();
    let mut world = create_world(&t, 1);
    crate::test_world::realm(&mut world, "r1", 7, "a1");
    resident(&mut world, "a1", Some("r1"), 60.0, 60.0, None);
    crate::test_world::add_city(&mut world, "npc", None, 20.0, 20.0, None);
    city_mut(&mut world, "npc").name = "Dunmere".into();
    resident(&mut world, "n1", None, 24.0, 20.0, Some("npc"));
    stable(&mut world, "st", "npc", 34.0, 20.0);
    assert!(!in_city_area(&world, "npc", 34.0, 20.0, SIZE));
    (world, t)
}

type Join = fn(&mut WorldState, &TerrainMap, &str);

/// The ways a realm's resident brings an NPC city in, each a whole tick of the world.
fn ways() -> [(&'static str, Join); 3] {
    fn captured(world: &mut WorldState, t: &TerrainMap, city: &str) {
        resident(world, "p1", Some("r1"), 21.0, 21.0, None);
        world.residents.last_mut().unwrap().carried.insert(Good::Sword, 1.0);
        let since = world.tick as f64 + 1.0 - OCCUPATION_TICKS;
        city_mut(world, city).occupation = Some(Occupation { realm_id: "r1".into(), since });
        step(world, t);
    }
    fn bought(world: &mut WorldState, t: &TerrainMap, city: &str) {
        let mut queue = OrderQueue::new(order_kinds(), Some(Arc::new(t.clone())));
        resident(world, "p1", Some("r1"), 21.0, 21.0, None);
        let price = {
            let c = world.cities.iter().find(|c| c.id == city).unwrap();
            city_price(world, c, None)
        };
        world.residents.last_mut().unwrap().carried.insert(Good::Coins, price);
        let order = json!({ "kind": "buyCity", "residentId": "p1", "cityId": city });
        let reply = queue.receive(world, &buyer(), &json!("q"), &order);
        assert!(matches!(reply, OrderReply::Ack { .. }), "{reply:?}");
        queue.apply_all(world);
        step(world, t);
    }
    fn persuaded(world: &mut WorldState, t: &TerrainMap, city: &str) {
        let mut queue = OrderQueue::new(order_kinds(), Some(Arc::new(t.clone())));
        world.join_requests.push(JoinRequest {
            city_id: city.into(),
            realm_id: "r1".into(),
            at: 0.0,
            declined: false,
        });
        let order = json!({ "kind": "acceptJoin", "cityId": city });
        let reply = queue.receive(world, &buyer(), &json!("q"), &order);
        assert!(matches!(reply, OrderReply::Ack { .. }), "{reply:?}");
        queue.apply_all(world);
        step(world, t);
    }
    [("captured", captured), ("bought", bought), ("persuaded", persuaded)]
}

// an NPC city captured / bought / persuaded

#[test]
fn an_npc_city_brings_all_its_own_horses_and_carriages_wherever_they_stand() {
    for (way, join) in ways() {
        let (mut world, t) = npc_city();
        horse(&mut world, "atStable", None, Some("npc"), 34.0, 20.0);
        horse(&mut world, "inArea", None, Some("npc"), 21.0, 24.0);
        horse(&mut world, "farAway", None, Some("npc"), 50.0, 10.0);
        horse(&mut world, "pulling", None, Some("npc"), 50.0, 12.0);
        carriage(&mut world, "kFar", None, Some("npc"), 50.0, 12.0, Some("pulling"));
        carriage(&mut world, "kStable", None, Some("npc"), 34.0, 20.0, None);
        join(&mut world, &t, "npc");
        assert_eq!(world.cities[0].realm_id.as_deref(), Some("r1"), "{way}");
        for id in ["atStable", "inArea", "farAway", "pulling", "kFar", "kStable"] {
            assert_eq!(owner_of(&world, id), joined(), "{way}: {id}");
        }
        assert_sound(&world, &t);
    }
}

#[test]
fn an_npc_city_leaves_another_npc_citys_even_at_its_stable_or_in_its_area() {
    for (way, join) in ways() {
        let (mut world, t) = npc_city();
        crate::test_world::add_city(&mut world, "npc2", None, 50.0, 50.0, None);
        city_mut(&mut world, "npc2").name = "Redbank".into();
        horse(&mut world, "visitor", None, Some("npc2"), 34.0, 20.0);
        horse(&mut world, "passing", None, Some("npc2"), 21.0, 24.0);
        carriage(&mut world, "kPassing", None, Some("npc2"), 21.0, 25.0, None);
        join(&mut world, &t, "npc");
        for id in ["visitor", "passing", "kPassing"] {
            assert_eq!(owner_of(&world, id), (None, Some("npc2".to_string())), "{way}: {id}");
        }
        assert_sound(&world, &t);
    }
}

#[test]
fn an_npc_city_a_resident_who_rides_keeps_their_horse_and_one_who_drives_their_carriage() {
    for (way, join) in ways() {
        let (mut world, t) = npc_city();
        horse(&mut world, "ridden", None, Some("npc"), 50.0, 10.0);
        resident(&mut world, "n2", None, 50.0, 10.0, Some("npc"));
        world.residents.last_mut().unwrap().riding = Some("ridden".into());
        horse(&mut world, "pulling", None, Some("npc"), 50.0, 12.0);
        carriage(&mut world, "kDriven", None, Some("npc"), 50.0, 12.0, Some("pulling"));
        resident(&mut world, "n3", None, 50.0, 12.0, Some("npc"));
        world.residents.last_mut().unwrap().order = Some(drive("kDriven", 50.0, 20.0));
        join(&mut world, &t, "npc");
        let rider = live(&world, "n2");
        assert_eq!(rider.owner.as_deref(), Some("r1"), "{way}");
        assert_eq!(rider.riding.as_deref(), Some("ridden"), "{way}");
        assert_eq!(live(&world, "n3").owner.as_deref(), Some("r1"), "{way}");
        for id in ["ridden", "pulling", "kDriven"] {
            assert_eq!(owner_of(&world, id), joined(), "{way}: {id}");
        }
        assert_sound(&world, &t);
    }
}

fn drive(carriage_id: &str, x: f64, y: f64) -> ResidentOrder {
    serde_json::from_value(json!({
        "kind": "drive", "carriageId": carriage_id, "target": { "x": x, "y": y },
        "path": null, "progress": 0
    }))
    .unwrap()
}

// a Player's city captured

/// The world of `npc_city`, with realm r2 (Player 8, Leader b1) and its cities c2, its town hall
/// at (40, 40) and a stable st2 past its area, where b2 lives, and c3, with a stable st3.
fn player_city() -> (WorldState, TerrainMap) {
    let (mut world, t) = npc_city();
    crate::test_world::realm(&mut world, "r2", 8, "b1");
    resident(&mut world, "b1", Some("r2"), 60.0, 5.0, None);
    crate::test_world::add_city(&mut world, "c2", Some("r2"), 40.0, 40.0, None);
    city_mut(&mut world, "c2").name = "Hartwell".into();
    crate::test_world::add_city(&mut world, "c3", Some("r2"), 10.0, 50.0, None);
    city_mut(&mut world, "c3").name = "Elmstead".into();
    stable(&mut world, "st2", "c2", 54.0, 40.0);
    stable(&mut world, "st3", "c3", 24.0, 50.0);
    assert!(!in_city_area(&world, "c2", 54.0, 40.0, SIZE));
    resident(&mut world, "b2", Some("r2"), 41.0, 44.0, Some("c2"));
    (world, t)
}

/// Captures c2 by r1, whose p1 stands armed on its hall.
fn captured(world: &mut WorldState, t: &TerrainMap) {
    resident(world, "p1", Some("r1"), 41.0, 41.0, None);
    world.residents.last_mut().unwrap().carried.insert(Good::Sword, 1.0);
    let since = world.tick as f64 + 1.0 - OCCUPATION_TICKS;
    city_mut(world, "c2").occupation = Some(Occupation { realm_id: "r1".into(), since });
    step(world, t);
    let c2 = world.cities.iter().find(|c| c.id == "c2").unwrap();
    assert_eq!(c2.realm_id.as_deref(), Some("r1"));
}

#[test]
fn a_players_city_captured_brings_those_in_its_area_or_at_its_stables_and_none_elsewhere() {
    let (mut world, t) = player_city();
    horse(&mut world, "atStable", Some("r2"), None, 55.0, 41.0);
    horse(&mut world, "inArea", Some("r2"), None, 41.0, 45.0);
    horse(&mut world, "elsewhere", Some("r2"), None, 5.0, 5.0);
    horse(&mut world, "atOtherStable", Some("r2"), None, 24.0, 50.0);
    horse(&mut world, "pulling", Some("r2"), None, 54.0, 40.0);
    carriage(&mut world, "kStable", Some("r2"), None, 54.0, 40.0, Some("pulling"));
    carriage(&mut world, "kElsewhere", Some("r2"), None, 5.0, 6.0, None);
    captured(&mut world, &t);
    for id in ["atStable", "inArea", "pulling", "kStable"] {
        assert_eq!(owner_of(&world, id), joined(), "{id}");
    }
    for id in ["elsewhere", "atOtherStable", "kElsewhere"] {
        assert_eq!(owner_of(&world, id), (Some("r2".to_string()), None), "{id}");
    }
    assert_sound(&world, &t);
}

#[test]
fn a_players_city_captured_leaves_another_realms_horse_at_its_stable() {
    let (mut world, t) = player_city();
    crate::test_world::realm(&mut world, "r3", 9, "c1");
    resident(&mut world, "c1", Some("r3"), 5.0, 60.0, None);
    horse(&mut world, "visitor", Some("r3"), None, 54.0, 40.0);
    captured(&mut world, &t);
    assert_eq!(owner_of(&world, "visitor"), (Some("r3".to_string()), None));
    assert_sound(&world, &t);
}

#[test]
fn a_players_city_captured_a_resident_far_away_who_rides_keeps_their_horse_and_one_who_drives_their_carriage(
) {
    let (mut world, t) = player_city();
    horse(&mut world, "ridden", Some("r2"), None, 5.0, 5.0);
    resident(&mut world, "b3", Some("r2"), 5.0, 5.0, Some("c2"));
    world.residents.last_mut().unwrap().riding = Some("ridden".into());
    horse(&mut world, "pulling", Some("r2"), None, 8.0, 8.0);
    carriage(&mut world, "kDriven", Some("r2"), None, 8.0, 8.0, Some("pulling"));
    resident(&mut world, "b4", Some("r2"), 8.0, 8.0, Some("c2"));
    world.residents.last_mut().unwrap().order = Some(drive("kDriven", 8.0, 20.0));
    captured(&mut world, &t);
    let rider = live(&world, "b3");
    assert_eq!(rider.owner.as_deref(), Some("r1"));
    assert_eq!(rider.riding.as_deref(), Some("ridden"));
    let driver = live(&world, "b4");
    assert_eq!(driver.owner.as_deref(), Some("r1"));
    assert!(driver.order.is_none());
    for id in ["ridden", "pulling", "kDriven"] {
        assert_eq!(owner_of(&world, id), joined(), "{id}");
    }
    assert_sound(&world, &t);
}

#[test]
fn a_players_city_captured_whoever_doesnt_join_loses_the_horse_or_carriage_that_does_and_goes_on_foot(
) {
    let (mut world, t) = player_city();
    horse(&mut world, "atStable", Some("r2"), None, 54.0, 40.0);
    resident(&mut world, "b3", Some("r2"), 54.0, 40.0, None);
    world.residents.last_mut().unwrap().riding = Some("atStable".into());
    horse(&mut world, "pulling", Some("r2"), None, 56.0, 40.0);
    carriage(&mut world, "kStable", Some("r2"), None, 56.0, 40.0, Some("pulling"));
    resident(&mut world, "b4", Some("r2"), 56.0, 40.0, None);
    world.residents.last_mut().unwrap().order = Some(drive("kStable", 56.0, 50.0));
    captured(&mut world, &t);
    assert_eq!(owner_of(&world, "atStable"), joined());
    assert_eq!(owner_of(&world, "kStable"), joined());
    let rider = live(&world, "b3");
    assert_eq!(rider.owner.as_deref(), Some("r2"));
    assert!(rider.riding.is_none());
    let driver = live(&world, "b4");
    assert_eq!(driver.owner.as_deref(), Some("r2"));
    assert!(driver.order.is_none());
    assert_sound(&world, &t);
}

#[test]
fn a_players_city_captured_a_self_managed_former_players_city_brings_what_it_got_from_the_realm_wherever_it_stands(
) {
    let (mut world, _) = player_city();
    horse(&mut world, "atStable", Some("r2"), None, 54.0, 40.0);
    end_realm(&mut world, "r2", SIZE);
    assert_eq!(owner_of(&world, "atStable"), (None, Some("c2".to_string())));
    capture_city(&mut world, "c2", "r1", SIZE);
    assert_eq!(owner_of(&world, "atStable"), joined());
}

// a trading post captured

#[test]
fn a_trading_post_captured_leaves_the_trade_organizations_caravans_to_it() {
    let land = crate::test_support::new_land();
    let mut world = generate_world(land, 1);
    crate::starting_city::found_starting_city(&mut world, land, 1, None);
    let post = trading_posts(&world)[0].id.clone();
    let hq = trade_org_hq(&world).unwrap().id.clone();
    let route = world.caravans.iter().find(|c| c.post_id == post).unwrap().clone();
    let captor = world.realms[0].id.clone();
    capture_city(&mut world, &post, &captor, land.size);
    let k = world.carriages.iter().find(|x| x.id == route.carriage_id).unwrap();
    assert_eq!((k.realm_id.clone(), k.city_id.clone()), (None, Some(hq.clone())));
    let h = world.horses.iter().find(|h| Some(&h.id) == k.horse_id.as_ref()).unwrap();
    assert_eq!((h.realm_id.clone(), h.city_id.clone()), (None, Some(hq)));
}

// the invariants

fn invariant(name: &str) -> crate::invariants::Invariant {
    crate::invariants::world_invariants().into_iter().find(|i| i.name == name).unwrap()
}

#[test]
fn the_invariants_catch_a_horse_or_carriage_left_to_a_city_that_has_a_realm() {
    let (mut world, t) = npc_city();
    horse(&mut world, "h", None, Some("npc"), 34.0, 20.0);
    carriage(&mut world, "k", None, Some("npc"), 34.0, 21.0, None);
    let owners = invariant("owners-exist");
    let stranded = |world: &WorldState| -> Vec<String> {
        owners.check(world, &t).into_iter().flat_map(|v| v.entity_ids).collect()
    };
    assert_eq!(stranded(&world), Vec::<String>::new());
    city_mut(&mut world, "npc").realm_id = Some("r1".into());
    assert_eq!(stranded(&world), vec!["h".to_string(), "k".to_string()]);
}

#[test]
fn the_invariants_catch_a_hitched_horse_that_isnt_its_carriages_realms_or_citys() {
    let (mut world, t) = npc_city();
    horse(&mut world, "h", Some("r1"), None, 34.0, 20.0);
    carriage(&mut world, "k", Some("r1"), None, 34.0, 20.0, Some("h"));
    let in_place = invariant("carriages-in-place");
    let found = |world: &WorldState| -> Vec<String> {
        in_place.check(world, &t).into_iter().map(|v| v.message).collect()
    };
    assert_eq!(found(&world), Vec::<String>::new());
    let set = |world: &mut WorldState, realm: Option<&str>, city: Option<&str>| {
        let h = world.horses.iter_mut().find(|h| h.id == "h").unwrap();
        h.realm_id = realm.map(str::to_string);
        h.city_id = city.map(str::to_string);
    };
    set(&mut world, None, Some("npc"));
    let messages = found(&world);
    assert_eq!(messages.len(), 1);
    assert!(messages[0].contains("not its own"), "{messages:?}");
    set(&mut world, Some("r1"), None);
    assert_eq!(found(&world), Vec::<String>::new());
}
