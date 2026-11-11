//! `caravans.test.ts`: so far only its slow simulation (#1038), a caravan's round trip. The
//! file's other cases are not ported yet.

use std::sync::Arc;

use csp_shared::balance::{CARAVAN_SPREAD, WAREHOUSE_FLOOR};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{CaravanStop, Good, Heading, Stock, WorldState};

use super::*;
use crate::invariants::check_all;
use crate::queries::names::held;
use crate::queries::warehouse::stock_floor;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trading_posts::found_trading_post;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

/// Every unit of a good in the world: in buildings, on carriages, carried and on the ground.
fn total(world: &WorldState, g: Good) -> f64 {
    let b: f64 = world.buildings.iter().filter_map(|b| b.stock.as_ref()).map(|s| held(s, g)).sum();
    let k: f64 = world.carriages.iter().map(|k| held(&k.load, g)).sum();
    let r: f64 = world.residents.iter().map(|r| held(&r.carried, g)).sum();
    let p: f64 = world.piles.iter().map(|p| held(&p.goods, g)).sum();
    b + k + r + p
}

#[test]
fn carry_stock_from_the_hq_to_the_post_and_back_evening_out_with_the_escort_along() {
    let terrain = plains(512);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    found_trade_org_hq(&mut world, &terrain, 128, 128, &mut || m.next());
    let post = found_trading_post(&mut world, &terrain, 320, 320, None, &mut || m.next());
    place_caravans(&mut world);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let post_wh = route_end(&world, &post, Heading::Post).warehouse.unwrap();
    let hq_wh = route_end(&world, &post, Heading::Hq).warehouse.unwrap();
    // Wood and coins stay above the stock floor, so the floor adds none of them on the way. Every
    // other good stands at the HQ's floor in both, spears ten times that for the army it arms:
    // nothing runs short, so neither city's own chain uses up wood, and nothing else needs
    // evening out.
    let floor = stock_floor(&world, &world.buildings[hq_wh]);
    let mut kept: Stock = floor.clone();
    kept.insert(Good::Spear, 10.0 * held(&floor, Good::Spear));
    let mut at_post = kept.clone();
    at_post.insert(Good::Coins, 2_000.0);
    at_post.insert(Good::Wood, 30.0);
    at_post.insert(Good::Iron, WAREHOUSE_FLOOR.get("iron").unwrap());
    world.buildings[post_wh].stock = Some(at_post);
    let mut at_hq = kept;
    at_hq.insert(Good::Wood, 300.0);
    at_hq.insert(Good::Iron, 100.0);
    world.buildings[hq_wh].stock = Some(at_hq);
    let wood = total(&world, Good::Wood);
    let carriage_id = world.caravans[0].carriage_id.clone();
    let (mut reached_post, mut back, mut farthest) = (false, false, 0f64);
    let mut t = 0;
    while t < 12_000 && !back {
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        let c = world.caravans[0].clone();
        let k = world.carriages.iter().find(|k| k.id == carriage_id).unwrap();
        if c.stop == CaravanStop::Warehouse || c.heading == Heading::Post {
            for id in &c.escort_ids {
                let r = world.residents.iter().find(|x| &x.id == id).unwrap();
                let d =
                    wrap_distance(terrain.size, (r.x as i32, r.y as i32), (k.x as i32, k.y as i32));
                farthest = farthest.max(d);
            }
        }
        if t % 500 == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
        let post_wood =
            world.buildings[post_wh].stock.as_ref().map_or(0.0, |s| held(s, Good::Wood));
        if c.heading == Heading::Hq && post_wood > 30.0 {
            reached_post = true;
        }
        back = reached_post && c.heading == Heading::Post && c.stop == CaravanStop::Storage;
        t += 1;
    }
    assert!(reached_post);
    assert!(back);
    // The post got about half the difference in wood and iron; nothing was made or lost.
    let at_post = world.buildings[post_wh].stock.clone().unwrap();
    assert!(held(&at_post, Good::Wood) > 100.0);
    assert!(held(&at_post, Good::Iron) > 0.0);
    assert_eq!(held(&at_post, Good::Coins), 2_000.0);
    assert_eq!(total(&world, Good::Wood), wood);
    // Moving its own stock between its warehouses is no theft.
    assert_eq!(world.crimes, vec![]);
    // The escort walked along: never far from the carriage on the way.
    assert!(farthest <= CARAVAN_SPREAD + 2.0, "{farthest}");
    // The crew and horse ate from what the caravan carries; nobody starved.
    let c = &world.caravans[0];
    let crew: Vec<&String> = c.driver_id.iter().chain(&c.escort_ids).collect();
    assert!(crew.iter().all(|id| world.residents.iter().any(|r| &&r.id == id)));
    assert!(world.cities.iter().any(|c| c.id == post));
    assert_eq!(check_all(&world, &terrain), []);
}
