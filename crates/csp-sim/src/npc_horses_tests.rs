//! `npc-horses.test.ts`'s slow simulations (#1038): an NPC village's horses over many game days.
//! The file's other cases are not ported yet.

use csp_shared::balance::{NPC_START_HORSES, NPC_START_HORSE_FOOD_DAYS, OWN_FOOD};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, BuildingKind, Good, Stock, WorldState};
use serde_json::{json, Value};

use crate::invariants::check_all;
use crate::npc_cities::give_npc_horses;
use crate::npc_test_world::{village, Runner};
use crate::queries::horses::{owns_horse, HorseOwner};
use crate::queries::npc_trade::npc_horses_wanted;

fn horses_of(world: &WorldState, city: &str) -> usize {
    world.horses.iter().filter(|h| owns_horse(HorseOwner::City(city), h)).count()
}

/// Runs the world with the invariants checked every game day (`run`).
fn run(world: &mut WorldState, terrain: &TerrainMap, ticks: usize, mut each: impl FnMut(&mut WorldState)) {
    let mut runner = Runner::new(terrain);
    for _ in 0..ticks {
        runner.step(world, terrain);
        each(world);
        if world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            assert_eq!(check_all(world, terrain), []);
        }
    }
    assert_eq!(check_all(world, terrain), []);
}

fn feed_everyone(world: &mut WorldState, storage_food: f64, city: &str) {
    let si = world
        .buildings
        .iter()
        .position(|b| b.city_id.as_deref() == Some(city) && b.kind == BuildingKind::Storage)
        .unwrap();
    world.buildings[si].stock = Some(Stock::from([(Good::Food, storage_food)]));
    for r in &mut world.residents {
        r.carried.insert(Good::Food, OWN_FOOD);
    }
}

#[test]
#[ignore = "timed in the PR"]
fn takes_its_time_from_a_village_with_no_wood_at_all_and_the_food_by_them_lasts() {
    let mut v = village(None);
    give_npc_horses(&mut v.world, &v.terrain, &v.city);
    feed_everyone(&mut v.world, 1000.0, &v.city);
    let city = v.city.clone();
    let mut up_at: Option<u64> = None;
    let ticks = (NPC_START_HORSE_FOOD_DAYS * TICKS_PER_GAME_DAY) as usize;
    run(&mut v.world, &v.terrain, ticks, |w| {
        let s = w
            .buildings
            .iter()
            .find(|b| b.kind == BuildingKind::Stable && b.city_id.as_deref() == Some(city.as_str()));
        if up_at.is_none() && s.is_some_and(|s| s.site.is_none()) {
            up_at = Some(w.tick);
        }
    });
    assert!(up_at.is_some());
    assert!(horses_of(&v.world, &city) as f64 >= NPC_START_HORSES);
}

fn breeders(world: &WorldState) -> usize {
    world
        .residents
        .iter()
        .filter(|r| {
            let s = serde_json::to_value(&r.script).unwrap();
            s["scriptId"] == json!(0) && s["task"] == Value::from("breed")
        })
        .count()
}

#[test]
#[ignore = "timed in the PR"]
fn stops_at_the_number_it_wants() {
    // `stabled`: a village with its two horses in a finished stable with plenty of Food, and a
    // full storage.
    let mut v = village(None);
    give_npc_horses(&mut v.world, &v.terrain, &v.city);
    let city = v.city.clone();
    let h = v.world.horses.iter().find(|h| owns_horse(HorseOwner::City(&city), h)).unwrap();
    let stable: Building = serde_json::from_value(json!({
        "id": "stable1", "kind": "stable", "cityId": city, "x": h.x - 1.0, "y": h.y - 1.0,
        "stock": { "food": 500 },
    }))
    .unwrap();
    v.world.buildings.push(stable);
    // The stable has its Food; none of it lies on its footprint.
    v.world.piles = Vec::new();
    feed_everyone(&mut v.world, 2000.0, &city);

    let wanted = npc_horses_wanted(&v.world, v.city());
    assert!(wanted > NPC_START_HORSES);
    let (mut most, mut bred) = (0, false);
    run(&mut v.world, &v.terrain, 45 * TICKS_PER_GAME_DAY as usize, |w| {
        most = most.max(horses_of(w, &city));
        bred |= breeders(w) > 0;
        let s = w.buildings.iter_mut().find(|b| b.id == "stable1").unwrap();
        s.stock.get_or_insert_with(Stock::new).insert(Good::Food, 500.0);
    });
    assert!(bred);
    assert_eq!(most as f64, npc_horses_wanted(&v.world, v.city()));
    assert_eq!(breeders(&v.world), 0);
}
