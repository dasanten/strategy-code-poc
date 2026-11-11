//! `posts-supplied.test.ts` (#1038): trading posts stay supplied with nobody interfering
//! (`CONTEXT.md`: Stock floor, Wandering trader; ADR 0023). Nothing tops up their warehouses, so
//! all they hold comes by caravan and trader, and those carriages' crews eat from the same
//! storages as the posts' people.

use std::sync::Arc;

use csp_shared::balance::{AVERAGE_HORSE_STATS, WAREHOUSE_FLOOR};
use csp_shared::goods::WEAPONS;
use csp_shared::terrain::{tile_index, Terrain};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, ResourceKind, ResourceNode};

use super::found_trading_post;
use crate::caravans::place_caravans;
use crate::goods_made::tally_goods;
use crate::invariants::{check_all, goods_only_from_nothing_at_the_floor};
use crate::queries::names::held;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::traders::place_traders;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const SIZE: i32 = 640;
const MID: i32 = SIZE / 2;
/// How long the world runs: about ten times round the loop of this small map.
const DAYS: usize = 30;
/// Game days the traders get to go round once before the posts are held to anything.
const SETTLE_DAYS: usize = 5;

#[test]
#[ignore = "48.5 s alone; see #1132"]
fn hold_food_weapons_and_coins_over_many_game_days_and_their_people_do_not_starve() {
    // `posts()`: the HQ in the middle of an open map with its nodes beside it, and a post at each
    // corner of a square round it, with no node of its own.
    let mut terrain = plains(SIZE);
    let nodes = [
        (ResourceKind::Forest, MID + 80, MID),
        (ResourceKind::Stone, MID + 80, MID + 12),
        (ResourceKind::IronOre, MID + 88, MID - 12),
        (ResourceKind::GoldOre, MID + 96, MID),
    ];
    for (kind, x, y) in nodes {
        let t = if kind == ResourceKind::Forest { Terrain::Forest } else { Terrain::Hills };
        terrain.tiles[tile_index(SIZE, x, y)] = t as u8;
    }
    let mut world = create_world(&terrain, 1);
    world.nodes = nodes
        .iter()
        .enumerate()
        .map(|(i, &(kind, x, y))| ResourceNode {
            id: format!("n{i}"),
            kind,
            x: x as f64,
            y: y as f64,
        })
        .collect();
    let mut m = Mulberry32::new(11.0);
    found_trade_org_hq(&mut world, &terrain, MID, MID, &mut || m.next());
    let sites = [
        (MID - 180, MID - 180),
        (MID + 180, MID - 180),
        (MID + 180, MID + 180),
        (MID - 180, MID + 180),
    ];
    let posts: Vec<String> = sites
        .into_iter()
        .map(|(x, y)| found_trading_post(&mut world, &terrain, x, y, None, &mut || m.next()))
        .collect();
    place_caravans(&mut world);
    place_traders(&mut world, SIZE);
    for h in &mut world.horses {
        h.stats.speed = AVERAGE_HORSE_STATS.speed;
        h.stats.strength = AVERAGE_HORSE_STATS.strength;
        h.stats.endurance = AVERAGE_HORSE_STATS.endurance;
    }

    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let people = |w: &csp_shared::world::WorldState| -> Vec<usize> {
        posts
            .iter()
            .map(|p| {
                w.residents.iter().filter(|r| r.city_id.as_deref() == Some(p.as_str())).count()
            })
            .collect()
    };
    let born = people(&world);
    let floor = |g: &str| WAREHOUSE_FLOOR.get(g).unwrap_or(0.0);
    for day in 1..=DAYS {
        let before = tally_goods(&world);
        scratch.made.take();
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        }
        let made = scratch.made.take();
        assert_eq!(
            goods_only_from_nothing_at_the_floor(&before, &world, &made),
            vec![],
            "day {day}"
        );
        assert_eq!(check_all(&world, &terrain), [], "day {day}");
        assert_eq!(people(&world), born, "day {day}");
        if day < SETTLE_DAYS {
            continue;
        }
        for post in &posts {
            let warehouse = world
                .buildings
                .iter()
                .find(|b| {
                    b.kind == BuildingKind::Warehouse && b.city_id.as_deref() == Some(post.as_str())
                })
                .unwrap();
            let stock = warehouse.stock.clone().unwrap_or_default();
            assert!(held(&stock, Good::Food) >= floor("food"), "day {day}, {post}: {stock:?}");
            assert!(held(&stock, Good::Coins) >= floor("coins"), "day {day}, {post}: {stock:?}");
            let weapons: f64 = WEAPONS
                .iter()
                .map(|w| held(&stock, serde_json::from_value(serde_json::json!(w)).unwrap()))
                .sum();
            assert!(weapons > 0.0, "day {day}, {post}: no weapons");
        }
    }
}
