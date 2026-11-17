//! The ram strikes (T110.2, `CONTEXT.md`: Ram, Walls in combat): a crewed ram next to a wall or gate
//! of another realm strikes it at `RAM_STRIKE_TICKS`, `RAM_BLOW` a strike, far harder than blows.
//! Its crew under its roof can't be struck from up on a wall nor shot; defenders who come down to
//! the ground strike the crew and the ram. A strike raises the alarm as a blow at the wall does.

use csp_shared::balance::{
    LIFESPAN_MAX, OWN_FOOD, RAM_BLOW, RAM_STRIKE_TICKS, STONE_WALL_STRENGTH, STRIKE_TICKS,
    WALL_STRENGTH,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, CrimeKind, Good, ResidentOrder, SiegeMachine, SiegeMachineKind, UpSide,
    WallMaterial, WorldState,
};
use serde_json::json;

use super::*;
use crate::defence::Alarms;
use crate::game_test_world::{player, run_script, Game};
use crate::goods_made::GoodsMade;
use crate::movement_test_world::{add_city, building, draw, realm, resident, world_with_realm};
use crate::queries::combat::attack_power;

/// Plains 30 tiles wide.
fn map() -> TerrainMap {
    let rows: Vec<String> = (0..30).map(|_| ".".repeat(30)).collect();
    let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
    draw(&rows)
}

const CREW: [&str; 4] = ["w1", "c2", "c3", "c4"];

/// Realm r1 (Player 7) with its crewed ram m1 at (9, 4) and its crew on it; realm r2 (Player 8)
/// with city c2 (town hall at (20, 4)) and its wall of three tiles (10, 3) to (10, 5), the middle
/// one a gate, and its defender d1 on the ground at (12, 4). Everyone is grown and fed.
fn world() -> WorldState {
    let mut world = world_with_realm(&map());
    world.realms.push(realm("r2", 8, "d1"));
    add_city(&mut world, "c2", Some("r2"), 20.0, 4.0);
    for (id, y, kind) in [
        ("w-3", 3.0, BuildingKind::Wall),
        ("g-4", 4.0, BuildingKind::Gate),
        ("w-5", 5.0, BuildingKind::Wall),
    ] {
        let mut b = building(id, kind, 10.0, y);
        b.city_id = Some("c2".into());
        world.buildings.push(b);
    }
    for id in CREW {
        world.residents.push(resident(id, Some("r1"), 9.0, 4.0));
    }
    world.residents.push(resident("d1", Some("r2"), 12.0, 4.0));
    for r in &mut world.residents {
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        r.lifespan = LIFESPAN_MAX;
    }
    world.siege_machines.push(SiegeMachine {
        id: "m1".into(),
        kind: SiegeMachineKind::Ram,
        realm_id: Some("r1".into()),
        x: 9.0,
        y: 4.0,
        damage: None,
        teardown: None,
        crew_ids: CREW.iter().map(|s| s.to_string()).collect(),
    });
    world
}

fn ram(game: &mut Game, by: &str, target: &str) -> String {
    game.order(7, json!({"kind": "ram", "residentId": by, "machineId": "m1", "targetId": target}))
}

fn wall<'w>(game: &'w Game, id: &str) -> Option<&'w Building> {
    game.world.buildings.iter().find(|b| b.id == id)
}

/// Ticks until `id` is gone, at most `max`.
fn until_gone(game: &mut Game, id: &str, max: usize) -> usize {
    for t in 0..max {
        if wall(game, id).is_none() {
            return t;
        }
        game.tick();
    }
    panic!("{id} still stands after {max} ticks");
}

#[test]
fn a_crewed_ram_next_to_a_wall_breaks_it_in_a_fraction_of_the_time_blows_take() {
    let mut game = Game::new(world(), map());
    assert_eq!(ram(&mut game, "w1", "w-3"), "ack", "a wall diagonally next to it");
    let ticks = until_gone(&mut game, "w-3", 2000);
    let want = (WALL_STRENGTH.wall / RAM_BLOW).ceil() * RAM_STRIKE_TICKS;
    assert!((ticks as f64 - want).abs() <= 2.0, "{ticks} ticks, {want} wanted");
    // One average resident striking it alone takes many times longer.
    let blows = WALL_STRENGTH.wall / attack_power(&game.world.residents[0], 0.0) * STRIKE_TICKS;
    assert!(blows > 4.0 * ticks as f64, "blows {blows}, ram {ticks}");
    // The order ends with the wall, its materials lie on its tile, and breaking r2's wall is a
    // crime of tearing down.
    assert!(game.r("w1").order.is_none());
    assert!(game.world.piles.iter().any(|p| (p.x, p.y) == (10.0, 3.0)));
    assert!(game.world.crimes.iter().any(|c| c.kind == CrimeKind::TearDown));
}

#[test]
fn a_stone_gate_holds_out_longer_against_it() {
    let mut world = world();
    world.buildings.iter_mut().find(|b| b.id == "g-4").expect("the gate").material =
        Some(WallMaterial::Stone);
    let mut game = Game::new(world, map());
    assert_eq!(ram(&mut game, "w1", "g-4"), "ack");
    let ticks = until_gone(&mut game, "g-4", 20_000);
    let want = (STONE_WALL_STRENGTH.gate / RAM_BLOW).ceil() * RAM_STRIKE_TICKS;
    assert!((ticks as f64 - want).abs() <= 2.0, "{ticks} ticks, {want} wanted");
}

#[test]
fn it_takes_its_whole_crew_next_to_a_wall_of_another_realm() {
    let mut game = Game::new(world(), map());
    game.world.siege_machines[0].crew_ids.pop();
    assert_eq!(ram(&mut game, "w1", "g-4"), "the ram needs 1 more crew to strike");
    game.world.siege_machines[0].crew_ids = CREW.iter().map(|s| s.to_string()).collect();
    assert_eq!(ram(&mut game, "d1", "g-4"), "not one of your residents");
    // Too far from the wall.
    game.world.siege_machines[0].x = 7.0;
    for id in CREW {
        game.r_mut(id).x = 7.0;
    }
    assert_eq!(ram(&mut game, "w1", "g-4"), "push the ram next to it first");
    // Its own realm's wall isn't rammed.
    let mut own = building("own", BuildingKind::Wall, 8.0, 4.0);
    add_city(&mut game.world, "c1", Some("r1"), 2.0, 2.0);
    own.city_id = Some("c1".into());
    game.world.buildings.push(own);
    assert_eq!(ram(&mut game, "w1", "own"), "that is one of your own walls");
}

#[test]
fn a_crew_too_small_stops_it() {
    let mut game = Game::new(world(), map());
    assert_eq!(ram(&mut game, "w1", "g-4"), "ack");
    game.run(15);
    assert!(wall(&game, "g-4").and_then(|b| b.damage).is_some(), "struck already");
    let walk = json!({"kind": "walkTo", "residentId": "c4", "x": 3, "y": 4});
    assert_eq!(game.order(7, walk), "ack");
    for _ in 0..40 {
        if game.r("c4").x != 9.0 {
            break;
        }
        game.tick();
    }
    game.tick();
    let damage = wall(&game, "g-4").and_then(|b| b.damage);
    game.run(40);
    assert!(game.r("w1").order.is_none(), "the ram order ends below its crew size");
    assert_eq!(wall(&game, "g-4").and_then(|b| b.damage), damage);
}

/// r2's d1 up on its wall at (10, 5), beside the ram's tile, with a Bow and Arrows.
fn defender_up(game: &mut Game) {
    let d1 = game.r_mut("d1");
    (d1.x, d1.y) = (10.0, 5.0);
    d1.up = Some(UpSide::Inside);
    d1.carried.insert(Good::Bow, 1.0);
    d1.carried.insert(Good::Arrows, 20.0);
}

#[test]
fn from_up_on_the_wall_nobody_strikes_or_shoots_its_crew_nor_the_ram() {
    let mut game = Game::new(world(), map());
    defender_up(&mut game);
    game.tick();
    let attack = |t: &str, shoot: bool| json!({"kind": "attack", "residentId": "d1", "targetId": t, "shoot": shoot});
    assert_eq!(game.order(8, attack("c2", false)), "they are under the ram’s roof");
    assert_eq!(game.order(8, attack("c2", true)), "they are under the ram’s roof");
    assert_eq!(game.order(8, attack("m1", false)), "a siege machine is struck from the ground");
    // An order given anyway, as a script or default might: it ends, and nobody is hurt.
    let order = crate::combat::attack_order("c2", false, false);
    game.r_mut("d1").order = Some(ResidentOrder::Attack(order));
    let before = game.r("c2").health;
    game.run(10);
    assert!(game.r("d1").order.is_none());
    assert_eq!(game.r("c2").health, before);
}

#[test]
fn defenders_on_the_ground_strike_its_crew_and_the_ram() {
    let mut game = Game::new(world(), map());
    let d1 = game.r_mut("d1");
    (d1.x, d1.y) = (8.0, 4.0);
    let attack = |t: &str| json!({"kind": "attack", "residentId": "d1", "targetId": t});
    assert_eq!(game.order(8, attack("c2")), "ack");
    assert!(game.until_hit("c2", 40).is_some(), "c2 is struck from the ground");
    assert_eq!(game.order(8, attack("m1")), "ack");
    game.run(20);
    assert!(game.world.siege_machines[0].damage.is_some(), "the ram takes blows");
}

/// The siege of a stone gate (`CONTEXT.md`: Ram, High ground): r1's four with Spears against r2's
/// gate at (10, 4) between stone walls, r2's three with Spears up on its walk striking down at
/// anyone on the ground next to it. Returns whether the gate fell within `ticks`, and how many of
/// the four still live.
fn siege(with_ram: bool, ticks: usize) -> (bool, usize) {
    let mut world = world();
    for b in world.buildings.iter_mut().filter(|b| b.city_id.as_deref() == Some("c2")) {
        if b.kind != BuildingKind::TownHall {
            b.material = Some(WallMaterial::Stone);
        }
    }
    world.residents.retain(|r| r.id != "d1");
    for (id, y) in [("d1", 3.0), ("d2", 4.0), ("d3", 5.0)] {
        let mut d = resident(id, Some("r2"), 10.0, y);
        d.up = Some(UpSide::Inside);
        d.lifespan = LIFESPAN_MAX;
        d.carried = [(Good::Food, OWN_FOOD), (Good::Spear, 1.0)].into_iter().collect();
        world.residents.push(d);
    }
    for (i, id) in CREW.iter().enumerate() {
        let r = world.residents.iter_mut().find(|r| r.id == *id).expect("a crew member");
        r.carried.insert(Good::Spear, 1.0);
        if !with_ram {
            // Spread along the wall, each striking the gate from the ground.
            (r.x, r.y) = (9.0, 3.0 + (i % 3) as f64);
            r.order = Some(ResidentOrder::Attack(crate::combat::attack_order("g-4", false, false)));
        }
    }
    if !with_ram {
        world.siege_machines.clear();
    } else {
        world.residents[0].order = Some(ResidentOrder::Ram(csp_shared::world::RamOrder {
            machine_id: "m1".into(),
            target_id: "g-4".into(),
            progress: 0.0,
        }));
    }
    let mut game =
        Game::new(world, map()).checking(&["siege-machines-in-place", "up-only-on-walls"]);
    game.scripts_run = false;
    for _ in 0..ticks {
        if wall(&game, "g-4").is_none() {
            break;
        }
        // The defenders go after the nearest of the four they see, as the Alarm default would.
        for d in ["d1", "d2", "d3"] {
            let idle = game.world.residents.iter().any(|r| r.id == d && r.order.is_none());
            let foe = CREW.iter().find(|id| game.world.residents.iter().any(|r| r.id == **id));
            if let (true, Some(foe)) = (idle, foe) {
                game.r_mut(d).order =
                    Some(ResidentOrder::Attack(crate::combat::attack_order(foe, true, true)));
            }
        }
        game.tick();
    }
    let alive = CREW.iter().filter(|id| game.world.residents.iter().any(|r| r.id == **id)).count();
    (wall(&game, "g-4").is_none(), alive)
}

#[test]
fn a_crewed_ram_breaks_a_defended_stone_gate_where_the_same_four_with_spears_fail() {
    let ticks = ((STONE_WALL_STRENGTH.gate / RAM_BLOW).ceil() * RAM_STRIKE_TICKS) as usize + 20;
    let (broke, alive) = siege(false, ticks);
    assert!(!broke, "without the ram the gate stands");
    assert!(alive < CREW.len(), "and the defenders above cut them down: {alive} left");
    let (broke, alive) = siege(true, ticks);
    assert!(broke, "with it the gate falls");
    assert_eq!(alive, CREW.len(), "and nobody up there reaches its crew");
}

/// Alarms that only note the walls struck.
#[derive(Default)]
struct Noted(Vec<(String, String)>);

impl Alarms for Noted {
    fn raise_wall_attacked(
        &mut self,
        _: &mut WorldState,
        attacker_id: &str,
        wall_id: &str,
        _: i32,
    ) {
        self.0.push((attacker_id.into(), wall_id.into()));
    }
}

#[test]
fn each_strike_raises_the_alarm_as_a_blow_at_the_wall_does() {
    let mut world = world();
    world.residents[0].order = Some(ResidentOrder::Ram(csp_shared::world::RamOrder {
        machine_id: "m1".into(),
        target_id: "g-4".into(),
        progress: 1.0 - 1.0 / RAM_STRIKE_TICKS,
    }));
    let mut alarms = Noted::default();
    let broken = resolve_ram_strikes(&mut world, 30, &mut alarms, &mut GoodsMade::default());
    assert!(broken.is_empty());
    assert_eq!(alarms.0, [("w1".to_string(), "g-4".to_string())]);
    assert_eq!(
        world.buildings.iter().find(|b| b.id == "g-4").and_then(|b| b.damage),
        Some(RAM_BLOW)
    );
}

#[test]
fn scripts_ram_as_the_order_does() {
    let world = world();
    let (answer, requests) =
        run_script(&world, &map(), &player(7), "w1", "memory.answer = ram(machines()[0], \"g-4\")");
    assert!(matches!(answer, None | Some(serde_json::Value::Null)), "{answer:?}");
    assert_eq!(
        serde_json::to_value(&requests).unwrap(),
        json!([{ "kind": "ram", "residentId": "w1", "machineId": "m1", "targetId": "g-4" }])
    );
}

#[test]
fn the_invariant_catches_a_ram_order_that_no_longer_holds() {
    let mut world = world();
    world.residents[0].order = Some(ResidentOrder::Ram(csp_shared::world::RamOrder {
        machine_id: "m1".into(),
        target_id: "g-4".into(),
        progress: 0.0,
    }));
    let broken = |w: &WorldState| {
        crate::invariants::check_all(w, &map())
            .into_iter()
            .filter(|v| v.invariant == "siege-machines-in-place")
            .map(|v| v.message)
            .collect::<Vec<_>>()
    };
    assert!(broken(&world).is_empty());
    world.siege_machines[0].crew_ids.pop();
    assert_eq!(
        broken(&world),
        ["resident w1 rams g-4 with m1, but the ram needs 1 more crew to strike"]
    );
}
