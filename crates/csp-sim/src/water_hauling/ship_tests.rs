//! Haul routes by ship (`CONTEXT.md`: Haul route by water, Docked, Crew, T91.4): a ship between two
//! havens, its captain getting off at each to move the goods straight between the haven's storage
//! and the ship, then sailing on as one of its crew while the rest of the crew stays aboard.

use csp_shared::balance::{LIFESPAN_MAX, OWN_FOOD, SHIP_MIN_CREW};
use csp_shared::terrain::{is_sea, terrain_at, tile_index, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Good, HaulPhase, HaulStop, ResidentOrder, Stock, Vessel, VesselKind,
};
use serde_json::json;

use crate::game_test_world::Game;
use crate::movement_test_world::{building, resident, world_with_realm};
use crate::queries::names::held;
use crate::queries::vessels::docked_at;

const SIZE: i32 = 24;

/// Plains with a strait of Sea down columns 6 to 17.
fn strait() -> TerrainMap {
    let mut tiles = vec![Terrain::Plains as u8; (SIZE * SIZE) as usize];
    for y in 0..SIZE {
        for x in 6..=17 {
            tiles[tile_index(SIZE, x, y)] = Terrain::Sea as u8;
        }
    }
    TerrainMap { size: SIZE, tiles }
}

/// Haven h1 ("home") on the west shore covering (3, 9)–(5, 11), holding 30 Food; haven h2 on the
/// east shore covering (18, 9)–(20, 11), holding 100 Iron ore. Ship s1 of r1 docked at h1 on
/// (6, 10) with c1–c3 aboard as its crew; w1, its captain to be, stands on h1 at (4, 10).
fn game() -> Game {
    let map = strait();
    let mut world = world_with_realm(&map);
    let mut h1 = building("h1", BuildingKind::Haven, 3.0, 9.0);
    h1.stock = Some([(Good::Food, 30.0)].into_iter().collect());
    let mut h2 = building("h2", BuildingKind::Haven, 18.0, 9.0);
    h2.stock = Some([(Good::IronOre, 100.0)].into_iter().collect());
    world.buildings.extend([h1, h2]);
    world.vessels.push(Vessel {
        id: "s1".into(),
        kind: VesselKind::Ship,
        realm_id: Some("r1".into()),
        x: 6.0,
        y: 10.0,
        load: Stock::new(),
        rower_id: None,
        crew_ids: ["c1", "c2", "c3"].map(String::from).to_vec(),
    });
    for (id, at) in
        [("w1", (4.0, 10.0)), ("c1", (6.0, 10.0)), ("c2", (6.0, 10.0)), ("c3", (6.0, 10.0))]
    {
        let mut r = resident(id, Some("r1"), at.0, at.1);
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        r.lifespan = LIFESPAN_MAX;
        if id != "w1" {
            r.aboard = Some("s1".into());
        }
        world.residents.push(r);
    }
    Game::new(world, map)
}

fn haul(game: &mut Game, goods: &[&str], back: &[&str], keep_food: f64) -> String {
    let order = json!({
        "kind": "haul", "residentId": "w1", "vesselId": "s1", "x": 19, "y": 10,
        "goods": goods, "returnGoods": back, "keepFood": keep_food
    });
    game.order(7, order)
}

fn s1(game: &Game) -> &Vessel {
    game.world.vessels.iter().find(|v| v.id == "s1").expect("ship s1")
}

fn stock(game: &Game, haven: &str, good: Good) -> f64 {
    let h = game.world.buildings.iter().find(|b| b.id == haven).expect("a haven");
    h.stock.as_ref().map_or(0.0, |s| held(s, good))
}

fn route(game: &Game) -> &csp_shared::world::WaterHaulOrder {
    match &game.r("w1").order {
        Some(ResidentOrder::HaulByWater(o)) => o,
        o => panic!("w1 is on no haul route by water: {o:?}"),
    }
}

/// Ticks until `done`, at most `max`, the ship on Sea all the while; the ticks taken.
fn run_until(game: &mut Game, max: usize, done: impl Fn(&Game) -> bool) -> usize {
    for t in 0..max {
        if done(game) {
            return t;
        }
        game.tick();
        let v = s1(game);
        assert!(is_sea(terrain_at(&game.terrain, v.x as i32, v.y as i32)), "the ship off the Sea");
    }
    panic!("not done after {max} ticks");
}

#[test]
fn hauls_ore_home_and_food_out_trip_after_trip() {
    let mut game = game();
    assert_eq!(haul(&mut game, &["food"], &["ironOre"], 5.0), "ack");
    // Food out to h2, all but the 5 kept aboard; the ore home to h1.
    run_until(&mut game, 6000, |g| stock(g, "h1", Good::IronOre) == 100.0);
    assert_eq!(stock(&game, "h2", Good::Food), 25.0);
    assert_eq!(stock(&game, "h2", Good::IronOre), 0.0);
    // More ore at h2, and Food at home, go too, trip after trip.
    for trip in 1..=3 {
        let h2 = game.world.buildings.iter_mut().find(|b| b.id == "h2").unwrap();
        h2.stock.as_mut().unwrap().insert(Good::IronOre, 20.0);
        let h1 = game.world.buildings.iter_mut().find(|b| b.id == "h1").unwrap();
        h1.stock.as_mut().unwrap().insert(Good::Food, 10.0);
        let home = 100.0 + 20.0 * f64::from(trip);
        run_until(&mut game, 6000, |g| stock(g, "h1", Good::IronOre) == home);
    }
    // The crew stayed aboard all along; the captain comes and goes.
    for c in ["c1", "c2", "c3"] {
        assert_eq!(game.r(c).aboard.as_deref(), Some("s1"), "{c}");
    }
    assert!(matches!(game.r("w1").order, Some(ResidentOrder::HaulByWater(_))));
}

#[test]
fn the_captain_gets_off_at_each_haven_and_sails_on_as_one_of_the_crew() {
    let mut game = game();
    assert_eq!(haul(&mut game, &["food"], &[], 0.0), "ack");
    run_until(&mut game, 200, |g| route(g).phase == HaulPhase::Driving);
    // Leaving, they board as one of its crew; the ship heads for the Sea beside h2.
    assert_eq!(game.r("w1").aboard.as_deref(), Some("s1"));
    assert_eq!(s1(&game).crew_ids.len(), SHIP_MIN_CREW as usize);
    let water = route(&game).water.expect("a Sea tile to sail to");
    assert_eq!((water.x, water.y), (17.0, 10.0));
    // There they get off onto h2 and the ship lies docked at it.
    run_until(&mut game, 3000, |g| route(g).stop == HaulStop::To && g.r("w1").aboard.is_none());
    assert_eq!((game.r("w1").x, game.r("w1").y), (19.0, 10.0));
    assert_eq!(docked_at(&game.world, s1(&game)).map(|h| h.id.as_str()), Some("h2"));
    assert!(!s1(&game).crew_ids.contains(&"w1".to_string()));
    // Sailing taught every one of the crew Seafaring.
    for c in ["w1", "c1", "c2", "c3"] {
        assert!(game.r(c).skills.contains_key(&csp_shared::world::SkillName::Seafaring), "{c}");
    }
}

#[test]
fn waits_at_home_with_nothing_to_load() {
    let mut game = game();
    let h1 = game.world.buildings.iter_mut().find(|b| b.id == "h1").unwrap();
    h1.stock = Some(Stock::new());
    assert_eq!(haul(&mut game, &["food"], &["ironOre"], 0.0), "ack");
    game.run(100);
    assert_eq!((route(&game).stop, route(&game).phase), (HaulStop::From, HaulPhase::Loading));
    assert_eq!((s1(&game).x, s1(&game).y), (6.0, 10.0));
    // Food at home sets it going.
    let h1 = game.world.buildings.iter_mut().find(|b| b.id == "h1").unwrap();
    h1.stock = Some([(Good::Food, 8.0)].into_iter().collect());
    run_until(&mut game, 3000, |g| stock(g, "h2", Good::Food) == 8.0);
}

#[test]
fn the_crew_stays_fed_from_the_food_kept_aboard() {
    let mut game = game();
    game.fed = false;
    for c in ["c1", "c2", "c3", "w1"] {
        game.r_mut(c).carried.clear();
    }
    let h1 = game.world.buildings.iter_mut().find(|b| b.id == "h1").unwrap();
    h1.stock = Some([(Good::Food, 400.0)].into_iter().collect());
    let h2 = game.world.buildings.iter_mut().find(|b| b.id == "h2").unwrap();
    h2.stock = Some([(Good::IronOre, 5000.0)].into_iter().collect());
    assert_eq!(haul(&mut game, &["food"], &["ironOre"], 40.0), "ack");
    // Three game days of back and forth: Food out, ore home, 40 Food kept aboard for the crew and
    // topped up at home each time; nobody keeps them fed but what they eat.
    game.run((3.0 * TICKS_PER_GAME_DAY) as usize);
    for c in ["c1", "c2", "c3"] {
        let r = game.r(c);
        assert!(r.hunger > 0.0, "{c} starves: hunger {}", r.hunger);
        assert_eq!(r.aboard.as_deref(), Some("s1"), "{c}");
    }
    assert!(held(&s1(&game).load, Good::Food) > 0.0, "Food stays aboard for the crew");
}

#[test]
fn needs_enough_crew_aboard_and_havens_as_stops() {
    let mut game = game();
    let fail = |game: &mut Game, x: i32, y: i32| {
        let order = json!({
            "kind": "haul", "residentId": "w1", "vesselId": "s1", "x": x, "y": y,
            "goods": ["food"], "returnGoods": [], "keepFood": 0
        });
        game.order(7, order)
    };
    assert_eq!(fail(&mut game, 22, 10), "a ship's stops are havens");
    game.world.vessels[0].crew_ids.pop();
    assert_eq!(fail(&mut game, 19, 10), "the ship needs 1 more crew aboard to sail");
}

#[test]
fn the_haul_task_sails_a_ship_given_as_its_carriage() {
    let mut game = game();
    let task = json!({
        "kind": "task", "task": "haul", "residentId": "w1", "carriageId": "s1",
        "x": 19, "y": 10, "goods": ["food"], "keepFood": 0
    });
    assert_eq!(game.order(7, task), "ack");
    run_until(&mut game, 3000, |g| stock(g, "h2", Good::Food) == 30.0);
    assert!(matches!(game.r("w1").order, Some(ResidentOrder::HaulByWater(_))));
    assert!(game.r("w1").script.is_some(), "the Haul default still runs");
}
