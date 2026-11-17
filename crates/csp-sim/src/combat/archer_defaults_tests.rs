//! The game's defaults with archers (T108.4, `CONTEXT.md`: Ranged combat, Under attack, Alarm):
//! Defend and Alarm shoot from where the archer stands (or the nearest wall tile) rather than walk
//! into contact; out of Arrows an archer is any armed resident. Scripts see reach and Arrows and
//! can order a shot.

use csp_shared::balance::SHOT_REACH;
use csp_shared::world::{BuildingKind, Good, ResidentOrder, Stat, WorldState};
use serde_json::json;

use crate::game_test_world::{player, run_script, Game};
use crate::movement_test_world::plains;
use crate::queries::walls::is_up;
use crate::starting_city::found_starting_city;
use crate::test_world::{empty_world, live, realm, resident};

const SIZE: i32 = 256;

fn stock(goods: &[(Good, f64)]) -> csp_shared::world::Stock {
    goods.iter().copied().collect()
}

fn bow_reach() -> f64 {
    SHOT_REACH.get("bow").expect("a reach")
}

/// Realm r1's a1 at (10, 10) and realm r2's b1 `apart` tiles east, each with a Bow and `arrows`.
fn archers(apart: f64, arrows: f64) -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    for (id, owner, x) in [("a1", "r1", 10.0), ("b1", "r2", 10.0 + apart)] {
        let i = resident(&mut world, id, Some(owner), x, 10.0);
        let r = &mut world.residents[i];
        r.carried = stock(&[(Good::Bow, 1.0), (Good::Arrows, arrows)]);
        r.stats.agility = Stat { base: 1.0, trained: 0.0 };
        crate::equipment::settle_equipment(r);
    }
    world
}

fn attack(by: &str, at: &str) -> serde_json::Value {
    json!({ "kind": "attack", "residentId": by, "targetId": at })
}

fn arrows(world: &WorldState, id: &str) -> f64 {
    live(world, id).unwrap().carried.get(&Good::Arrows).copied().unwrap_or(0.0)
}

#[test]
fn a_struck_archer_shoots_back_from_where_they_stand() {
    let world = archers(6.0, 20.0);
    let mut game = Game::new(world, crate::test_support::plains(SIZE));
    assert_eq!(game.order(8, attack("b1", "a1")), "ack");
    game.until_hit("a1", 20).expect("b1 shoots a1");
    game.until_hit("b1", 20).expect("a1 shoots back");
    let a = game.r("a1");
    assert_eq!((a.x, a.y), (10.0, 10.0), "a1 shot from where they stood");
    assert!(matches!(&a.order, Some(ResidentOrder::Attack(o)) if o.target_id == "b1"));
    assert!(arrows(&game.world, "a1") < 20.0);
}

/// The starting city of Player 7, every armed resident but one disarmed, that one (`archer`) with
/// a Bow and `arrows` at the town hall; one armed resident of Player 8 outside the middle of its
/// north wall, next to it, breaking it. The archer, the attacker and the north wall tile.
fn wall_siege(arrows: f64) -> (Game, String, String, (f64, f64)) {
    let terrain = plains(512);
    let mut world = crate::world::create_world(&terrain, 1);
    world.nodes.clear();
    found_starting_city(&mut world, &terrain, 7, None);
    found_starting_city(&mut world, &terrain, 8, None);
    let realm_of = |w: &WorldState, user: u64| {
        w.realms.iter().find(|r| r.user_id == user).expect("a realm").id.clone()
    };
    let (home, away) = (realm_of(&world, 7), realm_of(&world, 8));
    let city = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(&home)).unwrap().clone();
    let hall = world.buildings.iter().find(|b| b.id == city.town_hall_id).unwrap().clone();
    let walls: Vec<_> = world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(&city.id) && b.kind == BuildingKind::Wall)
        .cloned()
        .collect();
    let top = walls.iter().map(|b| b.y).fold(f64::MAX, f64::min);
    let north = walls
        .iter()
        .filter(|b| b.y == top)
        .min_by(|a, b| (a.x - hall.x).abs().total_cmp(&(b.x - hall.x).abs()))
        .expect("a north wall")
        .clone();
    let mut archer = None;
    for r in world.residents.iter_mut().filter(|r| r.owner.as_deref() == Some(&home)) {
        (r.x, r.y, r.order) = (hall.x, hall.y + 1.0, None);
        r.carried.retain(|g, _| *g == Good::Food);
        if archer.is_none() && r.id != world.realms.iter().find(|x| x.id == home).unwrap().leader_id
        {
            r.carried.insert(Good::Bow, 1.0);
            if arrows > 0.0 {
                r.carried.insert(Good::Arrows, arrows);
            }
            archer = Some(r.id.clone());
        }
        crate::equipment::settle_equipment(r);
    }
    let leader = world.realms.iter().find(|x| x.id == away).unwrap().leader_id.clone();
    let foe = world
        .residents
        .iter_mut()
        .find(|r| {
            r.owner.as_deref() == Some(&away)
                && r.id != leader
                && crate::queries::residents::is_armed(r)
        })
        .expect("an armed attacker");
    (foe.x, foe.y, foe.order, foe.script) = (north.x, north.y - 1.0, None, None);
    let foe = foe.id.clone();
    let mut game = Game::new(world, terrain);
    assert_eq!(game.order(8, attack(&foe, &north.id)), "ack");
    (game, archer.expect("an archer"), foe, (north.x, north.y))
}

#[test]
fn an_alarm_sends_an_archer_up_on_the_wall_and_they_shoot_from_there() {
    let (mut game, archer, foe, north) = wall_siege(40.0);
    let mut up_at = None;
    for _ in 0..400 {
        game.tick();
        let a = game.r(&archer);
        assert!(
            !matches!(&a.order, Some(ResidentOrder::Attack(_))) || is_up(&game.world, a),
            "the archer shoots only once up on the wall: {:?} at ({}, {})",
            a.order,
            a.x,
            a.y
        );
        if is_up(&game.world, a) && up_at.is_none() {
            up_at = Some((a.x, a.y));
        }
        if !game.world.residents.iter().any(|r| r.id == foe) {
            break;
        }
    }
    // Up on the north wall, by the attacker; every shot came from up there (checked each tick).
    let (_, y) = up_at.expect("the archer got up on the wall");
    assert_eq!(y, north.1, "on the north wall, between the hall and the attacker");
    let f = game.world.residents.iter().find(|r| r.id == foe);
    assert!(f.is_none_or(|f| f.health < 100.0), "the attacker was shot");
    assert!(arrows(&game.world, &archer) < 40.0);
}

#[test]
fn an_archer_with_no_arrows_closes_in_as_anyone_armed() {
    let (mut game, archer, foe, _) = wall_siege(0.0);
    let mut went = false;
    for _ in 0..200 {
        game.tick();
        let a = game.r(&archer);
        if matches!(&a.order, Some(ResidentOrder::Attack(o)) if o.target_id == foe) {
            went = true;
            break;
        }
    }
    assert!(went, "the archer out of Arrows goes after the attacker: {:?}", game.r(&archer).order);
}

#[test]
fn a_script_reads_reach_and_arrows_and_orders_a_shot() {
    let world = archers(5.0, 12.0);
    let terrain = crate::test_support::plains(SIZE);
    let mara = player(7);
    let (answer, _) = run_script(&world, &terrain, &mara, "a1", "memory.answer = me.reach");
    assert_eq!(answer.and_then(|v| v.as_f64()), Some(bow_reach()));
    let (answer, _) =
        run_script(&world, &terrain, &mara, "a1", "memory.answer = me.carried.arrows");
    assert_eq!(answer.and_then(|v| v.as_f64()), Some(12.0));
    let (answer, requests) =
        run_script(&world, &terrain, &mara, "a1", "memory.answer = shoot(\"b1\")");
    assert!(matches!(answer, None | Some(serde_json::Value::Null)), "{answer:?}");
    assert_eq!(
        serde_json::to_value(&requests).unwrap(),
        json!([{ "kind": "attack", "residentId": "a1", "targetId": "b1", "shoot": true }])
    );
    // They see b1's reach too: anyone who sees them sees their Bow.
    let (answer, _) = run_script(
        &world,
        &terrain,
        &mara,
        "a1",
        "for (r of residents()) { if (r.id == \"b1\") { memory.answer = r.reach } }",
    );
    assert_eq!(answer.and_then(|v| v.as_f64()), Some(bow_reach()));
    // Out of reach, without Arrows, or with no Bow: no shot, and why.
    let far = archers(bow_reach() + 2.0, 12.0);
    let (answer, requests) =
        run_script(&far, &terrain, &mara, "a1", "memory.answer = shoot(\"b1\")");
    assert_eq!((answer, requests.len()), (Some(json!("out of reach")), 0));
    let none = archers(5.0, 0.0);
    let (answer, _) = run_script(&none, &terrain, &mara, "a1", "memory.answer = shoot(\"b1\")");
    assert_eq!(answer, Some(json!("no arrows")));
    let mut bare = archers(5.0, 12.0);
    bare.residents[0].carried.clear();
    let (answer, _) = run_script(&bare, &terrain, &mara, "a1", "memory.answer = shoot(\"b1\")");
    assert_eq!(answer, Some(json!("no bow or crossbow equipped")));
    let (answer, _) = run_script(&bare, &terrain, &mara, "a1", "memory.answer = me.reach");
    assert!(matches!(answer, None | Some(serde_json::Value::Null)), "{answer:?}");
}
