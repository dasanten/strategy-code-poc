//! Rowing (`CONTEXT.md`: Rowing, Seafaring, No ferrying by itself, Vessels in sight, T90.4): a
//! grown resident aboard or beside a boat of their realm rows it a Step at a time over water,
//! carrying everyone aboard, faster with Strength and Seafaring, which rowing teaches.

use csp_shared::balance::{
    BOAT_CAPACITY, LIFESPAN_MAX, OWN_FOOD, PASSENGER_WEIGHT, SIGHT_RANGE, WALK_TICKS_PER_TILE,
};
use csp_shared::terrain::{is_water, terrain_at, tile_index, Terrain, TerrainMap};
use csp_shared::world::{Good, Pile, ResidentOrder, SkillName, Stat, Stock, Vessel, VesselKind};
use serde_json::json;

use crate::game_test_world::Game;
use crate::movement_test_world::{draw, resident, world_with_realm};
use crate::queries::names::held;
use crate::queries::pace::row_speed;
use crate::queries::vessels::{vessel_passengers, vessel_room};

/// A Lake over x 2..=15, y 2..=8, with a headland of land at x = 9 from the north shore down to
/// y = 6, so a boat west of it goes round its tip to get east of it.
pub(crate) fn lake() -> TerrainMap {
    let mut rows: Vec<String> = Vec::new();
    for y in 0..20 {
        let row: String = (0..20)
            .map(|x| {
                let water = (2..=15).contains(&x) && (2..=8).contains(&y);
                let headland = x == 9 && y <= 6;
                if water && !headland {
                    '~'
                } else {
                    '.'
                }
            })
            .collect();
        rows.push(row);
    }
    let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
    draw(&rows)
}

pub(crate) fn boat(id: &str, x: f64, y: f64) -> Vessel {
    Vessel {
        id: id.into(),
        kind: VesselKind::Boat,
        realm_id: Some("r1".into()),
        x,
        y,
        load: Stock::new(),
        rower_id: None,
        crew_ids: Vec::new(),
    }
}

/// Realm r1 (Player 7) with residents w1, p1, p2 on the west shore at (1, 4), each with their own
/// food, and its empty boat v1 on the Lake at (2, 4).
pub(crate) fn game_on(map: TerrainMap, at: (f64, f64), boat_at: (f64, f64)) -> Game {
    let mut world = world_with_realm(&map);
    for id in ["w1", "p1", "p2"] {
        let mut r = resident(id, Some("r1"), at.0, at.1);
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        r.lifespan = LIFESPAN_MAX;
        world.residents.push(r);
    }
    world.vessels.push(boat("v1", boat_at.0, boat_at.1));
    Game::new(world, map)
}

fn game() -> Game {
    game_on(lake(), (1.0, 4.0), (2.0, 4.0))
}

fn row(game: &mut Game, id: &str, x: i32, y: i32) -> String {
    game.order(7, json!({"kind": "row", "residentId": id, "vesselId": "v1", "x": x, "y": y}))
}

fn board(game: &mut Game, id: &str) -> String {
    game.order(7, json!({"kind": "board", "residentId": id, "vesselId": "v1"}))
}

pub(crate) fn v1(game: &Game) -> &Vessel {
    game.world.vessels.iter().find(|v| v.id == "v1").expect("boat v1")
}

/// Ticks until w1's order is done, at most `max` ticks; the ticks taken.
pub(crate) fn until_done(game: &mut Game, id: &str, max: usize) -> usize {
    for t in 0..max {
        if game.r(id).order.is_none() {
            return t;
        }
        game.tick();
    }
    panic!("{id}'s order is still not done after {max} ticks");
}

#[test]
fn rows_across_the_lake_round_the_headland_carrying_everyone_aboard() {
    let mut game = game();
    board(&mut game, "p1");
    board(&mut game, "p2");
    // From beside it, the rower boards first and takes the oars.
    assert_eq!(row(&mut game, "w1", 12, 4), "ack");
    assert_eq!(game.r("w1").aboard.as_deref(), Some("v1"));
    assert_eq!(v1(&game).rower_id.as_deref(), Some("w1"));
    let mut seen = Vec::new();
    for _ in 0..400 {
        if game.r("w1").order.is_none() {
            break;
        }
        game.tick();
        let v = v1(&game);
        seen.push((v.x as i32, v.y as i32));
        // Everyone aboard goes along, and the boat never leaves the water.
        for id in ["w1", "p1", "p2"] {
            assert_eq!((game.r(id).x, game.r(id).y), (v.x, v.y));
        }
        assert!(is_water(terrain_at(&game.terrain, v.x as i32, v.y as i32)));
    }
    assert_eq!((v1(&game).x, v1(&game).y), (12.0, 4.0));
    assert!(seen.iter().any(|&(_, y)| y >= 7), "round the headland's tip: {seen:?}");
    assert!(seen.iter().all(|&(x, y)| !(x == 9 && y <= 6)));
}

#[test]
fn given_a_land_tile_it_goes_to_the_nearest_free_water_tile_beside_it() {
    let mut game = game();
    // (5, 9) is the south shore: of the water tiles touching it, (4, 8) is nearest the boat.
    assert_eq!(row(&mut game, "w1", 5, 9), "ack");
    until_done(&mut game, "w1", 400);
    assert_eq!((v1(&game).x, v1(&game).y), (4.0, 8.0));
    // A land tile with no water beside it is refused.
    assert_eq!(row(&mut game, "w1", 5, 15), "no free water beside that tile");
}

#[test]
fn a_rower_then_gets_off_and_walks_on() {
    let mut game = game();
    assert_eq!(row(&mut game, "w1", 15, 5), "ack");
    until_done(&mut game, "w1", 400);
    assert_eq!(game.r("w1").aboard.as_deref(), Some("v1"), "still aboard at the far shore");
    assert_eq!(
        game.order(7, json!({"kind": "walkTo", "residentId": "w1", "x": 19, "y": 5})),
        "ack"
    );
    until_done(&mut game, "w1", 200);
    let w1 = game.r("w1");
    assert_eq!((w1.x, w1.y, w1.aboard.as_deref()), (19.0, 5.0, None));
    game.run(1);
    assert_eq!(v1(&game).rower_id, None, "no longer at its oars");
}

#[test]
fn the_rower_is_no_passenger_so_three_more_fit_and_a_full_boat_still_rows() {
    let mut game = game();
    let mut extra = resident("p3", Some("r1"), 1.0, 4.0);
    extra.lifespan = LIFESPAN_MAX;
    game.world.residents.push(extra);
    assert_eq!(row(&mut game, "w1", 3, 4), "ack");
    for id in ["p1", "p2", "p3"] {
        assert_eq!(board(&mut game, id), "ack");
    }
    assert_eq!(vessel_passengers(&game.world, "v1").len(), 3);
    let left = BOAT_CAPACITY - 3.0 * PASSENGER_WEIGHT;
    assert!((vessel_room(&game.world, v1(&game)) - left).abs() < 1e-9);
    until_done(&mut game, "w1", 100);
    assert_eq!(v1(&game).x, 3.0);
    // A passenger taking the oars puts the rower among the passengers: that still fits.
    assert_eq!(row(&mut game, "p1", 4, 4), "ack");
    assert_eq!(v1(&game).rower_id.as_deref(), Some("p1"));
}

#[test]
fn only_a_grown_resident_of_its_realm_rows_it() {
    let mut game = game();
    game.r_mut("p1").born_at = game.world.tick as f64;
    assert_eq!(row(&mut game, "p1", 5, 4), "children can’t row");
    game.r_mut("w1").x = 0.0;
    assert_eq!(row(&mut game, "w1", 5, 4), "that boat is not beside the resident");
}

#[test]
fn rowing_teaches_seafaring_and_a_stronger_or_more_skilled_rower_goes_faster() {
    let mut game = game();
    assert_eq!(row(&mut game, "w1", 8, 4), "ack");
    until_done(&mut game, "w1", 200);
    let learned = game.r("w1").skills.get(&SkillName::Seafaring).copied().unwrap_or(0.0);
    assert!(learned > 0.0, "Seafaring rises");
    let tick = game.world.tick as f64;
    let mut r = game.r("p1").clone();
    let average = row_speed(&r, tick);
    assert!(average > 1.0 / WALK_TICKS_PER_TILE, "a little faster than walking on Plains");
    r.stats.strength = Stat { base: 16.0, trained: 0.0 };
    let strong = row_speed(&r, tick);
    assert!(strong > average);
    r.skills.insert(SkillName::Seafaring, 25.0);
    assert!(row_speed(&r, tick) > strong);
}

#[test]
fn a_diagonal_step_never_squeezes_between_two_land_tiles() {
    // Two ponds joined only at a corner, between two land tiles.
    let map = draw(&[
        "........", "..~~....", "..~~....", "....~~..", "....~~..", "........", "........",
        "........",
    ]);
    let mut game = game_on(map, (1.0, 1.0), (2.0, 1.0));
    assert_eq!(row(&mut game, "w1", 5, 4), "ack");
    game.run(20);
    assert_eq!((v1(&game).x, v1(&game).y), (2.0, 1.0), "no way across the corner");
    assert!(game.r("w1").order.is_none());
}

#[test]
fn a_boat_nobody_rows_stays_put_and_walking_never_uses_it() {
    let mut game = game();
    board(&mut game, "p1");
    // p2 walks to the east shore: round the Lake on land, never aboard.
    assert_eq!(
        game.order(7, json!({"kind": "walkTo", "residentId": "p2", "x": 17, "y": 4})),
        "ack"
    );
    for _ in 0..600 {
        if game.r("p2").order.is_none() {
            break;
        }
        game.tick();
        assert!(game.r("p2").aboard.is_none());
    }
    assert_eq!((game.r("p2").x, game.r("p2").y), (17.0, 4.0));
    assert_eq!((v1(&game).x, v1(&game).y), (2.0, 4.0), "never drifts");
}

#[test]
fn those_aboard_eat_as_on_plains_and_take_meals_from_the_boat() {
    let mut game = game();
    game.fed = false;
    game.world.vessels[0].load.insert(Good::Food, 6.0);
    assert_eq!(row(&mut game, "w1", 12, 8), "ack");
    game.r_mut("w1").carried = Stock::new();
    game.tick();
    // Running low with none in hand, the rower took a meal from the boat's Food.
    assert!(held(&game.r("w1").carried, Good::Food) > 0.0);
    assert!(held(&v1(&game).load, Good::Food) < 6.0);
    // Water costs food as Plains does.
    let tick = game.world.tick as f64;
    let r = game.r("p1");
    let water = crate::queries::residents::food_use(r, Terrain::Lake as u8, tick);
    let plains = crate::queries::residents::food_use(r, Terrain::Plains as u8, tick);
    assert_eq!(water, plains);
}

#[test]
fn those_aboard_see_from_the_boat() {
    use crate::sight::entities_in_sight;
    use crate::world_index::WorldIndex;
    use csp_shared::protocol::SeenEntity;
    // A long Lake: from the west shore a pile on the east shore is out of sight; from the middle
    // of the Lake it is in sight.
    let size = 320;
    let mut tiles = vec![Terrain::Plains as u8; (size * size) as usize];
    for y in 0..size {
        for x in 10..=200 {
            tiles[tile_index(size, x, y)] = Terrain::Lake as u8;
        }
    }
    let map = TerrainMap { size, tiles };
    let mut game = game_on(map, (9.0, 50.0), (10.0, 50.0));
    let far = 201.0;
    assert!(far - 9.0 > SIGHT_RANGE * 2.0 && f64::from(size) - (far - 9.0) > SIGHT_RANGE * 2.0);
    game.world.piles.push(Pile {
        id: "pile1".into(),
        x: far,
        y: 50.0,
        goods: [(Good::Stone, 3.0)].into_iter().collect(),
    });
    let sees_pile = |game: &Game| {
        let index = WorldIndex::new(&game.world, size);
        entities_in_sight(&game.world, &index, Some("r1"), None)
            .iter()
            .any(|e| matches!(e, SeenEntity::Pile(p) if p.id == "pile1"))
    };
    assert!(!sees_pile(&game));
    board(&mut game, "p1");
    // Out in the Lake, as rowing would take it.
    game.world.vessels[0].x = 160.0;
    game.r_mut("p1").x = 160.0;
    assert!(sees_pile(&game));
}

#[test]
fn the_rower_rows_and_their_order_says_so() {
    let mut game = game();
    row(&mut game, "w1", 6, 4);
    assert!(matches!(&game.r("w1").order, Some(ResidentOrder::Row(o)) if o.vessel_id == "v1"));
}
