//! `apps/server/src/invariants.test.ts`, ported (T86.13). Its `worldWithCity()` is the fixture
//! `sight/city.json` (`createWorld(cityTerrain())` and `foundStartingCity` for Player 1) on
//! `cityTerrain()`, generated here (`generateTerrain(1, 1536)`), until the starting city (T86.8)
//! lands. Left for the tickets whose rules they step: the 200 ticks of "hold on a fresh world
//! and after many ticks" and the step of "catch a pick-up or drop order left over" (T86.14).

mod common;

use std::sync::OnceLock;

use csp_shared::balance::{
    trained_cap, CARRYING_TICKS, MAX_HEALTH, MAX_HUNGER, REALM_NAME_MAX_LENGTH,
};
use csp_shared::footprint::covers;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, Good, ResourceKind, SkillName, Stat, Stock, WorldState};
use csp_sim::invariants::{
    check_all, invariants_for_tick, should_check_invariants, world_invariants, InvariantViolation,
};
use csp_sim::queries::balance::carry_capacity;
use csp_sim::queries::building::building_at;
use csp_sim::queries::names::placed;
use csp_sim::terrain_gen::generate_terrain;
use serde_json::json;

fn terrain() -> &'static TerrainMap {
    static T: OnceLock<TerrainMap> = OnceLock::new();
    T.get_or_init(|| generate_terrain(1, 1536))
}

/// A world on `cityTerrain()` where Player 1 founded their starting city (`worldWithCity`).
fn world_with_city() -> WorldState {
    static W: OnceLock<WorldState> = OnceLock::new();
    W.get_or_init(|| common::load_world("sight/city.json").0).clone()
}

fn check(world: &WorldState) -> Vec<InvariantViolation> {
    check_all(world, terrain())
}

/// Each violation's invariant and entities, as the tests match them.
fn named(v: &[InvariantViolation]) -> Vec<(String, Vec<String>)> {
    v.iter().map(|v| (v.invariant.clone(), v.entity_ids.clone())).collect()
}

fn one(invariant: &str, id: &str) -> (String, Vec<String>) {
    (invariant.to_string(), vec![id.to_string()])
}

/// The first tile of a terrain kind (`terrain.tiles.indexOf(kind)`).
fn first_tile(kind: Terrain) -> (f64, f64) {
    let t = terrain();
    let i = t.tiles.iter().position(|&x| x == kind as u8).expect("the map has the terrain");
    ((i as i32 % t.size) as f64, (i as i32 / t.size) as f64)
}

/// The nearest tile east of (x, y) that no footprint covers.
fn off_footprints(world: &WorldState, x: f64, y: f64) -> (f64, f64) {
    let mut x = x;
    while building_at(world, x as i32, y as i32, terrain().size).is_some() {
        x += 1.0;
    }
    (x, y)
}

#[test]
fn hold_on_a_fresh_world() {
    assert_eq!(check(&world_with_city()), []);
}

#[test]
fn catch_a_resident_on_impassable_terrain() {
    for kind in [Terrain::Lake, Terrain::Sea] {
        let mut world = world_with_city();
        let (x, y) = first_tile(kind);
        let r = &mut world.residents[0];
        r.order = None;
        (r.x, r.y) = (x, y);
        let id = r.id.clone();
        assert_eq!(named(&check(&world)), [one("nothing-on-impassable-terrain", &id)]);
    }
}

#[test]
fn catch_a_resource_node_on_terrain_that_does_not_fit_it() {
    let mut world = world_with_city();
    let (x, y) = first_tile(Terrain::Plains);
    let node = world.nodes.iter_mut().find(|n| n.kind == ResourceKind::Forest).unwrap();
    (node.x, node.y) = (x, y);
    let id = node.id.clone();
    assert_eq!(named(&check(&world)), [one("nodes-on-fitting-terrain", &id)]);
}

#[test]
fn catch_a_position_stored_past_a_side_of_the_map() {
    let mut world = world_with_city();
    let r = &mut world.residents[0];
    r.order = None;
    r.x -= terrain().size as f64; // the same tile, under another name
    let id = r.id.clone();
    assert_eq!(named(&check(&world)), [one("positions-on-map", &id)]);
}

#[test]
fn catch_a_trained_bonus_above_its_cap_below_zero_or_on_a_base_of_nothing() {
    let mut world = world_with_city();
    world.residents[0].stats.strength = Stat { base: 10.0, trained: trained_cap(10.0) };
    assert_eq!(check(&world), []);
    world.residents[0].stats.strength.trained += 1.0;
    world.residents[1].stats.agility.trained = -1.0;
    world.residents[2].stats.intellect = Stat { base: 0.0, trained: 0.0 };
    let ids: Vec<String> = world.residents[..3].iter().map(|r| r.id.clone()).collect();
    assert_eq!(
        named(&check(&world)),
        ids.iter().map(|id| one("trained-within-cap", id)).collect::<Vec<_>>()
    );
}

#[test]
fn catch_a_work_or_construction_skill_above_its_most() {
    let mut world = world_with_city();
    world.residents[0].skills =
        [(SkillName::Farming, 100.0), (SkillName::Construction, 100.0), (SkillName::Combat, 250.0)]
            .into_iter()
            .collect();
    assert_eq!(check(&world), []);
    world.residents[0].skills.insert(SkillName::Farming, 100.5);
    world.residents[1].skills = [(SkillName::Construction, 101.0)].into_iter().collect();
    world.residents[2].skills = [(SkillName::Mining, -1.0)].into_iter().collect();
    let ids: Vec<String> = world.residents[..3].iter().map(|r| r.id.clone()).collect();
    assert_eq!(
        named(&check(&world)),
        ids.iter().map(|id| one("skills-within-cap", id)).collect::<Vec<_>>()
    );
}

#[test]
fn catch_a_resident_carrying_more_than_their_capacity() {
    let mut world = world_with_city();
    let tick = world.tick as f64;
    let cap = carry_capacity(&world.residents[0], tick);
    world.residents[0].carried = Stock::from([(Good::Stone, cap)]);
    assert_eq!(check(&world), []);
    world.residents[0].carried = Stock::from([(Good::Stone, cap + 1.0)]);
    let id = world.residents[0].id.clone();
    assert_eq!(named(&check(&world)), [one("carried-within-capacity", &id)]);
}

#[test]
fn catch_negative_goods_empty_piles_and_two_piles_on_one_tile() {
    let mut world = world_with_city();
    world.residents[0].carried = Stock::from([(Good::Food, -1.0)]);
    let (x, y) = (world.residents[0].x, world.residents[0].y);
    let (ox, oy) = off_footprints(&world, x, y);
    world.piles.extend(
        serde_json::from_value::<Vec<csp_shared::world::Pile>>(json!([
            { "id": "p1", "x": x, "y": y, "goods": { "wood": 3 } },
            { "id": "p2", "x": x, "y": y, "goods": { "wood": 2 } },
            // Off every footprint, so it is one tile's pile and not the farm's.
            { "id": "p3", "x": ox, "y": oy, "goods": {} },
        ]))
        .unwrap(),
    );
    let mut ids: Vec<String> = check(&world)
        .into_iter()
        .filter(|v| v.invariant == "goods-in-place")
        .map(|v| v.entity_ids[0].clone())
        .collect();
    ids.sort();
    let mut want = vec![world.residents[0].id.clone(), "p2".into(), "p3".into()];
    want.sort();
    assert_eq!(ids, want);
}

#[test]
fn catch_health_or_hunger_out_of_range() {
    let mut world = world_with_city();
    world.residents[0].health = MAX_HEALTH + 1.0;
    world.residents[1].hunger = -1.0;
    world.residents[2].hunger = MAX_HUNGER;
    world.residents[2].health = 0.0;
    let ids: Vec<String> = world.residents[..3].iter().map(|r| r.id.clone()).collect();
    assert_eq!(
        named(&check(&world)),
        [
            one("health-and-hunger-in-range", &ids[0]),
            one("health-and-hunger-in-range", &ids[1]),
            // No health is in range, but a resident with none should have died and left goods.
            one("dead-leave-loot", &ids[2]),
        ]
    );
}

#[test]
fn catch_a_realm_whose_leader_is_gone_or_belongs_elsewhere() {
    let mut world = world_with_city();
    world.realms[0].leader_id = "nobody".into();
    let id = world.realms[0].id.clone();
    assert_eq!(named(&check(&world)), [one("realms-have-leaders", &id)]);
}

#[test]
fn catch_a_realm_name_that_is_blank_untrimmed_or_too_long() {
    let mut world = world_with_city();
    let id = world.realms[0].id.clone();
    let long = "x".repeat(REALM_NAME_MAX_LENGTH as usize + 1);
    for name in ["", "  ", " Ironvale", &long] {
        world.realms[0].name = Some(name.into());
        assert_eq!(named(&check(&world)), [one("realms-have-leaders", &id)], "{name:?}");
    }
    world.realms[0].name = Some("Ironvale".into());
    assert_eq!(check(&world), []);
}

#[test]
fn catch_buildings_out_of_place_a_farm_off_plains_and_negative_stock() {
    let mut world = world_with_city();
    let find =
        |w: &WorldState, k: BuildingKind| w.buildings.iter().position(|b| b.kind == k).unwrap();
    let (wall, house, storage, farm) = (
        find(&world, BuildingKind::Wall),
        find(&world, BuildingKind::House),
        find(&world, BuildingKind::Storage),
        find(&world, BuildingKind::Farm),
    );
    // Onto the wall and the walls next to it.
    (world.buildings[house].x, world.buildings[house].y) =
        (world.buildings[wall].x, world.buildings[wall].y);
    let size = terrain().size;
    let h = placed(&world.buildings[house]);
    let walls: Vec<String> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Wall && covers(h, b.x as i32, b.y as i32, size))
        .map(|b| b.id.clone())
        .collect();
    world.buildings[storage].stock = Some(Stock::from([(Good::Food, -1.0)]));
    let (fx, fy) = first_tile(Terrain::Forest);
    (world.buildings[farm].x, world.buildings[farm].y) = (fx, fy);
    let mut ids: Vec<String> = check(&world)
        .into_iter()
        .filter(|v| v.invariant == "buildings-in-place")
        .map(|v| v.entity_ids[0].clone())
        .collect();
    assert!(walls.len() > 1);
    ids.sort();
    let mut want = vec![world.buildings[farm].id.clone(), world.buildings[storage].id.clone()];
    want.extend(walls);
    want.sort();
    assert_eq!(ids, want);
}

#[test]
fn catch_goods_kept_in_a_building_that_is_not_a_storage() {
    let mut world = world_with_city();
    let house = world.buildings.iter().position(|b| b.kind == BuildingKind::House).unwrap();
    world.buildings[house].stock = Some(Stock::from([(Good::Food, 3.0)]));
    let id = world.buildings[house].id.clone();
    assert_eq!(named(&check(&world)), [one("goods-in-place", &id)]);
}

#[test]
fn catch_a_pick_up_or_drop_order_left_over_after_its_tick() {
    let mut world = world_with_city();
    world.residents[0].order = Some(
        serde_json::from_value(
            json!({ "kind": "pickUp", "from": { "kind": "ground" }, "goods": { "food": 1 } }),
        )
        .unwrap(),
    );
    world.residents[1].order = Some(
        serde_json::from_value(
            json!({ "kind": "drop", "to": { "kind": "ground" }, "goods": { "food": 1 } }),
        )
        .unwrap(),
    );
    let (a, b) = (world.residents[0].id.clone(), world.residents[1].id.clone());
    assert_eq!(named(&check(&world)), [one("carry-orders-done", &a), one("carry-orders-done", &b)]);
    // TODO(T86.5): a step resolves the orders and the check passes.
}

#[test]
fn catch_a_resident_living_in_a_city_that_does_not_exist() {
    let mut world = world_with_city();
    world.residents[0].city_id = Some("nowhere".into());
    let id = world.residents[0].id.clone();
    assert_eq!(named(&check(&world)), [one("residents-in-cities", &id)]);
}

/// The starting city, made an NPC city (`Object.assign(city, { realmId: null, layout: 'grid' })`).
fn npc_city(world: &mut WorldState) {
    world.cities[0].realm_id = None;
    world.cities[0].layout = Some(csp_shared::world::CityLayout::Grid);
}

#[test]
fn catch_a_resident_of_an_npc_city_who_belongs_to_a_realm() {
    let mut world = world_with_city();
    npc_city(&mut world);
    for o in &mut world.residents[1..] {
        o.owner = None;
    }
    let id = world.residents[0].id.clone();
    assert_eq!(named(&check(&world)), [one("npc-city-residents-unowned", &id)]);
}

#[test]
fn catch_an_npc_city_resident_holding_an_order_the_city_never_gives() {
    let mut world = world_with_city();
    npc_city(&mut world);
    for o in &mut world.residents {
        o.owner = None;
    }
    world.residents[0].order = Some(
        serde_json::from_value(json!({
            "kind": "drive", "carriageId": "k0", "target": { "x": 0, "y": 0 }, "path": null, "progress": 0
        }))
        .unwrap(),
    );
    let id = world.residents[0].id.clone();
    assert!(named(&check(&world)).contains(&one("npc-orders-allowed", &id)));
}

#[test]
fn catch_an_npc_city_resident_attacking_someone_of_their_own_city() {
    let mut world = world_with_city();
    npc_city(&mut world);
    for o in &mut world.residents {
        o.owner = None;
    }
    let other = world.residents[1].id.clone();
    world.residents[0].order = Some(
        serde_json::from_value(json!({
            "kind": "attack", "targetId": other, "path": null, "progress": 0, "strike": 0,
            "started": false
        }))
        .unwrap(),
    );
    let id = world.residents[0].id.clone();
    assert!(named(&check(&world)).contains(&one("npc-fights-outsiders", &id)));
}

#[test]
fn catch_a_pair_that_does_not_hold_together() {
    let mut world = world_with_city();
    let pairs = |w: &WorldState| -> Vec<String> {
        check_all(w, terrain())
            .into_iter()
            .filter(|v| v.invariant == "pairs-hold-together")
            .map(|v| v.message)
            .collect()
    };
    let tick = world.tick as f64;
    let (a, b) = (world.residents[0].id.clone(), world.residents[1].id.clone());
    let pair = |id: &str, since: f64| csp_shared::world::Pair { partner_id: id.into(), since };
    world.residents[0].pair = Some(pair(&b, tick));
    world.residents[1].pair = Some(pair(&a, tick));
    assert!(pairs(&world).is_empty());
    world.residents[2].pair = Some(pair(&a, tick));
    let found = pairs(&world);
    assert_eq!(found.len(), 1);
    assert!(found[0].contains("doesn't pair back"));
    world.residents[2].pair = None;
    world.residents[1].pair.as_mut().unwrap().since = tick + 1.0;
    let found = pairs(&world);
    assert_eq!(found.len(), 3);
    assert!(found[0].contains("pairs since") && found[1].contains("pairs since"));
    assert!(found[2].contains("after now"));
    world.residents[1].pair.as_mut().unwrap().since = tick;
    world.residents[1].born_at = tick;
    let found = pairs(&world);
    assert_eq!(found.len(), 1);
    assert!(found[0].contains("as a child"));
}

#[test]
fn catch_a_resident_carrying_a_child_who_works_or_carries_past_the_time() {
    let mut world = world_with_city();
    let carrying = |w: &WorldState| -> Vec<String> {
        check_all(w, terrain())
            .into_iter()
            .filter(|v| v.invariant == "carrying-doesnt-work")
            .map(|v| v.message)
            .collect()
    };
    let (b_id, b_name) = (world.residents[1].id.clone(), world.residents[1].name.clone());
    world.residents[0].order = None;
    world.residents[0].carrying = Some(
        serde_json::from_value(json!({
            "since": world.tick, "partnerId": b_id, "partnerName": b_name,
            "partnerBase": { "strength": 10, "endurance": 10, "agility": 10, "intellect": 10 }
        }))
        .unwrap(),
    );
    assert!(carrying(&world).is_empty());
    let farm = world.buildings.iter().find(|x| x.kind == BuildingKind::Farm).unwrap().id.clone();
    let (x, y) = (world.residents[0].x, world.residents[0].y);
    world.residents[0].order = Some(
        serde_json::from_value(json!({
            "kind": "workAt", "buildingId": farm, "at": { "x": x, "y": y }, "progress": 0
        }))
        .unwrap(),
    );
    let found = carrying(&world);
    assert_eq!(found.len(), 1);
    assert!(found[0].contains("workAt order"));
    world.residents[0].order = None;
    world.tick += CARRYING_TICKS as u64 + 1;
    let found = carrying(&world);
    assert_eq!(found.len(), 1);
    assert!(found[0].contains("past its time"));
}

#[test]
fn are_checked_every_tick_at_rate_1_and_sampled_below_it() {
    assert!(should_check_invariants(1.0, &mut || 0.99));
    assert!(should_check_invariants(0.1, &mut || 0.05));
    assert!(!should_check_invariants(0.1, &mut || 0.5));
    assert!(!should_check_invariants(0.0, &mut || 0.0));
}

#[test]
fn invariants_for_tick_runs_every_invariant_at_least_once_over_a_round_and_no_tick_runs_them_all() {
    let all = world_invariants();
    let round = 10;
    let mut runs = vec![0; all.len()];
    for tick in 1234..1234 + round {
        let slice = invariants_for_tick(tick, 1.0 / round as f64, &all);
        assert!(slice.len() < all.len());
        for inv in slice {
            let i = all.iter().position(|x| x.name == inv.name).unwrap();
            runs[i] += 1;
        }
    }
    assert!(runs.iter().all(|&n| n >= 1));
}

#[test]
fn invariants_for_tick_runs_all_of_them_when_every_tick_is_sampled_none_at_a_rate_of_0() {
    let all = world_invariants();
    let names = |v: &[csp_sim::invariants::Invariant]| v.iter().map(|i| i.name).collect::<Vec<_>>();
    assert_eq!(names(&invariants_for_tick(7, 1.0, &all)), names(&all));
    assert!(invariants_for_tick(7, 0.0, &all).is_empty());
    // The TypeScript's list, by name and in order: 151 invariants.
    assert_eq!(all.len(), 151);
}
