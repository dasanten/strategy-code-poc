//! Stone walls and gates (T106.1, `CONTEXT.md`: Wall / Gate, Wood or stone): built from Stone
//! with more work, they hold out several times longer against blows and leave Stone when broken;
//! a stone Build line builds stone; a wall saved before there were materials is wood.

mod build_common;

use std::sync::Arc;

use build_common::*;
use csp_shared::balance::{
    BROKEN_MATERIALS_RETURNED, BUILD_MATERIALS, STONE_BUILD_MATERIALS, STONE_BUILD_WORK,
    STONE_WALL_STRENGTH, WALL_STRENGTH,
};
use csp_shared::world::{
    Building, BuildingKind, Good, ResidentOrder, Stock, WallMaterial, WorldState,
};
use csp_sim::combat::attack_order;
use csp_sim::invariants::invariant_named;
use csp_sim::queries::building::{materials_needed, work_needed};
use csp_sim::queries::walls::{broken_returns, wall_strength};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use serde_json::{json, Value};

/// Realm r1 (Player 7) with w1 on (4, 4) of an open map, carrying `carried`.
fn setup(carried: Stock) -> (WorldState, csp_shared::terrain::TerrainMap, Orders) {
    let terrain = plains(16);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "w1"));
    resident(&mut world, "w1", 4.0, 4.0);
    at(&mut world, "w1").carried = carried;
    (world, terrain, Orders::default())
}

fn build(building: &str, material: Option<&str>) -> Value {
    let mut o = json!({ "kind": "build", "residentId": "w1", "building": building });
    if let Some(m) = material {
        o["material"] = json!(m);
    }
    o
}

fn stone_of(kind: &str) -> f64 {
    STONE_BUILD_MATERIALS.get(kind).and_then(|t| t.get("stone")).expect("stone")
}

fn stone_wall(id: &str, kind: BuildingKind, x: f64, y: f64) -> Building {
    Building { material: Some(WallMaterial::Stone), ..building(id, kind, x, y) }
}

#[test]
fn a_stone_wall_and_gate_take_stone_and_more_work_than_wooden_ones() {
    for (kind, name) in [(BuildingKind::Wall, "wall"), (BuildingKind::Gate, "gate")] {
        let stone = stone_wall("s", kind, 1.0, 1.0);
        let wood = building("w", kind, 1.0, 1.0);
        let site = |b: &Building| Building {
            site: Some(csp_shared::world::ConstructionSite { delivered: Stock::new(), work: 0.0 }),
            ..b.clone()
        };
        assert_eq!(materials_needed(&site(&stone)), Stock::from([(Good::Stone, stone_of(name))]));
        assert!(!materials_needed(&site(&wood)).contains_key(&Good::Stone));
        assert_eq!(work_needed(&site(&stone)), STONE_BUILD_WORK.get(name).unwrap());
        assert!(work_needed(&site(&stone)) > work_needed(&site(&wood)));
    }
}

#[test]
fn builds_a_stone_wall_from_stone_with_the_work_and_it_stands_of_stone() {
    let (mut world, terrain, mut orders) = setup(Stock::new());
    let o = build("wall", Some("stone"));
    assert_eq!(order(&mut world, &mut orders, &player(7), o, &terrain), Ok(()));
    let ResidentOrder::Build(o) = world.residents[0].order.as_ref().unwrap() else { panic!() };
    assert_eq!(o.material, Some(WallMaterial::Stone));
    let si = world.buildings.iter().position(|b| b.site.is_some()).expect("the site");
    assert_eq!(world.buildings[si].material, Some(WallMaterial::Stone));
    let id = world.buildings[si].id.clone();
    // The work is in; it waits for its Stone.
    run(&mut world, &terrain, STONE_BUILD_WORK.get("wall").unwrap() as usize * 2);
    let si = world.buildings.iter().position(|b| b.id == id).unwrap();
    assert_eq!(work_needed(&world.buildings[si]), 0.0);
    assert!(world.buildings[si].site.is_some());
    let delivered = Stock::from([(Good::Stone, stone_of("wall"))]);
    world.buildings[si].site.as_mut().unwrap().delivered = delivered;
    run(&mut world, &terrain, 1);
    let wall = world.buildings.iter().find(|b| b.id == id).unwrap();
    assert!(wall.site.is_none(), "finished");
    assert_eq!(wall.material, Some(WallMaterial::Stone));
    assert_eq!(wall.kind, BuildingKind::Wall);
    assert_sound(&world, &terrain);
}

#[test]
fn a_wooden_wall_is_written_down_as_no_material_and_wood_is_the_default() {
    let (mut world, terrain, mut orders) = setup(Stock::new());
    assert_eq!(
        order(&mut world, &mut orders, &player(7), build("wall", Some("wood")), &terrain),
        Ok(())
    );
    run(&mut world, &terrain, 1);
    let site = world.buildings.iter().find(|b| b.site.is_some()).expect("the site");
    assert_eq!(site.material, None);
    assert_eq!(
        materials_needed(site),
        Stock::from([(Good::Wood, BUILD_MATERIALS.get("wall").unwrap().get("wood").unwrap())])
    );
}

#[test]
fn refuses_a_material_that_is_not_wood_or_stone_or_on_anything_but_a_wall_or_gate() {
    let (world, terrain, mut orders) = setup(Stock::new());
    let me = player(7);
    let no = orders.receive(&world, &me, build("wall", Some("iron")), &terrain).unwrap_err();
    assert!(no.contains("\"wood\" or \"stone\""), "{no}");
    assert_eq!(
        orders.receive(&world, &me, build("house", Some("stone")), &terrain),
        Err("only a wall or gate is of wood or stone".into())
    );
    assert_eq!(orders.receive(&world, &me, build("gate", Some("stone")), &terrain), Ok(()));
}

#[test]
fn a_stone_builder_does_not_join_a_wooden_site_on_the_tile() {
    let (mut world, terrain, mut orders) = setup(Stock::new());
    world.buildings.push(site("old", BuildingKind::Wall, 4.0, 4.0));
    // Turned down, or given and then ended on the taken tile: either way nobody joins.
    let _ = order(&mut world, &mut orders, &player(7), build("wall", Some("stone")), &terrain);
    run(&mut world, &terrain, 1);
    let joined = match &world.residents[0].order {
        Some(ResidentOrder::Build(o)) => o.site_id.as_deref() == Some("old"),
        _ => false,
    };
    assert!(!joined);
    assert_eq!(world.buildings.iter().filter(|b| b.x == 4.0 && b.y == 4.0).count(), 1);
}

#[test]
fn stone_holds_out_several_times_longer_and_leaves_stone_when_broken() {
    for (kind, wood, stone) in [
        (BuildingKind::Wall, WALL_STRENGTH.wall, STONE_WALL_STRENGTH.wall),
        (BuildingKind::Gate, WALL_STRENGTH.gate, STONE_WALL_STRENGTH.gate),
    ] {
        assert_eq!(wall_strength(&building("w", kind, 1.0, 1.0)), wood);
        assert_eq!(wall_strength(&stone_wall("s", kind, 1.0, 1.0)), stone);
        assert!(stone >= 3.0 * wood);
    }
    let left = (stone_of("wall") * BROKEN_MATERIALS_RETURNED).floor();
    assert!(left >= 1.0);
    assert_eq!(
        broken_returns(&stone_wall("s", BuildingKind::Wall, 1.0, 1.0)),
        Stock::from([(Good::Stone, left)])
    );
}

/// Strikes the tile `id` with r2's b9 from (4, 3) for `ticks` ticks; whether it still stands.
fn strike(
    world: &mut WorldState,
    terrain: &csp_shared::terrain::TerrainMap,
    id: &str,
    ticks: u32,
) -> bool {
    world.realms.push(realm("r2", 8, "b9"));
    world.residents.push(new_resident("b9", Some("r2"), 4.0, 3.0));
    world.residents.last_mut().unwrap().order =
        Some(ResidentOrder::Attack(attack_order(id, false, false)));
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        step_world(world, terrain, &mut scratch, Some(&mut walking), None);
    }
    world.buildings.iter().any(|b| b.id == id)
}

#[test]
fn a_blow_that_fells_a_worn_wooden_tile_leaves_a_stone_one_standing() {
    let terrain = plains(16);
    let worn = WALL_STRENGTH.wall - 0.01;
    let mut wooden = empty_world(&terrain);
    let mut w = building("t", BuildingKind::Wall, 4.0, 4.0);
    w.damage = Some(worn);
    wooden.buildings.push(w);
    assert!(!strike(&mut wooden, &terrain, "t", 20), "the wooden tile fell");
    let piles: f64 =
        wooden.piles.iter().map(|p| p.goods.get(&Good::Wood).copied().unwrap_or(0.0)).sum();
    assert!(piles >= 1.0, "a broken wooden tile leaves Wood");

    let mut stony = empty_world(&terrain);
    let mut s = stone_wall("t", BuildingKind::Wall, 4.0, 4.0);
    s.damage = Some(worn);
    stony.buildings.push(s);
    assert!(strike(&mut stony, &terrain, "t", 20), "the stone tile stands");
    let s = stony.buildings.iter().find(|b| b.id == "t").unwrap();
    assert!(s.damage.unwrap() > worn && s.damage.unwrap() < STONE_WALL_STRENGTH.wall);

    let mut broken = empty_world(&terrain);
    let mut s = stone_wall("t", BuildingKind::Wall, 4.0, 4.0);
    s.damage = Some(STONE_WALL_STRENGTH.wall - 0.01);
    broken.buildings.push(s);
    assert!(!strike(&mut broken, &terrain, "t", 20), "the worn stone tile fell");
    let stone: f64 =
        broken.piles.iter().map(|p| p.goods.get(&Good::Stone).copied().unwrap_or(0.0)).sum();
    assert_eq!(stone, (stone_of("wall") * BROKEN_MATERIALS_RETURNED).floor());
}

#[test]
fn a_stone_wall_line_builds_stone_on_each_tile() {
    let per_tile = stone_of("wall");
    let (mut world, terrain, mut orders) = setup(Stock::from([(Good::Stone, 3.0 * per_tile)]));
    let o = json!({
        "kind": "wallLine", "residentId": "w1", "material": "stone",
        "from": { "x": 4, "y": 4 }, "to": { "x": 6, "y": 4 },
    });
    assert_eq!(orders.receive(&world, &player(7), o, &terrain), Ok(()));
    orders.apply_all(&mut world, &terrain);
    let Some(ResidentOrder::WallLine(l)) = &world.residents[0].order else { panic!() };
    assert_eq!(l.material, Some(WallMaterial::Stone));
    run_walking(&mut world, &terrain, 40_000, |w| w.residents[0].order.is_none());
    for x in [4.0, 5.0, 6.0] {
        let wall = world.buildings.iter().find(|b| b.x == x && b.y == 4.0).expect("a wall");
        assert!(wall.site.is_none());
        assert_eq!(wall.material, Some(WallMaterial::Stone), "({x}, 4)");
    }
    assert_eq!(world.residents[0].carried.get(&Good::Stone).copied().unwrap_or(0.0), 0.0);
}

#[test]
fn a_wall_line_refuses_a_material_that_is_not_wood_or_stone() {
    let (world, terrain, mut orders) = setup(Stock::new());
    let o = json!({
        "kind": "wallLine", "residentId": "w1", "material": "gold",
        "from": { "x": 4, "y": 4 }, "to": { "x": 6, "y": 4 },
    });
    assert!(orders.receive(&world, &player(7), o, &terrain).is_err());
}

#[test]
fn a_wall_saved_without_a_material_reads_as_wood() {
    let saved = json!({
        "id": "w", "kind": "wall", "cityId": null, "x": 1.0, "y": 1.0
    });
    let wall: Building = serde_json::from_value(saved).expect("an old wall reads");
    assert_eq!(wall.material, None);
    assert_eq!(wall_strength(&wall), WALL_STRENGTH.wall);
    assert!(serde_json::to_value(&wall).unwrap().get("material").is_none());
}

#[test]
fn the_invariants_catch_stone_off_a_wall_and_damage_past_a_materials_strength() {
    let terrain = plains(16);
    let mut world = empty_world(&terrain);
    world.buildings.push(Building {
        material: Some(WallMaterial::Stone),
        ..building("h", BuildingKind::House, 1.0, 1.0)
    });
    world.buildings.push(Building {
        material: Some(WallMaterial::Wood),
        ..building("w", BuildingKind::Wall, 2.0, 1.0)
    });
    let materials = invariant_named("wall-materials-sound").unwrap();
    let broken: Vec<_> = (materials.check)(&world, &terrain);
    assert_eq!(broken.len(), 2);
    world.buildings.clear();
    // Past a wooden wall's strength is sound for a stone one, not for a wooden one.
    let mut s = stone_wall("s", BuildingKind::Wall, 1.0, 1.0);
    s.damage = Some(WALL_STRENGTH.wall + 1.0);
    let mut w = building("w", BuildingKind::Wall, 2.0, 1.0);
    w.damage = Some(WALL_STRENGTH.wall + 1.0);
    world.buildings.extend([s, w]);
    let damage = invariant_named("wall-damage-sound").unwrap();
    let broken = (damage.check)(&world, &terrain);
    assert_eq!(broken.len(), 1);
    assert_eq!(broken[0].entity_ids, vec!["w".to_string()]);
}
