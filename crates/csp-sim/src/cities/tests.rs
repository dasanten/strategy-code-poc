//! `apps/server/src/cities.test.ts`: city membership and the city area, ported one to one.
//! A torn-down town hall's city is dissolved here directly (`dissolve_city`), as teardown calls
//! it; storages laid out and finished are building's to test.

use csp_shared::balance::{CITY_AREA_MARGIN, CITY_BUILDING_REACH, HOME_FOOD_LOW};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildOrder, Building, BuildingKind, ConstructionSite, Good, Pair, ResidentOrder, Stock, Tile,
    WorldState,
};

use super::*;
use crate::invariants::check_all;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::building::{build_materials, build_work_of};
use crate::queries::city_area::{cities_at, in_city_area};
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::test_world::{add_city, building, empty_world, live, live_mut, realm, resident};
use crate::tick::Scratch;

const SIZE: i32 = 160;
const R: f64 = CITY_BUILDING_REACH;

/// An empty world with realm r1 (Player 7) and its resident w1 at (1, 1), drawn as `newResident`
/// draws one, with Strength 10.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "w1");
    let mut m = Mulberry32::new(1.0);
    let fields =
        NewResident { id: "w1", owner: Some("r1"), city_id: None, x: 1.0, y: 1.0, tick: 0.0 };
    let mut w1 = new_resident(&mut || m.next(), &fields, None);
    w1.stats.strength = csp_shared::world::Stat { base: 10.0, trained: 0.0 };
    world.residents.push(w1);
    world
}

/// A finished building of no city on (x, y); `update_city_membership` decides its city.
fn put(world: &mut WorldState, kind: BuildingKind, x: f64, y: f64) -> String {
    let id = format!("{}{x},{y}", crate::queries::names::kind_name(kind));
    building(world, &id, kind, None, x, y);
    id
}

/// A stretch of wall from (x, y) eastward, `n` tiles long.
fn wall_east(world: &mut WorldState, x: f64, y: f64, n: usize) -> Vec<String> {
    (0..n).map(|i| put(world, BuildingKind::Wall, x + i as f64, y)).collect()
}

fn city_of(world: &WorldState, id: &str) -> Option<String> {
    city_membership(world, SIZE).get(id).cloned()
}

fn site() -> ConstructionSite {
    serde_json::from_value(serde_json::json!({ "delivered": {}, "work": 0 })).unwrap()
}

fn c1() -> Option<String> {
    Some("c1".into())
}

// A test city's town hall stands at (40, 40): its footprint runs to (42, 42).

#[test]
fn grows_outward_from_the_town_hall_in_a_chain_of_city_buildings_within_reach() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0, None);
    // Reach counts from footprint to footprint.
    let near = put(&mut world, BuildingKind::House, 42.0 + R, 40.0);
    let wall = wall_east(&mut world, 44.0 + R, 40.0, 6);
    let far = put(&mut world, BuildingKind::Storage, 49.0 + 2.0 * R, 40.0);
    let beyond = put(&mut world, BuildingKind::House, 51.0 + 3.0 * R, 40.0);
    assert_eq!(city_of(&world, &near), c1());
    for w in &wall {
        assert_eq!(city_of(&world, w), c1());
    }
    assert_eq!(city_of(&world, &far), c1());
    assert_eq!(city_of(&world, &beyond), None);
}

#[test]
fn leaves_out_farms_workplaces_stables_and_construction_sites_and_chains_nothing_through_them() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0, None);
    let farm = put(&mut world, BuildingKind::Farm, 44.0, 40.0);
    let past = put(&mut world, BuildingKind::House, 43.0 + R, 40.0);
    let wall = put(&mut world, BuildingKind::Wall, 40.0, 44.0);
    world.buildings.iter_mut().find(|b| b.id == wall).unwrap().site = Some(site());
    let past_site = put(&mut world, BuildingKind::House, 40.0, 43.0 + R);
    let members = city_membership(&world, SIZE);
    for b in [farm, past, wall, past_site] {
        assert!(!members.contains_key(&b), "{b}");
    }
}

#[test]
fn gives_a_building_both_chains_reach_to_the_city_whose_town_hall_is_nearer() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0, None);
    add_city(&mut world, "c2", Some("r1"), 60.0, 40.0, None);
    // A wall from one town hall to the other: each part to the nearer hall, the older on a tie.
    let wall = wall_east(&mut world, 43.0, 40.0, 17);
    let cities: Vec<Option<String>> = wall.iter().map(|w| city_of(&world, w)).collect();
    let mut expected = vec![c1(); 8];
    expected.extend(vec![Some("c2".to_string()); 9]);
    assert_eq!(cities, expected);
}

#[test]
fn settles_a_tie_for_the_older_city() {
    let mut world = setup();
    add_city(&mut world, "c9", Some("r1"), 40.0, 40.0, None);
    add_city(&mut world, "c3", Some("r1"), 60.0, 40.0, None);
    let middle = put(&mut world, BuildingKind::House, 50.0, 40.0);
    assert_eq!(city_of(&world, &middle).as_deref(), Some("c3"));
}

#[test]
fn lets_a_chain_go_on_only_through_its_own_buildings() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0, None);
    add_city(&mut world, "c2", Some("r1"), 40.0, 56.0, None);
    // A house c2 holds, and past it, out of c1's reach except through that house.
    let held = put(&mut world, BuildingKind::House, 48.0, 52.0);
    let past = put(&mut world, BuildingKind::House, 49.0 + R, 52.0);
    assert_eq!(city_of(&world, &held).as_deref(), Some("c2"));
    assert_eq!(city_of(&world, &past).as_deref(), Some("c2"));
}

#[test]
fn reaches_across_the_joins_of_the_map() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 0.0, 0.0, None);
    let across = put(&mut world, BuildingKind::House, f64::from(SIZE - 2), f64::from(SIZE - 1));
    assert_eq!(city_of(&world, &across), c1());
    assert!(in_city_area(&world, "c1", f64::from(SIZE - 1), 1.0, SIZE));
}

#[test]
fn drops_a_building_cut_off_from_the_chain_once_the_building_between_goes() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0, None);
    let link = put(&mut world, BuildingKind::Wall, 42.0 + R, 40.0);
    let end = put(&mut world, BuildingKind::House, 42.0 + 2.0 * R, 40.0);
    update_city_membership(&mut world, SIZE);
    let city =
        |world: &WorldState| world.buildings.iter().find(|b| b.id == end).unwrap().city_id.clone();
    assert_eq!(city(&world), c1());
    world.buildings.retain(|b| b.id != link);
    update_city_membership(&mut world, SIZE);
    assert_eq!(city(&world), None);
}

#[test]
fn is_the_tiles_right_around_the_citys_buildings_footprints() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0, None);
    wall_east(&mut world, 43.0, 40.0, 3);
    update_city_membership(&mut world, SIZE);
    let m = CITY_AREA_MARGIN;
    assert!(in_city_area(&world, "c1", 40.0 - m, 40.0 - m, SIZE));
    assert!(in_city_area(&world, "c1", 45.0 + m, 40.0 + m, SIZE));
    assert!(in_city_area(&world, "c1", 42.0 + m, 42.0 + m, SIZE));
    assert!(!in_city_area(&world, "c1", 45.0 + m + 1.0, 40.0, SIZE));
    assert!(!in_city_area(&world, "c1", 40.0, 40.0 - m - 1.0, SIZE));
    assert_eq!(cities_at(&world, 44.0, 41.0, SIZE), vec![0]);
}

/// All Plains, `SIZE` tiles a side.
fn terrain() -> TerrainMap {
    crate::test_support::plains(SIZE)
}

/// One `stepWorld`, nobody walking.
fn step_world(world: &mut WorldState) {
    crate::world::step_world(world, &terrain(), &mut Scratch::default(), None, None);
}

/// Lays a site of `kind` at w1's tile with all its materials and all but a tick's work, and has w1
/// build it (`nearlyBuilt`); the site's id.
fn nearly_built(world: &mut WorldState, kind: BuildingKind) -> String {
    let w1 = live(world, "w1").unwrap();
    let (x, y) = (w1.x, w1.y);
    let id = format!("site{}", world.buildings.len());
    building(world, &id, kind, None, x, y);
    let work = match build_work_of(kind) {
        0.0 => 1.0,
        w => w,
    };
    world.buildings.last_mut().unwrap().site =
        Some(ConstructionSite { delivered: build_materials(kind), work: work - 1.0 });
    live_mut(world, "w1").order = Some(ResidentOrder::Build(BuildOrder {
        building: kind,
        at: Tile { x, y },
        site_id: Some(id.clone()),
    }));
    id
}

fn b<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).unwrap()
}

#[test]
fn is_where_residents_are_at_home_and_take_meals_from_the_storage() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0, None);
    let storage = put(&mut world, BuildingKind::Storage, 43.0, 40.0);
    world.buildings.last_mut().unwrap().stock = Some(Stock::from([(Good::Food, 50.0)]));
    // Out along a new stretch of wall, far from the storage, but in the city's area.
    wall_east(&mut world, 45.0, 40.0, 10);
    update_city_membership(&mut world, SIZE);
    assert_eq!(b(&world, &storage).city_id, c1());
    let w1 = live_mut(&mut world, "w1");
    (w1.x, w1.y, w1.carried) = (54.0 + CITY_AREA_MARGIN, 41.0, Stock::default());
    step_world(&mut world);
    let food = |world: &WorldState| live(world, "w1").unwrap().carried.get(&Good::Food).copied();
    assert!(food(&world).unwrap_or(0.0) >= HOME_FOOD_LOW);
    // One step further out there is nothing.
    let w1 = live_mut(&mut world, "w1");
    (w1.x, w1.y, w1.carried) = (55.0 + CITY_AREA_MARGIN, 41.0, Stock::default());
    step_world(&mut world);
    assert_eq!(food(&world).unwrap_or(0.0), 0.0);
    assert_eq!(check_all(&world, &terrain()), vec![]);
}

#[test]
fn a_town_hall_can_be_built_and_founds_a_city_of_the_builders_realm() {
    let mut world = setup();
    let map = std::sync::Arc::new(terrain());
    let mut q = OrderQueue::new(order_kinds(), Some(map));
    let order = serde_json::json!({ "kind": "build", "residentId": "w1", "building": "townHall" });
    let reply = q.receive(&world, &OrderSender::player(7, "Mara"), &"q".into(), &order);
    assert!(matches!(reply, OrderReply::Ack { .. }), "{reply:?}");
    let hall = nearly_built(&mut world, BuildingKind::TownHall);
    step_world(&mut world);
    assert_eq!(b(&world, &hall).site, None);
    let cities: Vec<_> =
        world.cities.iter().map(|c| (c.realm_id.as_deref(), c.town_hall_id.as_str())).collect();
    assert_eq!(cities, vec![(Some("r1"), hall.as_str())]);
    assert_eq!(b(&world, &hall).city_id.as_deref(), Some(world.cities[0].id.as_str()));
    assert_eq!(check_all(&world, &terrain()), vec![]);
}

#[test]
fn founds_a_city_around_a_town_hall_of_a_realm_and_names_it_from_its_id() {
    let mut world = setup();
    let hall = building(&mut world, "hall", BuildingKind::TownHall, None, 40.0, 40.0);
    let ci = found_city(&mut world, hall, Some("r1"));
    let city = &world.cities[ci];
    assert_eq!(
        (city.realm_id.as_deref(), city.town_hall_id.as_str(), city.game_name),
        (Some("r1"), "hall", Some(true))
    );
    assert!(CITY_NAMES.contains(&city.name.as_str()));
    assert_eq!(city.layout, None);
    assert_eq!(world.buildings[hall].city_id.as_deref(), Some(city.id.as_str()));
    // A daughter of no realm gets a layout, and a name no other city has.
    let other = building(&mut world, "hall2", BuildingKind::TownHall, None, 80.0, 80.0);
    let first = world.cities[ci].name.clone();
    world.seed = 1;
    let cj = found_city(&mut world, other, None);
    assert!(world.cities[cj].layout.is_some());
    assert_ne!(world.cities[cj].name, first);
}

#[test]
fn a_wall_built_near_it_grows_the_city() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 2.0, 1.0, None);
    live_mut(&mut world, "w1").x = 4.0 + R;
    let wall = nearly_built(&mut world, BuildingKind::Wall);
    let out = 4.0 + R + CITY_AREA_MARGIN;
    assert!(!in_city_area(&world, "c1", out, 1.0, SIZE));
    step_world(&mut world);
    assert_eq!(b(&world, &wall).city_id, c1());
    assert!(in_city_area(&world, "c1", out, 1.0, SIZE));
    assert_eq!(check_all(&world, &terrain()), vec![]);
}

/// The city's half of the TypeScript test: teardown finishing the hall is T86.6's.
#[test]
fn torn_down_dissolves_the_city_buildings_and_residents_stay_residents_are_homeless() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 1.0, 1.0, None);
    let house = put(&mut world, BuildingKind::House, 5.0, 1.0);
    let farm = put(&mut world, BuildingKind::Farm, 20.0, 20.0);
    world.buildings.iter_mut().find(|b| b.id == farm).unwrap().city_id = c1();
    update_city_membership(&mut world, SIZE);
    resident(&mut world, "w2", Some("r1"), 3.0, 3.0);
    live_mut(&mut world, "w2").city_id = c1();
    live_mut(&mut world, "w1").city_id = c1();
    live_mut(&mut world, "w2").pair = Some(Pair { partner_id: "w1".into(), since: 0.0 });
    live_mut(&mut world, "w1").pair = Some(Pair { partner_id: "w2".into(), since: 0.0 });
    world.buildings.retain(|b| b.id != "c1-hall");
    dissolve_city(&mut world, "c1");
    update_city_membership(&mut world, SIZE);
    assert!(world.cities.is_empty());
    let h = world.buildings.iter().find(|b| b.id == house).unwrap();
    assert_eq!((h.city_id.clone(), h.x, h.y), (None, 5.0, 1.0));
    assert_eq!(world.buildings.iter().find(|b| b.id == farm).unwrap().city_id, None);
    assert!(world.residents.iter().all(|r| r.city_id.is_none() && r.pair.is_none()));
}

// `citiesFromBuildings` is `invariants.ts`'s: T86.13. Storages laid out and finished are T86.6's.
