//! The haven (`CONTEXT.md`: Haven, Footprint, Where buildings go): a 3×3 building on the shore,
//! with a storage anyone at it uses, belonging to no one but the city that laid it out.

mod build_common;
mod ts_match;

use build_common::{
    add_city, assert_sound, building, new_resident, order, player, realm, run, site_of, Orders,
};
use csp_shared::balance::{BUILD_MATERIALS, BUILD_WORK, OWN_FOOD};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, Good, GoodsSpot, ResourceKind, ResourceNode, Stock, WorldState,
};
use csp_sim::carrying::{resolve_carrying, CarryAction, CarryKind};
use csp_sim::invariants::check_all;
use csp_sim::queries::building::{
    build_menu, build_problem, BUILDABLE, KEEPS_GOODS, OFF_NODES, ON_SHORE,
};
use csp_sim::queries::goods::storage_at;
use serde_json::json;
use ts_match::assert_matches;

const SIZE: i32 = 32;
const SHORE: &str = "a haven goes on the shore, touching Lake or Sea";

/// Plains, with a Lake running down columns 20 to 25, one Lake tile alone at (10, 25) and
/// Mountain at (18, 10).
fn terrain() -> TerrainMap {
    let mut tiles = vec![Terrain::Plains as u8; (SIZE * SIZE) as usize];
    for y in 0..SIZE {
        for x in 20..=25 {
            tiles[tile_index(SIZE, x, y)] = Terrain::Lake as u8;
        }
    }
    tiles[tile_index(SIZE, 10, 25)] = Terrain::Lake as u8;
    tiles[tile_index(SIZE, 18, 10)] = Terrain::Mountain as u8;
    TerrainMap { size: SIZE, tiles }
}

/// Realm r1 (Player 7) with city c1 and its Leader w1 at (17, 5) on the shore; realm r2 (Player
/// 8) with its Leader b1 there too.
fn setup() -> WorldState {
    let mut world = build_common::empty_world(&terrain());
    world.realms.push(realm("r1", 7, "w1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 2.0, 2.0);
    for (id, owner) in [("w1", "r1"), ("b1", "r2")] {
        let mut r = new_resident(id, Some(owner), 17.0, 5.0);
        r.city_id = (owner == "r1").then(|| "c1".into());
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        world.residents.push(r);
    }
    world
}

fn problem(world: &WorldState, x: i32, y: i32) -> Option<String> {
    build_problem(world, x, y, BuildingKind::Haven, Some(&terrain()))
}

#[test]
fn is_a_3x3_building_of_mostly_wood_and_some_stone_offered_off_nodes() {
    assert_eq!(FOOTPRINT.get("haven"), Some(3));
    assert!(BUILDABLE.contains(&BuildingKind::Haven));
    assert!(OFF_NODES.contains(&BuildingKind::Haven));
    assert!(ON_SHORE.contains(&BuildingKind::Haven));
    assert!(KEEPS_GOODS.contains(&BuildingKind::Haven));
    assert!(build_menu(None).contains(&BuildingKind::Haven));
    assert!(!build_menu(Some(ResourceKind::Forest)).contains(&BuildingKind::Haven));
    let materials = BUILD_MATERIALS.get("haven").unwrap();
    let keys: Vec<&str> = materials.0.iter().map(|(k, _)| *k).collect();
    assert_eq!(keys, ["wood", "stone"]);
    assert!(materials.get("wood").unwrap() > materials.get("stone").unwrap());
    assert!(BUILD_WORK.get("haven").unwrap() > 0.0);
}

#[test]
fn goes_where_a_tile_of_its_footprint_touches_water_straight_or_diagonally() {
    let world = setup();
    // Its east column, x 19, borders the Lake at x 20.
    assert_eq!(problem(&world, 17, 5), None);
    // Only its south-east corner (9, 24) touches the lone Lake tile (10, 25), diagonally.
    assert_eq!(problem(&world, 7, 22), None);
    // One tile further from either, no water touches it.
    assert_eq!(problem(&world, 16, 5).as_deref(), Some(SHORE));
    assert_eq!(problem(&world, 6, 21).as_deref(), Some(SHORE));
    assert_eq!(problem(&world, 2, 12).as_deref(), Some(SHORE));
}

#[test]
fn is_refused_on_mountain_on_a_node_on_the_water_and_on_another_building() {
    let mut world = setup();
    // The footprint from (17, 9) covers the Mountain at (18, 10), on the shore all the same.
    assert_eq!(
        problem(&world, 17, 9).as_deref(),
        Some("a haven goes off any resource node, and not on Mountain")
    );
    // Over the water's edge.
    assert_eq!(problem(&world, 18, 5).as_deref(), Some("a haven goes on passable land"));
    world.nodes.push(ResourceNode {
        id: "n1".into(),
        kind: ResourceKind::Forest,
        x: 18.0,
        y: 15.0,
    });
    assert_eq!(
        problem(&world, 17, 14).as_deref(),
        Some("a haven goes off any resource node, and not on Mountain")
    );
    world.buildings.push(building("s1", BuildingKind::Storage, 18.0, 20.0));
    assert_eq!(problem(&world, 17, 19).as_deref(), Some("there is already a building there"));
}

#[test]
fn is_laid_out_built_and_finished_like_any_building_and_belongs_to_the_builders_city() {
    let terrain = terrain();
    let mut world = setup();
    let mut orders = Orders::default();
    let build = json!({ "kind": "build", "residentId": "w1", "building": "haven" });
    assert_eq!(order(&mut world, &mut orders, &player(7), build, &terrain), Ok(()));
    let site = site_of(&world).expect("a haven site");
    assert_eq!(site.kind, BuildingKind::Haven);
    assert_eq!(
        (site.city_id.as_deref(), site.realm_id.as_deref(), site.x, site.y),
        (Some("c1"), Some("r1"), 17.0, 5.0)
    );
    assert_sound(&world, &terrain);
    // With its materials delivered and nearly all its work in, one more tick finishes it.
    let i = world.buildings.iter().position(|b| b.site.is_some()).unwrap();
    let delivered: Stock = BUILD_MATERIALS
        .get("haven")
        .unwrap()
        .0
        .iter()
        .map(|(g, n)| (serde_json::from_value::<Good>(json!(g)).unwrap(), *n))
        .collect();
    let s = world.buildings[i].site.as_mut().unwrap();
    s.delivered = delivered;
    s.work = BUILD_WORK.get("haven").unwrap() - 0.5;
    run(&mut world, &terrain, 1);
    let haven = &world.buildings[i];
    assert!(haven.site.is_none());
    assert_eq!((haven.city_id.as_deref(), haven.realm_id.as_deref()), (Some("c1"), None));
    assert_sound(&world, &terrain);
}

#[test]
fn refuses_a_build_order_away_from_the_water() {
    let terrain = terrain();
    let mut world = setup();
    world.residents[0].x = 12.0;
    let mut orders = Orders::default();
    let build = json!({ "kind": "build", "residentId": "w1", "building": "haven" });
    // A footprint that covers (12, 5) and touches the Lake has none: every corner is too far.
    assert!(order(&mut world, &mut orders, &player(7), build, &terrain).is_err());
    assert!(world.buildings.iter().all(|b| b.kind != BuildingKind::Haven));
}

mod its_storage {
    use super::*;

    /// A finished haven of city c1 at (17, 5) holding 9 Food.
    fn with_haven() -> WorldState {
        let mut world = setup();
        let mut h = building("h1", BuildingKind::Haven, 17.0, 5.0);
        h.city_id = Some("c1".into());
        h.stock = Some([(Good::Food, 9.0)].into_iter().collect());
        world.buildings.push(h);
        world
    }

    fn carry(kind: CarryKind, resident: &str, good: Good, units: f64) -> CarryAction {
        CarryAction {
            kind,
            resident_id: resident.into(),
            spot: GoodsSpot::Storage { storage_id: "h1".into() },
            goods: [(good, units)].into_iter().collect(),
        }
    }

    fn held(world: &WorldState, good: Good) -> f64 {
        world.buildings.iter().find(|b| b.id == "h1").unwrap().stock.as_ref().unwrap()[&good]
    }

    #[test]
    fn is_the_storage_on_every_tile_of_its_footprint() {
        let world = with_haven();
        for (x, y) in [(17, 5), (19, 7), (18, 6)] {
            assert_eq!(storage_at(&world, x, y, SIZE).map(|b| b.id.as_str()), Some("h1"));
        }
        assert!(storage_at(&world, 16, 5, SIZE).is_none());
    }

    #[test]
    fn takes_goods_put_in_and_gives_them_back() {
        let mut world = with_haven();
        world.residents[0].carried.insert(Good::Wood, 6.0);
        resolve_carrying(&mut world, &[carry(CarryKind::Put, "w1", Good::Wood, 6.0)], SIZE);
        assert_eq!(held(&world, Good::Wood), 6.0);
        resolve_carrying(&mut world, &[carry(CarryKind::Take, "w1", Good::Food, 4.0)], SIZE);
        assert_eq!(held(&world, Good::Food), 5.0);
        assert_eq!(world.residents[0].carried[&Good::Food], OWN_FOOD + 4.0);
        assert!(world.crimes.is_empty());
        assert_sound(&world, &terrain());
    }

    #[test]
    fn judges_taking_from_it_as_at_any_storage_of_its_city() {
        let mut world = with_haven();
        resolve_carrying(&mut world, &[carry(CarryKind::Take, "b1", Good::Food, 3.0)], SIZE);
        assert_eq!(held(&world, Good::Food), 6.0);
        assert_eq!(world.crimes.len(), 1);
        assert_matches(
            &world.crimes[0],
            json!({ "kind": "theft", "victimOrg": "r1", "goods": { "food": 3 } }),
        );
    }
}

#[test]
fn breaks_an_invariant_when_away_from_the_water() {
    let terrain = terrain();
    let mut world = setup();
    world.buildings.push(building("h1", BuildingKind::Haven, 2.0, 12.0));
    let broken: Vec<String> = check_all(&world, &terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(broken, ["h1 is a haven away from water"]);
}
