//! Haul routes by water (`CONTEXT.md`: Haul route by water, T91.5): a rower rows a boat between
//! two stops on land, shore tiles or a haven, getting off at each to load and unload it by hand
//! from beside it, as a carriage's driver does at a stop.

use csp_shared::terrain::{is_water, terrain_at};
use csp_shared::world::{
    BuildingKind, Good, HaulPhase, HaulStop, Pile, ResidentOrder, Stock, VesselKind,
};
use serde_json::{json, Value};

use crate::game_test_world::Game;
use crate::movement_test_world::building;
use crate::queries::names::held;
use crate::rowing::tests::{game_on, lake, v1};

/// The lake of the rowing tests: w1, p1 and p2 on the west shore at (1, 4), the boat v1 on the
/// water beside them at (2, 4). The east shore is x = 16, round the headland at x = 9.
fn game() -> Game {
    game_on(lake(), (1.0, 4.0), (2.0, 4.0))
}

fn pile(game: &mut Game, id: &str, (x, y): (f64, f64), goods: &[(Good, f64)]) {
    let goods: Stock = goods.iter().copied().collect();
    game.world.piles.push(Pile { id: id.into(), x, y, goods });
}

/// Units of a good lying on the ground at (x, y).
fn on_ground(game: &Game, (x, y): (f64, f64), good: Good) -> f64 {
    game.world.piles.iter().filter(|p| p.x == x && p.y == y).map(|p| held(&p.goods, good)).sum()
}

fn haul(game: &mut Game, to: (i32, i32), goods: &[&str], back: &[&str]) -> String {
    let order = json!({
        "kind": "haul", "residentId": "w1", "vesselId": "v1", "x": to.0, "y": to.1,
        "goods": goods, "returnGoods": back, "keepFood": 0
    });
    game.order(7, order)
}

fn route(game: &Game) -> &csp_shared::world::WaterHaulOrder {
    match &game.r("w1").order {
        Some(ResidentOrder::HaulByWater(o)) => o,
        o => panic!("w1 is on no haul route by water: {o:?}"),
    }
}

/// Ticks the game until `done`, at most `max` ticks, the boat on water all the while; the ticks.
fn run_until(game: &mut Game, max: usize, done: impl Fn(&Game) -> bool) -> usize {
    for t in 0..max {
        if done(game) {
            return t;
        }
        game.tick();
        let v = v1(game);
        assert!(is_water(terrain_at(&game.terrain, v.x as i32, v.y as i32)), "the boat on land");
    }
    panic!("not done after {max} ticks");
}

#[test]
fn hauls_across_the_lake_between_two_shore_tiles_and_waits_for_more() {
    let mut game = game();
    pile(&mut game, "p-west", (1.0, 4.0), &[(Good::Wood, 20.0)]);
    assert_eq!(haul(&mut game, (16, 4), &["wood"], &[]), "ack");
    assert_eq!((route(&game).stop, route(&game).phase), (HaulStop::From, HaulPhase::Loading));
    // Loaded from the pile beside the boat, rowed round the headland and unloaded onto the shore.
    let mut rowed = false;
    run_until(&mut game, 3000, |g| {
        on_ground(g, (16.0, 4.0), Good::Wood) == 20.0
            && route(g).stop == HaulStop::From
            && route(g).phase == HaulPhase::Loading
            && g.r("w1").aboard.is_none()
    });
    for _ in 0..30 {
        game.tick();
        rowed |= route(&game).phase == HaulPhase::Driving;
    }
    assert_eq!(on_ground(&game, (1.0, 4.0), Good::Wood), 0.0);
    assert_eq!(held(&v1(&game).load, Good::Wood), 0.0);
    // Back at the first stop with nothing there to load, it waits ashore.
    assert!(!rowed, "it waits with no goods to load");
    assert_eq!((game.r("w1").x, game.r("w1").y), (1.0, 4.0));
    assert_eq!(v1(&game).rower_id, None, "ashore, the rower has left the oars");
    // More goods at the first stop go across too.
    pile(&mut game, "p-more", (1.0, 4.0), &[(Good::Wood, 5.0)]);
    run_until(&mut game, 3000, |g| on_ground(g, (16.0, 4.0), Good::Wood) == 25.0);
}

#[test]
fn hauls_between_a_shore_and_a_haven_both_ways() {
    let mut game = game();
    // Like a stable it has no owner: anyone at it loads and unloads (`CONTEXT.md`: Haven).
    let mut haven = building("h1", BuildingKind::Haven, 16.0, 3.0);
    haven.stock = Some([(Good::Stone, 12.0)].into_iter().collect());
    game.world.buildings.push(haven);
    pile(&mut game, "p-west", (1.0, 4.0), &[(Good::Wood, 10.0)]);
    // (16, 4) is the haven's west column, beside the water at (15, 4).
    assert_eq!(haul(&mut game, (16, 4), &["wood"], &["stone"]), "ack");
    let stock = |g: &Game, good: Good| {
        let h = g.world.buildings.iter().find(|b| b.id == "h1").expect("the haven");
        h.stock.as_ref().map_or(0.0, |s| held(s, good))
    };
    // Wood goes into the haven's storage; its Stone comes back to the pile on the west shore.
    run_until(&mut game, 4000, |g| {
        stock(g, Good::Wood) == 10.0 && on_ground(g, (1.0, 4.0), Good::Stone) == 12.0
    });
    assert_eq!(stock(&game, Good::Stone), 0.0);
    assert_eq!(on_ground(&game, (1.0, 4.0), Good::Wood), 0.0);
}

#[test]
fn the_rower_gets_off_at_each_stop_and_rows_at_the_oars_between() {
    let mut game = game();
    pile(&mut game, "p-west", (1.0, 4.0), &[(Good::Wood, 4.0)]);
    assert_eq!(haul(&mut game, (16, 4), &["wood"], &[]), "ack");
    run_until(&mut game, 200, |g| route(g).phase == HaulPhase::Driving);
    // Leaving, they board and take the oars; the boat heads for the water beside the other stop.
    assert_eq!(game.r("w1").aboard.as_deref(), Some("v1"));
    assert_eq!(v1(&game).rower_id.as_deref(), Some("w1"));
    let water = route(&game).water.expect("a water tile to row to");
    assert_eq!((water.x, water.y), (15.0, 4.0));
    // There they get off onto the stop, beside the boat, and unload.
    run_until(&mut game, 2000, |g| route(g).stop == HaulStop::To && g.r("w1").aboard.is_none());
    assert_eq!((game.r("w1").x, game.r("w1").y), (16.0, 4.0));
    assert_eq!((v1(&game).x, v1(&game).y), (15.0, 4.0));
    assert!(game.r("w1").skills.get(&csp_shared::world::SkillName::Seafaring).is_some());
}

#[test]
fn ends_when_the_boat_is_rowed_away_from_the_stop() {
    let mut game = game();
    assert_eq!(haul(&mut game, (16, 4), &["wood"], &[]), "ack");
    game.tick();
    // Nothing to load: it waits, until p1 rows the boat off.
    let row = json!({"kind": "row", "residentId": "p1", "vesselId": "v1", "x": 5, "y": 5});
    assert_eq!(game.order(7, row), "ack");
    run_until(&mut game, 50, |g| g.r("w1").order.is_none());
}

fn refusal(game: &mut Game, order: Value) -> String {
    let mut order = order;
    let o = order.as_object_mut().expect("an order");
    for (k, v) in [
        ("kind", json!("haul")),
        ("residentId", json!("w1")),
        ("goods", json!(["wood"])),
        ("keepFood", json!(0)),
    ] {
        o.entry(k).or_insert(v);
    }
    game.order(7, order)
}

#[test]
fn refuses_stops_a_boat_cant_serve_and_rowers_who_cant_row() {
    let mut game = game();
    // A vessel's id given as the carriage hauls by water too (a script's `haul(boat, …)`).
    let ok = json!({"carriageId": "v1", "x": 16, "y": 4});
    // A tile with no water beside it, water itself, or the tile they stand on.
    let far = json!({"vesselId": "v1", "x": 16, "y": 14});
    assert_eq!(refusal(&mut game, far), "no free water beside that tile");
    let water = json!({"vesselId": "v1", "x": 5, "y": 5});
    assert_eq!(refusal(&mut game, water), "a stop must be a shore tile or a haven");
    let here = json!({"vesselId": "v1", "x": 1, "y": 4});
    assert_eq!(refusal(&mut game, here), "the other stop must be another tile");
    // Food kept that doesn't fit on the boat.
    let heavy = json!({"vesselId": "v1", "x": 16, "y": 4, "keepFood": 100000});
    assert_eq!(
        refusal(&mut game, heavy),
        "the Food kept for the rower must be whole units that fit on the boat"
    );
    // Not to an army.
    let army = json!({"vesselId": "v1", "armyId": "a1"});
    assert_eq!(refusal(&mut game, army), "a boat hauls between stops on land, not to an army");
    // A ship is sailed, not rowed (T91.4 brings its haul route).
    game.world.vessels[0].kind = VesselKind::Ship;
    assert_eq!(refusal(&mut game, ok.clone()), "a ship is sailed, not rowed");
    game.world.vessels[0].kind = VesselKind::Boat;
    // Aboard, the route can't start: it starts on the shore.
    assert_eq!(
        game.order(7, json!({"kind": "board", "residentId": "w1", "vesselId": "v1"})),
        "ack"
    );
    assert_eq!(
        refusal(&mut game, ok.clone()),
        "the route starts on the shore beside the boat: get off first"
    );
    assert_eq!(game.order(7, json!({"kind": "getOff", "residentId": "w1"})), "ack");
    // Away from the boat, they can't row it.
    game.r_mut("w1").x = 0.0;
    assert_eq!(refusal(&mut game, ok.clone()), "that boat is not beside the resident");
    game.r_mut("w1").x = 1.0;
    assert_eq!(refusal(&mut game, ok), "ack");
    assert!(matches!(game.r("w1").order, Some(ResidentOrder::HaulByWater(_))));
}

#[test]
fn the_haul_task_rows_a_boat_given_as_its_carriage() {
    let mut game = game();
    pile(&mut game, "p-west", (1.0, 4.0), &[(Good::Wood, 6.0)]);
    let task = json!({
        "kind": "task", "task": "haul", "residentId": "w1", "carriageId": "v1",
        "x": 16, "y": 4, "goods": ["wood"], "keepFood": 0
    });
    assert_eq!(game.order(7, task), "ack");
    run_until(&mut game, 3000, |g| on_ground(g, (16.0, 4.0), Good::Wood) == 6.0);
    assert!(matches!(game.r("w1").order, Some(ResidentOrder::HaulByWater(_))));
    assert!(game.r("w1").script.is_some(), "the Haul default still runs");
}
