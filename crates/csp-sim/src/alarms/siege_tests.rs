//! The Alarm default against an attack on the wall (T105.6, ADR 0036, `CONTEXT.md`: Alarm,
//! Walls in combat): climbing a city's wall raises the alarm as a blow at it does, and a defender
//! done with one attacker goes on to the next still at the wall, ending only once none is left.

use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{AlarmKind, BuildingKind, Good, Resident, Stock, Task, WorldState};
use csp_shared::world::{AlarmScriptId, ClimbOrder, ResidentOrder, Tile};

use crate::combat::attack_order;
use crate::game_test_world::Game;
use crate::movement_test_world::{add_city, building, plains, realm, resident};
use crate::script_runner::default_host::default_script_id;

const SIZE: i32 = 512;

/// Realm r1 (Player 7, Leader a1) with city c1, its town hall at (8, 8) inside a ring of wall
/// from (5, 5) to (11, 11), its gate in the middle of the south side; a1, armed, stands inside.
/// Realm r2 (Player 8) has b1 and b2, armed, outside the north side at (7, 4) and (9, 4), next to
/// the wall tiles (7, 5) and (9, 5).
fn setup() -> (WorldState, csp_shared::terrain::TerrainMap) {
    let terrain = plains(SIZE);
    let mut world = crate::world::create_world(&terrain, 1);
    world.nodes.clear();
    world.realms.push(realm("r1", 7, "a1"));
    world.realms.push(realm("r2", 8, "b1"));
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
    let mut a1 = armed(resident("a1", Some("r1"), 7.0, 8.0));
    a1.city_id = Some("c1".into());
    world.residents.push(a1);
    world.residents.push(armed(resident("b1", Some("r2"), 7.0, 4.0)));
    world.residents.push(armed(resident("b2", Some("r2"), 9.0, 4.0)));
    (world, terrain)
}

fn armed(mut r: Resident) -> Resident {
    r.lifespan = 60.0;
    r.carried = Stock::from([(Good::Spear, 1.0), (Good::Food, 5.0)]);
    r
}

fn r_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).expect("the resident")
}

/// The attacked alarm a1's Alarm script runs for: whom it is about.
fn attacked_about(game: &Game) -> Option<String> {
    let s = game.r("a1").script.as_ref().filter(|s| s.task == Some(Task::Alarm))?;
    s.alarm.as_ref().filter(|a| a.kind == AlarmKind::Attacked).map(|a| a.about.clone())
}

/// Ticks until `done`, at most a game day.
fn until(game: &mut Game, done: impl Fn(&Game) -> bool) {
    for _ in 0..TICKS_PER_GAME_DAY as usize {
        if done(game) {
            return;
        }
        game.tick();
    }
    assert!(done(game), "never happened");
}

fn climb(world: &mut WorldState, id: &str, wall: &str) {
    let r = r_mut(world, id);
    let at = Tile { x: r.x, y: r.y };
    r.order = Some(ResidentOrder::Climb(ClimbOrder { wall_id: wall.into(), at, progress: 0.0 }));
}

/// The breaker or climber `id` leaves: gone from the area, as dead or fled.
fn leaves(game: &mut Game, id: &str) {
    let r = r_mut(&mut game.world, id);
    (r.x, r.y, r.order, r.script) = (300.0, 300.0, None, None);
}

#[test]
fn climbing_a_citys_wall_raises_the_alarm_there_as_breaking_it_does() {
    let (mut world, terrain) = setup();
    climb(&mut world, "b1", "w7-5");
    let mut game = Game::new(world, terrain);
    until(&mut game, |g| attacked_about(g).is_some());
    assert_eq!(attacked_about(&game).as_deref(), Some("b1"));
}

#[test]
fn the_alarm_default_goes_on_to_the_next_attacker_at_the_wall_until_none_is_left() {
    let (mut world, terrain) = setup();
    r_mut(&mut world, "b1").order = Some(ResidentOrder::Attack(attack_order("w7-5", false, false)));
    climb(&mut world, "b2", "w9-5");
    let mut game = Game::new(world, terrain);
    until(&mut game, |g| attacked_about(g).is_some());
    let first = attacked_about(&game).expect("an attacker");
    let next = if first == "b1" { "b2" } else { "b1" };
    leaves(&mut game, &first);
    until(&mut game, |g| attacked_about(g).as_deref() != Some(first.as_str()));
    assert_eq!(attacked_about(&game).as_deref(), Some(next), "on to the other one");
    leaves(&mut game, next);
    until(&mut game, |g| g.r("a1").script.is_none());
}

#[test]
fn a_script_the_player_picked_isnt_moved_on() {
    let (mut world, terrain) = setup();
    r_mut(&mut world, "b1").order = Some(ResidentOrder::Attack(attack_order("w7-5", false, false)));
    r_mut(&mut world, "b2").order = Some(ResidentOrder::Attack(attack_order("w9-5", false, false)));
    let mut game = Game::new(world, terrain);
    until(&mut game, |g| attacked_about(g).is_some());
    let first = attacked_about(&game).expect("an attacker");
    // Picked now: the Alarm default the runner resolves for it is theirs all the same.
    let theirs = default_script_id(7, Task::Alarm);
    r_mut(&mut game.world, "a1").alarm_script_id = Some(AlarmScriptId::Script(theirs));
    leaves(&mut game, &first);
    until(&mut game, |g| attacked_about(g).as_deref() != Some(first.as_str()));
    assert_eq!(attacked_about(&game), None, "it ended for that attacker");
}
