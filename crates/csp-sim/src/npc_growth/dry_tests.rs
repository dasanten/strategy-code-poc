//! Moving on from a dry node (`CONTEXT.md`: Running dry, NPC city, Trade Org HQ; T102.4): a city
//! whose mine ran dry frees its workers, opens a mine on the next node it knows of and tears the
//! dead one down once it has nothing better to do; with no other node known, the good stays short
//! and its trader buys it. The HQ takes the next nearest node, however far.

use std::collections::HashSet;

use csp_shared::balance::{NPC_NODE_REACH, NPC_TOWN};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, CityProject, Good, ResourceKind, ResourceNode, Stock, TradeOrgCity,
    VeinStock, WorldState,
};

use super::{chain_project, city_project, dead_workplace};
use crate::npc_behaviour::{npc_home, put_to_work};
use crate::npc_chain::{makes, short_goods};
use crate::npc_cities::found_npc_city;
use crate::npc_plan::{npc_leaves_dry_workplaces, plan_city};
use crate::npc_trader::has_node_for;
use crate::queries::building::workplace_good;
use crate::queries::city::town_hall_of;
use crate::queries::warehouse::stock_floor;
use crate::random::Mulberry32;
use crate::test_support::plains;
use crate::trade_org::found_trade_org_hq;
use crate::veins::{take_from_vein, Take};
use crate::world::create_world;

/// A node of `kind` at (x, y) on its terrain, holding `left` units of ore when given.
fn add_node(
    world: &mut WorldState,
    terrain: &mut TerrainMap,
    id: &str,
    kind: ResourceKind,
    (x, y): (i32, i32),
    left: Option<f64>,
) {
    let t = match kind {
        ResourceKind::Forest => Terrain::Forest,
        _ => Terrain::Hills,
    };
    terrain.tiles[tile_index(terrain.size, x, y)] = t as u8;
    world.nodes.push(ResourceNode {
        id: id.into(),
        kind,
        x: f64::from(x),
        y: f64::from(y),
        richness: Default::default(),
        stock: left.map(|left| VeinStock { first: left, left, made: 0.0 }),
    });
}

/// A town alone on Plains with its forest and stone near, its mine on an iron ore node 60 tiles
/// out holding one unit, and, when `second` is given, another iron ore node that many tiles out
/// the other way. Returns the world, its terrain, the town and its mine's id.
fn town(second: Option<i32>) -> (WorldState, TerrainMap, String, String) {
    let mut terrain = plains(600);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 200, 200, &mut || m.next(), None);
    let home = npc_home(&world, &city).expect("a home").clone();
    let (hx, hy) = (home.x as i32, home.y as i32);
    add_node(&mut world, &mut terrain, "forest", ResourceKind::Forest, (hx + 60, hy), None);
    add_node(&mut world, &mut terrain, "stone", ResourceKind::Stone, (hx, hy + 60), None);
    add_node(&mut world, &mut terrain, "ore", ResourceKind::IronOre, (hx + 60, hy + 60), Some(1.0));
    if let Some(d) = second {
        add_node(
            &mut world,
            &mut terrain,
            "ore2",
            ResourceKind::IronOre,
            (hx - d, hy),
            Some(500.0),
        );
    }
    world.buildings.push(crate::test_support::building(
        "mine",
        BuildingKind::Mine,
        None,
        f64::from(hx + 60),
        f64::from(hy + 60),
    ));
    let c = world.cities.iter_mut().find(|c| c.id == city).expect("the town");
    c.workplace_ids.get_or_insert_with(Vec::new).push("mine".into());
    (world, terrain, city, "mine".into())
}

fn building<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).expect("the building")
}

fn city<'w>(world: &'w WorldState, id: &str) -> &'w csp_shared::world::City {
    world.cities.iter().find(|c| c.id == id).expect("the city")
}

/// Runs the mine's vein dry, as its last unit is made.
fn run_dry(world: &mut WorldState, mine: &str) {
    let b = building(world, mine).clone();
    assert_eq!(take_from_vein(world, &b), Take::Last);
    assert_eq!(world.dry_nodes.len(), 1);
}

/// The iron ore the town's chain wants next, and where.
fn ore_project(world: &WorldState, terrain: &TerrainMap, id: &str) -> Option<CityProject> {
    let c = city(world, id);
    let home = npc_home(world, id).expect("a home");
    chain_project(world, c, home, terrain, None, Good::IronOre, &mut HashSet::new())
}

/// Who the town's last plan puts to work at `place`.
fn crew(world: &WorldState, city: &str, place: &str) -> usize {
    world
        .city_plans
        .get(city)
        .map_or(0, |p| p.jobs.values().filter(|j| j.building_id.as_deref() == Some(place)).count())
}

#[test]
fn a_city_whose_mine_ran_dry_frees_its_workers_and_opens_a_mine_on_the_next_node_it_knows() {
    let (mut world, terrain, id, mine) = town(Some(120));
    // Its mine makes Iron ore, so it opens no other; a few of its people work it.
    assert!(makes(&world, city(&world, &id), Good::IronOre));
    assert_eq!(ore_project(&world, &terrain, &id), None);
    let people: Vec<usize> = (0..world.residents.len())
        .filter(|&i| world.residents[i].city_id.as_deref() == Some(&*id))
        .take(2)
        .collect();
    let place = building(&world, &mine).clone();
    for &i in &people {
        put_to_work(&mut world.residents[i], &place);
    }

    run_dry(&mut world, &mine);
    // It makes nothing now: the city no longer counts on it for Iron ore.
    assert_eq!(workplace_good(&world, building(&world, &mine), None), None);
    assert!(!makes(&world, city(&world, &id), Good::IronOre));
    // The next planning pass gives nobody a job there.
    world.tick += 1;
    plan_city(&mut world, &id, Some(&terrain), None, None);
    assert_eq!(crew(&world, &id, &mine), 0);
    assert_eq!(npc_leaves_dry_workplaces(&world), []);
    // Its chain opens a mine on the other iron ore node, within its reach.
    let ore2 = world.nodes.iter().find(|n| n.id == "ore2").expect("the second node").clone();
    match ore_project(&world, &terrain, &id) {
        Some(CityProject::Build { building: BuildingKind::Mine, x, y }) => {
            let d = (x - ore2.x).abs().max((y - ore2.y).abs());
            assert!(d <= 2.0, "a mine at ({x}, {y}), the node at ({}, {})", ore2.x, ore2.y);
        }
        other => panic!("a mine on the second node, not {other:?}"),
    }
    // The dead mine is the one its builders will tear down.
    assert_eq!(dead_workplace(&world, city(&world, &id)).map(|b| b.id.as_str()), Some("mine"));
}

#[test]
fn with_no_other_node_known_the_good_stays_short_and_its_trader_buys_it() {
    // A second node far past its reach, which no scout of its has found.
    let far = (NPC_NODE_REACH as i32) + 60;
    let (mut world, terrain, id, mine) = town(Some(far));
    let home = npc_home(&world, &id).expect("a home");
    let at = (home.x as i32, home.y as i32);
    assert!(has_node_for(&world, city(&world, &id), at, Good::Iron, 600, &mut HashSet::new()));

    run_dry(&mut world, &mine);
    assert_eq!(ore_project(&world, &terrain, &id), None);
    let c = city(&world, &id);
    // Short of Iron (its storage holds none), with no node for its ore: what its trader buys.
    assert!(short_goods(&world, c, terrain.size, None).contains(&Good::Iron));
    assert!(!has_node_for(&world, c, at, Good::Iron, terrain.size, &mut HashSet::new()));
}

#[test]
fn with_nothing_better_to_do_its_builders_tear_down_the_dead_mine() {
    let (mut world, terrain, id, mine) = town(None);
    run_dry(&mut world, &mine);
    // Nothing short: the storage holds plenty of everything, and no wall or house is wanted
    // before the dead mine comes down.
    let full: Stock = csp_shared::goods::GOODS
        .iter()
        .map(|g| (serde_json::from_value(serde_json::json!(g)).expect("a good"), 10_000.0))
        .collect();
    let home = npc_home(&world, &id).expect("a home").id.clone();
    world.buildings.iter_mut().find(|b| b.id == home).expect("the home").stock = Some(full);
    let c = city(&world, &id).clone();
    let h = npc_home(&world, &id).expect("a home").clone();
    let mut seen = Vec::new();
    // Whatever it wants first, the dead mine is among what comes after, before the inner walls.
    for _ in 0..200 {
        match city_project(&world, &c, &h, &terrain, true) {
            Some(CityProject::TearDown { building_id }) if building_id == mine => return,
            Some(p @ CityProject::Build { building, x, y }) => {
                seen.push(p.clone());
                // Pretend it stands, so the next want comes up.
                let id = format!("done{}", seen.len());
                let mut b = crate::test_support::building(&id, building, Some(&c.id), x, y);
                b.site = None;
                world.buildings.push(b);
                let cm = world.cities.iter_mut().find(|x| x.id == c.id).expect("the town");
                cm.workplace_ids.get_or_insert_with(Vec::new).push(id);
            }
            other => panic!("the dead mine torn down, not {other:?} after {seen:?}"),
        }
    }
    panic!("never tore it down; wanted {seen:?}");
}

/// The Trade Org HQ in the middle of an open map with one node of each kind near, its iron ore
/// node holding one unit, and another iron ore node far past an NPC city's reach.
fn hq() -> (WorldState, TerrainMap, String) {
    const MID: i32 = 320;
    let mut terrain = plains(1200);
    let mut world = create_world(&terrain, 1);
    world.nodes.clear();
    let nodes = [
        ("forest", ResourceKind::Forest, (MID + 80, MID), None),
        ("stone", ResourceKind::Stone, (MID + 80, MID + 12), None),
        ("ore", ResourceKind::IronOre, (MID + 88, MID - 12), Some(1.0)),
        ("gold", ResourceKind::GoldOre, (MID + 96, MID), Some(500.0)),
        ("coal", ResourceKind::Coal, (MID + 96, MID + 12), Some(500.0)),
    ];
    for (id, kind, at, left) in nodes {
        add_node(&mut world, &mut terrain, id, kind, at, left);
    }
    let mut m = Mulberry32::new(7.0);
    let city = found_trade_org_hq(&mut world, &terrain, MID, MID, &mut || m.next());
    // Laid down after its founding, so its first mine went on the near one.
    let far = (MID - 2 * NPC_NODE_REACH as i32, MID);
    add_node(&mut world, &mut terrain, "ore2", ResourceKind::IronOre, far, Some(500.0));
    (world, terrain, city)
}

#[test]
fn the_hq_moves_its_mine_to_the_next_nearest_node_however_far() {
    let (mut world, terrain, id) = hq();
    let hq = city(&world, &id).clone();
    assert_eq!(hq.trade_org, Some(TradeOrgCity::Hq));
    let ids = hq.workplace_ids.clone().unwrap_or_default();
    let mine = world
        .buildings
        .iter()
        .find(|b| {
            ids.contains(&b.id)
                && b.kind == BuildingKind::Mine
                && workplace_good(&world, b, None) == Some(Good::IronOre)
        })
        .expect("its iron mine")
        .id
        .clone();
    run_dry(&mut world, &mine);
    // Its warehouses hold their floor of everything but Iron ore, which runs short.
    let warehouses: Vec<String> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Warehouse && b.city_id.as_deref() == Some(&*id))
        .map(|b| b.id.clone())
        .collect();
    for w in &warehouses {
        let b = world.buildings.iter().find(|b| &b.id == w).expect("a warehouse");
        let mut floor = stock_floor(&world, b);
        floor.insert(Good::IronOre, 0.0);
        world.buildings.iter_mut().find(|b| &b.id == w).expect("a warehouse").stock = Some(floor);
    }
    let hq = city(&world, &id).clone();
    let hall = town_hall_of(&world, &hq).expect("its town hall").clone();
    let home = npc_home(&world, &id).cloned().unwrap_or(hall);
    let ore2 = world.nodes.iter().find(|n| n.id == "ore2").expect("the far node").clone();
    match city_project(&world, &hq, &home, &terrain, false) {
        Some(CityProject::Build { building: BuildingKind::Mine, x, y }) => {
            let d = (x - ore2.x).abs().max((y - ore2.y).abs());
            assert!(d <= 2.0, "a mine at ({x}, {y}), the far node at ({}, {})", ore2.x, ore2.y);
        }
        other => panic!("a mine on the far node, not {other:?}"),
    }
}
