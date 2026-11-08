//! `apps/server/src/work.test.ts`, ported (T86.6). Left for the tickets whose rules they need:
//! taking meals from a workplace's pile or a carriage there (survival, T86.3: "lets a worker
//! running low take meals…", "catches a worker who runs low…", "lets a worker running low take
//! meals from a carriage…", and the rival's meal in "lets another realm's workers take over");
//! the starting-city runs (`a starting city`, T86.8 with T86.3); the invariant checks
//! (`checkInvariants`, `workOrdersOnWorkplaces`, `refilledWhenLow`, T86.13).

mod build_common;

use build_common::*;
use csp_shared::balance::{
    HOME_FOOD_LOW, WORKPLACE_MAX_WORKERS, WORK_OUTPUT_PER_DAY, WORK_SKILL_EFFECT,
    WORK_SKILL_PER_DAY,
};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Good, Pile, Resident, ResidentOrder, ResourceKind, ResourceNode, SkillName,
    Stock, WorldState,
};
use csp_sim::queries::balance::{skill_of, work_output};
use csp_sim::queries::building::{holders_of, pile_tile};
use csp_sim::stand_ins::OrderSender;
use csp_sim::world::create_world;
use serde_json::json;

/// Plains, with Forest at (3, 1) and Hills at (5, 1) and (7, 1) for the workplaces on nodes.
fn terrain() -> TerrainMap {
    let mut t = plains(16);
    t.tiles[16 + 3] = Terrain::Forest as u8;
    t.tiles[16 + 5] = Terrain::Hills as u8;
    t.tiles[16 + 7] = Terrain::Hills as u8;
    t
}

fn farm_max_workers() -> f64 {
    WORKPLACE_MAX_WORKERS.get("farm").unwrap()
}

fn farm_food_per_day() -> f64 {
    WORK_OUTPUT_PER_DAY.get("food").unwrap()
}

fn farm_output(r: &Resident, tick: f64) -> f64 {
    work_output(r, Good::Food, SkillName::Farming, tick)
}

fn farm_side() -> f64 {
    FOOTPRINT.get("farm").unwrap() as f64
}

fn me() -> OrderSender {
    player(7)
}

fn stranger() -> OrderSender {
    player(8)
}

/// A resident of `owner` with Strength, Intellect and Endurance 10.
fn worker(world: &mut WorldState, id: &str, x: f64, y: f64, owner: &str) -> usize {
    world.residents.push(new_resident(id, Some(owner), x, y));
    world.residents.len() - 1
}

/// A world on plains: realm r1 (Player 7), its city c1 with a farm at (3, 3) outside the wall,
/// and resident w1 standing on the farm.
fn setup() -> (WorldState, TerrainMap, Orders) {
    let t = terrain();
    let mut world = create_world(&t, 1);
    world.realms.push(realm("r1", 7, "w1"));
    let mut farm = building("farm", BuildingKind::Farm, 3.0, 3.0);
    farm.city_id = Some("c1".into());
    world.buildings.push(farm);
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    worker(&mut world, "w1", 3.0, 3.0, "r1");
    (world, t, Orders::default())
}

fn work_at(resident_id: &str) -> serde_json::Value {
    json!({ "kind": "workAt", "residentId": resident_id })
}

/// Sends a work-at order, and if accepted applies it and runs the tick that starts it.
fn work(
    world: &mut WorldState,
    t: &TerrainMap,
    orders: &mut Orders,
    resident_id: &str,
    sender: &OrderSender,
) -> Answer {
    order(world, orders, sender, work_at(resident_id), t)
}

/// The pile reached from (x, y) (`pileAt`).
fn pile_at(world: &WorldState, x: i32, y: i32) -> Option<&Pile> {
    let (px, py) = pile_tile(world, x, y, 5760);
    world.piles.iter().find(|p| p.x as i32 == px && p.y as i32 == py)
}

fn piled(world: &WorldState, x: i32, y: i32, good: Good) -> f64 {
    pile_at(world, x, y).and_then(|p| p.goods.get(&good).copied()).unwrap_or(0.0)
}

fn progress(r: &Resident) -> f64 {
    match &r.order {
        Some(ResidentOrder::WorkAt(o)) => o.progress,
        _ => 0.0,
    }
}

fn working(world: &WorldState) -> usize {
    world.residents.iter().filter(|r| matches!(r.order, Some(ResidentOrder::WorkAt(_)))).count()
}

#[test]
fn sets_a_resident_to_work_the_farm_they_stand_on_as_plain_data() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(orders.receive(&world, &me(), work_at("w1"), &t), Ok(()));
    orders.apply_all(&mut world, &t);
    let o = serde_json::to_value(&at(&mut world, "w1").order).unwrap();
    assert_eq!(
        o,
        json!({ "kind": "workAt", "buildingId": "farm", "at": { "x": 3.0, "y": 3.0 }, "progress": 0.0 })
    );
    let back: Option<ResidentOrder> = serde_json::from_value(o).unwrap();
    assert_eq!(back, at(&mut world, "w1").order);
    run(&mut world, &t, 1);
    assert!(
        matches!(&at(&mut world, "w1").order, Some(ResidentOrder::WorkAt(o)) if o.building_id == "farm")
    );
}

#[test]
fn rejects_what_cant_be_worked_and_who_cant_work() {
    let (mut world, t, mut orders) = setup();
    let reject =
        |world: &WorldState, orders: &mut Orders, reason: &str, id: &str, s: &OrderSender| {
            assert_eq!(orders.receive(world, s, work_at(id), &t), Err(reason.to_string()));
        };
    reject(&world, &mut orders, "not one of your residents", "w1", &stranger());
    reject(&world, &mut orders, "not one of your residents", "nobody", &me());
    let tick = world.tick as f64;
    at(&mut world, "w1").born_at = tick - csp_shared::balance::ticks_for_age(5.0);
    reject(&world, &mut orders, "children can’t work", "w1", &me());
    at(&mut world, "w1").born_at = tick - csp_shared::balance::ticks_for_age(30.0);
    at(&mut world, "w1").x = 8.0;
    reject(&world, &mut orders, "there is no workplace to work here", "w1", &me());
    at(&mut world, "w1").x = 3.0;
    world.buildings[0].site =
        Some(csp_shared::world::ConstructionSite { delivered: Stock::new(), work: 0.0 });
    reject(&world, &mut orders, "it is still a construction site", "w1", &me());
    world.buildings[0].site = None;
    work(&mut world, &t, &mut orders, "w1", &me()).unwrap();
    reject(&world, &mut orders, "already working here", "w1", &me());
    assert_eq!(orders.len(), 0);
}

#[test]
fn takes_at_most_its_cap_of_workers_on_a_farm() {
    let (mut world, t, mut orders) = setup();
    let max = farm_max_workers();
    for i in 2..=max as usize {
        worker(&mut world, &format!("w{i}"), 3.0, 3.0, "r1");
    }
    let ids: Vec<String> = world.residents.iter().map(|r| r.id.clone()).collect();
    for id in &ids {
        orders.receive(&world, &me(), work_at(id), &t).unwrap();
    }
    orders.apply_all(&mut world, &t);
    run(&mut world, &t, 1);
    worker(&mut world, "extra", 3.0, 3.0, "r1");
    assert_eq!(
        orders.receive(&world, &me(), work_at("extra"), &t),
        Err(format!("it already has {max} workers"))
    );
    // Orders accepted in the same tick can't push a farm over its cap: the extra one stops.
    world.residents[0].order = None;
    worker(&mut world, "late", 3.0, 3.0, "r1");
    orders.receive(&world, &me(), work_at("extra"), &t).unwrap();
    orders.receive(&world, &me(), work_at("late"), &t).unwrap();
    orders.apply_all(&mut world, &t);
    run(&mut world, &t, 1);
    assert_eq!(working(&world) as f64, max);
}

#[test]
fn stops_when_the_resident_leaves_the_farm() {
    let (mut world, t, mut orders) = setup();
    work(&mut world, &t, &mut orders, "w1", &me()).unwrap();
    at(&mut world, "w1").x = 3.0 + farm_side(); // just off its footprint
    run(&mut world, &t, 1);
    assert!(at(&mut world, "w1").order.is_none());
}

#[test]
fn makes_about_its_food_a_game_day_onto_the_farms_pile_and_teaches_farming() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "w1").carried = Stock::from([(Good::Food, HOME_FOOD_LOW)]);
    work(&mut world, &t, &mut orders, "w1", &me()).unwrap();
    // Just short of a game day, so none of it spoils yet; the skill learned adds a little.
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize - 2);
    let r = at(&mut world, "w1").clone();
    let made = progress(&r) + piled(&world, 3, 3, Good::Food);
    assert!((made - farm_food_per_day()).abs() < 0.5, "{made}");
    assert_eq!(r.carried, Stock::from([(Good::Food, HOME_FOOD_LOW)]));
    assert!((skill_of(&r, SkillName::Farming) - WORK_SKILL_PER_DAY).abs() < 0.005);
}

#[test]
fn is_worked_from_any_tile_of_the_farm_onto_its_one_pile_on_the_north_west_tile() {
    let (mut world, t, mut orders) = setup();
    let corner = 3.0 + farm_side() - 1.0; // its south-east tile
    at(&mut world, "w1").x = corner;
    at(&mut world, "w1").y = corner;
    work(&mut world, &t, &mut orders, "w1", &me()).unwrap();
    assert!(matches!(
        &at(&mut world, "w1").order,
        Some(ResidentOrder::WorkAt(o)) if o.building_id == "farm" && (o.at.x, o.at.y) == (6.0, 6.0)
    ));
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize - 2);
    let tiles: Vec<(f64, f64)> = world.piles.iter().map(|p| (p.x, p.y)).collect();
    assert_eq!(tiles, [(3.0, 3.0)]);
    assert_eq!(pile_at(&world, 6, 6).map(|p| &p.id), pile_at(&world, 3, 3).map(|p| &p.id));
    assert!(piled(&world, 3, 3, Good::Food) > 0.0);
}

#[test]
fn makes_2_food_a_game_day_for_a_worker_of_average_strength_and_no_skill() {
    let (mut world, _, _) = setup();
    close(farm_output(at(&mut world, "w1"), 0.0) * TICKS_PER_GAME_DAY, 2.0);
}

#[test]
fn makes_more_food_with_strength_and_farming_skill() {
    let (mut world, _, _) = setup();
    let r = at(&mut world, "w1");
    let base = farm_output(r, 0.0);
    close(base * TICKS_PER_GAME_DAY, farm_food_per_day());
    r.stats.strength = csp_shared::world::Stat { base: 15.0, trained: 5.0 };
    assert!((farm_output(r, 0.0) - base * 2.0).abs() < 1e-9);
    r.stats.strength = csp_shared::world::Stat { base: 10.0, trained: 0.0 };
    r.skills.insert(SkillName::Farming, 10.0);
    assert!((farm_output(r, 0.0) - base * (1.0 + 10.0 * WORK_SKILL_EFFECT)).abs() < 1e-9);
}

/// Adds a finished workplace of `kind` on a node of `node` at (x, 1) and puts w1 on it, with an
/// order to work it.
fn on_node(
    kind: BuildingKind,
    node: ResourceKind,
    x: f64,
    id: &str,
) -> (WorldState, TerrainMap, Orders) {
    let (mut world, t, mut orders) = setup();
    world.nodes.push(ResourceNode { id: format!("n{x}"), kind: node, x, y: 1.0 });
    world.buildings.push(building(id, kind, x, 1.0));
    at(&mut world, "w1").x = x;
    at(&mut world, "w1").y = 1.0;
    assert_eq!(work(&mut world, &t, &mut orders, "w1", &me()), Ok(()));
    (world, t, orders)
}

#[test]
fn a_workplace_on_a_node_makes_its_good_onto_the_pile_on_its_tile_and_teaches_its_skill() {
    let cases = [
        (
            BuildingKind::LumberCamp,
            "lumberCamp",
            ResourceKind::Forest,
            3.0,
            Good::Wood,
            SkillName::Woodcutting,
        ),
        (BuildingKind::Quarry, "quarry", ResourceKind::Stone, 5.0, Good::Stone, SkillName::Mining),
        (BuildingKind::Mine, "mine", ResourceKind::IronOre, 7.0, Good::IronOre, SkillName::Mining),
        (BuildingKind::Mine, "mine", ResourceKind::GoldOre, 7.0, Good::GoldOre, SkillName::Mining),
    ];
    for (kind, name, node, x, good, skill) in cases {
        let (mut world, t, _) = on_node(kind, node, x, name);
        run(&mut world, &t, TICKS_PER_GAME_DAY as usize - 2);
        let r = at(&mut world, "w1").clone();
        assert!(matches!(&r.order, Some(ResidentOrder::WorkAt(o)) if o.building_id == name));
        assert_eq!(r.carried.get(&good).copied().unwrap_or(0.0), 0.0);
        let made = progress(&r) + piled(&world, x as i32, 1, good);
        let want = WORK_OUTPUT_PER_DAY.get(csp_sim::queries::names::good_name(good)).unwrap();
        assert!((made - want).abs() < 0.5, "{name}: {made}");
        assert!((skill_of(&r, skill) - WORK_SKILL_PER_DAY).abs() < 0.005);
        assert_eq!(skill_of(&r, SkillName::Farming), 0.0);
    }
}

#[test]
fn makes_more_ore_with_strength_and_the_workplaces_skill() {
    let (mut world, _, _) = setup();
    let r = at(&mut world, "w1");
    let base = work_output(r, Good::IronOre, SkillName::Mining, 0.0);
    close(base * TICKS_PER_GAME_DAY, WORK_OUTPUT_PER_DAY.get("ironOre").unwrap());
    r.skills.insert(SkillName::Farming, 10.0);
    close(work_output(r, Good::IronOre, SkillName::Mining, 0.0), base);
    r.skills.insert(SkillName::Mining, 10.0);
    let more = work_output(r, Good::IronOre, SkillName::Mining, 0.0);
    assert!((more - base * (1.0 + 10.0 * WORK_SKILL_EFFECT)).abs() < 1e-9);
}

#[test]
fn takes_at_most_its_cap_of_workers_on_a_node_workplace() {
    let cases = [
        (BuildingKind::LumberCamp, "lumberCamp", ResourceKind::Forest),
        (BuildingKind::Quarry, "quarry", ResourceKind::Stone),
        (BuildingKind::Mine, "mine", ResourceKind::IronOre),
    ];
    for (kind, name, node) in cases {
        let max = WORKPLACE_MAX_WORKERS.get(name).unwrap();
        let (mut world, t, mut orders) = on_node(kind, node, 3.0, name);
        for i in 2..=max as usize {
            worker(&mut world, &format!("w{i}"), 3.0, 1.0, "r1");
        }
        let ids: Vec<String> = world.residents[1..].iter().map(|r| r.id.clone()).collect();
        for id in &ids {
            orders.receive(&world, &me(), work_at(id), &t).unwrap();
        }
        orders.apply_all(&mut world, &t);
        run(&mut world, &t, 1);
        worker(&mut world, "extra", 3.0, 1.0, "r1");
        assert_eq!(
            orders.receive(&world, &me(), work_at("extra"), &t),
            Err(format!("it already has {max} workers")),
            "{name}"
        );
    }
}

#[test]
fn stops_when_the_workplace_is_torn_down() {
    let (mut world, t, _) = on_node(BuildingKind::Quarry, ResourceKind::Stone, 5.0, "quarry");
    world.buildings.retain(|b| b.kind != BuildingKind::Quarry);
    run(&mut world, &t, 1);
    assert!(at(&mut world, "w1").order.is_none());
}

/// Realm r2 of the stranger (Player 8), with resident s1 standing on (x, y).
fn rival(world: &mut WorldState, x: f64, y: f64) {
    world.realms.push(realm("r2", 8, "s1"));
    worker(world, "s1", x, y, "r2");
}

#[test]
fn lets_another_realms_workers_take_over_an_empty_workplace_and_its_output() {
    let (mut world, t, mut orders) = setup();
    let farm = world.buildings[0].clone();
    assert!(holders_of(&world, &farm).is_empty());
    work(&mut world, &t, &mut orders, "w1", &me()).unwrap();
    assert_eq!(holders_of(&world, &farm), ["r1"]);
    // r1's worker walks off: the farm (built for r1's city) is nobody's now.
    at(&mut world, "w1").x = 3.0 + farm_side();
    run(&mut world, &t, 1);
    assert!(holders_of(&world, &farm).is_empty());
    rival(&mut world, 3.0, 3.0);
    assert_eq!(work(&mut world, &t, &mut orders, "s1", &stranger()), Ok(()));
    assert_eq!(holders_of(&world, &farm), ["r2"]);
    let before = at(&mut world, "w1").carried.get(&Good::Food).copied().unwrap_or(0.0);
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize / 2);
    // TODO(T86.3): the rival takes meals from the farm's pile (`s.carried.food > 0`).
    assert!(piled(&world, 3, 3, Good::Food) > 0.0);
    assert_eq!(at(&mut world, "w1").carried.get(&Good::Food).copied().unwrap_or(0.0), before);
}

#[test]
fn works_the_same_on_a_workplace_of_no_city() {
    let (mut world, t, _) = on_node(BuildingKind::Mine, ResourceKind::IronOre, 7.0, "mine");
    let mine = world.buildings.iter().find(|b| b.kind == BuildingKind::Mine).unwrap().clone();
    at(&mut world, "w1").x = 6.0;
    run(&mut world, &t, 1);
    rival(&mut world, 7.0, 1.0);
    let mut fresh = Orders::default();
    assert_eq!(work(&mut world, &t, &mut fresh, "s1", &stranger()), Ok(()));
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize / 2);
    assert_eq!(holders_of(&world, &mine), ["r2"]);
    // The ore lies on the mine's tile, where r2's worker stands guard over it.
    assert!(piled(&world, 7, 1, Good::IronOre) > 0.0);
    let s = at(&mut world, "s1").clone();
    assert_eq!((s.x, s.y), (7.0, 1.0));
    assert_eq!(at(&mut world, "w1").carried.get(&Good::IronOre).copied().unwrap_or(0.0), 0.0);
}
