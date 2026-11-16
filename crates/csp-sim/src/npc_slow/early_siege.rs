//! Early cities can't take each other (T105.6, ADR 0036, `CONTEXT.md`: Walls in combat, Starting
//! city, Alarm): two starting cities on the game's defaults, one sending every armed resident it
//! has at the other's wall, half of them breaking it and half climbing it, the defenders inside
//! going by the Alarm default. The wall holds: no tile of it falls before the attackers are
//! beaten, and the defenders lose few. The same with twice the defenders' numbers.

use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, WorldState};
use serde_json::json;

use crate::game_test_world::Game;
use crate::movement_test_world::plains;
use crate::queries::residents::{can_work, is_armed};
use crate::queries::walls::wall_strength;
use crate::starting_city::found_starting_city;

const SIZE: i32 = 512;
const DEFENDER: u64 = 7;
/// The Players whose starting cities attack, as many as it takes for the numbers.
const ATTACKERS: [u64; 3] = [8, 9, 10];

/// The most of its armed residents the defending city may lose to an attack on its wall.
const MOST_DEFENDERS_LOST: f64 = 0.25;

/// An attacker, the Player who orders them, the wall tile they break or climb and where they
/// stand to.
struct Post {
    id: String,
    user: u64,
    wall: String,
    at: (f64, f64),
    climbs: bool,
}

/// What came of a siege.
#[derive(Debug)]
struct Outcome {
    defenders: usize,
    attackers: usize,
    defenders_lost: usize,
    attackers_left: usize,
    /// The tick a tile of the wall or the gate fell, if one did.
    fell_at: Option<u64>,
    /// The most damage a tile of the wall or the gate took, as a share of its strength.
    most_damage: f64,
    /// Ticks until the attackers were beaten or a tile fell.
    ticks: u64,
}

fn realm_id(world: &WorldState, user_id: u64) -> String {
    world.realms.iter().find(|r| r.user_id == user_id).expect("the realm").id.clone()
}

fn city_of(world: &WorldState, realm: &str) -> String {
    world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm)).expect("a city").id.clone()
}

/// The armed grown residents of `realm`, its Leader aside unless `leader`.
fn armed(world: &WorldState, realm: &str, leader: bool) -> Vec<String> {
    let leader_id = world.realms.iter().find(|r| r.id == realm).map(|r| r.leader_id.clone());
    world
        .residents
        .iter()
        .filter(|r| r.owner.as_deref() == Some(realm))
        .filter(|r| leader || Some(&r.id) != leader_id.as_ref())
        .filter(|r| can_work(r.born_at, world.tick as f64) && is_armed(r))
        .map(|r| r.id.clone())
        .collect()
}

/// The wall and gate tiles of `city`, as (id, x, y, gate).
fn ring(world: &WorldState, city: &str) -> Vec<(String, f64, f64, bool)> {
    world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(city))
        .filter(|b| matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate))
        .map(|b| (b.id.clone(), b.x, b.y, b.kind == BuildingKind::Gate))
        .collect()
}

fn alive(world: &WorldState, id: &str) -> bool {
    world.residents.iter().any(|r| r.id == id)
}

/// The starting city of Player 7 defends; those of Players 8, 9 and 10 send every armed resident
/// they have but their Leaders (whose death would end the realm) until there are `factor` times
/// as many attackers as the defending city has armed residents, its Leader among them. The defenders are
/// at home inside their ring, its gate closed by their Player; the attackers stand outside it,
/// the north side first, each next to a wall tile of its own, every other one to break it and the
/// rest to climb.
fn siege(factor: usize) -> Outcome {
    let terrain = plains(SIZE);
    let mut world = crate::world::create_world(&terrain, 1);
    world.nodes.clear();
    for user in std::iter::once(DEFENDER).chain(ATTACKERS) {
        found_starting_city(&mut world, &terrain, user, None);
    }
    let defending = realm_id(&world, DEFENDER);
    let city = city_of(&world, &defending);
    let defenders = armed(&world, &defending, true);
    assert!(defenders.len() >= 4, "a starting city arms its grown residents: {defenders:?}");
    // Each attacker and the Player who orders them.
    let mut attackers: Vec<(String, u64)> = Vec::new();
    for user in ATTACKERS {
        let realm = realm_id(&world, user);
        attackers.extend(armed(&world, &realm, false).into_iter().map(|id| (id, user)));
    }
    attackers.truncate(factor * defenders.len());
    assert_eq!(attackers.len(), factor * defenders.len(), "the attackers' numbers");

    let ring = ring(&world, &city);
    let top = ring.iter().map(|t| t.2).fold(f64::MAX, f64::min);
    let (left, right) =
        ring.iter().fold((f64::MAX, f64::MIN), |(l, r), t| (l.min(t.1), r.max(t.1)));
    let hall = {
        let id = &world.cities.iter().find(|c| c.id == city).expect("the city").town_hall_id;
        let b = world.buildings.iter().find(|b| &b.id == id).expect("the hall");
        (b.x, b.y)
    };
    // Everyone of the defending city at home inside the ring, by the town hall.
    for r in world.residents.iter_mut().filter(|r| r.owner.as_deref() == Some(defending.as_str())) {
        (r.x, r.y, r.order) = (hall.0, hall.1 + 1.0, None);
    }
    // The wall tiles, corners and the gate aside, the north side's first, one for each
    // attacker, who stands outside it.
    let bottom = ring.iter().map(|t| t.2).fold(f64::MIN, f64::max);
    let outside = |(_, x, y, _): &(String, f64, f64, bool)| -> Option<(f64, f64)> {
        let corner = (*x == left || *x == right) && (*y == top || *y == bottom);
        match () {
            _ if corner => None,
            _ if *y == top => Some((*x, y - 1.0)),
            _ if *x == left => Some((x - 1.0, *y)),
            _ if *x == right => Some((x + 1.0, *y)),
            _ => Some((*x, y + 1.0)),
        }
    };
    let mut tiles: Vec<_> = ring
        .iter()
        .filter(|t| !t.3)
        .filter_map(|t| outside(t).map(|at| (t.0.clone(), at, t.2 != top, t.1)))
        .collect();
    tiles.sort_by(|a, b| (a.2, a.3).partial_cmp(&(b.2, b.3)).expect("numbers"));
    assert!(tiles.len() >= attackers.len(), "a wall tile for each attacker");
    let posts: Vec<Post> = attackers
        .iter()
        .zip(tiles)
        .enumerate()
        .map(|(i, ((id, user), (wall, at, ..)))| Post {
            id: id.clone(),
            user: *user,
            wall,
            at,
            climbs: i % 2 == 1,
        })
        .collect();
    for p in &posts {
        let r = world.residents.iter_mut().find(|r| r.id == p.id).expect("the attacker");
        (r.x, r.y, r.order, r.script) = (p.at.0, p.at.1, None, None);
    }

    let mut game = Game::new(world, terrain);
    let gate = ring.iter().find(|t| t.3).expect("a gate").0.clone();
    let closed = game.order(DEFENDER, json!({"kind": "setGate", "gateId": gate, "open": false}));
    assert_eq!(closed, "ack");

    let limit = TICKS_PER_GAME_DAY as u64;
    let start = game.world.tick;
    let mut fell_at = None;
    let mut most_damage: f64 = 0.0;
    while game.world.tick - start < limit {
        let left: Vec<&Post> = posts.iter().filter(|p| alive(&game.world, &p.id)).collect();
        if left.is_empty() {
            break;
        }
        if ring.iter().any(|t| !game.world.buildings.iter().any(|b| b.id == t.0)) {
            fell_at = Some(game.world.tick - start);
            break;
        }
        // The attackers keep at it: a breaker struck from above, or a climber knocked off, takes
        // up their work again; one who got over goes after the nearest defender.
        for p in left {
            let (id, wall) = (&p.id, &p.wall);
            let r = game.r(id);
            if r.order.is_some() {
                continue;
            }
            let (rx, ry) = (r.x, r.y);
            let order = if (rx, ry) == p.at {
                if p.climbs {
                    json!({"kind": "climb", "residentId": id, "wallId": wall})
                } else {
                    json!({"kind": "attack", "residentId": id, "targetId": wall})
                }
            } else if let Some(target) = nearest(&game.world, &defenders, (rx, ry)) {
                json!({"kind": "attack", "residentId": id, "targetId": target})
            } else {
                continue;
            };
            game.receive(p.user, order);
        }
        game.tick();
        for b in game.world.buildings.iter().filter(|b| ring.iter().any(|t| t.0 == b.id)) {
            most_damage = most_damage.max(b.damage.unwrap_or(0.0) / wall_strength(b));
        }
    }
    Outcome {
        defenders: defenders.len(),
        attackers: attackers.len(),
        defenders_lost: defenders.iter().filter(|id| !alive(&game.world, id)).count(),
        attackers_left: attackers.iter().filter(|(id, _)| alive(&game.world, id)).count(),
        fell_at,
        most_damage,
        ticks: game.world.tick - start,
    }
}

/// The living one of `ids` nearest (x, y).
fn nearest(world: &WorldState, ids: &[String], at: (f64, f64)) -> Option<String> {
    world
        .residents
        .iter()
        .filter(|r| ids.contains(&r.id))
        .min_by(|a, b| {
            let d = |r: &csp_shared::world::Resident| (r.x - at.0).abs() + (r.y - at.1).abs();
            d(a).total_cmp(&d(b))
        })
        .map(|r| r.id.clone())
}

fn holds(outcome: &Outcome) {
    let o = outcome;
    eprintln!(
        "{} attackers against {} defenders: {} attackers left, {} defenders lost, after {} \
         ticks; the most damaged tile took {:.0} % of its strength",
        o.attackers,
        o.defenders,
        o.attackers_left,
        o.defenders_lost,
        o.ticks,
        o.most_damage * 100.0
    );
    assert_eq!(outcome.fell_at, None, "no tile of the wall falls: {outcome:?}");
    assert_eq!(outcome.attackers_left, 0, "the attackers are beaten: {outcome:?}");
    let most = (outcome.defenders as f64 * MOST_DEFENDERS_LOST).floor() as usize;
    assert!(outcome.defenders_lost <= most, "the defenders lose at most {most}: {outcome:?}");
}

#[test]
#[ignore = "5.1 s alone; see #1132"]
fn a_starting_city_takes_no_tile_of_anothers_wall_at_equal_numbers() {
    holds(&siege(1));
}

#[test]
#[ignore = "6.4 s alone; see #1132"]
fn nor_at_twice_their_numbers() {
    holds(&siege(2));
}
