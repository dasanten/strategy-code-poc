//! `apps/server/src/territory.test.ts`. The `territorySound` checks come with the invariants
//! (T86.13).

use csp_shared::balance::{
    TERRITORY_CITY_BASE, TERRITORY_MAX_REACH, TERRITORY_PER_ARMED, TERRITORY_PER_RESIDENT,
    TERRITORY_WORKPLACE_BASE,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_HOUR;
use csp_shared::world::{BuildingKind, Good, Resident, ResidentOrder, WorldState};
use serde_json::json;

use super::*;
use crate::queries::residents::is_armed;
use crate::queries::territory::{
    compute_territory, control_reach, control_sources, territory_owner,
};
use crate::realm_test_world::{add_city, building, plains, resident};
use crate::world::create_world;

/// All Plains, 480 tiles a side: room for territory to reach its farthest without wrapping.
fn terrain() -> TerrainMap {
    plains(480)
}
const SIZE: i32 = 480;

/// An empty world on the plains with realms r1 and r2, their Leaders far off in no city.
fn setup() -> WorldState {
    let mut world = create_world(&terrain(), 1);
    world.nodes.clear();
    for (id, user, leader) in [("r1", 1, "lead1"), ("r2", 2, "lead2")] {
        world.realms.push(
            serde_json::from_value(json!({"id": id, "userId": user, "leaderId": leader}))
                .expect("a realm"),
        );
    }
    person(&mut world, Some("lead1"), Some("r1"), 400.0, 400.0, None, false);
    person(&mut world, Some("lead2"), Some("r2"), 400.0, 402.0, None, false);
    world
}

/// Adds a resident; `armed` gives them a spear. Returns their index.
fn person(
    world: &mut WorldState,
    id: Option<&str>,
    owner: Option<&str>,
    x: f64,
    y: f64,
    city: Option<&str>,
    armed: bool,
) -> usize {
    let id = id.map_or_else(|| format!("p{}", world.residents.len()), str::to_string);
    let mut r: Resident = resident(&id, owner, x, y);
    r.city_id = city.map(str::to_string);
    if armed {
        r.carried.insert(Good::Spear, 1.0);
    }
    world.residents.push(r);
    world.residents.len() - 1
}

/// Puts a finished smithy (2×2) with its north-west tile on (x, y) and sets `workers` to work it.
fn workplace(world: &mut WorldState, x: f64, y: f64, workers: &[usize]) -> String {
    let id = format!("smithy{x},{y}");
    world.buildings.push(building(&id, BuildingKind::Smithy, None, x, y));
    for &i in workers {
        let r = &mut world.residents[i];
        (r.x, r.y) = (x, y);
        let order = json!({"kind": "workAt", "buildingId": id, "at": {"x": x, "y": y}, "progress": 0, "makes": "spear"});
        r.order = Some(serde_json::from_value::<ResidentOrder>(order).expect("a work order"));
    }
    id
}

fn owner(world: &WorldState, x: i32, y: i32) -> Option<String> {
    territory_owner(&compute_territory(world, SIZE), x, y).map(str::to_string)
}

#[test]
fn a_city_controls_the_ground_around_it_as_far_as_its_reach() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 120.0, 120.0, "Ashford");
    let reach = control_reach(TERRITORY_CITY_BASE) as i32;
    assert!(reach > 0);
    // From every tile of the town hall's footprint, (120, 120) to (122, 122).
    assert_eq!(owner(&world, 120, 120).as_deref(), Some("r1"));
    assert_eq!(owner(&world, 122 + reach, 121).as_deref(), Some("r1"));
    assert_eq!(owner(&world, 122 + reach + 1, 121), None);
    assert_eq!(owner(&world, 122 + reach, 122 + reach), None); // round, not square
}

#[test]
fn projects_from_every_finished_city_building_not_from_sites() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 120.0, 120.0, "Ashford");
    world.buildings.push(building("h1", BuildingKind::House, Some("c1"), 126.0, 120.0));
    let mut site = building("h2", BuildingKind::House, Some("c1"), 132.0, 120.0);
    site.site = Some(serde_json::from_value(json!({"delivered": {}, "work": 0})).expect("a site"));
    world.buildings.push(site);
    let reach = control_reach(TERRITORY_CITY_BASE) as i32;
    assert_eq!(owner(&world, 127 + reach, 120).as_deref(), Some("r1"));
    assert_eq!(owner(&world, 128 + reach, 120), None);
}

#[test]
fn reaches_farther_with_more_residents_and_more_again_with_a_garrison() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 120.0, 120.0, "Ashford");
    for _ in 0..20 {
        person(&mut world, None, Some("r1"), 120.0, 121.0, Some("c1"), false);
    }
    let s = control_sources(&world, SIZE).remove(0);
    assert_eq!(s.strength, TERRITORY_CITY_BASE + 20.0 * TERRITORY_PER_RESIDENT);
    let reach = s.reach;
    assert!(reach > control_reach(TERRITORY_CITY_BASE));
    assert_eq!(owner(&world, 122 + reach as i32, 120).as_deref(), Some("r1"));
    // Armed residents of the city in its area are its garrison; one out in the fields is not.
    person(&mut world, None, Some("r1"), 124.0, 120.0, Some("c1"), true);
    person(&mut world, None, Some("r1"), 200.0, 200.0, Some("c1"), true);
    let g = control_sources(&world, SIZE).remove(0);
    assert_eq!(
        g.strength,
        TERRITORY_CITY_BASE + 22.0 * TERRITORY_PER_RESIDENT + TERRITORY_PER_ARMED
    );
    assert!(g.reach >= reach);
}

#[test]
fn never_reaches_past_the_farthest_reach_however_strong() {
    assert_eq!(control_reach(1e6), TERRITORY_MAX_REACH);
}

#[test]
fn where_two_cities_overlap_the_stronger_wins() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 120.0, 120.0, "Ashford");
    add_city(&mut world, "c2", Some("r2"), 160.0, 120.0, "Bury");
    for _ in 0..4 {
        person(&mut world, None, Some("r1"), 120.0, 121.0, Some("c1"), false);
    }
    for _ in 0..30 {
        person(&mut world, None, Some("r2"), 160.0, 121.0, Some("c2"), false);
    }
    // Halfway between them, and even nearer the weak city, the strong one wins.
    assert_eq!(owner(&world, 141, 120).as_deref(), Some("r2"));
    assert_eq!(owner(&world, 138, 120).as_deref(), Some("r2"));
    // Its own town hall the weak city keeps.
    assert_eq!(owner(&world, 120, 120).as_deref(), Some("r1"));
}

#[test]
fn a_tie_between_equally_strong_organizations_leaves_the_tile_to_nobody() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 120.0, 120.0, "Ashford");
    add_city(&mut world, "c2", Some("r2"), 136.0, 120.0, "Bury");
    assert_eq!(owner(&world, 129, 120), None);
    assert_eq!(owner(&world, 128, 120).as_deref(), Some("r1"));
    assert_eq!(owner(&world, 130, 120).as_deref(), Some("r2"));
}

#[test]
fn cities_of_one_realm_never_contest_each_other() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 120.0, 120.0, "Ashford");
    add_city(&mut world, "c2", Some("r1"), 136.0, 120.0, "Bury");
    assert_eq!(owner(&world, 129, 120).as_deref(), Some("r1"));
}

#[test]
fn a_city_of_no_realm_holds_territory_for_itself() {
    let mut world = setup();
    add_city(&mut world, "c1", None, 120.0, 120.0, "Ashford");
    assert_eq!(owner(&world, 124, 124).as_deref(), Some("c1"));
}

#[test]
fn a_workplace_projects_control_only_while_its_holder_guards_it() {
    let mut world = setup();
    let worker = person(&mut world, None, Some("r1"), 0.0, 0.0, None, false);
    let b = workplace(&mut world, 240.0, 240.0, &[worker]);
    assert_eq!(owner(&world, 240, 240), None);
    // An armed resident of another realm next to it guards nothing.
    person(&mut world, None, Some("r2"), 242.0, 240.0, None, true);
    assert_eq!(owner(&world, 240, 240), None);
    // Two tiles off is too far to guard it.
    let guard = person(&mut world, None, Some("r1"), 243.0, 240.0, None, true);
    assert_eq!(owner(&world, 240, 240), None);
    // Next to its footprint, (240, 240) to (241, 241), diagonally too.
    (world.residents[guard].x, world.residents[guard].y) = (242.0, 242.0);
    let s = control_sources(&world, SIZE).remove(0);
    assert_eq!((s.id.as_str(), s.owner.as_str()), (b.as_str(), "r1"));
    assert_eq!(s.strength, TERRITORY_WORKPLACE_BASE + TERRITORY_PER_RESIDENT + TERRITORY_PER_ARMED);
    assert_eq!(owner(&world, 240, 240).as_deref(), Some("r1"));
    assert_eq!(owner(&world, 241 + s.reach as i32, 240).as_deref(), Some("r1"));
    assert_eq!(owner(&world, 242 + s.reach as i32, 240), None);
    // An armed worker on it guards it too.
    world.residents[guard].x = 0.0;
    world.residents[worker].carried = [(Good::Sword, 1.0)].into_iter().collect();
    assert!(is_armed(&world.residents[worker].carried));
    assert_eq!(owner(&world, 240, 240).as_deref(), Some("r1"));
}

#[test]
fn a_workplace_nobody_works_projects_nothing_however_guarded() {
    let mut world = setup();
    workplace(&mut world, 240.0, 240.0, &[]);
    person(&mut world, None, Some("r1"), 240.0, 240.0, None, true);
    assert!(control_sources(&world, SIZE).is_empty());
}

#[test]
fn a_guarded_workplace_can_win_ground_off_a_city_nearby() {
    let mut world = setup();
    add_city(&mut world, "c1", Some("r1"), 120.0, 120.0, "Ashford");
    let worker = person(&mut world, None, Some("r2"), 0.0, 0.0, None, false);
    workplace(&mut world, 136.0, 120.0, &[worker]);
    person(&mut world, None, Some("r2"), 138.0, 120.0, None, true);
    assert_eq!(owner(&world, 133, 120).as_deref(), Some("r2"));
    assert_eq!(owner(&world, 120, 120).as_deref(), Some("r1"));
}

#[test]
fn the_tracker_recomputes_once_a_game_hour() {
    let mut world = setup();
    let terrain = terrain();
    let mut tracker = TerritoryTracker::default();
    assert!(tracker.update(&world, &terrain));
    assert!(tracker.current.as_ref().expect("worked out").owners.is_empty());
    add_city(&mut world, "c1", Some("r1"), 120.0, 120.0, "Ashford");
    world.tick += TICKS_PER_GAME_HOUR as u64 - 1;
    assert!(!tracker.update(&world, &terrain));
    assert_eq!(territory_owner(tracker.current.as_ref().expect("worked out"), 120, 120), None);
    world.tick += 1;
    assert!(tracker.update(&world, &terrain));
    let current = tracker.current.as_ref().expect("worked out");
    assert_eq!(current.tick, world.tick);
    assert_eq!(territory_owner(current, 120, 120), Some("r1"));
}
