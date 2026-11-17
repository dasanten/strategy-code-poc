use csp_shared::balance::{DECAY_WORN, REPAIR_WORK_SHARE};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, ConstructionSite, Good, ResidentOrder, WorldState,
};
use serde_json::json;

use super::*;
use crate::test_world::{building, empty_world, resident};

fn decay_of(world: &WorldState, id: &str) -> f64 {
    world.buildings.iter().find(|b| b.id == id).unwrap().decay.unwrap_or(0.0)
}

fn b<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).unwrap()
}

/// Steps the decay through `days` game days, tick by tick at the turns of the day only.
fn days(world: &mut WorldState, days: u64) {
    for _ in 0..days {
        world.tick += TICKS_PER_GAME_DAY as u64;
        step_decay(world);
    }
}

#[test]
fn condition_falls_per_game_day_by_kind_and_reads_in_words() {
    let mut world = empty_world();
    building(&mut world, "road", BuildingKind::Road, None, 1.0, 1.0);
    building(&mut world, "house", BuildingKind::House, None, 4.0, 4.0);
    building(&mut world, "smithy", BuildingKind::Smithy, None, 8.0, 8.0);
    let site = building(&mut world, "site", BuildingKind::House, None, 12.0, 12.0);
    world.buildings[site].site =
        Some(ConstructionSite { delivered: Default::default(), work: 0.0 });
    let cart = building(&mut world, "cart", BuildingKind::Carriage, None, 16.0, 16.0);
    world.buildings[cart].site =
        Some(ConstructionSite { delivered: Default::default(), work: 0.0 });

    // Nothing between the turns of the day.
    world.tick = 1;
    step_decay(&mut world);
    assert_eq!(decay_of(&world, "road"), 0.0);
    world.tick = 0;

    // Until a road reads worn.
    let worn = (DECAY_WORN * decay_days(BuildingKind::Road).unwrap()).ceil();
    days(&mut world, worn as u64);
    let road = worn / decay_days(BuildingKind::Road).unwrap();
    let smithy = worn / decay_days(BuildingKind::Smithy).unwrap();
    // Rounded to a billionth each day.
    assert!((decay_of(&world, "road") - road).abs() < 1e-7);
    assert!((decay_of(&world, "smithy") - smithy).abs() < 1e-7);
    // Roads go faster than timber, timber faster than stone.
    assert!(decay_of(&world, "road") > decay_of(&world, "house"));
    assert!(decay_of(&world, "house") > decay_of(&world, "smithy"));
    assert_eq!(condition_of(b(&world, "road")), Some(Condition::Worn));
    assert_eq!(condition_of(b(&world, "smithy")), Some(Condition::Good));
    // A site, and a carriage site, never decay.
    assert_eq!(decay_of(&world, "site"), 0.0);
    assert_eq!(condition_of(b(&world, "site")), None);
    assert_eq!(decay_of(&world, "cart"), 0.0);

    days(&mut world, decay_days(BuildingKind::Road).unwrap() as u64);
    assert_eq!(decay_of(&world, "road"), 1.0, "never below nothing");
    assert_eq!(condition_of(b(&world, "road")), Some(Condition::NearlyRuin));
}

#[test]
fn a_building_saved_before_decay_reads_good() {
    // Format 129 had no `decay` nor `repair`: such a building loads as good.
    let old: Building = serde_json::from_value(json!({
        "id": "h1", "kind": "house", "cityId": null, "x": 3, "y": 3
    }))
    .unwrap();
    assert_eq!(old.decay, None);
    assert_eq!(condition_of(&old), Some(Condition::Good));
    // And one that has lost none leaves both out of the save.
    let saved = serde_json::to_value(&old).unwrap();
    assert!(saved.get("decay").is_none() && saved.get("repair").is_none(), "{saved}");
}

fn worn_house() -> WorldState {
    let mut world = empty_world();
    let h = building(&mut world, "h1", BuildingKind::House, None, 4.0, 4.0);
    world.buildings[h].decay = Some(0.5);
    resident(&mut world, "w1", None, 4.0, 4.0);
    world
}

fn repairing(world: &mut WorldState) {
    world.residents[0].order = Some(ResidentOrder::Repair(RepairOrder {
        building_id: "h1".into(),
        at: Tile { x: 4.0, y: 4.0 },
    }));
}

#[test]
fn says_why_a_building_cant_be_repaired() {
    let mut world = worn_house();
    assert_eq!(repair_problem(&world, 4, 4, "h1"), None);
    assert_eq!(repair_problem(&world, 5, 5, "h1"), None, "anywhere on its footprint");
    assert_eq!(
        repair_problem(&world, 9, 9, "h1").as_deref(),
        Some("the resident is not at that building")
    );
    world.buildings[0].decay = Some(DECAY_WORN / 2.0);
    assert_eq!(
        repair_problem(&world, 4, 4, "h1").as_deref(),
        Some("the house is in good condition")
    );
    world.buildings[0].site = Some(ConstructionSite { delivered: Default::default(), work: 0.0 });
    assert_eq!(
        repair_problem(&world, 4, 4, "h1").as_deref(),
        Some("it is still a construction site")
    );
}

#[test]
fn a_repair_takes_a_share_of_the_materials_and_work_and_puts_the_building_back_to_good() {
    let materials = repair_materials(BuildingKind::House);
    assert_eq!(materials.get(&Good::Wood), Some(&5.0), "a quarter of a house's 20 Wood");
    assert_eq!(repair_materials(BuildingKind::Road).get(&Good::Stone), Some(&1.0));
    assert_eq!(repair_work(BuildingKind::House), TICKS_PER_GAME_DAY * REPAIR_WORK_SHARE);

    let mut world = worn_house();
    world.residents[0].carried.insert(Good::Wood, 7.0);
    repairing(&mut world);
    let mut ticks = 0;
    while world.residents[0].order.is_some() {
        let actions = request_repairing(&world);
        resolve_repairing(&mut world, &actions, None);
        world.tick += 1;
        ticks += 1;
        assert!(ticks < 10_000, "never done");
    }
    // An average resident puts in about a unit of work a tick, a little more as they learn.
    let work = repair_work(BuildingKind::House);
    assert!(ticks as f64 <= work + 1.0 && ticks as f64 > work * 0.5, "{ticks}");
    let h = b(&world, "h1");
    assert_eq!((h.decay, h.repair.is_some()), (None, false));
    assert_eq!(condition_of(h), Some(Condition::Good));
    assert_eq!(world.residents[0].carried.get(&Good::Wood), Some(&2.0), "5 Wood went in");
}

#[test]
fn without_the_materials_the_work_goes_in_but_the_building_stays_worn_until_they_come() {
    let mut world = worn_house();
    repairing(&mut world);
    for _ in 0..(repair_work(BuildingKind::House) as usize + 10) {
        let actions = request_repairing(&world);
        resolve_repairing(&mut world, &actions, None);
        world.tick += 1;
    }
    let h = b(&world, "h1");
    assert_eq!(h.decay, Some(0.5));
    assert_eq!(repair_work_needed(h), 0.0);
    assert_eq!(repair_materials_needed(h).get(&Good::Wood), Some(&5.0));
    assert!(world.residents[0].order.is_some(), "still at it");
    // The Wood comes: the repair is done.
    world.residents[0].carried.insert(Good::Wood, 5.0);
    let actions = request_repairing(&world);
    resolve_repairing(&mut world, &actions, None);
    assert_eq!(b(&world, "h1").decay, None);
    assert!(world.residents[0].order.is_none());
    assert!(world.residents[0].carried.get(&Good::Wood).is_none());
}

#[test]
fn a_resident_who_leaves_the_tile_stops_repairing() {
    let mut world = worn_house();
    repairing(&mut world);
    world.residents[0].x = 10.0;
    let actions = request_repairing(&world);
    resolve_repairing(&mut world, &actions, None);
    assert!(world.residents[0].order.is_none());
    assert!(b(&world, "h1").repair.is_none());
}

#[test]
fn the_invariants_hold_a_condition_in_range_and_a_repairer_at_the_building() {
    use crate::invariants::checks::{conditions_in_range, repair_orders_on_buildings};
    let terrain = crate::test_support::plains(32);
    let mut world = worn_house();
    repairing(&mut world);
    world.buildings[0].repair =
        Some(ConstructionSite { delivered: [(Good::Wood, 5.0)].into_iter().collect(), work: 1.0 });
    assert_eq!(conditions_in_range(&world, &terrain), []);
    assert_eq!(repair_orders_on_buildings(&world, &terrain), []);

    world.buildings[0].decay = Some(1.5);
    assert_eq!(conditions_in_range(&world, &terrain).len(), 1);
    world.buildings[0].decay = Some(0.5);
    world.buildings[0].repair.as_mut().unwrap().delivered.insert(Good::Wood, 6.0);
    assert_eq!(conditions_in_range(&world, &terrain).len(), 1);
    world.buildings[0].repair.as_mut().unwrap().delivered.insert(Good::Wood, 5.0);
    world.buildings[0].repair.as_mut().unwrap().work = repair_work(BuildingKind::House) + 1.0;
    assert_eq!(conditions_in_range(&world, &terrain).len(), 1);
    world.buildings[0].repair = None;
    world.buildings[0].site = Some(ConstructionSite { delivered: Default::default(), work: 0.0 });
    assert_eq!(conditions_in_range(&world, &terrain).len(), 1, "a site never decays");

    world.residents[0].x = 10.0;
    assert_eq!(repair_orders_on_buildings(&world, &terrain).len(), 1);
}
