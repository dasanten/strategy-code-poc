//! A town goes stone (T106.3, `CONTEXT.md`: Wall / Gate, Wood or stone): left to itself with a
//! forest and a stone node near, a freshly founded town builds a quarry for the Stone and upgrades
//! its outer wall, gate first, then tile by tile from the gate. `--nocapture` shows the days.
//!
//! The upgrade is the last use of its Stone (beyond its reserve, after its roads and other
//! projects), and a town's ring is long (a ring 22 tiles out has 176 tiles, 704 Stone): it builds
//! its quarry first, so its gate goes stone in its second game month and over a third of its outer
//! wall within a game season (70 of 176 when measured, with its wooden ring's repairs), the rest
//! over the next.

use csp_shared::balance::NPC_TOWN;
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};
use csp_shared::world::{Building, BuildingKind, ResourceKind, WorldState};

use super::{add_node, home_mut};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_inner_wall::outer_walls;
use crate::npc_test_world::{plains, Runner};
use crate::queries::building::is_stone;
use crate::queries::npc_trade::npc_reserve;
use crate::random::Mulberry32;
use crate::world::create_world;

/// A game season: a quarter of the game year.
const SEASON_DAYS: usize = (TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY / 4.0) as usize;

/// The game day by which its gate is of stone (day 5 when measured: it starts with its reserve,
/// which holds the Stone it sets aside for its wall, Epic 113; day 27 before).
const GATE_BY_DAY: usize = 45;

/// The share of its outer wall of stone at the end of the season (45% when measured, with the Stone
/// it sets aside for its wall while it grows and saves for a founding party, Epic 113; 40% before;
/// 62% before its wooden walls decayed, Epic 97: once worn their repairs take a Wood a tile, Wood
/// its quarry and upgrade then wait on).
const SHARE_BY_SEASON: f64 = 0.3;

#[test]
#[ignore = "57.8 s alone: runs a town for a game season"]
fn a_town_upgrades_its_outer_wall_to_stone_gate_first_through_a_season() {
    let mut terrain = plains(700);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(11.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 300, 300, &mut || m.next(), None);
    world.nodes.clear();
    let home = npc_home(&world, &city).expect("a home").clone();
    add_node(&mut world, &mut terrain, ResourceKind::Forest, home.x + 40.0, home.y);
    add_node(&mut world, &mut terrain, ResourceKind::Stone, home.x - 40.0, home.y);
    let reserve = npc_reserve(&world, world.cities.iter().find(|c| c.id == city).unwrap());
    home_mut(&mut world, &city).stock = Some(reserve);
    let size = terrain.size;
    let outer = |world: &WorldState| -> Vec<Building> {
        let walls: Vec<Building> = world
            .buildings
            .iter()
            .filter(|b| {
                b.city_id.as_deref() == Some(city.as_str())
                    && matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)
                    && b.site.is_none()
            })
            .cloned()
            .collect();
        outer_walls(&walls, |b| (b.x as i32, b.y as i32), (home.x as i32, home.y as i32), size)
    };
    let stone = |b: &Building| is_stone(b.kind, b.material);
    let mut runner = Runner::new(&terrain);
    let day = TICKS_PER_GAME_DAY as usize;
    let (mut gate_day, mut first_wall_day) = (None, None);
    let mut share = 0.0;
    for d in 1..=SEASON_DAYS {
        for _ in 0..day {
            runner.step(&mut world, &terrain);
        }
        assert_eq!(check_all(&world, &terrain), [], "day {d}");
        let ring = outer(&world);
        if gate_day.is_none() && ring.iter().any(|b| b.kind == BuildingKind::Gate && stone(b)) {
            gate_day = Some(d);
        }
        if first_wall_day.is_none() && ring.iter().any(|b| b.kind == BuildingKind::Wall && stone(b))
        {
            first_wall_day = Some(d);
        }
        let done = ring.iter().filter(|b| stone(b)).count();
        share = done as f64 / ring.len().max(1) as f64;
        if d % 15 == 0 {
            eprintln!("day {d}: {done} of {} outer tiles of stone", ring.len());
        }
    }
    eprintln!("gate of stone on day {gate_day:?}, the first wall tile on day {first_wall_day:?}");
    let gate_day = gate_day.expect("the gate went stone");
    assert!(gate_day <= GATE_BY_DAY, "the gate on day {gate_day}");
    assert!(first_wall_day.is_some_and(|w| w >= gate_day), "the gate first");
    assert!(share >= SHARE_BY_SEASON, "{share} of the outer wall of stone after a season");
}
