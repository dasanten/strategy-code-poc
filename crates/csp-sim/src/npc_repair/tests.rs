//! Repairs on their own (`CONTEXT.md`: Repairing, Decay; T97.7): an NPC city's builders and road
//! crew keep its buildings out of ruin; the Trade Organization repairs its own from its stock.

use csp_shared::balance::{DECAY_NEARLY_RUIN, DECAY_WORN};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, ResidentOrder, TradeOrgCity, WorldState};

use super::*;
use crate::invariants::check_all;
use crate::npc_test_world::{plains, village, Runner};
use crate::random::Mulberry32;
use crate::repair::{condition_of, decays, step_decay, trade_org_repairs, Condition};
use crate::trade_org::found_trade_org_hq;
use crate::world::create_world;

/// The village's finished buildings that decay, by id.
fn decaying(world: &WorldState, city: &str) -> Vec<String> {
    world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(city) && decays(b))
        .map(|b| b.id.clone())
        .collect()
}

fn lost(world: &WorldState, id: &str) -> f64 {
    world.buildings.iter().find(|b| b.id == id).map_or(0.0, |b| b.decay.unwrap_or(0.0))
}

#[test]
fn an_npc_city_keeps_its_buildings_out_of_ruin() {
    let mut v = village(None);
    let city = v.city.clone();
    // Two tiles of its wooden wall, a house and its farm all but nearly a ruin: the wall tiles
    // would be one in three game days unrepaired. It has plenty above its reserve to repair them.
    let mut worn: Vec<String> = Vec::new();
    for kind in [BuildingKind::Wall, BuildingKind::Wall, BuildingKind::House, BuildingKind::Farm] {
        let b = v
            .world
            .buildings
            .iter_mut()
            .find(|b| {
                b.city_id.as_deref() == Some(&city)
                    && b.kind == kind
                    && decays(b)
                    && !worn.contains(&b.id)
            })
            .expect("one of the village's");
        b.decay = Some(0.7);
        worn.push(b.id.clone());
    }
    let s = v.storage();
    let stock = v.world.buildings[s].stock.get_or_insert_with(Default::default);
    for good in [Good::Wood, Good::Stone, Good::Food] {
        *stock.entry(good).or_insert(0.0) += 400.0;
    }
    let ids = decaying(&v.world, &city);
    let mut runner = Runner::new(&v.terrain);
    let mut repaired_by_order = false;
    for day in 0..3 {
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            runner.step(&mut v.world, &v.terrain);
            repaired_by_order |=
                v.world.residents.iter().any(|r| matches!(r.order, Some(ResidentOrder::Repair(_))));
        }
        assert_eq!(check_all(&v.world, &v.terrain), [], "day {day}");
        for id in &ids {
            assert!(lost(&v.world, id) < DECAY_NEARLY_RUIN, "{id} nearly a ruin on day {day}");
        }
    }
    assert!(repaired_by_order, "its residents repair by the repair order");
    for id in &worn {
        assert!(lost(&v.world, id) < DECAY_WORN, "{id} is good again");
    }
}

#[test]
fn a_builder_fetches_from_above_the_reserve_and_never_below_it() {
    let mut v = village(None);
    let city = v.city.clone();
    let house = v
        .world
        .buildings
        .iter()
        .position(|b| b.city_id.as_deref() == Some(&city) && b.kind == BuildingKind::House)
        .expect("a house");
    v.world.buildings[house].decay = Some(0.5);
    let s = v.storage();
    let c = v.city().clone();
    // Just its reserve: nothing to spare.
    let reserve = npc_reserve(&v.world, &c);
    v.world.buildings[s].stock = Some(reserve.clone());
    assert!(!repair_due(&v.world, &c, Some(s), false));
    let i = 0;
    v.world.residents[i].order = None;
    v.world.residents[i].script = None;
    v.world.residents[i].carried = Stock::new();
    let size = v.terrain.size;
    assert!(!take_repair(&mut v.world, &c, i, Some(s), size, false, true));
    // Wood above it: a builder at the storage picks up what the repair lacks.
    *v.world.buildings[s].stock.as_mut().unwrap().entry(Good::Wood).or_insert(0.0) += 20.0;
    assert!(repair_due(&v.world, &c, Some(s), false));
    let (sx, sy) = (v.world.buildings[s].x, v.world.buildings[s].y);
    v.world.residents[i].x = sx;
    v.world.residents[i].y = sy;
    assert!(take_repair(&mut v.world, &c, i, Some(s), size, false, true));
    let Some(ResidentOrder::PickUp(p)) = &v.world.residents[i].order else {
        panic!("a pick-up: {:?}", v.world.residents[i].order)
    };
    let wanted = repair_materials_needed(&v.world.buildings[house]);
    assert_eq!(p.goods, wanted);
    // Carrying it, they go to the house, and there repair it.
    v.world.residents[i].order = None;
    v.world.residents[i].carried = wanted;
    assert!(take_repair(&mut v.world, &c, i, Some(s), size, false, false));
    assert!(matches!(v.world.residents[i].order, Some(ResidentOrder::WalkTo(_))));
    let (hx, hy) = (v.world.buildings[house].x, v.world.buildings[house].y);
    v.world.residents[i].x = hx;
    v.world.residents[i].y = hy;
    v.world.residents[i].order = None;
    assert!(take_repair(&mut v.world, &c, i, Some(s), size, false, false));
    let Some(ResidentOrder::Repair(o)) = &v.world.residents[i].order else {
        panic!("a repair: {:?}", v.world.residents[i].order)
    };
    assert_eq!(o.building_id, v.world.buildings[house].id);
    // Roads are the road crew's.
    assert!(!repair_due(&v.world, &c, Some(s), true));
}

#[test]
fn the_trade_org_hq_and_its_trading_posts_never_fall_to_ruin() {
    let terrain = plains(512);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let hq = found_trade_org_hq(&mut world, &terrain, 128, 128, &mut || m.next());
    // A city of the Trade Organization's with nothing in stock repairs its own all the same.
    let mut v = village(None);
    let post = v.city.clone();
    v.city_mut().trade_org = Some(TradeOrgCity::Post);
    for s in v.world.buildings.iter_mut() {
        s.stock = None;
    }
    let theirs = |w: &WorldState| -> Vec<String> {
        w.buildings
            .iter()
            .filter(|b| b.city_id.as_deref() == Some(&hq) || b.city_id.as_deref() == Some(&post))
            .filter(|b| decays(b))
            .map(|b| b.id.clone())
            .collect()
    };
    let wood = |w: &WorldState| -> f64 {
        w.buildings
            .iter()
            .filter(|b| b.city_id.as_deref() == Some(&hq))
            .map(|b| held_in(b.stock.as_ref(), Good::Wood))
            .sum()
    };
    // Wood above the HQ's stock floor, which its repairs take.
    let wh = world
        .buildings
        .iter()
        .position(|b| b.city_id.as_deref() == Some(&hq) && b.kind == BuildingKind::Warehouse)
        .expect("a warehouse");
    *world.buildings[wh]
        .stock
        .get_or_insert_with(Default::default)
        .entry(Good::Wood)
        .or_insert(0.0) += 100.0;
    let before = wood(&world);
    for w in [&mut world, &mut v.world] {
        assert!(!theirs(w).is_empty());
        // Past every kind's whole decay.
        let longest = csp_shared::balance::DECAY_DAYS.0.iter().map(|(_, d)| *d).fold(0.0, f64::max);
        for _ in 0..longest as usize {
            w.tick += TICKS_PER_GAME_DAY as u64;
            step_decay(w);
            trade_org_repairs(w);
            for b in w.buildings.iter().filter(|b| decays(b)) {
                let theirs =
                    b.city_id.as_deref() == Some(&hq) || b.city_id.as_deref() == Some(&post);
                if theirs {
                    assert_ne!(condition_of(b), Some(Condition::NearlyRuin), "{}", b.id);
                    assert_eq!(condition_of(b), Some(Condition::Good), "{}", b.id);
                }
            }
        }
    }
    // Its repairs came out of the HQ's stock.
    assert!(wood(&world) < before, "{} then {}", before, wood(&world));
    // Never below its stock floor: only the Wood above it went.
    let hq_city = world.cities.iter().find(|c| c.id == hq).expect("the HQ").clone();
    let floor = held(&crate::npc_chain::trade_org_reserve(&world, &hq_city), Good::Wood);
    assert!(wood(&world) >= floor, "{} below its floor {}", wood(&world), floor);
    // Nothing between the turns of the day.
    world.tick += 1;
    assert_eq!(trade_org_repairs(&mut world), 0);
}

#[test]
fn the_invariant_catches_a_trade_org_building_nearly_a_ruin() {
    use crate::invariants::checks::trade_org_kept_up;
    let mut v = village(None);
    let wall = v
        .world
        .buildings
        .iter()
        .position(|b| b.city_id.as_deref() == Some(&v.city) && b.kind == BuildingKind::Wall)
        .expect("a wall");
    v.world.buildings[wall].decay = Some(DECAY_NEARLY_RUIN);
    // An NPC city's may be.
    assert_eq!(trade_org_kept_up(&v.world, &v.terrain), []);
    v.city_mut().trade_org = Some(TradeOrgCity::Post);
    assert_eq!(trade_org_kept_up(&v.world, &v.terrain).len(), 1);
}
