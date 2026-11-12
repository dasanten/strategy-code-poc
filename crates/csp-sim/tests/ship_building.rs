//! Building a ship (`CONTEXT.md`: Ship, Building a ship, Vessel, T91.1): a ship site on a tile of
//! a finished haven that touches Sea, finished like any construction site, becomes an empty ship
//! of the finisher's realm on the nearest free Sea tile next to it, never on a Lake.

mod build_common;

use build_common::{
    add_city, assert_sound, building, new_resident, order, player, realm, run, site, Orders,
};
use csp_shared::balance::{BOAT_CAPACITY, BUILD_MATERIALS, BUILD_WORK, OWN_FOOD, SHIP_CAPACITY};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, ConstructionSite, Good, Stock, Vessel, VesselKind, WorldState,
};
use csp_sim::invariants::check_all;
use csp_sim::queries::building::{build_materials, build_problem, ship_site_at, BUILDABLE};
use csp_sim::queries::vessels::{
    launch_tile, vessel_at, vessel_capacity, vessel_room,
};
use csp_sim::rowing::row_problem;
use serde_json::json;

const SIZE: i32 = 32;
const NOT_HERE: &str = "a ship is built on a tile of a finished haven touching the Sea";

/// Plains, with the Sea in columns 20 to 25 but for a Lake lagoon on (20, 4)–(21, 6), and a Lake in
/// columns 2 and 3 from row 20 to 25.
fn terrain() -> TerrainMap {
    let mut tiles = vec![Terrain::Plains as u8; (SIZE * SIZE) as usize];
    for y in 0..SIZE {
        for x in 20..=25 {
            tiles[tile_index(SIZE, x, y)] = Terrain::Sea as u8;
        }
    }
    for y in 4..=6 {
        for x in 20..=21 {
            tiles[tile_index(SIZE, x, y)] = Terrain::Lake as u8;
        }
    }
    for y in 20..=25 {
        for x in 2..=3 {
            tiles[tile_index(SIZE, x, y)] = Terrain::Lake as u8;
        }
    }
    TerrainMap { size: SIZE, tiles }
}

/// Realm r1 (Player 7) with city c1, realm r2 (Player 8); a finished haven h1 of c1 covering
/// (17, 5)–(19, 7), its east column on the shore of the Sea and the lagoon, and a finished haven h2
/// covering (4, 20)–(6, 22) on the Lake alone. Resident w1 of r1 and b1 of r2 stand on h1's shore
/// tile (19, 6).
fn setup() -> WorldState {
    let mut world = build_common::empty_world(&terrain());
    world.realms.push(realm("r1", 7, "w1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 2.0, 2.0);
    for (id, x, y) in [("h1", 17.0, 5.0), ("h2", 4.0, 20.0)] {
        let mut haven = building(id, BuildingKind::Haven, x, y);
        haven.city_id = Some("c1".into());
        haven.stock = Some(Stock::new());
        world.buildings.push(haven);
    }
    for (id, owner) in [("w1", "r1"), ("b1", "r2")] {
        let mut r = new_resident(id, Some(owner), 19.0, 6.0);
        r.city_id = (owner == "r1").then(|| "c1".into());
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        world.residents.push(r);
    }
    world
}

fn problem(world: &WorldState, x: i32, y: i32) -> Option<String> {
    build_problem(world, x, y, BuildingKind::Ship, Some(&terrain()))
}

fn build(resident: &str) -> serde_json::Value {
    json!({ "kind": "build", "residentId": resident, "building": "ship" })
}

fn vessel(id: &str, kind: VesselKind, x: f64, y: f64) -> Vessel {
    Vessel { id: id.into(), kind, realm_id: None, x, y, load: Stock::new(), rower_id: None, crew_ids: Vec::new() }
}

/// A ship site on (19, 6) with all its materials and all but half a tick's work.
fn nearly_done(world: &mut WorldState) {
    let mut s = site("ss", BuildingKind::Ship, 19.0, 6.0);
    s.site = Some(ConstructionSite {
        delivered: build_materials(BuildingKind::Ship),
        work: BUILD_WORK.get("ship").unwrap() - 0.5,
    });
    world.buildings.push(s);
}

/// w1 joins the site on their tile, then works it for a tick.
fn work_on_it(world: &mut WorldState, t: &TerrainMap) {
    let mut orders = Orders::default();
    assert_eq!(order(world, &mut orders, &player(7), build("w1"), t), Ok(()));
    run(world, t, 1);
}

#[test]
fn takes_wood_and_some_iron_far_more_work_than_a_boat_and_carries_far_more_than_a_carriage() {
    assert!(BUILDABLE.contains(&BuildingKind::Ship));
    let materials = BUILD_MATERIALS.get("ship").unwrap();
    let (wood, iron) = (materials.get("wood").unwrap(), materials.get("iron").unwrap());
    assert!(wood > iron && iron > 0.0);
    assert!(BUILD_WORK.get("ship").unwrap() >= 5.0 * BUILD_WORK.get("boat").unwrap());
    const { assert!(SHIP_CAPACITY >= 4.0 * csp_shared::balance::CARRIAGE_CAPACITY) };
    let ship = vessel("s1", VesselKind::Ship, 22.0, 6.0);
    assert_eq!(vessel_capacity(&ship), SHIP_CAPACITY);
    assert!(vessel_capacity(&ship) > BOAT_CAPACITY);
}

#[test]
fn goes_on_a_tile_of_a_finished_haven_that_touches_the_sea() {
    let mut world = setup();
    // (19, 6) touches the Sea diagonally at (20, 7), (19, 7) straight; (19, 5) only the lagoon.
    assert_eq!(problem(&world, 19, 6), None);
    assert_eq!(problem(&world, 19, 7), None);
    assert_eq!(problem(&world, 19, 5).as_deref(), Some(NOT_HERE));
    // Inland haven tiles, off the haven, and a haven on a Lake alone.
    assert_eq!(problem(&world, 18, 6).as_deref(), Some(NOT_HERE));
    assert_eq!(problem(&world, 19, 9).as_deref(), Some(NOT_HERE));
    assert_eq!(problem(&world, 4, 21).as_deref(), Some(NOT_HERE));
    // A boat goes on the lake haven, and on the lagoon tile, all the same.
    let boat = |x, y| build_problem(&world, x, y, BuildingKind::Boat, Some(&terrain()));
    assert_eq!((boat(4, 21), boat(19, 5)), (None, None));
    // On an unfinished haven.
    world.buildings[1].site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    assert_eq!(problem(&world, 19, 6).as_deref(), Some(NOT_HERE));
}

#[test]
fn takes_one_ship_site_per_tile() {
    let mut world = setup();
    world.buildings.push(site("ss", BuildingKind::Ship, 19.0, 6.0));
    assert_eq!(
        problem(&world, 19, 6).as_deref(),
        Some("there is already a ship site on this tile")
    );
    assert_eq!(problem(&world, 19, 7), None);
}

#[test]
fn is_laid_out_by_a_build_order_sharing_the_havens_tile() {
    let t = terrain();
    let mut world = setup();
    let mut orders = Orders::default();
    assert_eq!(order(&mut world, &mut orders, &player(7), build("w1"), &t), Ok(()));
    let s = ship_site_at(&world, 19, 6).expect("a ship site");
    assert!(s.site.is_some());
    assert_eq!((s.city_id.as_deref(), s.stock.as_ref()), (None, None));
    assert!(world.buildings.iter().any(|b| b.id == "h1"));
    assert_sound(&world, &t);
    // Not from the lagoon tile.
    world.residents[0].y = 5.0;
    world.residents[0].order = None;
    let mut orders = Orders::default();
    assert_eq!(order(&mut world, &mut orders, &player(7), build("w1"), &t), Err(NOT_HERE.into()));
}

#[test]
fn finished_is_gone_and_an_empty_ship_of_the_finishers_realm_floats_on_the_sea_next_to_it() {
    let t = terrain();
    let mut world = setup();
    nearly_done(&mut world);
    work_on_it(&mut world, &t);
    assert!(ship_site_at(&world, 19, 6).is_none());
    assert_eq!(world.vessels.len(), 1);
    let v = &world.vessels[0];
    // Straight east is the lagoon, and so is the north-east diagonal: the Sea to the south-east.
    assert_eq!(
        (v.kind, v.realm_id.as_deref(), v.x, v.y),
        (VesselKind::Ship, Some("r1"), 20.0, 7.0)
    );
    assert!(v.id.starts_with("ship"), "{}", v.id);
    assert!(v.load.is_empty());
    assert!(world.residents[0].order.is_none());
    assert_sound(&world, &t);
}

#[test]
fn belongs_to_the_realm_of_whoever_finishes_it() {
    let t = terrain();
    let mut world = setup();
    nearly_done(&mut world);
    let mut orders = Orders::default();
    assert_eq!(order(&mut world, &mut orders, &player(8), build("b1"), &t), Ok(()));
    run(&mut world, &t, 1);
    assert_eq!(world.vessels[0].realm_id.as_deref(), Some("r2"));
}

#[test]
fn floats_on_the_nearest_free_sea_tile_never_on_the_lake() {
    let t = terrain();
    let mut world = setup();
    // A boat from the same tile floats straight east, on the lagoon; a ship never does.
    assert_eq!(launch_tile(&world, &t, 19, 6, VesselKind::Boat), Some((20, 6)));
    assert_eq!(launch_tile(&world, &t, 19, 6, VesselKind::Ship), Some((20, 7)));
    // With the only Sea tile next to it taken, the nearest free one further out over the Sea.
    world.vessels.push(vessel("v1", VesselKind::Boat, 20.0, 7.0));
    assert_eq!(launch_tile(&world, &t, 19, 6, VesselKind::Ship), Some((21, 7)));
    // From the lagoon tile and the lake haven, no Sea is next to it.
    assert_eq!(launch_tile(&world, &t, 19, 5, VesselKind::Ship), None);
    assert_eq!(launch_tile(&world, &t, 4, 21, VesselKind::Ship), None);
    nearly_done(&mut world);
    work_on_it(&mut world, &t);
    assert!(vessel_at(&world, 21, 7).is_some_and(|v| v.kind == VesselKind::Ship));
    assert_sound(&world, &t);
}

/// A ship is sailed, never rowed (`CONTEXT.md`: Sailing); boarding it is docking's (T91.2).
#[test]
fn is_never_rowed() {
    let mut world = setup();
    let mut ship = vessel("s1", VesselKind::Ship, 20.0, 7.0);
    ship.realm_id = Some("r1".into());
    world.vessels.push(ship);
    let (w1, s1) = (&world.residents[0], &world.vessels[0]);
    assert_eq!(row_problem(&world, w1, s1).as_deref(), Some("a ship is sailed, not rowed"));
    assert_eq!(vessel_room(&world, s1), SHIP_CAPACITY);
}

mod invariants {
    use super::*;

    fn broken(world: &WorldState) -> Vec<String> {
        check_all(world, &terrain()).into_iter().map(|v| v.message).collect()
    }

    #[test]
    fn a_ship_is_always_on_the_sea() {
        let mut world = setup();
        world.vessels.push(vessel("s1", VesselKind::Ship, 22.0, 6.0));
        world.vessels.push(vessel("v1", VesselKind::Boat, 20.0, 6.0));
        assert!(broken(&world).is_empty(), "{:?}", broken(&world));
        world.vessels[0].x = 21.0;
        assert_eq!(broken(&world), ["ship s1 is on a Lake at (21, 6)"]);
        world.vessels[0].x = 19.0;
        assert_eq!(broken(&world), ["vessel s1 is on land at (19, 6)"]);
    }

    #[test]
    fn a_ship_site_is_on_a_haven_tile_by_the_sea() {
        let mut world = setup();
        world.buildings.push(site("ss", BuildingKind::Ship, 19.0, 6.0));
        assert!(broken(&world).is_empty(), "{:?}", broken(&world));
        world.buildings.pop();
        world.buildings.push(site("ss", BuildingKind::Ship, 19.0, 5.0));
        assert_eq!(broken(&world), ["ss is a ship site away from the Sea"]);
        world.buildings.pop();
        world.buildings.push(site("ss", BuildingKind::Ship, 19.0, 9.0));
        assert_eq!(broken(&world), ["ss is a ship site off any haven"]);
    }
}

mod sight {
    use super::*;
    use csp_shared::protocol::SeenEntity;
    use csp_sim::sight::entities_in_sight;
    use csp_sim::world_index::WorldIndex;

    #[test]
    fn shows_as_a_ship_to_whoever_sees_its_tile() {
        let mut world = setup();
        let mut v = vessel("s1", VesselKind::Ship, 20.0, 7.0);
        v.realm_id = Some("r1".into());
        world.vessels.push(v);
        let index = WorldIndex::new(&world, SIZE);
        for realm in ["r1", "r2"] {
            let seen = entities_in_sight(&world, &index, Some(realm), None);
            let ship = seen.iter().find_map(|e| match e {
                SeenEntity::Vessel(v) => Some(v.clone()),
                _ => None,
            });
            assert_eq!(ship.map(|s| (s.kind, s.x, s.y)), Some((VesselKind::Ship, 20.0, 7.0)));
        }
    }
}
