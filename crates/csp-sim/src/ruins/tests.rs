use csp_shared::balance::{BUILD_MATERIALS, COLLAPSE_MATERIALS_LEFT, RUIN_COLLAPSE_DAYS};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, ConstructionSite, Good, RepairOrder, ResidentOrder, Stock, Tile, WorldState,
};

use super::*;
use crate::queries::city_area::housing_room;
use crate::repair::{
    condition_of, decay_days, repair_materials, repair_work, request_repairing, resolve_repairing,
    step_decay, Condition,
};
use crate::test_world::{add_city, building, empty_world, resident};

const SIZE: i32 = csp_shared::balance::MAP_SIZE;

fn b<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).unwrap()
}

/// Steps decay, ruin and collapse through `days` game days, at the turns of the day only.
fn days(world: &mut WorldState, scratch: &mut Scratch, days: u64) -> Vec<Building> {
    let mut fallen = Vec::new();
    for _ in 0..days {
        world.tick += TICKS_PER_GAME_DAY as u64;
        step_decay(world);
        fallen.extend(step_ruins(world, SIZE, scratch));
    }
    fallen
}

#[test]
fn a_neglected_building_turns_to_a_ruin_then_collapses_leaving_a_pile() {
    let mut world = empty_world();
    let mut scratch = Scratch::default();
    let h = building(&mut world, "h1", BuildingKind::Storage, None, 4.0, 4.0);
    world.buildings[h].stock = Some([(Good::Food, 7.0)].into_iter().collect());
    let lasts = decay_days(BuildingKind::Storage).unwrap() as u64;

    days(&mut world, &mut scratch, lasts - 1);
    assert!(!is_ruin(b(&world, "h1")), "nearly a ruin, not yet one");
    assert_eq!(condition_of(b(&world, "h1")), Some(Condition::NearlyRuin));
    days(&mut world, &mut scratch, 1);
    assert!(is_ruin(b(&world, "h1")));
    assert_eq!(condition_of(b(&world, "h1")), Some(Condition::Ruin));
    assert_eq!(Condition::Ruin.name(), "ruin");
    assert!(!standing(b(&world, "h1")));

    // It stands its days as a ruin, then is gone.
    let fallen = days(&mut world, &mut scratch, RUIN_COLLAPSE_DAYS as u64 - 1);
    assert!(fallen.is_empty());
    let fallen = days(&mut world, &mut scratch, 1);
    assert_eq!(fallen.len(), 1);
    assert!(world.buildings.is_empty());
    // Part of its materials and the goods it kept lie where it stood.
    let wood = BUILD_MATERIALS.get("storage").unwrap().get("wood").unwrap();
    let left = (wood * COLLAPSE_MATERIALS_LEFT).floor();
    assert!(left > 0.0);
    assert_eq!(world.piles.len(), 1);
    let pile = &world.piles[0];
    assert_eq!((pile.x, pile.y), (4.0, 4.0));
    assert_eq!(pile.goods.get(&Good::Wood), Some(&left));
    assert_eq!(pile.goods.get(&Good::Food), Some(&7.0));
    assert_eq!(scratch.made.take().get(&Good::Wood), Some(&left), "the materials came in anew");
}

#[test]
fn a_ruin_takes_no_blows_and_a_collapsed_town_hall_dissolves_its_city() {
    let mut world = empty_world();
    let mut scratch = Scratch::default();
    add_city(&mut world, "c1", None, 10.0, 10.0, None);
    let w = building(&mut world, "w1", BuildingKind::Wall, Some("c1"), 2.0, 2.0);
    world.buildings[w].damage = Some(3.0);
    world.buildings[w].decay = Some(1.0);
    world.buildings[0].decay = Some(1.0);
    days(&mut world, &mut scratch, 1);
    assert_eq!(b(&world, "w1").damage, None);
    assert!(is_ruin(b(&world, "c1-hall")));
    days(&mut world, &mut scratch, RUIN_COLLAPSE_DAYS as u64);
    assert!(world.buildings.is_empty());
    assert!(world.cities.is_empty());
}

#[test]
fn a_ruined_house_houses_nobody() {
    let mut world = empty_world();
    add_city(&mut world, "c1", None, 10.0, 10.0, None);
    let h = building(&mut world, "h1", BuildingKind::House, Some("c1"), 4.0, 4.0);
    let room = housing_room(&world, "c1");
    assert!(room > 0.0);
    world.buildings[h].decay = Some(1.0);
    world.buildings[h].ruined_at = Some(0.0);
    assert_eq!(housing_room(&world, "c1"), 0.0);
}

#[test]
fn a_ruin_never_decays_away_from_its_kind_a_site_never_becomes_one() {
    let mut world = empty_world();
    let mut scratch = Scratch::default();
    let s = building(&mut world, "s1", BuildingKind::House, None, 4.0, 4.0);
    world.buildings[s].site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    days(&mut world, &mut scratch, 400);
    assert!(!is_ruin(b(&world, "s1")));
}

fn ruined_house() -> WorldState {
    let mut world = empty_world();
    let h = building(&mut world, "h1", BuildingKind::House, None, 4.0, 4.0);
    world.buildings[h].decay = Some(1.0);
    world.buildings[h].ruined_at = Some(0.0);
    resident(&mut world, "w1", None, 4.0, 4.0);
    world.residents[0].order = Some(ResidentOrder::Repair(RepairOrder {
        building_id: "h1".into(),
        at: Tile { x: 4.0, y: 4.0 },
    }));
    world
}

#[test]
fn rebuilding_a_ruin_costs_more_than_a_repair_and_less_than_a_new_one() {
    let wood = |s: &Stock| s.get(&Good::Wood).copied().unwrap_or(0.0);
    let house = BUILD_MATERIALS.get("house").unwrap().get("wood").unwrap();
    let rebuild = rebuild_materials(BuildingKind::House);
    assert!(wood(&rebuild) > wood(&repair_materials(BuildingKind::House)));
    assert!(wood(&rebuild) < house);
    assert!(rebuild_work(BuildingKind::House) > repair_work(BuildingKind::House));
    assert!(rebuild_work(BuildingKind::House) < build_work_of(BuildingKind::House));

    // The repair order on a ruin rebuilds it, with the rebuild's materials and work.
    let mut world = ruined_house();
    world.residents[0].carried.insert(Good::Wood, wood(&rebuild) + 2.0);
    let mut ticks = 0;
    while world.residents[0].order.is_some() {
        let actions = request_repairing(&world);
        resolve_repairing(&mut world, &actions, None);
        world.tick += 1;
        ticks += 1;
        assert!(ticks < 10_000, "never done");
    }
    assert!(ticks as f64 > repair_work(BuildingKind::House), "{ticks}");
    let h = b(&world, "h1");
    assert_eq!((h.decay, h.ruined_at, h.repair.is_some()), (None, None, false));
    assert_eq!(condition_of(h), Some(Condition::Good));
    assert_eq!(world.residents[0].carried.get(&Good::Wood), Some(&2.0));
}

#[test]
fn rebuilding_stops_short_without_its_materials() {
    let mut world = ruined_house();
    world.residents[0].carried.insert(Good::Wood, wood_of(&repair_materials(BuildingKind::House)));
    for _ in 0..(rebuild_work(BuildingKind::House) as usize * 2) {
        let actions = request_repairing(&world);
        resolve_repairing(&mut world, &actions, None);
        world.tick += 1;
    }
    assert!(is_ruin(b(&world, "h1")), "a repair's materials don't rebuild it");
}

fn wood_of(s: &Stock) -> f64 {
    s.get(&Good::Wood).copied().unwrap_or(0.0)
}

#[test]
fn a_collapse_ends_repair_orders_on_it_and_leaves_what_the_rebuild_had() {
    let mut world = ruined_house();
    let mut scratch = Scratch::default();
    world.buildings[0].repair =
        Some(ConstructionSite { delivered: [(Good::Wood, 3.0)].into_iter().collect(), work: 1.0 });
    world.tick = (RUIN_COLLAPSE_DAYS * TICKS_PER_GAME_DAY) as u64;
    assert_eq!(step_ruins(&mut world, SIZE, &mut scratch).len(), 1);
    assert_eq!(world.residents[0].order, None);
    let left = (BUILD_MATERIALS.get("house").unwrap().get("wood").unwrap()
        * COLLAPSE_MATERIALS_LEFT)
        .floor();
    assert_eq!(world.piles[0].goods.get(&Good::Wood), Some(&(left + 3.0)));
}
