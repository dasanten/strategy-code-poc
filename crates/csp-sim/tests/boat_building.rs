//! Building a boat (`CONTEXT.md`: Vessel, Building a boat, T90.2): a boat site on a tile of a
//! finished haven that touches the water, finished like any construction site, becomes an empty
//! boat of the finisher's realm on the nearest free water tile next to it.

mod build_common;

use build_common::{
    add_city, assert_sound, building, new_resident, order, player, realm, run, site, Orders,
};
use csp_shared::balance::{BUILD_MATERIALS, BUILD_WORK, OWN_FOOD};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, ConstructionSite, Good, GoodsSpot, Stock, Vessel, VesselKind, WorldState,
};
use csp_sim::carrying::{resolve_carrying, resolve_carrying_on, CarryAction, CarryKind};
use csp_sim::invariants::check_all;
use csp_sim::queries::building::{boat_site_at, build_materials, build_problem, BUILDABLE};
use csp_sim::queries::vessels::{launch_tile, vessel_at};
use serde_json::json;

const SIZE: i32 = 32;
const NOT_HERE: &str = "a boat is built on a tile of a finished haven touching the water";

/// Plains, with a Lake running down columns 20 to 25.
fn terrain() -> TerrainMap {
    let mut tiles = vec![Terrain::Plains as u8; (SIZE * SIZE) as usize];
    for y in 0..SIZE {
        for x in 20..=25 {
            tiles[tile_index(SIZE, x, y)] = Terrain::Lake as u8;
        }
    }
    TerrainMap { size: SIZE, tiles }
}

/// Realm r1 (Player 7) with city c1, realm r2 (Player 8), and a finished haven h1 of c1 covering
/// (17, 5)–(19, 7), its east column on the Lake's shore. Resident w1 of r1 and b1 of r2 stand on
/// its shore tile (19, 6).
fn setup() -> WorldState {
    let mut world = build_common::empty_world(&terrain());
    world.realms.push(realm("r1", 7, "w1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 2.0, 2.0);
    let mut haven = building("h1", BuildingKind::Haven, 17.0, 5.0);
    haven.city_id = Some("c1".into());
    haven.stock = Some(Stock::new());
    world.buildings.push(haven);
    for (id, owner) in [("w1", "r1"), ("b1", "r2")] {
        let mut r = new_resident(id, Some(owner), 19.0, 6.0);
        r.city_id = (owner == "r1").then(|| "c1".into());
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        world.residents.push(r);
    }
    world
}

fn problem(world: &WorldState, x: i32, y: i32) -> Option<String> {
    build_problem(world, x, y, BuildingKind::Boat, Some(&terrain()))
}

fn build(resident: &str) -> serde_json::Value {
    json!({ "kind": "build", "residentId": resident, "building": "boat" })
}

fn boat(id: &str, x: f64, y: f64) -> Vessel {
    Vessel {
        id: id.into(),
        kind: VesselKind::Boat,
        realm_id: None,
        x,
        y,
        load: Stock::new(),
        rower_id: None,
        crew_ids: Vec::new(),
    }
}

/// A boat site on (19, 6) with all its materials and all but half a tick's work.
fn nearly_done(world: &mut WorldState) -> usize {
    let mut s = site("bs", BuildingKind::Boat, 19.0, 6.0);
    s.site = Some(ConstructionSite {
        delivered: build_materials(BuildingKind::Boat),
        work: BUILD_WORK.get("boat").unwrap() - 0.5,
    });
    world.buildings.push(s);
    world.buildings.len() - 1
}

/// w1 joins the site on their tile, then works it for a tick.
fn work_on_it(world: &mut WorldState, t: &TerrainMap) {
    let mut orders = Orders::default();
    assert_eq!(order(world, &mut orders, &player(7), build("w1"), t), Ok(()));
    run(world, t, 1);
}

#[test]
fn is_a_buildable_site_of_wood_and_some_work_and_a_boat_holds_a_little() {
    assert!(BUILDABLE.contains(&BuildingKind::Boat));
    let materials = BUILD_MATERIALS.get("boat").unwrap();
    assert!(materials.get("wood").unwrap() > 0.0);
    assert!(BUILD_WORK.get("boat").unwrap() > 0.0);
    assert!(BUILD_WORK.get("boat").unwrap() < BUILD_WORK.get("haven").unwrap());
}

#[test]
fn goes_on_a_tile_of_a_finished_haven_that_touches_the_water() {
    let mut world = setup();
    // The haven's east column touches the Lake, straight or diagonally.
    for y in 5..=7 {
        assert_eq!(problem(&world, 19, y), None, "(19, {y})");
    }
    // Its middle and west columns don't.
    assert_eq!(problem(&world, 18, 6).as_deref(), Some(NOT_HERE));
    assert_eq!(problem(&world, 17, 5).as_deref(), Some(NOT_HERE));
    // Off the haven, by the water all the same.
    assert_eq!(problem(&world, 19, 9).as_deref(), Some(NOT_HERE));
    // On an unfinished haven.
    world.buildings[1].site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    assert_eq!(problem(&world, 19, 6).as_deref(), Some(NOT_HERE));
}

#[test]
fn takes_one_site_per_tile() {
    let mut world = setup();
    world.buildings.push(site("bs", BuildingKind::Boat, 19.0, 6.0));
    assert_eq!(
        problem(&world, 19, 6).as_deref(),
        Some("there is already a boat site on this tile")
    );
    assert_eq!(problem(&world, 19, 7), None);
}

#[test]
fn is_laid_out_by_a_build_order_sharing_the_havens_tile() {
    let t = terrain();
    let mut world = setup();
    let mut orders = Orders::default();
    assert_eq!(order(&mut world, &mut orders, &player(7), build("w1"), &t), Ok(()));
    let s = boat_site_at(&world, 19, 6).expect("a boat site");
    assert!(s.site.is_some());
    assert_eq!((s.city_id.as_deref(), s.stock.as_ref()), (None, None));
    // The haven stands on, and keeps its storage.
    assert!(world.buildings.iter().any(|b| b.id == "h1"));
    assert_sound(&world, &t);
}

#[test]
fn refuses_a_build_order_off_the_shore_tiles() {
    let t = terrain();
    let mut world = setup();
    world.residents[0].x = 18.0;
    let mut orders = Orders::default();
    assert_eq!(order(&mut world, &mut orders, &player(7), build("w1"), &t), Err(NOT_HERE.into()));
    assert!(world.buildings.iter().all(|b| b.kind != BuildingKind::Boat));
}

#[test]
fn finished_is_gone_and_an_empty_boat_of_the_finishers_realm_floats_next_to_it() {
    let t = terrain();
    let mut world = setup();
    nearly_done(&mut world);
    work_on_it(&mut world, &t);
    assert!(boat_site_at(&world, 19, 6).is_none());
    assert_eq!(world.vessels.len(), 1);
    let v = &world.vessels[0];
    // The water straight east of the site.
    assert_eq!(
        (v.kind, v.realm_id.as_deref(), v.x, v.y),
        (VesselKind::Boat, Some("r1"), 20.0, 6.0)
    );
    assert!(v.load.is_empty());
    // The haven is still there, and w1's build order has ended with its site.
    assert!(world.buildings.iter().any(|b| b.id == "h1"));
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
fn floats_on_the_nearest_free_water_tile_when_the_next_one_is_taken() {
    let t = terrain();
    let mut world = setup();
    world.vessels.push(boat("v1", 20.0, 6.0));
    // Straight east is taken: the diagonals come next, north first.
    assert_eq!(launch_tile(&world, &t, 19, 6, VesselKind::Boat), Some((20, 5)));
    world.vessels.push(boat("v2", 20.0, 5.0));
    world.vessels.push(boat("v3", 20.0, 7.0));
    // Every water tile next to it taken: the nearest free one further out.
    assert_eq!(launch_tile(&world, &t, 19, 6, VesselKind::Boat), Some((21, 6)));
    nearly_done(&mut world);
    work_on_it(&mut world, &t);
    assert!(vessel_at(&world, 21, 6).is_some());
    assert_eq!(world.vessels.len(), 4);
    assert_sound(&world, &t);
}

#[test]
fn the_last_materials_delivered_finish_it_too() {
    let t = terrain();
    let mut world = setup();
    let i = nearly_done(&mut world);
    let s = world.buildings[i].site.as_mut().unwrap();
    s.work = BUILD_WORK.get("boat").unwrap();
    s.delivered = Stock::new();
    let wood = build_materials(BuildingKind::Boat)[&Good::Wood];
    world.residents[0].carried.insert(Good::Wood, wood);
    let drop = CarryAction {
        kind: CarryKind::Put,
        resident_id: "w1".into(),
        spot: GoodsSpot::Site { site_id: "bs".into() },
        goods: [(Good::Wood, wood)].into_iter().collect(),
    };
    // Without the map nothing can float: the site waits, all delivered.
    resolve_carrying(&mut world, std::slice::from_ref(&drop), SIZE);
    assert!(boat_site_at(&world, 19, 6).is_some() && world.vessels.is_empty());
    // With it, the next delivery or work there launches it.
    let i = world.buildings.iter().position(|b| b.id == "bs").unwrap();
    world.buildings[i].site.as_mut().unwrap().delivered = Stock::new();
    world.residents[0].carried.insert(Good::Wood, wood);
    resolve_carrying_on(&mut world, &[drop], SIZE, Some(&t));
    assert!(boat_site_at(&world, 19, 6).is_none());
    assert_eq!(world.vessels.len(), 1);
    assert_sound(&world, &t);
}

#[test]
fn a_boat_of_a_realm_that_ends_belongs_to_nobody() {
    let t = terrain();
    let mut world = setup();
    let mut v = boat("v1", 20.0, 6.0);
    v.realm_id = Some("r2".into());
    world.vessels.push(v);
    csp_sim::survival::end_realm(&mut world, "r2", SIZE);
    world.realms.retain(|r| r.id != "r2");
    assert_eq!(world.vessels[0].realm_id, None);
    run(&mut world, &t, 1);
    assert!(world.vessels[0].realm_id.is_none());
}

mod invariants {
    use super::*;

    fn broken(world: &WorldState) -> Vec<String> {
        check_all(world, &terrain()).into_iter().map(|v| v.message).collect()
    }

    #[test]
    fn a_vessel_is_always_on_water() {
        let mut world = setup();
        world.vessels.push(boat("v1", 20.0, 6.0));
        assert!(broken(&world).is_empty());
        world.vessels[0].x = 19.0;
        assert_eq!(broken(&world), ["vessel v1 is on land at (19, 6)"]);
    }

    #[test]
    fn one_vessel_per_tile() {
        let mut world = setup();
        world.vessels.push(boat("v1", 20.0, 6.0));
        world.vessels.push(boat("v2", 20.0, 6.0));
        assert_eq!(broken(&world), ["vessel v2 shares the water tile (20, 6) with v1"]);
    }

    #[test]
    fn a_vessel_holds_no_more_than_it_can() {
        let mut world = setup();
        let mut v = boat("v1", 20.0, 6.0);
        v.load.insert(Good::Stone, 1000.0);
        world.vessels.push(v);
        assert_eq!(broken(&world).len(), 1);
        assert!(broken(&world)[0].contains("more than it can"), "{:?}", broken(&world));
    }

    #[test]
    fn a_boat_site_is_on_a_haven_tile_by_the_water() {
        let mut world = setup();
        world.buildings.push(site("bs", BuildingKind::Boat, 18.0, 6.0));
        assert_eq!(broken(&world), ["bs is a boat site away from water"]);
        world.buildings.pop();
        world.buildings.push(site("bs", BuildingKind::Boat, 19.0, 9.0));
        assert_eq!(broken(&world), ["bs is a boat site off any haven"]);
    }
}

mod sight {
    use super::*;
    use csp_shared::protocol::{LoadLevel, SeenEntity};
    use csp_sim::sight::entities_in_sight;
    use csp_sim::world_index::WorldIndex;

    fn seen_boat(world: &WorldState, realm: &str) -> Option<csp_shared::protocol::SeenVessel> {
        let index = WorldIndex::new(world, SIZE);
        entities_in_sight(world, &index, Some(realm), None).iter().find_map(|e| match e {
            SeenEntity::Vessel(v) => Some(v.clone()),
            _ => None,
        })
    }

    #[test]
    fn shows_to_whoever_sees_its_tile_its_load_only_to_its_own_realm() {
        let mut world = setup();
        let mut v = boat("v1", 20.0, 6.0);
        v.realm_id = Some("r1".into());
        v.load.insert(Good::Wood, 10.0);
        world.vessels.push(v);
        let ours = seen_boat(&world, "r1").expect("r1 sees its boat");
        assert_eq!((ours.kind, ours.x, ours.y), (VesselKind::Boat, 20.0, 6.0));
        assert_eq!(ours.load.as_ref().map(|l| l[&Good::Wood]), Some(10.0));
        let theirs = seen_boat(&world, "r2").expect("r2 sees it from the shore");
        assert_eq!((theirs.load, theirs.load_level), (None, LoadLevel::Light));
    }
}

mod sent {
    use super::*;
    use csp_sim::sight::{entities_in_sight, sent_inside_unseen, sent_out_of_sight};
    use csp_sim::world_index::WorldIndex;

    /// The invariants on what goes out to a Player hold with a boat in sight, its load sent to its
    /// own realm only.
    #[test]
    fn what_is_sent_of_a_boat_breaks_no_sight_invariant() {
        let mut world = setup();
        let mut v = boat("v1", 20.0, 6.0);
        v.realm_id = Some("r1".into());
        v.load.insert(Good::Wood, 10.0);
        world.vessels.push(v);
        let index = WorldIndex::new(&world, SIZE);
        for realm in ["r1", "r2"] {
            let sent = entities_in_sight(&world, &index, Some(realm), None);
            assert!(sent.iter().any(|e| e.is() == "vessel"), "{realm}");
            assert!(sent_out_of_sight(&world, &index, realm, &sent).is_empty(), "{realm}");
            assert!(sent_inside_unseen(&world, &index, realm, &sent).is_empty(), "{realm}");
        }
    }
}
