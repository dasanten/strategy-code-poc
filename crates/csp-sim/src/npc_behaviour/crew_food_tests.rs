//! `crew-food.test.ts`'s slow simulation (#1038): a far lumber camp of an NPC village kept at
//! work for 30 game days, its carrier bringing the crew's Food. The file's other cases are not
//! ported yet.

use std::collections::HashMap;

use csp_shared::balance::{set_out_food, CREW_FOOD, MAX_HUNGER, NPC_VILLAGE, WALK_TICKS_PER_TILE};
use csp_shared::footprint::is_at;
use csp_shared::terrain::Terrain;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, BuildingKind, Good, Resident, ResidentOrder, Stat, Stock};
use serde_json::{json, Value};

use super::put_to_work;
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::building::building_pile;
use crate::queries::names::{held, placed};
use crate::queries::npc_trade::npc_reserve;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::world::create_world;

/// JavaScript's truthiness of a script memory's value.
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn memory<'r>(r: &'r Resident, k: &str) -> Option<&'r Value> {
    r.script.as_ref().and_then(|s| s.memory.get(k))
}

#[test]
#[ignore = "26.1 s alone; see #1132"]
fn a_lumber_camp_160_tiles_from_home_keeps_six_workers_at_work_for_30_game_days_only_the_carrier_leaving(
) {
    // `village(400)`.
    let mut terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 20, 20, &mut || m.next(), None);
    let si = world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_deref() == Some(city.as_str()) && b.kind == BuildingKind::Storage
        })
        .unwrap();
    world.buildings[si].stock = Some(Stock::from([(Good::Food, 2000.0)]));
    let (sx, sy) = (world.buildings[si].x, world.buildings[si].y);
    // The village's own residents farm and stand guard, so the city keeps its soldiers without
    // drafting the crew. A lumber camp of no city that the city works, as it builds far off
    // (`farCamp`).
    let at = (sx as i32 + 160, sy as i32);
    terrain.tiles[(at.1 * terrain.size + at.0) as usize] = Terrain::Forest as u8;
    world.nodes.push(
        serde_json::from_value(json!({ "id": "n-camp", "kind": "forest", "x": at.0, "y": at.1 }))
            .unwrap(),
    );
    let camp: Building = serde_json::from_value(
        json!({ "id": "camp", "kind": "lumberCamp", "cityId": null, "x": at.0, "y": at.1 }),
    )
    .unwrap();
    world.buildings.push(camp.clone());
    let ci = world.cities.iter().position(|c| c.id == city).unwrap();
    world.cities[ci].workplace_ids.get_or_insert_with(Vec::new).push("camp".into());
    let walk = 160.0 * WALK_TICKS_PER_TILE;
    let crew = ["a1", "a2", "a3", "a4", "a5", "a6"];
    for id in crew {
        // `villager`: an adult of the city at the storage, idle, with the set-out Food on them.
        let mut m = Mulberry32::new(world.residents.len() as f64 + 11.0);
        let fields = NewResident { id, owner: None, city_id: Some(&city), x: sx, y: sy, tick: 0.0 };
        let mut r = new_resident(&mut || m.next(), &fields, None);
        r.stats.strength = Stat { base: 10.0, trained: 0.0 };
        // Average Agility: they walk a Plains tile in `WALK_TICKS_PER_TILE`.
        r.stats.agility = Stat { base: 10.0, trained: 0.0 };
        r.carried = Stock::from([(Good::Food, set_out_food(walk))]);
        r.hunger = MAX_HUNGER;
        put_to_work(&mut r, &camp);
        world.residents.push(r);
    }
    let size = terrain.size;
    let at_camp = |r: &Resident| is_at((r.x as i32, r.y as i32), placed(&camp), size);
    let of = |w: &csp_shared::world::WorldState, id: &str| {
        w.residents.iter().find(|r| r.id == id).cloned()
    };
    let mut runner = Runner::new(&terrain);
    let mut arrived = false;
    let mut last_pile_food = 0.0;
    let mut trips = 0;
    let mut here: HashMap<&str, bool> = HashMap::new();
    for _ in 0..30 * TICKS_PER_GAME_DAY as usize {
        runner.step(&mut world, &terrain);
        // The Wood they bring goes on out of the store: the crew never reaches the surplus cap.
        let c = world.cities.iter().find(|c| c.id == city).unwrap();
        let cap = held(&npc_reserve(&world, c), Good::Wood) + 1.0;
        let stock = world.buildings[si].stock.get_or_insert_with(Stock::new);
        let wood = held(stock, Good::Wood).min(cap);
        stock.insert(Good::Wood, wood);
        let rs: Vec<Resident> = crew.iter().map(|id| of(&world, id).expect("alive")).collect();
        if !arrived {
            arrived = rs.iter().all(at_camp);
            for id in crew {
                here.insert(id, true);
            }
            continue;
        }
        // Once there, one of them at a time is away, and only ever as its carrier: who leaves the
        // camp carries a load off, nobody walks home for Food. Home with the load stored, a
        // carrier bringing no crew food is free and the city sends them back.
        let away = rs.iter().filter(|r| !at_camp(r));
        assert!(away.filter(|r| truthy(memory(r, "carry"))).count() <= 1);
        for r in &rs {
            if here[r.id.as_str()] && !at_camp(r) {
                assert!(truthy(memory(r, "carry")), "{} left the camp carrying nothing", r.id);
            }
            assert_eq!(memory(r, "food"), None, "{} went for Food", r.id);
            here.insert(crew.iter().find(|id| **id == r.id).unwrap(), at_camp(r));
        }
        // A trip with the crew's Food: the pile's Food goes up (it only ever goes down otherwise).
        let pile_food = building_pile(&world, &camp).map_or(0.0, |p| held(&p.goods, Good::Food));
        if pile_food > last_pile_food {
            trips += 1;
        }
        last_pile_food = pile_food;
        if world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            assert_eq!(check_all(&world, &terrain), []);
        }
    }
    assert!(arrived);
    // In 30 days the carrier walks the 160 tiles both ways many times, Food back each time.
    assert!(trips > 5, "{trips} trips");
    let rs: Vec<Resident> = crew.iter().map(|id| of(&world, id).expect("alive")).collect();
    // Still a crew of six on the camp: all at work there, or one of them away as its carrier.
    let workers =
        rs.iter().filter(|r| memory(r, "workplaceId") == Some(&Value::from("camp"))).count();
    assert_eq!(workers + rs.iter().filter(|r| r.script.is_none()).count(), 6);
    let working = rs
        .iter()
        .filter(|r| at_camp(r) && matches!(r.order, Some(ResidentOrder::WorkAt(_))))
        .count();
    assert!(working > 4, "{working} at work");
    // The pile keeps about crewFood: the carrier tops it up, never heaps it.
    assert!(building_pile(&world, &camp).map_or(0.0, |p| held(&p.goods, Good::Food)) <= CREW_FOOD);
    assert!(world.buildings[si].stock.as_ref().is_some_and(|s| held(s, Good::Wood) > 0.0));
}
