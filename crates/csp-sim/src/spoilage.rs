//! Spoilage (`apps/server/src/spoilage.ts`, `CONTEXT.md`: Spoilage).

use csp_shared::balance::FOOD_SPOIL_PER_DAY;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Good, RealmEventWhat, Stock, WorldState};

use crate::events::record_event;
use crate::queries::names::held;

/// Spoilage (`stepSpoilage`, `CONTEXT.md`: Spoilage): at the end of each game day,
/// `FOOD_SPOIL_PER_DAY` of the Food in every place goes bad: in storages, carried by residents, on
/// carriages and in piles. Other goods keep. Goods stay whole units: the part of a unit left over
/// spoils by chance, so on average the share is exact, and the chance is drawn from the world's
/// seed so a replay matches. A pile left with nothing is gone. What a realm lost (in its cities'
/// storages, its residents' loads and its carriages) goes in its Player's log as one event.
pub fn step_spoilage(world: &mut WorldState) {
    let day = TICKS_PER_GAME_DAY as u64;
    if world.tick % day != day - 1 {
        return;
    }
    let (seed, tick) = (world.seed, world.tick);
    // By realm, in the order the realms first lost Food (a `Map`'s order).
    let mut lost: Vec<(String, f64)> = Vec::new();
    let mut spoil = |holder: &str, stock: Option<&mut Stock>, realm_id: Option<String>| {
        let Some(stock) = stock else { return };
        let food = held(stock, Good::Food);
        if food <= 0.0 {
            return;
        }
        let due = food * FOOD_SPOIL_PER_DAY;
        let extra = if chance(seed, tick, holder) < due % 1.0 { 1.0 } else { 0.0 };
        let units = food.min(due.floor() + extra);
        let left = food - units;
        if left > 0.0 {
            stock.insert(Good::Food, left);
        } else {
            stock.shift_remove(&Good::Food);
        }
        if let Some(realm_id) = realm_id {
            if units > 0.0 {
                match lost.iter_mut().find(|(id, _)| *id == realm_id) {
                    Some((_, n)) => *n += units,
                    None => lost.push((realm_id, units)),
                }
            }
        }
    };
    let city_realm: Vec<(String, Option<String>)> =
        world.cities.iter().map(|c| (c.id.clone(), c.realm_id.clone())).collect();
    for b in &mut world.buildings {
        let realm = b.city_id.as_ref().and_then(|id| {
            city_realm.iter().find(|(c, _)| c == id).and_then(|(_, realm)| realm.clone())
        });
        spoil(&b.id, b.stock.as_mut(), realm);
    }
    for r in &mut world.residents {
        spoil(&r.id, Some(&mut r.carried), r.owner.clone());
    }
    for k in &mut world.carriages {
        spoil(&k.id, Some(&mut k.load), k.realm_id.clone());
    }
    for p in &mut world.piles {
        spoil(&p.id, Some(&mut p.goods), None);
    }
    world.piles.retain(|p| p.goods.values().any(|n| *n > 0.0));
    for (realm_id, units) in lost {
        record_event(world, Some(&realm_id), RealmEventWhat::FoodSpoiled { units });
    }
}

/// A number in [0, 1) that depends only on its inputs (`chance`: FNV-1a hash of
/// `${seed}:${tick}:${id}`, then an integer mix). `for (const ch of text)` walks code points, and
/// `ch.charCodeAt(0)` is the first UTF-16 unit of each.
fn chance(seed: i64, tick: u64, id: &str) -> f64 {
    let mut h = 0x811c_9dc5_u32 as i32;
    for ch in format!("{seed}:{tick}:{id}").chars() {
        let mut units = [0u16; 2];
        let first = ch.encode_utf16(&mut units)[0];
        h = (h ^ i32::from(first)).wrapping_mul(0x0100_0193);
    }
    let mix = |h: i32| h ^ (((h as u32) >> 16) as i32);
    h = mix(h).wrapping_mul(0x045d_9f3b);
    h = mix(h).wrapping_mul(0x045d_9f3b);
    f64::from(mix(h) as u32) / 4_294_967_296.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::world::Pile;

    use crate::test_support::{same_json, world_with_city};

    /// Runs spoilage alone for some game days (`wait`).
    fn wait(world: &mut WorldState, days: f64) {
        for _ in 0..(days * TICKS_PER_GAME_DAY) as u64 {
            step_spoilage(world);
            world.tick += 1;
        }
    }

    fn storage(world: &mut WorldState) -> &mut Stock {
        let b =
            world.buildings.iter_mut().find(|b| b.kind == csp_shared::world::BuildingKind::Storage);
        b.unwrap().stock.get_or_insert_with(Stock::new)
    }

    #[test]
    fn spoils_the_balance_share_of_a_storages_food_each_game_day_and_nothing_else() {
        let (mut world, _) = world_with_city();
        let all = Stock::from([(Good::Food, 1000.0), (Good::Wood, 1000.0), (Good::Coins, 1000.0)]);
        *storage(&mut world) = all.clone();
        wait(&mut world, 0.99);
        assert_eq!(*storage(&mut world), all);
        wait(&mut world, 0.02);
        let mut spoiled = all.clone();
        spoiled.insert(Good::Food, 1000.0 - 1000.0 * FOOD_SPOIL_PER_DAY);
        assert_eq!(*storage(&mut world), spoiled);
    }

    #[test]
    fn spoils_food_carried_by_residents_and_carriages_and_in_piles() {
        let (mut world, _) = world_with_city();
        world.residents[0].carried = Stock::from([(Good::Food, 10.0), (Good::Stone, 5.0)]);
        world.carriages[0].load = Stock::from([(Good::Food, 400.0)]);
        let (x, y) = (world.residents[0].x, world.residents[0].y);
        let goods = Stock::from([(Good::Food, 400.0), (Good::Iron, 2.0)]);
        world.piles.push(Pile { id: "p1".into(), x, y, goods });
        wait(&mut world, 1.0);
        assert!(held(&world.residents[0].carried, Good::Food) <= 10.0);
        assert_eq!(held(&world.residents[0].carried, Good::Stone), 5.0);
        let left = 400.0 - 400.0 * FOOD_SPOIL_PER_DAY;
        assert_eq!(world.carriages[0].load, Stock::from([(Good::Food, left)]));
        assert_eq!(world.piles[0].goods, Stock::from([(Good::Food, left), (Good::Iron, 2.0)]));
    }

    #[test]
    fn keeps_small_stocks_in_whole_units_and_spoils_them_at_the_right_rate_on_average() {
        let (mut world, _) = world_with_city();
        for i in 0..1000 {
            world.piles.push(Pile {
                id: format!("p{i}"),
                x: f64::from(i % 300),
                y: f64::from(i / 300),
                goods: Stock::from([(Good::Food, 10.0)]),
            });
        }
        wait(&mut world, 1.0);
        let left: Vec<f64> = world.piles.iter().map(|p| held(&p.goods, Good::Food)).collect();
        assert!(left.iter().all(|n| *n == 9.0 || *n == 10.0));
        let lost = 10_000.0 - left.iter().sum::<f64>();
        assert!((lost - 10_000.0 * FOOD_SPOIL_PER_DAY).abs() < 50.0);
    }

    #[test]
    fn lets_a_pile_of_food_rot_away_entirely() {
        let (mut world, _) = world_with_city();
        let goods = Stock::from([(Good::Food, 1.0)]);
        world.piles.push(Pile { id: "p1".into(), x: 0.0, y: 0.0, goods });
        wait(&mut world, 1000.0);
        assert!(world.piles.is_empty());
    }

    #[test]
    fn spoils_the_same_way_given_the_same_seed() {
        let run = || {
            let (mut world, _) = world_with_city();
            for r in &mut world.residents {
                r.carried = Stock::from([(Good::Food, 7.0)]);
            }
            wait(&mut world, 5.0);
            world.residents.iter().map(|r| held(&r.carried, Good::Food)).collect::<Vec<_>>()
        };
        assert_eq!(run(), run());
    }

    #[test]
    fn writes_what_a_realm_lost_in_its_log() {
        let (mut world, _) = world_with_city();
        *storage(&mut world) = Stock::from([(Good::Food, 1000.0)]);
        wait(&mut world, 1.0);
        let spoiled: Vec<f64> = world
            .events
            .iter()
            .filter_map(|e| match e.what {
                RealmEventWhat::FoodSpoiled { units } => Some(units),
                _ => None,
            })
            .collect();
        assert_eq!(spoiled.len(), 1);
        assert!(spoiled[0] >= 1000.0 * FOOD_SPOIL_PER_DAY);
    }

    #[test]
    fn spoils_what_the_typescript_spoils_unit_for_unit() {
        let expected: serde_json::Value =
            serde_json::from_str(include_str!("residents/expected.json")).expect("expected.json");
        for case in expected["spoiled"].as_array().unwrap() {
            let want = &case["world"];
            let (mut world, _) = world_with_city();
            world.seed = case["seed"].as_i64().unwrap();
            world.tick = 3 * TICKS_PER_GAME_DAY as u64 - 1;
            world.next_id = 10;
            world.events.clear();
            world.realms.truncate(1);
            world.realms[0].id = "realm1".into();
            world.cities.truncate(1);
            world.cities[0].id = "city1".into();
            world.cities[0].realm_id = Some("realm1".into());
            world.buildings.truncate(1);
            world.buildings[0].id = "b1".into();
            world.buildings[0].city_id = Some("city1".into());
            world.buildings[0].stock = Some(Stock::from([(Good::Food, 337.0), (Good::Wood, 4.0)]));
            let template = world.residents[0].clone();
            world.residents = (0..20)
                .map(|i| {
                    let mut r = template.clone();
                    r.id = format!("r{i}");
                    r.owner = (i % 2 == 1).then(|| "realm1".to_string());
                    r.carried = Stock::from([(Good::Food, f64::from(i))]);
                    r
                })
                .collect();
            world.carriages.truncate(1);
            world.carriages[0].id = "k1".into();
            world.carriages[0].realm_id = Some("realm1".into());
            world.carriages[0].load = Stock::from([(Good::Food, 55.0)]);
            world.piles = (0..30)
                .map(|i| Pile {
                    id: format!("pile{i}"),
                    x: f64::from(i),
                    y: 0.0,
                    goods: Stock::from([(Good::Food, f64::from(i % 7 + 1))]),
                })
                .collect();
            step_spoilage(&mut world);
            let seed = &case["seed"];
            assert!(same_json(&world.piles, &want["piles"]), "seed {seed}");
            assert!(same_json(&world.events, &want["events"]), "seed {seed}");
            assert!(same_json(&world.buildings[0].stock, &want["buildings"][0]["stock"]));
            assert!(same_json(&world.carriages[0].load, &want["carriages"][0]["load"]));
            for (r, w) in world.residents.iter().zip(want["residents"].as_array().unwrap()) {
                assert!(same_json(&r.carried, &w["carried"]), "{}", r.id);
            }
        }
    }

    // "keeps the invariants over a game day" and "reports goods held in part units"
    // (`goods-in-whole-units`) come with the step and the invariants (T86.13, T86.14).
}
