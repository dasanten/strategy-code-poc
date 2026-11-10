//! `breeding.test.ts`'s slow simulation (#1038): an NPC city breeding its horses through the
//! default task. Its world is `worldWithCity` as the TypeScript builds it: `found_starting_city` on
//! `city_terrain`.

use std::sync::Arc;

use csp_shared::balance::{OWN_FOOD, STABLE_BREED_DAYS};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, Stock};
use serde_json::{json, Value};

use crate::invariants::check_all;
use crate::survival::end_realm;
use crate::test_support::world_with_city;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::step_world;

#[test]
fn have_one_of_their_residents_breed_their_horses_through_the_default_task() {
    let (mut world, land) = world_with_city();
    let realm = world.realms[0].clone();
    let stable = world.buildings.iter().position(|b| b.kind == BuildingKind::Stable).unwrap();
    world.buildings[stable].stock = Some(Stock::from([(Good::Food, 10_000.0)]));
    let stable_id = world.buildings[stable].id.clone();
    for r in &mut world.residents {
        r.carried = Stock::from([(Good::Food, 100.0)]);
    }
    end_realm(&mut world, &realm.id, land.size);
    let city = world.cities[0].id.clone();
    assert!(world
        .horses
        .iter()
        .all(|h| h.city_id.as_deref() == Some(city.as_str()) && h.realm_id.is_none()));
    // One of them is idle, free for what the city needs.
    let idle = world.residents.iter().position(|r| r.id != realm.leader_id).unwrap();
    world.residents[idle].order = None;
    world.residents[idle].script = None;
    world.residents[idle].carried = Stock::from([(Good::Food, OWN_FOOD)]);
    let mut walking = Walking::new(Arc::new(land.clone()));
    let mut scratch = Scratch::default();
    step_world(&mut world, &land, &mut scratch, Some(&mut walking), None);
    let script = serde_json::to_value(&world.residents[idle].script).unwrap();
    assert_eq!(script["task"], json!("breed"), "{script}");
    assert_eq!(script["memory"]["stableId"], json!(stable_id));
    let breeding = world
        .residents
        .iter()
        .filter(|r| serde_json::to_value(&r.script).unwrap()["task"] == Value::from("breed"))
        .count();
    assert_eq!(breeding, 1);
    for _ in 0..(STABLE_BREED_DAYS * TICKS_PER_GAME_DAY) as usize + 500 {
        step_world(&mut world, &land, &mut scratch, Some(&mut walking), None);
    }
    assert!(world.horses.len() >= 3);
    assert_eq!(world.horses[2].city_id.as_deref(), Some(city.as_str()));
    assert_eq!(world.horses[2].realm_id, None);
    assert_eq!(check_all(&world, &land), []);
}
