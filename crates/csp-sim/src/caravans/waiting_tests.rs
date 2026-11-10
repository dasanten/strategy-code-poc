//! `waiting-for-food.test.ts`'s slow simulations (#1038). The file's other cases are not ported
//! yet.

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
#[ignore = "30.5 s alone; see #1092"]
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
    let crew: std::collections::HashSet<String> = w
        .caravans
        .iter()
        .flat_map(|c| crew_ids_of(c.driver_id.as_deref(), &c.escort_ids))
        .collect();
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
        .filter(|r| {
            r.city_id.as_deref() == Some(hq.as_str()) && !crew.contains(&r.id) && r.hunger < 20.0
        })
        .map(|r| &r.id)
        .collect();
    assert_eq!(hungry, Vec::<&String>::new());
    assert_eq!(check_all(&w, &terrain), []);
}

#[test]
#[ignore = "88.7 s alone; see #1092"]
fn its_carriages_wait_then_leave_with_enough_nobody_goes_down_on_the_first_legs_and_supply_goes_on()
{
    use crate::queries::city::town_hall_of;
    use crate::queries::names::{held, placed};
    use crate::queries::residents::is_down;
    use crate::traders::place_traders;
    use csp_shared::balance::CARAVAN_ESCORTS;
    use csp_shared::footprint::middle_of;

    let terrain = plains(SIZE);
    let mut w = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let hq = found_trade_org_hq(&mut w, &terrain, HQ, HQ, &mut || m.next());
    let posts: Vec<String> = [0, 160, 320, 480]
        .into_iter()
        .map(|dy| found_trading_post(&mut w, &terrain, HQ + LEG, HQ + dy, None, &mut || m.next()))
        .collect();
    place_caravans(&mut w);
    place_traders(&mut w, SIZE);
    for h in &mut w.horses {
        h.stats.speed = AVERAGE_HORSE_STATS.speed;
        h.stats.strength = AVERAGE_HORSE_STATS.strength;
        h.stats.endurance = AVERAGE_HORSE_STATS.endurance;
    }
    let storage = hq_end(&w).storage.unwrap();
    // Far too little for eight carriages and everyone at the HQ.
    w.buildings[storage].stock = Some(Stock::from([(Good::Food, 90.0)]));
    // Gold ore a post's hands neither dig nor spend: what it holds came by carriage.
    let warehouses: Vec<usize> = posts.iter().map(|p| post_end(&w, p).warehouse.unwrap()).collect();
    for &b in &warehouses {
        w.buildings[b].stock.get_or_insert_with(Stock::new).insert(Good::GoldOre, 0.0);
    }
    // Every convoy by id, its carriage and its crew.
    let convoys: Vec<(String, String, Vec<String>)> = w
        .caravans
        .iter()
        .map(|c| {
            (
                c.id.clone(),
                c.carriage_id.clone(),
                crew_ids_of(c.driver_id.as_deref(), &c.escort_ids),
            )
        })
        .chain(w.traders.iter().map(|t| {
            (
                t.id.clone(),
                t.carriage_id.clone(),
                crew_ids_of(t.driver_id.as_deref(), &t.escort_ids),
            )
        }))
        .collect();
    let hq_city = w.cities.iter().find(|c| c.id == hq).unwrap().clone();
    let hall = middle_of(placed(town_hall_of(&w, &hq_city).unwrap()), SIZE);
    let mut seen: std::collections::HashMap<String, f64> = Default::default();
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for _day in 1..=15 {
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            step_world(&mut w, &terrain, &mut scratch, Some(&mut walking), None);
            // The Food on board when a carriage first leaves the HQ's area (`leftWith`).
            for (id, carriage, _) in &convoys {
                let k = w.carriages.iter().find(|k| &k.id == carriage).unwrap();
                let away = (k.x - f64::from(hall.0)).hypot(k.y - f64::from(hall.1)) > 60.0;
                if away && !seen.contains_key(id) {
                    seen.insert(id.clone(), held(&k.load, Good::Food));
                }
            }
        }
        assert_eq!(check_all(&w, &terrain), []);
        let crew_down: Vec<&String> = convoys
            .iter()
            .flat_map(|c| c.2.iter())
            .filter(|id| w.residents.iter().any(|r| &&r.id == id && is_down(r.down_until)))
            .collect();
        assert_eq!(crew_down, Vec::<&String>::new());
        let horses_down: Vec<&String> =
            w.horses.iter().filter(|h| h.down_until.is_some()).map(|h| &h.id).collect();
        assert_eq!(horses_down, Vec::<&String>::new());
    }
    // All of them got away in the end, none of them short for the way.
    assert_eq!(seen.len(), convoys.len());
    let enough = food_for_way(CARAVAN_ESCORTS, f64::from(LEG), 0.0) - 2.0;
    for (id, _, _) in &convoys {
        assert!(seen[id] >= enough, "{id} left with {}", seen[id]);
    }
    // And every post got what only a carriage brings it.
    for &b in &warehouses {
        assert!(w.buildings[b].stock.as_ref().is_some_and(|s| held(s, Good::GoldOre) > 0.0));
    }
}
