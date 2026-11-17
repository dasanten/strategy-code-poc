//! NPC cities building towers (T109.3, `CONTEXT.md`: Tower, Soldier posts): a town whose outer
//! wall is all of stone builds a stone tower by each gate, then in each corner, as it can spare the
//! Stone; a wooden-walled one doesn't; its wall posts fill its towers first, archers first.

use csp_shared::balance::{STONE_BUILD_MATERIALS, TOWER_ROOM};
use csp_shared::footprint::{covers, footprint_tiles, Placed};
use csp_shared::terrain::{wrap_delta, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, CityProject, Good, Stock, WallMaterial, WorldState,
};

use super::*;
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_posts::soldier_posts;
use crate::npc_test_world::{plains, village, Runner};
use crate::random::Mulberry32;

const STONE: Option<WallMaterial> = Some(WallMaterial::Stone);

/// A town founded on open plains, with its ring of wall and its gate.
struct Town {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    home: Building,
}

impl Town {
    /// With its wall all of stone when `stone`.
    fn new(stone: bool) -> Town {
        let terrain = plains(200);
        let mut world = crate::world::create_world(&terrain, 1);
        let mut m = Mulberry32::new(7.0);
        let city = found_npc_city(
            &mut world,
            &terrain,
            &csp_shared::balance::NPC_TOWN,
            40,
            40,
            &mut || m.next(),
            None,
        );
        let home = npc_home(&world, &city).expect("a home").clone();
        if stone {
            for b in world.buildings.iter_mut().filter(|b| {
                b.city_id.as_ref() == Some(&city)
                    && matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)
            }) {
                b.material = STONE;
            }
        }
        Town { world, terrain, city, home }
    }

    fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the town")
    }

    fn gate(&self) -> Building {
        self.world
            .buildings
            .iter()
            .find(|b| b.city_id.as_ref() == Some(&self.city) && b.kind == BuildingKind::Gate)
            .expect("a gate")
            .clone()
    }

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

    fn next(&self) -> Option<CityProject> {
        tower_project(&self.world, self.city(), &self.home, Some(&self.terrain), 200, false)
    }

    /// A finished stone tower of the town at `nw`.
    fn put_tower(&mut self, nw: (f64, f64)) {
        let id = format!("tw{}", self.world.buildings.len());
        let mut t = crate::test_support::building(&id, BuildingKind::Tower, None, nw.0, nw.1);
        t.city_id = Some(self.city.clone());
        t.material = STONE;
        self.world.buildings.push(t);
    }
}

fn tower_stone() -> f64 {
    STONE_BUILD_MATERIALS.get("tower").and_then(|t| t.get("stone")).expect("a stone tower's Stone")
}

fn spot(p: &Option<CityProject>) -> (f64, f64) {
    match p {
        Some(CityProject::Build { building: BuildingKind::Tower, x, y, material }) => {
            assert_eq!(*material, STONE, "a stone tower");
            (*x, *y)
        }
        other => panic!("no tower project: {other:?}"),
    }
}

fn ring(home: &Building, (x, y): (i32, i32)) -> i32 {
    wrap_delta(home.x as i32, x, 200).abs().max(wrap_delta(home.y as i32, y, 200).abs())
}

fn tiles(nw: (f64, f64)) -> Vec<(i32, i32)> {
    footprint_tiles(Placed { kind: "tower", x: nw.0 as i32, y: nw.1 as i32 }, 200)
}

#[test]
fn a_stone_walled_town_builds_a_tower_by_its_gate_then_one_in_each_corner() {
    let mut t = Town::new(true);
    t.give_stone(20.0 * tower_stone());
    let gate = t.gate();
    let wall = ring(&t.home, (gate.x as i32, gate.y as i32));
    let first = spot(&t.next());
    let near_gate = tiles(first)
        .iter()
        .map(|&(x, y)| {
            wrap_delta(gate.x as i32, x, 200).abs().max(wrap_delta(gate.y as i32, y, 200).abs())
        })
        .min()
        .unwrap();
    assert!(near_gate <= 2, "by the gate: {first:?}, gate at {}, {}", gate.x, gate.y);
    // Just inside the wall, touching it, and clear of the way in.
    let rings: Vec<i32> = tiles(first).iter().map(|&t2| ring(&t.home, t2)).collect();
    assert!(rings.iter().all(|&r| r < wall) && rings.contains(&(wall - 1)), "{rings:?}");
    let inward = (
        -wrap_delta(t.home.x as i32, gate.x as i32, 200).signum(),
        -wrap_delta(t.home.y as i32, gate.y as i32, 200).signum(),
    );
    let along_x = wrap_delta(t.home.x as i32, gate.x as i32, 200).abs() == wall;
    let way_in = if along_x {
        (gate.x as i32 + inward.0, gate.y as i32)
    } else {
        (gate.x as i32, gate.y as i32 + inward.1)
    };
    let p = Placed { kind: "tower", x: first.0 as i32, y: first.1 as i32 };
    assert!(!covers(p, way_in.0, way_in.1, 200), "the way in stays free");
    t.put_tower(first);
    // Then one in each corner, and no more.
    let mut corners = Vec::new();
    while let Some(p) = t.next() {
        let at = spot(&Some(p));
        let edge: Vec<i32> = tiles(at).iter().map(|&t2| ring(&t.home, t2)).collect();
        assert!(edge.iter().all(|&r| r < wall) && edge.contains(&(wall - 1)), "{edge:?}");
        corners.push(at);
        t.put_tower(at);
        assert!(corners.len() <= 4, "four corners at most: {corners:?}");
    }
    assert_eq!(corners.len(), 4, "a tower in each corner");
    for c in &corners {
        let (dx, dy) = (
            wrap_delta(t.home.x as i32, c.0 as i32, 200).abs(),
            wrap_delta(t.home.y as i32, c.1 as i32, 200).abs(),
        );
        assert!(dx >= wall - 3 && dy >= wall - 3, "in a corner: {c:?}");
    }
    assert!(!wants_stone_for_towers(&t.world, t.city(), &t.home, 200));
}

#[test]
fn a_wooden_walled_town_and_a_village_build_none() {
    let mut t = Town::new(false);
    t.give_stone(20.0 * tower_stone());
    assert_eq!(t.next(), None);
    assert!(!wants_stone_for_towers(&t.world, t.city(), &t.home, 200));
    let v = village(None);
    let p = tower_project(&v.world, v.city(), &v.home, Some(&v.terrain), v.terrain.size, false);
    assert_eq!(p, None);
}

#[test]
fn it_waits_for_a_towers_stone_beyond_its_reserve() {
    let mut t = Town::new(true);
    let reserve = crate::queries::npc_trade::npc_reserve(&t.world, t.city())
        .get(&Good::Stone)
        .copied()
        .unwrap_or(0.0);
    let held = crate::queries::npc_trade::npc_city_stock(&t.world, t.city())
        .get(&Good::Stone)
        .copied()
        .unwrap_or(0.0);
    t.give_stone((reserve - held).max(0.0) + tower_stone() - 1.0);
    assert_eq!(t.next(), None, "a Stone short");
    assert!(wants_stone_for_towers(&t.world, t.city(), &t.home, 200));
    t.give_stone(1.0);
    spot(&t.next());
}

#[test]
fn a_tower_begun_goes_on_whatever_else() {
    let mut t = Town::new(true);
    t.give_stone(20.0 * tower_stone());
    let first = spot(&t.next());
    t.put_tower(first);
    let site = t.world.buildings.last_mut().unwrap();
    site.site = Some(csp_shared::world::ConstructionSite { delivered: Stock::new(), work: 0.0 });
    // Even with no Stone to spare now, and moving its wall out.
    let p = tower_project(&t.world, t.city(), &t.home, Some(&t.terrain), 200, true);
    assert_eq!(spot(&p), first);
}

#[test]
fn a_town_builds_its_gate_tower_with_its_own_builders() {
    let mut t = Town::new(true);
    t.give_stone(4.0 * tower_stone());
    let mut runner = Runner::new(&t.terrain);
    let day = TICKS_PER_GAME_DAY as usize;
    for tick in 0..5 * day {
        runner.step(&mut t.world, &t.terrain);
        if tick % (day / 4) == 0 {
            let broken: Vec<_> = check_all(&t.world, &t.terrain);
            assert_eq!(broken, [], "tick {tick}");
        }
        let done = t.world.buildings.iter().any(|b| {
            b.kind == BuildingKind::Tower
                && b.site.is_none()
                && b.city_id.as_ref() == Some(&t.city)
                && b.material == STONE
        });
        if done {
            return;
        }
    }
    panic!("no tower after 5 game days");
}

#[test]
fn its_posts_fill_its_towers_first_its_archers_first() {
    let mut t = Town::new(true);
    t.give_stone(20.0 * tower_stone());
    let first = spot(&t.next());
    t.put_tower(first);
    let soldiers: Vec<usize> = (0..t.world.residents.len())
        .filter(|&i| t.world.residents[i].city_id.as_ref() == Some(&t.city))
        .take(TOWER_ROOM as usize + 4)
        .collect();
    assert!(soldiers.len() > TOWER_ROOM as usize + 2, "enough residents");
    // The last two by id carry Bows: archers.
    let mut by_id = soldiers.clone();
    by_id.sort_by(|&a, &b| t.world.residents[a].id.cmp(&t.world.residents[b].id));
    let archers: Vec<String> =
        by_id.iter().rev().take(2).map(|&i| t.world.residents[i].id.clone()).collect();
    for &i in &by_id {
        if archers.contains(&t.world.residents[i].id) {
            t.world.residents[i].carried.insert(Good::Bow, 1.0);
        }
    }
    let posts = soldier_posts(&t.world, t.city(), &soldiers, 200, Some(&t.terrain));
    let on_tower: Vec<&String> =
        posts.iter().filter(|(_, p)| tiles(first).contains(&p.at)).map(|(id, _)| id).collect();
    assert_eq!(on_tower.len(), TOWER_ROOM as usize, "{posts:?}");
    for a in &archers {
        assert!(on_tower.contains(&a), "archer {a} up on the tower");
    }
}

#[test]
fn the_old_wall_takes_its_towers_with_it() {
    let mut t = Town::new(true);
    t.give_stone(20.0 * tower_stone());
    let first = spot(&t.next());
    t.put_tower(first);
    let gate = t.gate();
    let wall = ring(&t.home, (gate.x as i32, gate.y as i32));
    let id = t.world.buildings.last().unwrap().id.clone();
    assert_eq!(old_tower(&t.world, t.city(), &t.home, wall, wall + 4, 200), Some(id));
    assert_eq!(old_tower(&t.world, t.city(), &t.home, wall, wall, 200), None, "not moving out");
}
