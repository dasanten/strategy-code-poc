//! A town doesn't begin a building whose materials it has no way to get (#1487, `CONTEXT.md`: NPC
//! city).

use std::collections::HashSet;

use csp_shared::balance::NPC_TOWN;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, CityProject, ConstructionSite, Good, ResourceKind, ResourceNode,
    WorldState,
};

use super::can_come;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_growth::{chain_project, next_project};
use crate::npc_test_world::plains;
use crate::queries::npc_trade::NPC_SMITHY_WEAPON;
use crate::random::Mulberry32;
use crate::trading_posts::found_trading_post;
use crate::world::create_world;

/// A town on Plains with a forest and a stone node near and no iron ore anywhere, its storage
/// holding plenty of Food, Wood and Stone and the 4 Iron of a starting stock: the stone-wall slow
/// run's town when it began its smithy.
fn town_without_iron() -> (WorldState, TerrainMap, String, Building) {
    let terrain = plains(700);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(11.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 300, 300, &mut || m.next(), None);
    let home = npc_home(&world, &city).expect("a home").clone();
    world.nodes.clear();
    for (i, (kind, dx)) in
        [(ResourceKind::Forest, 40.0), (ResourceKind::Stone, -40.0)].iter().enumerate()
    {
        world.nodes.push(ResourceNode {
            id: format!("n{i}"),
            kind: *kind,
            x: home.x + dx,
            y: home.y,
            richness: Default::default(),
            stock: None,
        });
    }
    let storage = world
        .buildings
        .iter_mut()
        .find(|b| b.city_id.as_deref() == Some(city.as_str()) && b.kind == BuildingKind::Storage)
        .expect("a storage");
    storage.stock = Some(
        [(Good::Food, 400.0), (Good::Wood, 300.0), (Good::Stone, 300.0), (Good::Iron, 4.0)]
            .into_iter()
            .collect(),
    );
    (world, terrain, city, home)
}

fn add_post(world: &mut WorldState, terrain: &TerrainMap, home: &Building) {
    let mut m = Mulberry32::new(3.0);
    found_trading_post(world, terrain, home.x as i32 + 200, home.y as i32, None, &mut || m.next());
}

fn city<'w>(world: &'w WorldState, id: &str) -> &'w csp_shared::world::City {
    world.cities.iter().find(|c| c.id == id).expect("the city")
}

fn weapons_workplace(
    world: &WorldState,
    terrain: &TerrainMap,
    id: &str,
    home: &Building,
) -> Option<CityProject> {
    chain_project(
        world,
        city(world, id),
        home,
        terrain,
        None,
        NPC_SMITHY_WEAPON,
        &mut HashSet::new(),
    )
}

#[test]
fn a_town_with_no_iron_node_and_no_trader_begins_no_smithy() {
    let (mut world, terrain, id, home) = town_without_iron();
    let at = (home.x as i32, home.y as i32);
    assert!(!can_come(&world, city(&world, &id), at, Good::Iron, terrain.size));
    assert!(can_come(&world, city(&world, &id), at, Good::Stone, terrain.size));
    // Its 4 Iron forge spears, but a smithy takes 10 to build.
    assert_eq!(weapons_workplace(&world, &terrain, &id, &home), None);
    // A Trade Org warehouse in its trader's reach sells Iron: then it begins one.
    add_post(&mut world, &terrain, &home);
    assert!(can_come(&world, city(&world, &id), at, Good::Iron, terrain.size));
    assert!(matches!(
        weapons_workplace(&world, &terrain, &id, &home),
        Some(CityProject::Build { building: BuildingKind::Smithy, .. })
    ));
}

#[test]
fn a_town_whose_begun_smithy_waits_on_iron_it_cant_get_builds_its_other_projects() {
    let (mut world, terrain, id, home) = town_without_iron();
    // A smithy begun in a running world before #1487, its 4 Iron delivered: it waits on 6 more.
    let mut smithy = crate::test_support::building(
        "smithy",
        BuildingKind::Smithy,
        None,
        home.x + 6.0,
        home.y + 6.0,
    );
    smithy.site = Some(ConstructionSite {
        delivered: [(Good::Stone, 30.0), (Good::Wood, 20.0), (Good::Iron, 4.0)]
            .into_iter()
            .collect(),
        work: 0.0,
    });
    world.buildings.push(smithy);
    let c = world.cities.iter_mut().find(|c| c.id == id).unwrap();
    c.workplace_ids.get_or_insert_with(Vec::new).push("smithy".into());
    let is_smithy = |p: &Option<CityProject>| {
        matches!(p, Some(CityProject::Build { building: BuildingKind::Smithy, .. }))
    };
    let next = next_project(&world, city(&world, &id), &home, &terrain);
    assert!(next.is_some(), "it has other projects");
    assert!(!is_smithy(&next), "{next:?}");
    // Once Iron can come, the begun smithy comes first again.
    add_post(&mut world, &terrain, &home);
    let next = next_project(&world, city(&world, &id), &home, &terrain);
    assert!(is_smithy(&next), "{next:?}");
}
