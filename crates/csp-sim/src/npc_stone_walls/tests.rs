//! NPC cities upgrading their walls to stone (T106.3, `CONTEXT.md`: Wall / Gate, Wood or stone).

use csp_shared::balance::{
    NPC_TOWN, NPC_WALL_STEP, NPC_WALL_TILES_PER_TRIP, STONE_BUILD_MATERIALS,
};
use csp_shared::terrain::{wrap_delta, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, CityProject, Good, Stock, WallMaterial, WorldState,
};

use super::*;
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_chain::short_goods;
use crate::npc_cities::found_npc_city;
use crate::npc_growth::{next_project, wall_rings};
use crate::npc_test_world::{
    fill_houses, fill_inside, plains, ring, village, Runner, Village, WALL,
};
use crate::queries::npc_trade::npc_reserve;
use crate::random::Mulberry32;

const STONE: Option<WallMaterial> = Some(WallMaterial::Stone);

/// A town founded on open plains, with its ring of wooden wall and its gate.
struct Town {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    home: Building,
}

impl Town {
    fn new() -> Town {
        let terrain = plains(200);
        let mut world = crate::world::create_world(&terrain, 1);
        let mut m = Mulberry32::new(7.0);
        let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 40, 40, &mut || m.next(), None);
        let home = npc_home(&world, &city).expect("a home").clone();
        Town { world, terrain, city, home }
    }

    fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the town")
    }

    fn walls(&self) -> Vec<&Building> {
        self.world
            .buildings
            .iter()
            .filter(|b| {
                b.city_id.as_ref() == Some(&self.city)
                    && matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)
            })
            .collect()
    }

    fn gate(&self) -> Building {
        self.walls().into_iter().find(|b| b.kind == BuildingKind::Gate).expect("a gate").clone()
    }

    /// The town's storage holding `stone` Stone on top of what it has.
    fn give_stone(&mut self, stone: f64) {
        let i = self
            .world
            .buildings
            .iter()
            .position(|b| b.city_id.as_ref() == Some(&self.city) && b.kind == BuildingKind::Storage)
            .expect("a storage");
        let stock = self.world.buildings[i].stock.get_or_insert_with(Stock::new);
        *stock.entry(Good::Stone).or_insert(0.0) += stone;
    }

    fn upgrade(&self) -> Option<CityProject> {
        stone_upgrade_project(&self.world, self.city(), &self.home, self.terrain.size, false)
    }

    fn set_stone(&mut self, id: &str) {
        let i = self.world.buildings.iter().position(|b| b.id == id).unwrap();
        self.world.buildings[i].material = STONE;
    }
}

fn trip() -> f64 {
    STONE_BUILD_MATERIALS.get("wall").and_then(|t| t.get("stone")).unwrap()
        * NPC_WALL_TILES_PER_TRIP
}

fn at(p: &Option<CityProject>) -> (BuildingKind, f64, f64, Option<WallMaterial>) {
    match p {
        Some(CityProject::Build { building, x, y, material }) => (*building, *x, *y, *material),
        other => panic!("no build project: {other:?}"),
    }
}

#[test]
fn a_town_is_an_npc_city_of_a_towns_residents_a_village_is_not() {
    let t = Town::new();
    assert!(is_npc_town(&t.world, t.city()));
    let v = village(None);
    assert!(!is_npc_town(&v.world, v.city()));
}

#[test]
fn a_town_with_spare_stone_upgrades_its_gate_first_then_its_wall_nearest_the_gate() {
    let mut t = Town::new();
    // Short of Stone beyond its reserve, it waits.
    assert_eq!(t.upgrade(), None);
    t.give_stone(3.0 * trip());
    let gate = t.gate();
    assert_eq!(at(&t.upgrade()), (BuildingKind::Gate, gate.x, gate.y, STONE));
    t.set_stone(&gate.id);
    let (kind, x, y, material) = at(&t.upgrade());
    assert_eq!((kind, material), (BuildingKind::Wall, STONE));
    let size = t.terrain.size;
    let next_to = wrap_delta(gate.x as i32, x as i32, size)
        .abs()
        .max(wrap_delta(gate.y as i32, y as i32, size).abs());
    assert_eq!(next_to, 1, "a tile beside the gate");
}

#[test]
fn a_village_with_spare_stone_stays_wooden() {
    let mut v = village(None);
    let i = v.storage();
    v.world.buildings[i].stock = Some(Stock::from([(Good::Stone, 500.0), (Good::Food, 400.0)]));
    let size = v.terrain.size;
    assert_eq!(stone_upgrade_project(&v.world, v.city(), &v.home, size, false), None);
    assert!(!wants_stone_for_walls(&v.world, v.city()));
}

#[test]
fn a_town_upgrades_only_from_a_trips_stone_beyond_its_reserve_and_never_runs_short_for_it() {
    let mut t = Town::new();
    assert!(wants_stone_for_walls(&t.world, t.city()));
    // Holding its reserve's Stone and no more, it waits; the upgrade makes it short of nothing, so
    // no other project waits on it.
    let reserve = npc_reserve(&t.world, t.city()).get(&Good::Stone).copied().unwrap_or(0.0);
    let i = t
        .world
        .buildings
        .iter()
        .position(|b| b.city_id.as_ref() == Some(&t.city) && b.kind == BuildingKind::Storage)
        .unwrap();
    let mut stock = npc_reserve(&t.world, t.city());
    stock.insert(Good::Stone, reserve);
    t.world.buildings[i].stock = Some(stock.clone());
    assert!(!short_goods(&t.world, t.city(), t.terrain.size, None).contains(&Good::Stone));
    assert_eq!(t.upgrade(), None);
    // A trip's Stone beyond its reserve: the gate goes stone.
    stock.insert(Good::Stone, reserve + trip());
    t.world.buildings[i].stock = Some(stock);
    assert_eq!(at(&t.upgrade()).0, BuildingKind::Gate);
    // All of stone: nothing more wanted for it.
    let ids: Vec<String> = t.walls().iter().map(|b| b.id.clone()).collect();
    for id in ids {
        t.set_stone(&id);
    }
    assert!(!wants_stone_for_walls(&t.world, t.city()));
    assert_eq!(t.upgrade(), None);
}

#[test]
fn the_inner_ring_follows_once_the_outer_one_is_stone() {
    let mut t = Town::new();
    t.give_stone(3.0 * trip());
    // An inner ring of two tiles and a gate near the home.
    let (hx, hy) = (t.home.x, t.home.y);
    for (i, (dx, kind)) in
        [(-1.0, BuildingKind::Wall), (0.0, BuildingKind::Gate), (1.0, BuildingKind::Wall)]
            .into_iter()
            .enumerate()
    {
        let mut b = crate::test_support::building(&format!("in{i}"), kind, None, hx + dx, hy + 4.0);
        b.city_id = Some(t.city.clone());
        t.world.buildings.push(b);
    }
    let _inner: Vec<String> =
        t.walls().iter().filter(|b| b.id.starts_with("in")).map(|b| b.id.clone()).collect();
    let outer: Vec<String> =
        t.walls().iter().filter(|b| !b.id.starts_with("in")).map(|b| b.id.clone()).collect();
    let (_, x, y, _) = at(&t.upgrade());
    assert!(outer.iter().any(|id| t
        .world
        .buildings
        .iter()
        .any(|b| &b.id == id && b.x == x && b.y == y)));
    for id in outer {
        t.set_stone(&id);
    }
    assert_eq!(at(&t.upgrade()), (BuildingKind::Gate, hx, hy + 4.0, STONE));
}

#[test]
fn growing_moves_a_stone_wall_out_as_stone() {
    let mut v: Village = village(None);
    fill_inside(&mut v.world, &mut v.terrain, &v.home);
    fill_houses(&mut v.world, &v.city, &v.home);
    let i = v.storage();
    v.world.buildings[i].stock =
        Some(Stock::from([(Good::Food, 400.0), (Good::Wood, 100.0), (Good::Stone, 500.0)]));
    let size = v.terrain.size;
    let ids: Vec<String> =
        ring(&v.world, &v.city, &v.home, size, WALL).iter().map(|b| b.id.clone()).collect();
    for id in &ids {
        let j = v.world.buildings.iter().position(|b| &b.id == id).unwrap();
        v.world.buildings[j].material = STONE;
    }
    // A house outside the wall: the city grows, its new wall starting from its gate.
    let mut h = crate::test_support::building(
        "h",
        BuildingKind::House,
        None,
        v.home.x,
        v.home.y + f64::from(WALL) + 2.0,
    );
    h.city_id = Some(v.city.clone());
    v.world.buildings.push(h);
    let rings = wall_rings(&v.world, v.city(), &v.home, size).expect("rings");
    assert!(rings.expanding);
    assert_eq!(
        next_project(&v.world, v.city(), &v.home, &v.terrain),
        Some(CityProject::Build {
            building: BuildingKind::Gate,
            x: v.home.x,
            y: v.home.y + f64::from(WALL) + NPC_WALL_STEP,
            material: STONE,
        })
    );
}

#[test]
fn a_town_upgrades_its_gate_to_stone_with_its_own_builders() {
    let mut t = Town::new();
    t.give_stone(4.0 * trip());
    let gate = t.gate();
    let mut runner = Runner::new(&t.terrain);
    let day = TICKS_PER_GAME_DAY as usize;
    for tick in 0..4 * day {
        runner.step(&mut t.world, &t.terrain);
        if tick % (day / 4) == 0 {
            let broken: Vec<_> = check_all(&t.world, &t.terrain);
            assert_eq!(broken, [], "tick {tick}");
        }
        let now = t.world.buildings.iter().find(|b| b.id == gate.id).expect("the gate stands");
        if is_stone(now.kind, now.material) {
            return;
        }
    }
    panic!("the gate is still wood after 4 game days");
}

#[test]
fn an_upgrade_project_makes_the_town_short_of_nothing() {
    // Its Stone comes from beyond its reserve: its hands go on working for what else it wants.
    let mut t = Town::new();
    t.give_stone(3.0 * trip());
    let project = t.upgrade().expect("an upgrade");
    let i = t
        .world
        .buildings
        .iter()
        .position(|b| b.city_id.as_ref() == Some(&t.city) && b.kind == BuildingKind::Storage)
        .unwrap();
    let reserve = npc_reserve(&t.world, t.city());
    t.world.buildings[i].stock = Some(reserve);
    let short = short_goods(&t.world, t.city(), t.terrain.size, Some(&project));
    assert!(!short.contains(&Good::Stone), "{short:?}");
}
