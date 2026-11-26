//! Upgrading a wooden wall to stone (T106.2, `CONTEXT.md`: Wall / Gate, Wood or stone): a stone
//! site on a wooden wall or gate leaves the wooden one standing, walkable and defended until the
//! stone one is finished and replaces it, those up on it staying up; a stone Build line upgrades
//! the wooden tiles on its way and passes those of stone; breaking the wooden tile leaves the site.

use std::sync::Arc;

use csp_shared::balance::{STONE_BUILD_MATERIALS, STONE_BUILD_WORK, WALL_STRENGTH};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildOrder, Building, BuildingKind, ConstructionSite, Good, LineOrder, LinePhase,
    ResidentOrder, Stock, Tile, UpSide, WallMaterial, WorldState,
};

use crate::invariants::{check_all, InvariantViolation};
use crate::movement_test_world::{add_city, building, plains, realm, resident};
use crate::queries::building::{build_problem_for, construction_at, line_tile, TerrainLookup};
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::walls::wall_map;
use crate::world::step_world;

const SIZE: i32 = 512;

/// Realm r1 (Player 7) with city c1: a ring of wooden wall from (5, 5) to (11, 11), its gate at
/// (8, 11) and its town hall at (8, 8) (as the wall walk's tests).
fn setup() -> (WorldState, Arc<TerrainMap>) {
    let terrain = plains(SIZE);
    let mut world = crate::world::create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "a1"));
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    for i in 5..=11 {
        for (x, y) in [(i, 5), (i, 11), (5, i), (11, i)] {
            let (x, y) = (f64::from(x), f64::from(y));
            if world.buildings.iter().any(|b| b.x == x && b.y == y) {
                continue;
            }
            let kind = if (x, y) == (8.0, 11.0) { BuildingKind::Gate } else { BuildingKind::Wall };
            let mut b = building(&format!("w{x}-{y}"), kind, x, y);
            b.city_id = Some("c1".into());
            world.buildings.push(b);
        }
    }
    (world, Arc::new(terrain))
}

fn step(world: &mut WorldState, terrain: &Arc<TerrainMap>, walking: &mut Walking, ticks: u32) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        for r in &mut world.residents {
            r.hunger = 100.0;
        }
        step_world(world, terrain, &mut scratch, Some(walking), None);
    }
}

fn wall(world: &WorldState, x: f64, y: f64) -> Vec<&Building> {
    world.buildings.iter().filter(|b| b.x == x && b.y == y).collect()
}

fn stone() -> Option<WallMaterial> {
    Some(WallMaterial::Stone)
}

/// a1 up on (8, 5) and builder b1 up beside them, giving b1 the order to build stone on (8, 5).
fn upgrading_8_5(world: &mut WorldState) {
    for id in ["a1", "b1"] {
        let mut r = resident(id, Some("r1"), 8.0, 5.0);
        r.up = Some(UpSide::Inside);
        world.residents.push(r);
    }
    world.residents[1].order = Some(ResidentOrder::Build(BuildOrder {
        building: BuildingKind::Wall,
        at: Tile { x: 8.0, y: 5.0 },
        site_id: None,
        material: stone(),
    }));
}

#[test]
fn a_stone_site_leaves_the_wooden_wall_standing_and_walkable_until_it_replaces_it() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::without_budget(terrain.clone());
    upgrading_8_5(&mut world);
    step(&mut world, &terrain, &mut walking, 1);
    let here = wall(&world, 8.0, 5.0);
    assert_eq!(here.len(), 2, "the wooden wall and the stone site");
    let site = here.iter().find(|b| b.site.is_some()).expect("the site");
    assert_eq!(site.material, stone());
    let site_id = site.id.clone();
    // The wooden one is still the wall: walls and the walk see it, and it is still wood.
    let walls = wall_map(&world, &terrain);
    assert!(walls.tiles.contains_key(&(5 * SIZE as usize + 8)));
    let wooden = world.buildings.iter().find(|b| b.id == "w8-5").unwrap();
    assert_eq!((wooden.site.is_none(), wooden.material), (true, None));
    assert_eq!(broken(&world, &terrain), []);
    // Its work in, its Stone delivered: finished, the wooden wall becomes the stone one.
    step(&mut world, &terrain, &mut walking, STONE_BUILD_WORK.get("wall").unwrap() as u32 / 2);
    assert!(world.buildings.iter().any(|b| b.id == site_id), "not finished without its Stone");
    let si = world.buildings.iter().position(|b| b.id == site_id).unwrap();
    let units = STONE_BUILD_MATERIALS.get("wall").and_then(|t| t.get("stone")).unwrap();
    world.buildings[si].site.as_mut().unwrap().delivered = Stock::from([(Good::Stone, units)]);
    step(&mut world, &terrain, &mut walking, STONE_BUILD_WORK.get("wall").unwrap() as u32);
    let here = wall(&world, 8.0, 5.0);
    assert_eq!(here.len(), 1);
    assert_eq!(here[0].id, "w8-5", "the wall keeps its id");
    assert_eq!((here[0].site.is_none(), here[0].material), (true, stone()));
    assert_eq!(here[0].city_id.as_deref(), Some("c1"));
    // Those up on it stay up, and b1's order is done.
    for id in ["a1", "b1"] {
        let r = world.residents.iter().find(|r| r.id == id).unwrap();
        assert_eq!((r.x, r.y, r.up), (8.0, 5.0, Some(UpSide::Inside)), "{id}");
    }
    assert!(world.residents[1].order.is_none());
    assert_eq!(broken(&world, &terrain), []);
}

#[test]
fn only_one_stone_site_goes_on_a_wooden_wall_and_a_wooden_one_never_does() {
    let (mut world, terrain) = setup();
    let t = Some(&*terrain as &dyn TerrainLookup);
    assert_eq!(build_problem_for(&world, 8, 5, BuildingKind::Wall, stone(), t), None);
    assert!(build_problem_for(&world, 8, 5, BuildingKind::Wall, None, t).is_some());
    // A stone wall on a wooden gate, or a stone gate on a wooden wall: not its kind.
    assert!(build_problem_for(&world, 8, 11, BuildingKind::Wall, stone(), t).is_some());
    assert!(build_problem_for(&world, 8, 5, BuildingKind::Gate, stone(), t).is_some());
    let mut s = building("s", BuildingKind::Wall, 8.0, 5.0);
    s.site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    s.material = stone();
    world.buildings.push(s);
    assert!(build_problem_for(&world, 8, 5, BuildingKind::Wall, stone(), t).is_some());
    assert_eq!(construction_at(&world, 8, 5, BuildingKind::Wall).map(|b| b.id.as_str()), Some("s"));
}

#[test]
fn a_stone_line_over_a_mixed_ring_upgrades_the_wood_and_its_gate_and_passes_the_stone() {
    let (mut world, terrain) = setup();
    for id in ["w7-11", "w9-11"] {
        let i = world.buildings.iter().position(|b| b.id == id).unwrap();
        world.buildings[i].material = stone();
    }
    let t = Some(&*terrain as &dyn TerrainLookup);
    let tiles = |world: &WorldState, material| -> Vec<(i32, BuildingKind)> {
        (5..=11)
            .filter_map(|x| line_tile(world, BuildingKind::Wall, material, x, 11, t))
            .map(|l| (l.x, l.building))
            .collect()
    };
    use BuildingKind::{Gate, Wall};
    // The ring's corners at 5 and 11 are wood too.
    assert_eq!(tiles(&world, stone()), [(5, Wall), (6, Wall), (8, Gate), (10, Wall), (11, Wall)]);
    // A wooden line passes both wood and stone.
    assert_eq!(tiles(&world, None), []);
}

#[test]
fn a_stone_wall_line_order_upgrades_the_wooden_tiles_and_the_gate_to_stone() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::without_budget(terrain.clone());
    let i = world.buildings.iter().position(|b| b.id == "w7-11").unwrap();
    world.buildings[i].material = stone();
    let mut b1 = resident("b1", Some("r1"), 6.0, 12.0);
    let per_tile = STONE_BUILD_MATERIALS.get("wall").and_then(|t| t.get("stone")).unwrap();
    let per_gate = STONE_BUILD_MATERIALS.get("gate").and_then(|t| t.get("stone")).unwrap();
    b1.carried = Stock::from([(Good::Stone, 2.0 * per_tile + per_gate), (Good::Food, 3.0)]);
    b1.stats.strength.base = 40.0;
    b1.order = Some(ResidentOrder::WallLine(LineOrder {
        tiles: vec![(6.0, 11.0), (7.0, 11.0), (8.0, 11.0), (9.0, 11.0)],
        phase: LinePhase::Walking,
        path: None,
        progress: 0.0,
        site_id: None,
        material: stone(),
    }));
    world.residents.push(b1);
    let mut seen = Vec::new();
    for _ in 0..40 {
        step(&mut world, &terrain, &mut walking, 100);
        seen.extend(broken(&world, &terrain));
        if world.residents[0].order.is_none() {
            break;
        }
    }
    assert!(world.residents[0].order.is_none(), "the line ended");
    assert_eq!(seen, []);
    for (x, kind, id) in [(6.0, BuildingKind::Wall, "w6-11"), (7.0, BuildingKind::Wall, "w7-11")]
        .into_iter()
        .chain([(8.0, BuildingKind::Gate, "w8-11"), (9.0, BuildingKind::Wall, "w9-11")])
    {
        let here = wall(&world, x, 11.0);
        assert_eq!(here.len(), 1, "({x}, 11)");
        assert_eq!((here[0].id.as_str(), here[0].kind, here[0].material), (id, kind, stone()));
    }
    let left = world.residents[0].carried.get(&Good::Stone).copied().unwrap_or(0.0);
    assert_eq!(left, 0.0, "two walls and the gate took the Stone; the stone tile none");
}

#[test]
fn breaking_the_wooden_tile_while_the_stone_site_stands_leaves_the_site() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::without_budget(terrain.clone());
    let mut s = building("s", BuildingKind::Wall, 8.0, 5.0);
    s.site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    s.material = stone();
    world.buildings.push(s);
    let i = world.buildings.iter().position(|b| b.id == "w8-5").unwrap();
    world.buildings[i].damage = Some(WALL_STRENGTH.wall - 0.01);
    world.realms.push(realm("r2", 8, "b9"));
    let mut b9 = resident("b9", Some("r2"), 8.0, 4.0);
    b9.order = Some(ResidentOrder::Attack(crate::combat::attack_order("w8-5", false, false)));
    world.residents.push(b9);
    step(&mut world, &terrain, &mut walking, 20);
    let here = wall(&world, 8.0, 5.0);
    assert_eq!(here.len(), 1);
    assert_eq!(here[0].id, "s", "the site stands alone");
    assert!(!wall_map(&world, &terrain).tiles.contains_key(&(5 * SIZE as usize + 8)));
    assert_eq!(broken(&world, &terrain), []);
}

#[test]
fn the_invariant_lets_an_upgrade_site_share_only_its_wooden_wall() {
    let (mut world, terrain) = setup();
    let mut s = building("s", BuildingKind::Wall, 8.0, 5.0);
    s.site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    s.material = stone();
    world.buildings.push(s.clone());
    assert_eq!(broken(&world, &terrain), []);
    // Over the town hall it overlaps as any building does.
    let i = world.buildings.len() - 1;
    world.buildings[i].x = 8.0;
    world.buildings[i].y = 8.0;
    crate::world_index::forget_building_lookups();
    let all = broken(&world, &terrain);
    assert!(all.iter().any(|v| v.invariant == "buildings-in-place"), "{all:?}");
}

/// The invariants broken but those about the test's own residents and realms, made up as they are.
fn broken(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let made_up = ["ages-in-range", "realms-have-leaders"];
    check_all(world, terrain)
        .into_iter()
        .filter(|v| !made_up.contains(&v.invariant.as_str()))
        .collect()
}
