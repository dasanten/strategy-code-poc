//! `self-managed.test.ts`: a dead Leader's cities become self-managed (`CONTEXT.md`: Self-managed
//! city).

use std::collections::HashSet;

use csp_shared::terrain::{terrain_at, wrap_distance, Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, ResidentOrder, Stock, WorldState};
use serde_json::{json, Value};

use super::{end_realm, go_down};
use crate::invariants::check_all;
use crate::invariants::checks::owners_exist;
use crate::npc_behaviour::run_by_npc_city;
use crate::npc_test_world::Runner;
use crate::queries::city_area::in_city_area;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::test_world::{add_city, city_terrain, world_with_city};

/// A free Plains tile at least `far` tiles from every town hall, for a second city's town hall
/// (`freePlains`).
fn free_plains(world: &WorldState, terrain: &TerrainMap, far: f64) -> (f64, f64) {
    let size = terrain.size;
    let halls: Vec<(i32, i32)> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::TownHall)
        .map(|b| (b.x as i32, b.y as i32))
        .collect();
    let mut taken: HashSet<(i32, i32)> =
        world.buildings.iter().map(|b| (b.x as i32, b.y as i32)).collect();
    taken.extend(world.nodes.iter().map(|n| (n.x as i32, n.y as i32)));
    for y in 2..size - 2 {
        for x in 2..size - 2 {
            if terrain_at(terrain, x, y) != Terrain::Plains as u8 || taken.contains(&(x, y)) {
                continue;
            }
            if halls.iter().all(|h| wrap_distance(size, *h, (x, y)) >= far) {
                return (f64::from(x), f64::from(y));
            }
        }
    }
    panic!("no free Plains")
}

struct Two {
    world: WorldState,
    terrain: &'static TerrainMap,
    realm: String,
    user_id: u64,
    leader: String,
    first: String,
    second: String,
}

/// Player 1's starting city and a second city of their realm far from it (`twoCities`).
fn two_cities() -> Two {
    let terrain = city_terrain();
    let mut world = world_with_city();
    let realm = world.realms[0].clone();
    let first = world.cities[0].id.clone();
    let (x, y) = free_plains(&world, terrain, 40.0);
    add_city(&mut world, "city-second", Some(&realm.id), x, y, None);
    world.cities.last_mut().unwrap().name = "Redbank".into();
    Two {
        world,
        terrain,
        realm: realm.id,
        user_id: realm.user_id,
        leader: realm.leader_id,
        first,
        second: "city-second".into(),
    }
}

fn hall_of(world: &WorldState, city: &str) -> (f64, f64) {
    let c = world.cities.iter().find(|c| c.id == city).unwrap();
    let h = world.buildings.iter().find(|b| b.id == c.town_hall_id).unwrap();
    (h.x, h.y)
}

fn messages(world: &WorldState, terrain: &TerrainMap) -> Vec<String> {
    check_all(world, terrain).into_iter().map(|v| v.message).collect()
}

fn order(v: Value) -> Option<ResidentOrder> {
    Some(serde_json::from_value(v).unwrap())
}

fn realm_of_city(world: &WorldState, city: &str) -> Option<String> {
    world.cities.iter().find(|c| c.id == city).unwrap().realm_id.clone()
}

#[test]
fn turns_each_city_into_its_own_npc_city_with_its_residents_horses_and_carriages() {
    let Two { mut world, terrain, realm, leader, first, second, .. } = two_cities();
    let hall = hall_of(&world, &second);
    // One resident lives in the second city, one more is homeless next to it.
    let s = world.residents.iter().position(|r| r.id != leader).unwrap();
    let settler = world.residents[s].id.clone();
    let r = &mut world.residents[s];
    (r.city_id, r.x, r.y, r.order) = (Some(second.clone()), hall.0 + 1.0, hall.1, None);
    let fields = NewResident {
        id: "homeless",
        owner: Some(&realm),
        city_id: None,
        x: hall.0,
        y: hall.1 + 1.0,
        tick: 0.0,
    };
    let mut m = Mulberry32::new(3.0);
    let homeless = new_resident(&mut || m.next(), &fields, None);
    world.residents.push(homeless);
    // A horse and the carriage stand next to the second city; the other horse stays home.
    (world.horses[0].x, world.horses[0].y) = (hall.0 - 1.0, hall.1);
    let carriage = &mut world.carriages[0];
    (carriage.x, carriage.y, carriage.horse_id) = (hall.0 - 1.0, hall.1, None);
    let first_residents: Vec<String> = world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(first.as_str()) && r.id != settler)
        .map(|r| r.id.clone())
        .collect();

    end_realm(&mut world, &realm, terrain.size);

    assert!(world.realms.is_empty());
    for c in [&first, &second] {
        assert_eq!(realm_of_city(&world, c), None);
    }
    for r in &world.residents {
        assert_eq!(r.owner, None);
        assert!(run_by_npc_city(&world, r), "{}", r.id);
    }
    let now: Vec<String> = world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(first.as_str()))
        .map(|r| r.id.clone())
        .collect();
    assert_eq!(now, first_residents);
    let city_of = |id: &str| world.residents.iter().find(|r| r.id == id).unwrap().city_id.clone();
    assert_eq!(city_of(&settler), Some(second.clone()));
    assert_eq!(city_of("homeless"), Some(second.clone()));
    let owners = |realm: &Option<String>, city: &Option<String>| (realm.clone(), city.clone());
    let (near, home) = (&world.horses[0], &world.horses[1]);
    assert_eq!(owners(&near.realm_id, &near.city_id), (None, Some(second.clone())));
    assert_eq!(owners(&home.realm_id, &home.city_id), (None, Some(first.clone())));
    let k = &world.carriages[0];
    assert_eq!(owners(&k.realm_id, &k.city_id), (None, Some(second.clone())));
    assert_eq!(messages(&world, terrain), Vec::<String>::new());
}

#[test]
fn sends_residents_away_home_leaves_workers_on_their_citys_farm_and_ends_player_only_orders() {
    let Two { mut world, terrain, realm, first, second, .. } = two_cities();
    let hall = hall_of(&world, &first);
    let farm = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(first.as_str()))
        .unwrap()
        .clone();
    let own: Vec<usize> = (0..world.residents.len())
        .filter(|&i| world.residents[i].city_id.as_deref() == Some(first.as_str()))
        .take(3)
        .collect();
    let (away, worker, builder) = (own[0], own[1], own[2]);
    // Out by the second city, on a Player's errand.
    let far = hall_of(&world, &second);
    let r = &mut world.residents[away];
    (r.x, r.y) = (far.0 + 1.0, far.1);
    r.order = order(json!({
        "kind": "walkTo", "target": { "x": far.0 + 2.0, "y": far.1 }, "path": null, "progress": 0,
    }));
    let r = &mut world.residents[worker];
    (r.x, r.y) = (farm.x, farm.y);
    r.order = order(json!({
        "kind": "workAt", "buildingId": farm.id, "at": { "x": farm.x, "y": farm.y }, "progress": 0,
    }));
    let work = r.order.clone();
    let r = &mut world.residents[builder];
    (r.x, r.y) = (hall.0, hall.1 + 1.0);
    r.order = order(json!({
        "kind": "drive", "carriageId": "k0", "target": { "x": 0, "y": 0 }, "path": null,
        "progress": 0,
    }));
    let away_id = world.residents[away].id.clone();

    end_realm(&mut world, &realm, terrain.size);

    let Some(ResidentOrder::WalkTo(o)) = &world.residents[away].order else {
        panic!("not walking home");
    };
    assert!(in_city_area(&world, &first, o.target.x, o.target.y, terrain.size));
    assert_eq!(world.residents[worker].order, work);
    assert_eq!(world.residents[builder].order, None);
    assert_eq!(messages(&world, terrain), Vec::<String>::new());

    // The one away does get home, on their own.
    let mut runner = Runner::new(terrain);
    let home = |w: &WorldState| {
        let r = w.residents.iter().find(|r| r.id == away_id).unwrap();
        in_city_area(w, &first, r.x, r.y, terrain.size)
    };
    for _ in 0..20000 {
        if home(&world) {
            break;
        }
        runner.step(&mut world, terrain);
    }
    assert!(home(&world));
    assert_eq!(messages(&world, terrain), Vec::<String>::new());
}

#[test]
fn tells_the_player_what_became_of_each_city_and_where_it_stands() {
    let Two { mut world, terrain, realm, user_id, leader, first, second } = two_cities();
    let s = world.residents.iter().position(|r| r.id != leader).unwrap();
    world.residents[s].city_id = Some(second.clone());

    end_realm(&mut world, &realm, terrain.size);

    let living = |c: &str| {
        world.residents.iter().filter(|r| r.city_id.as_deref() == Some(c)).count() as f64
    };
    let ((x1, y1), (x2, y2)) = (hall_of(&world, &first), hall_of(&world, &second));
    let name = world.cities.iter().find(|c| c.id == first).unwrap().name.clone();
    let event = serde_json::to_value(world.events.last().unwrap()).unwrap();
    assert_eq!(event["kind"], "selfManaged");
    assert_eq!(event["userId"], json!(user_id));
    let want = json!([
        { "cityId": first, "name": name, "x": x1, "y": y1, "residents": living(&first) },
        { "cityId": second, "name": "Redbank", "x": x2, "y": y2, "residents": 1.0 },
    ]);
    assert_eq!(
        crate::test_support::as_numbers(&event["cities"]),
        crate::test_support::as_numbers(&want)
    );
}

#[test]
fn leaves_everything_to_nobody_when_the_realm_has_no_city_left() {
    let terrain = city_terrain();
    let mut world = world_with_city();
    let realm = world.realms[0].id.clone();
    world.cities.clear();
    for b in &mut world.buildings {
        b.city_id = None;
    }
    for r in &mut world.residents {
        r.city_id = None;
    }
    world.buildings.retain(|b| b.kind != BuildingKind::TownHall);

    end_realm(&mut world, &realm, terrain.size);

    for r in &world.residents {
        assert_eq!((&r.owner, &r.city_id), (&None, &None));
    }
    for h in &world.horses {
        assert_eq!((&h.realm_id, &h.city_id), (&None, &None));
    }
    for k in &world.carriages {
        assert_eq!((&k.realm_id, &k.city_id), (&None, &None));
    }
    assert_eq!(owners_exist(&world, terrain), []);
    let event = serde_json::to_value(world.events.last().unwrap()).unwrap();
    assert_eq!((&event["kind"], &event["cities"]), (&json!("selfManaged"), &json!([])));
}

#[test]
fn a_leader_dying_in_the_world_leaves_nothing_belonging_to_the_ended_realm() {
    let Two { mut world, terrain, leader, .. } = two_cities();
    let i = world.residents.iter().position(|r| r.id == leader).unwrap();
    world.residents[i].hunger = 0.0;
    world.residents[i].carried = Stock::new();
    // Down from hunger, and their time is up (`CONTEXT.md`: Down).
    go_down(&mut world, i);
    world.residents[i].down_until = Some(world.tick as f64);
    let mut scratch = crate::tick::Scratch::default();
    crate::world::step_world(&mut world, terrain, &mut scratch, None, None);
    assert!(world.realms.is_empty());
    assert_eq!(owners_exist(&world, terrain), []);
    assert_eq!(messages(&world, terrain), Vec::<String>::new());
}

#[test]
fn catches_anything_left_belonging_to_an_ended_realm_or_to_a_city_it_cannot_belong_to() {
    let Two { mut world, terrain, realm, first, .. } = two_cities();
    world.realms.clear();
    world.horses[0].city_id = Some(first);
    let found = owners_exist(&world, terrain);
    let ids: HashSet<&str> = found.iter().map(|v| v.entity_ids[0].as_str()).collect();
    for r in &world.residents {
        assert!(ids.contains(r.id.as_str()), "{}", r.id);
    }
    for c in &world.cities {
        assert!(ids.contains(c.id.as_str()), "{}", c.id);
    }
    let horse = &world.horses[0].id;
    assert_eq!(found.iter().filter(|v| &v.entity_ids[0] == horse).count(), 2);
    assert!(found[0].message.contains(&realm));
}
