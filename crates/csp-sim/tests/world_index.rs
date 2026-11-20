//! `apps/server/src/world-index.test.ts`, ported one to one. Its busy worlds start from the
//! fixture worlds (`generateWorld` is the world generation's port) and get, drawn from the seed,
//! horses, roads (some sites), a building across the map's join, alliance armies and mercenary
//! contracts, some started and some sharing residents, so every way `commanderOf` can answer
//! comes up.

mod common;

use common::load_world;
use csp_shared::world::{
    Alliance, AllianceArmyPart, AllianceArmyPartIs, BuildingKind, ConstructionSite, ContractSide,
    MercenaryContract, Resident, WorldState,
};
use csp_sim::queries::alliance::commander_of;
use csp_sim::queries::building::{building_at, road_tiles};
use csp_sim::random::Mulberry32;
use csp_sim::world_index::{world_index, WorldIndex};

const WORLDS: [&str; 3] =
    ["worlds/generated-1-1024.json", "worlds/village-1440.json", "worlds/hq-1440.json"];

fn pick<'a, T>(rand: &mut Mulberry32, xs: &'a [T]) -> &'a T {
    &xs[(rand.next() * xs.len() as f64).floor() as usize]
}

/// A resident like `newResident` makes: one of the world's, with another id, owner and place.
fn new_resident(world: &WorldState, id: &str, owner: &str, x: f64, y: f64) -> Resident {
    let mut r = world.residents[0].clone();
    (r.id, r.owner, r.x, r.y) = (id.into(), Some(owner.into()), x, y);
    (r.order, r.script, r.queue, r.riding, r.aboard) = (None, None, None, None, None);
    r
}

fn busy_world(file: &str, seed: f64) -> (WorldState, i32) {
    let (mut world, size, _) = load_world(file);
    let mut rand = Mulberry32::new(seed);
    let horse = world.horses.first().cloned();
    for i in 0..20 {
        let r = pick(&mut rand, &world.residents).clone();
        if let Some(mut h) = horse.clone() {
            (h.id, h.realm_id, h.city_id, h.x, h.y) = (format!("h{i}"), None, r.city_id, r.x, r.y);
            world.horses.push(h);
        }
    }
    let sample = pick(&mut rand, &world.buildings).clone();
    for i in 0..30 {
        let r = pick(&mut rand, &world.residents).clone();
        let mut road = sample.clone();
        (road.id, road.kind, road.x, road.y) = (format!("road{i}"), BuildingKind::Road, r.x, r.y);
        road.site =
            (i % 5 == 0).then(|| ConstructionSite { delivered: Default::default(), work: 0.0 });
        world.buildings.push(road);
    }
    let mut across = sample.clone();
    (across.id, across.kind, across.x, across.y, across.site) =
        ("across".into(), BuildingKind::Storage, f64::from(size - 1), f64::from(size - 1), None);
    world.buildings.push(across);
    for i in 0..4 {
        let r = new_resident(&world, &format!("p{i}"), &format!("realm{i}"), 0.0, 0.0);
        world.residents.push(r);
    }
    let ids = |rand: &mut Mulberry32, world: &WorldState| -> Vec<String> {
        (0..6).map(|_| pick(rand, &world.residents).id.clone()).collect()
    };
    for i in 0..3 {
        let mut army: Vec<AllianceArmyPart> = ids(&mut rand, &world)
            .into_iter()
            .map(|id| AllianceArmyPart { is: AllianceArmyPartIs::Resident, id, recall_at: None })
            .collect();
        if !world.carriages.is_empty() {
            let id = pick(&mut rand, &world.carriages).id.clone();
            army.push(AllianceArmyPart { is: AllianceArmyPartIs::Carriage, id, recall_at: None });
        }
        world.alliances.push(Alliance {
            id: format!("a{i}"),
            name: format!("A{i}"),
            leader_id: format!("realm{i}"),
            members: vec![],
            invites: vec![],
            army,
        });
    }
    for i in 0..4 {
        let resident_ids = ids(&mut rand, &world);
        world.contracts.push(MercenaryContract {
            id: format!("c{i}"),
            lender_id: "lender".into(),
            hirer_id: format!("hirer{i}"),
            offered_by: ContractSide::Lender,
            resident_ids,
            days: 7.0,
            price_per_week: 1.0,
            storage_id: sample.id.clone(),
            started_at: (i != 3).then_some(0.0),
            paid_weeks: 0.0,
        });
    }
    (world, size)
}

#[test]
fn agrees_with_the_scans_it_replaces_on_the_fixture_worlds() {
    for (seed, file) in WORLDS.into_iter().enumerate() {
        let (world, size) = busy_world(file, seed as f64 + 1.0);
        let index = WorldIndex::new(&world, size);
        for r in &world.residents {
            let found = world.residents.iter().find(|x| x.id == r.id);
            assert!(std::ptr::eq(index.resident_by_id(&world, &r.id).unwrap(), found.unwrap()));
            assert_eq!(
                index.commander_of(&world, &r.id, r.owner.as_deref()),
                commander_of(&world, &r.id, r.owner.as_deref())
            );
        }
        for b in &world.buildings {
            let found = world.buildings.iter().find(|x| x.id == b.id).unwrap();
            assert!(std::ptr::eq(index.building_by_id(&world, &b.id).unwrap(), found));
        }
        for k in &world.carriages {
            assert!(std::ptr::eq(index.carriage_by_id(&world, &k.id).unwrap(), k));
        }
        for h in &world.horses {
            assert!(std::ptr::eq(index.horse_by_id(&world, &h.id).unwrap(), h));
        }
        assert!(index.resident_by_id(&world, "nobody").is_none());
        // Every tile of every footprint and around it, the map's join included, and random
        // tiles.
        let mut rand = Mulberry32::new(seed as f64 + 1.0);
        let mut tiles = Vec::new();
        for b in &world.buildings {
            for dy in -1..=3 {
                for dx in -1..=3 {
                    tiles.push(((b.x as i32 + dx + size) % size, (b.y as i32 + dy + size) % size));
                }
            }
        }
        for _ in 0..2000 {
            let x = (rand.next() * f64::from(size)).floor() as i32;
            tiles.push((x, (rand.next() * f64::from(size)).floor() as i32));
        }
        for (x, y) in tiles {
            let (got, want) = (index.building_at(&world, x, y), building_at(&world, x, y, size));
            assert_eq!(got.map(|b| &b.id), want.map(|b| &b.id), "{file} at ({x}, {y})");
        }
        assert_eq!(*index.roads(&world), road_tiles(&world, size));
        assert!(!index.roads(&world).is_empty());
    }
}

#[test]
fn is_the_same_index_while_nothing_it_reads_has_changed() {
    let (mut world, size) = busy_world(WORLDS[0], 4.0);
    let mut slot = None;
    world_index(&mut slot, &world, size);
    world.residents[0].x += 1.0;
    assert!(slot.as_ref().unwrap().is_current(&world));
    world.tick += 1;
    assert!(!slot.as_ref().unwrap().is_current(&world));
    assert!(world_index(&mut slot, &world, size).is_current(&world));
}

#[test]
fn is_built_again_after_a_push_and_after_a_filter() {
    let (mut world, size) = busy_world(WORLDS[0], 5.0);
    let mut slot = None;
    let added = new_resident(&world, "newcomer", "realmX", 1.0, 1.0);
    assert!(world_index(&mut slot, &world, size).resident_by_id(&world, "newcomer").is_none());
    world.residents.push(added.clone());
    assert_eq!(
        world_index(&mut slot, &world, size).resident_by_id(&world, "newcomer"),
        Some(&added)
    );
    world.residents.retain(|r| r.id != "newcomer");
    assert!(world_index(&mut slot, &world, size).resident_by_id(&world, "newcomer").is_none());

    let across = world.buildings.iter().find(|b| b.id == "across").unwrap().clone();
    assert_eq!(world_index(&mut slot, &world, size).building_at(&world, 0, 0), Some(&across));
    world.buildings.retain(|b| b.id != "across");
    assert_eq!(
        world_index(&mut slot, &world, size).building_at(&world, 0, 0).map(|b| &b.id),
        building_at(&world, 0, 0, size).map(|b| &b.id)
    );
}

#[test]
fn follows_who_commands_a_resident_as_armies_and_contracts_change() {
    let (mut world, size) = busy_world(WORLDS[0], 6.0);
    let mut slot = None;
    let r = new_resident(&world, "loner", "realm0", 1.0, 1.0);
    world.residents.push(r.clone());
    let commander = |slot: &mut Option<WorldIndex>, world: &WorldState, owner: &str| {
        world_index(slot, world, size).commander_of(world, "loner", Some(owner))
    };
    assert_eq!(commander(&mut slot, &world, "realm0").as_deref(), Some("realm0"));
    world.contracts[0].resident_ids.push(r.id.clone());
    assert_eq!(
        commander(&mut slot, &world, "realm0"),
        commander_of(&world, "loner", Some("realm0"))
    );
    world.alliances[1].army.push(AllianceArmyPart {
        is: AllianceArmyPartIs::Resident,
        id: r.id.clone(),
        recall_at: None,
    });
    assert_eq!(commander(&mut slot, &world, "realm0").as_deref(), Some("realm1"));
    world.alliances[1].army.retain(|p| p.id != r.id);
    assert_eq!(commander(&mut slot, &world, "realm0").as_deref(), Some("hirer0"));
    world.contracts[0].started_at = None;
    assert_eq!(commander(&mut slot, &world, "realm0").as_deref(), Some("realm0"));
    // The owner is read as it is now.
    assert_eq!(commander(&mut slot, &world, "realmY").as_deref(), Some("realmY"));
}

/// Where a scan finds the buildings `on` holds for.
fn scan(world: &WorldState, on: impl Fn(&csp_shared::world::Building) -> bool) -> Vec<usize> {
    world.buildings.iter().enumerate().filter(|(_, b)| on(b)).map(|(i, _)| i).collect()
}

/// Every building lookup next to the scan it replaces, for each city and for the tiles on and
/// round each of `step`th building.
fn lookups_agree_with_scans(world: &WorldState, size: i32, step: usize) {
    use csp_shared::footprint::covers;
    use csp_shared::terrain::wrap;
    use csp_sim::queries::names::placed;
    use csp_sim::world_index::{building_indices_covering, building_indices_on, buildings_of_city};
    for city in world.cities.iter().map(|c| c.id.as_str()).chain(["nobody's"]) {
        let found: Vec<usize> = buildings_of_city(world, city).map(|(i, _)| i).collect();
        assert_eq!(found, scan(world, |b| b.city_id.as_deref() == Some(city)), "{city}");
    }
    for b in world.buildings.iter().step_by(step) {
        for (dx, dy) in [(0, 0), (1, 1), (-1, 0), (3, 3), (4, 0), (-size, size), (size + 2, 2)] {
            let (x, y) = (b.x as i32 + dx, b.y as i32 + dy);
            assert_eq!(
                building_indices_covering(world, x, y, size),
                scan(world, |o| covers(placed(o), x, y, size)),
                "over ({x}, {y})"
            );
            assert_eq!(
                building_indices_on(world, x, y, size),
                scan(world, |o| wrap(o.x as i32, size) == wrap(x, size)
                    && wrap(o.y as i32, size) == wrap(y, size)),
                "on ({x}, {y})"
            );
        }
    }
}

#[test]
fn building_lookups_agree_with_the_scans_on_the_fixture_worlds() {
    for file in WORLDS {
        let (world, size) = busy_world(file, 11.0);
        assert!(world.buildings.iter().any(|b| b.city_id.is_some()), "{file}");
        lookups_agree_with_scans(&world, size, 7);
    }
}

#[test]
fn building_lookups_follow_buildings_added_removed_and_changing_city() {
    use csp_sim::world_index::forget_building_lookups;
    let (mut world, size) = busy_world(WORLDS[1], 12.0);
    lookups_agree_with_scans(&world, size, 5);
    // One more of a city's buildings, on a tile that already has one, with a new id.
    let mut more = world.buildings.iter().find(|b| b.city_id.is_some()).expect("a city's").clone();
    more.id = format!("b{}", world.next_id);
    world.next_id += 1;
    world.buildings.push(more);
    lookups_agree_with_scans(&world, size, 5);
    // The first building gone: every other stands one place earlier.
    world.buildings.remove(0);
    lookups_agree_with_scans(&world, size, 5);
    // The tick turned.
    world.tick += 1;
    lookups_agree_with_scans(&world, size, 5);
    // A building leaves its city in place, as `update_city_membership` does it.
    let i = world.buildings.iter().position(|b| b.city_id.is_some()).expect("a city's");
    world.buildings[i].city_id = None;
    forget_building_lookups();
    lookups_agree_with_scans(&world, size, 5);
}
