//! `waiting-for-food.test.ts`'s slow simulation with caravans (#1038). Its other slow simulation
//! and its traders' cases need `placeTraders`, which comes with `traders.ts`; the file's other
//! cases are not ported yet.

use std::sync::Arc;

use csp_shared::balance::{AVERAGE_HORSE_STATS, FOOD_PER_DAY, HQ_PEOPLE_FOOD_DAYS};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Good, Stock};

use super::*;
use crate::invariants::check_all;
use crate::queries::carriages::crew_ids_of;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trading_posts::found_trading_post;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const SIZE: i32 = 1024;
const HQ: i32 = 128;
/// A post this many tiles from the HQ: a few game days' drive, so hunger shows on the way.
const LEG: i32 = 600;

#[test]
#[ignore = "timed in the PR"]
fn a_waiting_horse_doesnt_go_down_nor_the_hqs_people_go_hungry_for_it() {
    // `world({ posts: 3 })`: the HQ and three posts `LEG` tiles east of it, with their caravans.
    let terrain = plains(SIZE);
    let mut w = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let hq = found_trade_org_hq(&mut w, &terrain, HQ, HQ, &mut || m.next());
    for i in 0..3 {
        found_trading_post(&mut w, &terrain, HQ + LEG, HQ + i * 80, None, &mut || m.next());
    }
    place_caravans(&mut w);
    for h in &mut w.horses {
        h.stats.speed = AVERAGE_HORSE_STATS.speed;
        h.stats.strength = AVERAGE_HORSE_STATS.strength;
        h.stats.endurance = AVERAGE_HORSE_STATS.endurance;
    }
    let storage = hq_end(&w).storage.unwrap();
    let goods = hq_end(&w).warehouse.unwrap();

    // The storage holds only what the HQ's own people are left, so no carriage gets more than a
    // ration (`peopleKeep`).
    let crew: std::collections::HashSet<String> =
        w.caravans.iter().flat_map(|c| crew_ids_of(c.driver_id.as_deref(), &c.escort_ids)).collect();
    let people = w
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(hq.as_str()) && !crew.contains(&r.id))
        .count();
    let keep = people as f64 * FOOD_PER_DAY * HQ_PEOPLE_FOOD_DAYS;
    w.buildings[storage].stock = Some(Stock::from([(Good::Food, keep)]));

    // No Food in the warehouse, so they stand and wait, on what the farms bring.
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for _ in 0..6 * TICKS_PER_GAME_DAY as usize {
        step_world(&mut w, &terrain, &mut scratch, Some(&mut walking), None);
        w.buildings[goods].stock.get_or_insert_with(Stock::new).insert(Good::Food, 0.0);
    }
    for c in &w.caravans {
        let k = w.carriages.iter().find(|k| k.id == c.carriage_id).unwrap();
        let h = w.horses.iter().find(|h| Some(&h.id) == k.horse_id.as_ref()).unwrap();
        assert_eq!(h.down_until, None, "{}'s horse is down", c.id);
    }
    let hungry: Vec<&String> = w
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(hq.as_str()) && !crew.contains(&r.id) && r.hunger < 20.0)
        .map(|r| &r.id)
        .collect();
    assert_eq!(hungry, Vec::<&String>::new());
    assert_eq!(check_all(&w, &terrain), []);
}
