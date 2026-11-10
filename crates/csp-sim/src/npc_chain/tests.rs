//! `npc-chain.test.ts`: the reserve-driven chain (`CONTEXT.md`: NPC city, NPC reserve): spare
//! hands go to the good shortest of the reserve, and the city builds the workplace that makes it,
//! up from the node.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{NpcCitySize, NPC_TOWN, NPC_VILLAGE, OWN_FOOD};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, CityJob, CityProject, CityScouted, Good, ResourceKind, ResourceNode, Stock,
    WorldState,
};
use serde_json::json;

use super::short_goods;
use crate::invariants::check_all;
use crate::npc_behaviour::{npc_home, put_to_work, step_npc_cities};
use crate::npc_cities::found_npc_city;
use crate::npc_growth::chain_project;
use crate::npc_plan::plan_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::building::recipe_for;
use crate::queries::city::city_residents;
use crate::queries::names::good_name;
use crate::queries::npc_trade::{
    npc_city_stock, npc_reserve, npc_soldier_target, NPC_SMITHY_WEAPON,
};
use crate::queries::residents::{can_work, is_armed};
use crate::random::Mulberry32;
use crate::world::create_world;

/// The terrain each kind of node lies on here (`NODE_TERRAIN`).
fn node_terrain(kind: ResourceKind) -> Terrain {
    match kind {
        ResourceKind::Forest => Terrain::Forest,
        ResourceKind::Stone | ResourceKind::IronOre => Terrain::Hills,
        ResourceKind::GoldOre => Terrain::Mountain,
    }
}

/// A city of `size` alone on a Plains map, with nodes of `kinds` 60 tiles out from its home
/// (`cityWith`).
fn city_with(size: &NpcCitySize, kinds: &[ResourceKind]) -> (WorldState, TerrainMap, String) {
    let mut terrain = plains(300);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, size, 40, 40, &mut || m.next(), None);
    let home = npc_home(&world, &city).expect("a home");
    let (hx, hy) = (home.x, home.y);
    let at = [(hx + 60.0, hy), (hx, hy + 60.0), (hx + 60.0, hy + 60.0)];
    for (kind, (x, y)) in kinds.iter().zip(at) {
        let id = format!("n-{}", serde_json::to_value(kind).unwrap().as_str().unwrap());
        world.nodes.push(ResourceNode { id, kind: *kind, x, y });
        terrain.tiles[tile_index(terrain.size, x as i32, y as i32)] = node_terrain(*kind) as u8;
    }
    (world, terrain, city)
}

fn city_of<'w>(world: &'w WorldState, id: &str) -> &'w csp_shared::world::City {
    world.cities.iter().find(|c| c.id == id).expect("the city")
}

fn city_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut csp_shared::world::City {
    world.cities.iter_mut().find(|c| c.id == id).expect("the city")
}

/// Runs the world a game day at a time, checking the invariants, until `done` or `days` pass;
/// returns when each kind of workplace first stood finished, by tick (`runDays`).
fn run_days(
    world: &mut WorldState,
    terrain: &TerrainMap,
    days: usize,
    done: &dyn Fn(&WorldState) -> bool,
) -> HashMap<BuildingKind, u64> {
    let mut runner = Runner::new(terrain);
    let mut finished = HashMap::new();
    for _ in 0..days {
        if done(world) {
            break;
        }
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            runner.step(world, terrain);
            for b in world.buildings.iter().filter(|b| b.site.is_none()) {
                finished.entry(b.kind).or_insert(world.tick);
            }
        }
        assert_eq!(check_all(world, terrain), []);
    }
    finished
}

/// The city's adults who carry a weapon, and how many soldiers it keeps (`soldiers`).
fn soldiers(world: &WorldState, city: &str) -> (usize, f64) {
    let tick = world.tick as f64;
    let adults: Vec<_> = city_residents(world, city)
        .into_iter()
        .filter(|r| r.health > 0.0 && can_work(r.born_at, tick))
        .collect();
    let armed = adults.iter().filter(|r| is_armed(&r.carried)).count();
    (armed, npc_soldier_target(adults.len() as f64))
}

#[test]
fn wants_weapons_for_its_soldiers_and_builds_up_from_the_node_mine_before_smelter_before_smithy() {
    use ResourceKind::{Forest, IronOre, Stone};
    let (mut world, terrain, city) = city_with(&NPC_TOWN, &[Forest, Stone, IronOre]);
    let home = npc_home(&world, &city).unwrap().clone();
    // Short of weapons, and the Iron and Wood to forge them.
    assert!(
        npc_reserve(&world, city_of(&world, &city)).get(&NPC_SMITHY_WEAPON).copied() > Some(0.0)
    );
    let short = short_goods(&world, city_of(&world, &city), terrain.size, None);
    for g in [Good::Spear, Good::Iron, Good::Wood] {
        assert!(short.contains(&g), "{g:?} in {short:?}");
    }
    // Weapons want a smithy, which wants Iron, so a smelter, which wants ore: a mine first, and
    // its Wood a lumber camp before that.
    let next = |world: &WorldState| {
        let c = city_of(world, &city);
        match chain_project(world, c, &home, &terrain, None, NPC_SMITHY_WEAPON, &mut HashSet::new())
        {
            Some(CityProject::Build { building, .. }) => Some(building),
            _ => None,
        }
    };
    assert_eq!(next(&world), Some(BuildingKind::Mine));
    // With its mine on the ore, though no ore in its storage yet, the smelter comes next.
    let ore = world.nodes.iter().find(|n| n.kind == IronOre).unwrap().clone();
    world.buildings.push(crate::test_support::building(
        "mine",
        BuildingKind::Mine,
        None,
        ore.x,
        ore.y,
    ));
    city_mut(&mut world, &city).workplace_ids.get_or_insert_with(Vec::new).push("mine".into());
    assert_eq!(next(&world), Some(BuildingKind::Smelter));
    // A village with no ore in reach builds nothing for weapons at all.
    let (w, t, v) = city_with(&NPC_VILLAGE, &[Forest]);
    let vh = npc_home(&w, &v).unwrap();
    let project =
        chain_project(&w, city_of(&w, &v), vh, &t, None, NPC_SMITHY_WEAPON, &mut HashSet::new());
    assert_eq!(project, None);
}

#[test]
fn a_smith_takes_the_iron_and_wood_for_spears_from_the_storage_before_setting_out() {
    let (mut world, terrain, city) = city_with(&NPC_VILLAGE, &[ResourceKind::Forest]);
    let storage = world
        .buildings
        .iter()
        .position(|b| Some(&b.id) == npc_home(&world, &city).map(|h| &h.id))
        .unwrap();
    let smithy = crate::test_support::building("smithy", BuildingKind::Smithy, None, 30.0, 30.0);
    world.buildings.push(smithy);
    city_mut(&mut world, &city).workplace_ids.get_or_insert_with(Vec::new).push("smithy".into());
    world.buildings[storage].stock =
        Some(Stock::from([(Good::Food, 200.0), (Good::Iron, 3.0), (Good::Wood, 100.0)]));
    // It knows its limit, so the spare hand has no scouting to go to (`CONTEXT.md`: Scout).
    city_mut(&mut world, &city).scouted =
        Some(CityScouted { sectors: vec![], no_way: None, done: Some(true) });
    // Two of them: one farms for both, the other is a spare hand.
    let tick = world.tick as f64;
    let adults: Vec<_> =
        world.residents.iter().filter(|r| can_work(r.born_at, tick)).take(2).cloned().collect();
    world.residents = adults;
    let farm = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(city.as_str()))
        .unwrap()
        .clone();
    put_to_work(&mut world.residents[0], &farm);
    let (sx, sy) = (world.buildings[storage].x, world.buildings[storage].y);
    let smith = &mut world.residents[1];
    (smith.x, smith.y, smith.order, smith.script) = (sx, sy, None, None);
    smith.carried = Stock::from([(Good::Food, OWN_FOOD)]);
    let smith_id = smith.id.clone();
    let storage_id = world.buildings[storage].id.clone();
    // Spears are short and the storage holds their Iron and Wood: the smithy is worked.
    plan_city(&mut world, &city, Some(&terrain), None, None);
    let work: CityJob =
        serde_json::from_value(json!({ "kind": "work", "buildingId": "smithy" })).unwrap();
    assert_eq!(world.city_plans[&city].jobs.get(&smith_id), Some(&work));
    step_npc_cities(&mut world, terrain.size, Some(&terrain), None);
    // All the Iron there is, and the Wood to go with it.
    let recipe = recipe_for(BuildingKind::Smithy, Some(good_name(NPC_SMITHY_WEAPON))).unwrap();
    let (iron, wood) = (recipe.input.get("iron").unwrap(), recipe.input.get("wood").unwrap());
    let want = json!({
        "kind": "pickUp", "from": { "kind": "storage", "storageId": storage_id },
        "goods": { "iron": 3.0 * iron, "wood": 3.0 * wood },
    });
    let got = serde_json::to_value(&world.residents[1].order).unwrap();
    assert_eq!(crate::test_support::as_numbers(&got), crate::test_support::as_numbers(&want));
    let smith = &mut world.residents[1];
    smith.carried.insert(Good::Iron, 3.0);
    smith.carried.insert(Good::Wood, 6.0);
    smith.order = None;
    step_npc_cities(&mut world, terrain.size, Some(&terrain), None);
    // Then they set out to make spears, keeping the input on them.
    let smith = &world.residents[1];
    let memory = &smith.script.as_ref().expect("a script").memory;
    assert_eq!(memory.get("workplaceId"), Some(&json!("smithy")));
    assert_eq!(memory.get("makes"), Some(&json!(good_name(NPC_SMITHY_WEAPON))));
    assert_eq!(smith.carried.get(&Good::Iron), Some(&3.0));
    assert_eq!(smith.carried.get(&Good::Wood), Some(&6.0));
    // With no Iron in the storage and none on them, nobody is sent.
    let smith = &mut world.residents[1];
    (smith.carried, smith.order, smith.script) =
        (Stock::from([(Good::Food, OWN_FOOD)]), None, None);
    world.buildings[storage].stock = Some(Stock::from([(Good::Food, 200.0), (Good::Wood, 100.0)]));
    plan_city(&mut world, &city, Some(&terrain), None, None);
    step_npc_cities(&mut world, terrain.size, Some(&terrain), None);
    assert!(world.residents[1].script.is_none());
}

#[test]
#[ignore = "32.1 s with eight at once; see #1092"]
fn a_town_with_forest_stone_and_iron_in_reach_builds_the_chain_and_arms_its_soldiers() {
    use ResourceKind::{Forest, IronOre, Stone};
    let (mut world, terrain, city) = city_with(&NPC_TOWN, &[Forest, Stone, IronOre]);
    let armed = |w: &WorldState| {
        let (armed, target) = soldiers(w, &city);
        w.buildings.iter().any(|b| b.kind == BuildingKind::Smithy && b.site.is_none())
            && armed as f64 >= target
    };
    let finished = run_days(&mut world, &terrain, 120, &armed);
    let order = [
        BuildingKind::LumberCamp,
        BuildingKind::Quarry,
        BuildingKind::Mine,
        BuildingKind::Smelter,
        BuildingKind::Smithy,
    ];
    let ticks: Vec<u64> = order.iter().map(|k| *finished.get(k).expect("finished")).collect();
    let mut sorted = ticks.clone();
    sorted.sort_unstable();
    assert_eq!(sorted, ticks);
    // Its soldiers carry spears: none came from anywhere but its smithy.
    assert!(armed(&world));
    let spears = city_residents(&world, &city)
        .iter()
        .filter(|r| r.carried.get(&Good::Spear).copied().unwrap_or(0.0) > 0.0)
        .count();
    assert!(spears as f64 >= soldiers(&world, &city).1);
}

#[test]
#[ignore = "15.9 s with eight at once; see #1092"]
fn a_village_with_no_iron_in_reach_stays_short_of_weapons_and_is_still_fed() {
    let (mut world, terrain, city) = city_with(&NPC_VILLAGE, &[ResourceKind::Forest]);
    let people = city_residents(&world, &city).len();
    run_days(&mut world, &terrain, 30, &|_| false);
    assert!(world.buildings.iter().any(|b| b.kind == BuildingKind::LumberCamp && b.site.is_none()));
    for kind in [BuildingKind::Mine, BuildingKind::Smelter, BuildingKind::Smithy] {
        assert!(!world.buildings.iter().any(|b| b.kind == kind));
    }
    let c = city_of(&world, &city);
    assert!(short_goods(&world, c, terrain.size, None).contains(&NPC_SMITHY_WEAPON));
    // Fed: nobody starved, and its storages hold Food.
    assert!(city_residents(&world, &city).iter().filter(|r| r.health > 0.0).count() >= people);
    assert!(npc_city_stock(&world, c).get(&Good::Food).copied().unwrap_or(0.0) > 0.0);
}
