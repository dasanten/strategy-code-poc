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

use super::{chain_good, chain_makes, own_workplaces, short_goods};
use crate::invariants::check_all;
use crate::npc_behaviour::{npc_home, put_to_work, step_npc_cities};
use crate::npc_cities::found_npc_city;
use crate::npc_defence::step_npc_defence;
use crate::npc_growth::chain_project;
use crate::npc_plan::plan_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::building::recipe_for;
use crate::queries::city::city_residents;
use crate::queries::names::good_name;
use crate::queries::npc_trade::{
    npc_city_stock, npc_makes_steel, npc_reserve, npc_soldier_kit, npc_soldier_target,
    NPC_SMITHY_WEAPON,
};
use crate::queries::residents::{can_work, is_armed};
use crate::random::Mulberry32;
use crate::world::create_world;

/// The terrain each kind of node lies on here (`NODE_TERRAIN`).
fn node_terrain(kind: ResourceKind) -> Terrain {
    match kind {
        ResourceKind::Forest => Terrain::Forest,
        ResourceKind::Stone | ResourceKind::IronOre => Terrain::Hills,
        ResourceKind::GoldOre | ResourceKind::Coal => Terrain::Mountain,
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
        world.nodes.push(ResourceNode { id, kind: *kind, x, y, richness: Default::default() });
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
#[ignore = "13.9 s alone; see #1132"]
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
#[ignore = "6.7 s alone; see #1132"]
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

// T101.6: NPC cities and Coal and Steel (`CONTEXT.md`: NPC reserve).

/// A finished workplace of the city's, by its `workplaceIds`.
fn add_workplace(world: &mut WorldState, city: &str, id: &str, kind: BuildingKind, x: f64, y: f64) {
    world.buildings.push(crate::test_support::building(id, kind, None, x, y));
    city_mut(world, city).workplace_ids.get_or_insert_with(Vec::new).push(id.into());
}

fn held_good(stock: &Stock, g: Good) -> f64 {
    stock.get(&g).copied().unwrap_or(0.0)
}

fn storage_index(world: &WorldState, city: &str) -> usize {
    let home = npc_home(world, city).expect("a home").id.clone();
    world.buildings.iter().position(|b| b.id == home).expect("the storage")
}

#[test]
fn a_town_that_knows_of_a_coal_node_wants_the_steel_kit_and_builds_mine_smelters_and_smithy() {
    use ResourceKind::{Coal, Forest, IronOre};
    let (mut world, terrain, city) = city_with(&NPC_TOWN, &[Forest, IronOre, Coal]);
    let home = npc_home(&world, &city).unwrap().clone();
    let c = city_of(&world, &city);
    assert!(npc_makes_steel(&world, c));
    assert_eq!(super::steel_only_with_coal(&world), []);
    let target = soldiers(&world, &city).1;
    let reserve = npc_reserve(&world, c);
    // A steel Sword, Armour and Shield for each soldier, no spear; their Steel (2 + 7 + 1 each),
    // and the Iron and Coal for that Steel.
    for g in [Good::SteelSword, Good::SteelArmour, Good::SteelShield] {
        assert_eq!(held_good(&reserve, g), target, "{g:?}");
    }
    assert_eq!(held_good(&reserve, Good::Spear), 0.0);
    assert_eq!(held_good(&reserve, Good::Steel), 10.0 * target);
    assert!(held_good(&reserve, Good::Iron) >= 10.0 * target);
    // And the Iron ore for that Iron, two a unit.
    assert!(held_good(&reserve, Good::IronOre) >= 20.0 * target);
    assert_eq!(held_good(&reserve, Good::Coal), 10.0 * target);
    let short = short_goods(&world, c, terrain.size, None);
    for g in [Good::SteelSword, Good::Steel, Good::Coal] {
        assert!(short.contains(&g), "{g:?} in {short:?}");
    }
    let next = |world: &WorldState| {
        let c = city_of(world, &city);
        match chain_project(world, c, &home, &terrain, None, Good::SteelSword, &mut HashSet::new())
        {
            Some(CityProject::Build { building, .. }) => Some(building),
            _ => None,
        }
    };
    // Steel wants Iron and Coal: a mine on the ore first, then one on the coal.
    assert_eq!(next(&world), Some(BuildingKind::Mine));
    let node = |world: &WorldState, kind: ResourceKind| {
        let n = world.nodes.iter().find(|n| n.kind == kind).unwrap();
        (n.x, n.y)
    };
    // Its Iron first: a smelter on top of the mine.
    let (ox, oy) = node(&world, IronOre);
    add_workplace(&mut world, &city, "ore-mine", BuildingKind::Mine, ox, oy);
    assert_eq!(next(&world), Some(BuildingKind::Smelter));
    add_workplace(&mut world, &city, "smelter-1", BuildingKind::Smelter, 30.0, 30.0);
    assert_eq!(chain_good(&world, world.buildings.last().unwrap()), Some(Good::Iron));
    // Then the Coal: a mine on the coal node, and a second smelter, which smelts the Steel.
    assert_eq!(next(&world), Some(BuildingKind::Mine));
    let (cx, cy) = node(&world, Coal);
    add_workplace(&mut world, &city, "coal-mine", BuildingKind::Mine, cx, cy);
    assert_eq!(next(&world), Some(BuildingKind::Smelter));
    add_workplace(&mut world, &city, "smelter-2", BuildingKind::Smelter, 34.0, 30.0);
    assert_eq!(chain_good(&world, world.buildings.last().unwrap()), Some(Good::Steel));
    assert_eq!(chain_makes(&world, world.buildings.last().unwrap()), Some(Good::Steel));
    // The sword's Wood: a lumber camp. Then the smithy, which forges the steel sword first.
    assert_eq!(next(&world), Some(BuildingKind::LumberCamp));
    let (fx, fy) = node(&world, Forest);
    add_workplace(&mut world, &city, "camp", BuildingKind::LumberCamp, fx, fy);
    assert_eq!(next(&world), Some(BuildingKind::Smithy));
    add_workplace(&mut world, &city, "smithy", BuildingKind::Smithy, 38.0, 30.0);
    assert_eq!(chain_good(&world, world.buildings.last().unwrap()), Some(Good::SteelSword));
    assert_eq!(next(&world), None);
    // Once its storage holds the swords its soldiers lack, the smithy forges the armour.
    let storage = storage_index(&world, &city);
    world.buildings[storage].stock.get_or_insert_with(Stock::new).insert(Good::SteelSword, target);
    let smithy = world.buildings.iter().find(|b| b.id == "smithy").unwrap();
    assert_eq!(chain_good(&world, smithy), Some(Good::SteelArmour));
}

#[test]
fn a_village_with_no_coal_node_in_reach_stays_on_the_iron_spear() {
    use ResourceKind::{Forest, IronOre};
    let (mut world, _terrain, city) = city_with(&NPC_VILLAGE, &[Forest, IronOre]);
    // A coal node out of its reach, and not scouted.
    let home = npc_home(&world, &city).unwrap().clone();
    world.nodes.push(ResourceNode {
        id: "far-coal".into(),
        kind: ResourceKind::Coal,
        x: home.x + 150.0,
        y: home.y + 150.0,
        richness: Default::default(),
    });
    let c = city_of(&world, &city);
    assert!(!npc_makes_steel(&world, c));
    assert_eq!(super::steel_only_with_coal(&world), []);
    assert_eq!(npc_soldier_kit(&world, c), vec![NPC_SMITHY_WEAPON]);
    let reserve = npc_reserve(&world, c);
    assert!(held_good(&reserve, NPC_SMITHY_WEAPON) > 0.0);
    for g in [Good::SteelSword, Good::SteelArmour, Good::SteelShield, Good::Steel, Good::Coal] {
        assert_eq!(held_good(&reserve, g), 0.0, "{g:?}");
    }
    for (i, x) in [30.0, 34.0].into_iter().enumerate() {
        add_workplace(&mut world, &city, &format!("smelter-{i}"), BuildingKind::Smelter, x, 30.0);
        let smelter = world.buildings.last().unwrap();
        assert_eq!(chain_good(&world, smelter), Some(Good::Iron));
    }
}

/// Every adult of the city carries a spear and stands at its storage with nothing to do.
fn spears_at_the_storage(world: &mut WorldState, city: &str) -> Vec<usize> {
    let storage = storage_index(world, city);
    let (sx, sy) = (world.buildings[storage].x, world.buildings[storage].y);
    let tick = world.tick as f64;
    let adults: Vec<usize> = (0..world.residents.len())
        .filter(|&i| world.residents[i].city_id.as_deref() == Some(city))
        .filter(|&i| can_work(world.residents[i].born_at, tick))
        .collect();
    for &i in &adults {
        let r = &mut world.residents[i];
        r.carried.insert(Good::Spear, 1.0);
        (r.x, r.y, r.order, r.script) = (sx, sy, None, None);
    }
    adults
}

#[test]
fn a_soldier_fetches_the_steel_sword_its_storage_holds_and_puts_back_the_spear() {
    use ResourceKind::{Coal, Forest, IronOre};
    let (mut world, terrain, city) = city_with(&NPC_TOWN, &[Forest, IronOre, Coal]);
    let adults = spears_at_the_storage(&mut world, &city);
    let storage = storage_index(&world, &city);
    let storage_id = world.buildings[storage].id.clone();
    world.buildings[storage].stock.get_or_insert_with(Stock::new).insert(Good::SteelSword, 1.0);
    step_npc_defence(&mut world, terrain.size);
    let want = json!({ "kind": "pickUp", "from": { "kind": "storage", "storageId": storage_id },
        "goods": { "steelSword": 1.0 } });
    let fetching: Vec<usize> = adults
        .iter()
        .copied()
        .filter(|&i| {
            let got = serde_json::to_value(&world.residents[i].order).unwrap();
            crate::test_support::as_numbers(&got) == crate::test_support::as_numbers(&want)
        })
        .collect();
    assert_eq!(fetching.len(), 1, "one soldier fetches it");
    // Carrying it, they put the spear it outdoes back.
    let s = fetching[0];
    world.residents[s].carried.insert(Good::SteelSword, 1.0);
    world.residents[s].order = None;
    step_npc_defence(&mut world, terrain.size);
    let want = json!({ "kind": "drop", "to": { "kind": "storage", "storageId": storage_id },
        "goods": { "spear": 1.0 } });
    let got = serde_json::to_value(&world.residents[s].order).unwrap();
    assert_eq!(crate::test_support::as_numbers(&got), crate::test_support::as_numbers(&want));
}

#[test]
fn a_heartland_villages_soldiers_keep_their_spears_by_steel_in_its_storage() {
    use ResourceKind::{Forest, IronOre};
    let (mut world, terrain, city) = city_with(&NPC_VILLAGE, &[Forest, IronOre]);
    let adults = spears_at_the_storage(&mut world, &city);
    let storage = storage_index(&world, &city);
    world.buildings[storage].stock.get_or_insert_with(Stock::new).insert(Good::SteelSword, 5.0);
    step_npc_defence(&mut world, terrain.size);
    for &i in &adults {
        assert_eq!(world.residents[i].order, None);
    }
}

/// A frontier town with a coal node, its forest, ore and coal in reach and Stone in store, runs until
/// its soldiers carry steel swords: it builds mines, smelters and a smithy on the way.
#[test]
#[ignore = "a long chain run, like the iron one above; see #1132"]
fn a_frontier_town_with_a_coal_node_builds_the_chain_and_arms_its_soldiers_in_steel() {
    use ResourceKind::{Coal, Forest, IronOre};
    let (mut world, terrain, city) = city_with(&NPC_TOWN, &[Forest, IronOre, Coal]);
    // It has no stone node here (three nodes at most): Stone for its mines and smelters in store.
    let storage = storage_index(&world, &city);
    world.buildings[storage].stock.get_or_insert_with(Stock::new).insert(Good::Stone, 300.0);
    let steel_armed = |w: &WorldState| {
        let target = soldiers(w, &city).1;
        let n = city_residents(w, &city)
            .iter()
            .filter(|r| r.health > 0.0 && held_good(&r.carried, Good::SteelSword) > 0.0)
            .count();
        n as f64 >= target
    };
    let finished = run_days(&mut world, &terrain, 240, &steel_armed);
    for kind in [BuildingKind::Mine, BuildingKind::Smelter, BuildingKind::Smithy] {
        assert!(finished.contains_key(&kind), "{kind:?} built");
    }
    let c = city_of(&world, &city);
    let smelters =
        own_workplaces(&world, c).iter().filter(|b| b.kind == BuildingKind::Smelter).count();
    assert!(smelters >= 2, "an Iron and a Steel smelter");
    assert!(steel_armed(&world));
}
