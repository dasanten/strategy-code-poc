//! Those sent to the wall go up (T105.5, `CONTEXT.md`: Wall walk, Alarm, Trading post): a Player's
//! armed residents going after an attacker at their wall by the Alarm default, and a trading
//! post's soldiers fighting one at its wall, get up onto the walk next to them, taking the time,
//! and come down again when sent elsewhere. An NPC city's wall posts are in `tests/npc_posts.rs`.

use csp_shared::balance::{WALK_TICKS_PER_TILE, WALL_WALK_TICKS};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, Resident, ResidentOrder, TradeOrgCity, UpSide};
use csp_shared::world::{Stock, WorldState};

use crate::combat::attack_order;
use crate::game_test_world::Game;
use crate::movement_test_world::{building, plains, realm, resident, walk_to};

const SIZE: i32 = 512;

/// The ring of c1: wall from (5, 5) to (11, 11), its gate in the middle of the south side.
const GATE: (f64, f64) = (8.0, 11.0);

/// Realm r1 (Player 7, Leader a1) and r2 (Player 8, Leader b1), and city c1 with its town hall at
/// (8, 8) inside a ring of wall (`GATE`): r1's when `trade_org` is none, else a city of the Trade
/// Organization's. r2's b1, armed, stands outside the north side of the ring at (8, 4), next to
/// its wall tile (8, 5).
fn setup(trade_org: Option<TradeOrgCity>) -> (WorldState, TerrainMap) {
    let terrain = plains(SIZE);
    let mut world = crate::world::create_world(&terrain, 1);
    world.nodes.clear();
    world.realms.push(realm("r1", 7, "a1"));
    world.realms.push(realm("r2", 8, "b1"));
    let owner = trade_org.is_none().then_some("r1");
    crate::test_world::add_city(&mut world, "c1", owner, 8.0, 8.0, trade_org);
    for i in 5..=11 {
        for (x, y) in [(i, 5), (i, 11), (5, i), (11, i)] {
            let (x, y) = (f64::from(x), f64::from(y));
            if world.buildings.iter().any(|b| b.x == x && b.y == y) {
                continue;
            }
            let kind = if (x, y) == GATE { BuildingKind::Gate } else { BuildingKind::Wall };
            let mut b = building(&format!("w{x}-{y}"), kind, x, y);
            b.city_id = Some("c1".into());
            world.buildings.push(b);
        }
    }
    let mut b1 = grown(resident("b1", Some("r2"), 8.0, 4.0));
    b1.carried = Stock::from([(Good::Sword, 1.0), (Good::Food, 5.0)]);
    world.residents.push(b1);
    (world, terrain)
}

/// A resident who lives a life of usual length (`resident`'s never ends).
fn grown(mut r: Resident) -> Resident {
    r.lifespan = 60.0;
    r
}

/// An armed defender of c1 at (x, y): of r1, or of the city itself when `owner` is none.
fn defender(id: &str, owner: Option<&str>, x: f64, y: f64) -> Resident {
    let mut r = grown(resident(id, owner, x, y));
    r.city_id = Some("c1".into());
    r.carried = Stock::from([(Good::Spear, 1.0), (Good::Food, 5.0)]);
    r
}

fn r_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).expect("the resident")
}

/// Whether (x, y) is a tile of c1's wall, its gate aside.
fn on_wall(world: &WorldState, x: f64, y: f64) -> bool {
    world.buildings.iter().any(|b| b.kind == BuildingKind::Wall && b.x == x && b.y == y)
}

/// b1 sets about breaking the wall tile next to them, (8, 5).
fn attack_the_wall(world: &mut WorldState) {
    r_mut(world, "b1").order = Some(ResidentOrder::Attack(attack_order("w8-5", false, false)));
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

/// Ticks until `id` is up on a wall tile, and returns the ticks they spent on the last ground
/// tile before it: getting up. On the way they keep inside the ring: never out of the gate.
fn until_up(game: &mut Game, id: &str) -> u64 {
    let mut last: Option<((f64, f64), u64)> = None;
    for _ in 0..TICKS_PER_GAME_DAY as usize {
        let d = game.r(id);
        if on_wall(&game.world, d.x, d.y) {
            assert_eq!(d.up, Some(UpSide::Inside), "{id} up from inside");
            let (_, since) = last.expect("came from the ground");
            return game.world.tick - since;
        }
        assert!(d.up.is_none(), "{id} on the ground off the wall");
        let inside = (6.0..=10.0).contains(&d.x) && (6.0..=10.0).contains(&d.y);
        assert!(inside, "{id} keeps inside the ring: at ({}, {})", d.x, d.y);
        if last.map(|(t, _)| t) != Some((d.x, d.y)) {
            last = Some(((d.x, d.y), game.world.tick));
        }
        game.tick();
    }
    panic!("{id} never got up onto the wall");
}

/// Getting up took about its ticks: more than a step on plains could, whatever progress was left
/// over from the step before.
fn took_the_time(ticks: u64) {
    assert!(ticks as f64 >= WALL_WALK_TICKS - WALK_TICKS_PER_TILE, "got up in {ticks} ticks");
}

/// Up on the north wall, in contact with b1 below at (8, 4).
fn up_by_the_attacker(game: &Game, id: &str) {
    let d = game.r(id);
    assert!((d.x - 8.0).abs() <= 1.0 && d.y == 5.0, "{id} at ({}, {})", d.x, d.y);
}

#[test]
fn the_alarm_default_takes_a_players_armed_resident_up_onto_the_wall_by_the_attacker() {
    let (mut world, terrain) = setup(None);
    world.residents.push(defender("a1", Some("r1"), 7.0, 8.0));
    attack_the_wall(&mut world);
    let mut game = Game::new(world, terrain);
    until(&mut game, |g| g.r("a1").script.as_ref().is_some_and(|s| s.alarm.is_some()));
    took_the_time(until_up(&mut game, "a1"));
    up_by_the_attacker(&game, "a1");

    // The attacker gone, a walk inside brings them down again: nobody is stuck up there.
    let b1 = r_mut(&mut game.world, "b1");
    (b1.x, b1.y, b1.order) = (300.0, 300.0, None);
    until(&mut game, |g| g.r("a1").script.is_none());
    walk_to(r_mut(&mut game.world, "a1"), 7.0, 8.0);
    until(&mut game, |g| g.r("a1").order.is_none());
    let a1 = game.r("a1");
    assert_eq!((a1.x, a1.y, a1.up), (7.0, 8.0, None));
}

#[test]
fn a_trading_posts_soldier_fights_an_attacker_at_its_wall_from_up_on_it() {
    let (mut world, terrain) = setup(Some(TradeOrgCity::Post));
    world.residents.push(defender("d1", None, 7.0, 8.0));
    // r1, the Player, has their Leader far away.
    world.residents.push(grown(resident("a1", Some("r1"), 300.0, 300.0)));
    attack_the_wall(&mut world);
    let mut game = Game::new(world, terrain);
    took_the_time(until_up(&mut game, "d1"));
    let d1 = game.r("d1");
    assert!(matches!(&d1.order, Some(ResidentOrder::Attack(o)) if o.target_id == "b1"));
    up_by_the_attacker(&game, "d1");
}
