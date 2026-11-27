//! A new vein elsewhere (`CONTEXT.md`: Running dry; T102.2): when a node runs dry, a new node of
//! its kind and richness comes into being in the same tick in a region that fits, out of every
//! Player's sight. A Player who had explored its tile sees no node there until they see the tile
//! again. The same seed places it on the same tile; the nodes of each kind and richness stay as
//! many; with no fitting tile anywhere, the node comes back where it was.

// Epic 127: this file still has `_ =>` arms over enums; its tickets name each variant or say
// why the wildcard is right, then remove this line.
#![allow(clippy::wildcard_enum_match_arm)]

mod build_common;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use build_common::*;
use csp_shared::balance::{NEW_VEIN_SPOT_REACH, SIGHT_RANGE, VEIN_RETURN_DAYS};
use csp_shared::chunks::{decode_chunk, CHUNK_SIZE};
use csp_shared::terrain::{wrap_distance, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{DryNode, ResourceKind, ResourceNode, Richness, WorldState};
use csp_sim::explored::ExploredTerrain;
use csp_sim::last_seen::refresh_last_seen;
use csp_sim::new_veins::{reveal_new_veins, step_new_veins, veins_counted};
use csp_sim::node_gen::{contested_spots, fits_terrain};
use csp_sim::regions::{RegionKind, Regions};
use csp_sim::starting_sites::place_starting_sites;
use csp_sim::terrain_gen::generate_terrain;
use csp_sim::tick::Scratch;
use csp_sim::veins::veins_sound;
use csp_sim::world::create_world;

const MARA: u64 = 7;
const SEED: i64 = 16;
const SIZE: i32 = 256;

/// A generated world with its nodes placed, Mara's realm r1 with w1 standing in the middle of a
/// heartland, and the map's regions.
fn generated() -> (WorldState, TerrainMap, Regions) {
    let terrain = generate_terrain(SEED, SIZE);
    let mut world = create_world(&terrain, SEED);
    place_starting_sites(&mut world, &terrain);
    let regions = Regions::of(SEED, &terrain);
    let home = regions.of_kind(RegionKind::Heartland).next().expect("a heartland").clone();
    world.realms.push(realm("r1", MARA, "w1"));
    world.residents.push(new_resident("w1", Some("r1"), f64::from(home.x), f64::from(home.y)));
    (world, terrain, regions)
}

/// The explored terrain of `world`, shared as the server shares it with the tick.
fn land(world: &WorldState, terrain: &TerrainMap) -> Arc<Mutex<ExploredTerrain>> {
    Arc::new(Mutex::new(ExploredTerrain::new(terrain.clone(), &world.nodes_ever())))
}

/// Runs the node at `i` dry by hand, as `take_from_vein` does at its last unit: gone from the
/// world, kept as a dry node with none come for it yet.
fn run_dry(world: &mut WorldState, i: usize) -> DryNode {
    let n = world.nodes.remove(i);
    let dry = DryNode {
        id: n.id,
        kind: n.kind,
        x: n.x,
        y: n.y,
        richness: n.richness,
        at: world.tick,
        seen_gone_by: Vec::new(),
        next: None,
    };
    world.dry_nodes.push(dry.clone());
    dry
}

/// The first node of `kind` and `richness`.
fn first(world: &WorldState, kind: ResourceKind, richness: Richness) -> usize {
    world
        .nodes
        .iter()
        .position(|n| n.kind == kind && n.richness == richness)
        .unwrap_or_else(|| panic!("no {richness:?} {kind:?} node"))
}

/// The node that came into being for the dry node `id`.
fn next_of<'w>(world: &'w WorldState, id: &str) -> &'w ResourceNode {
    let next = world.dry_nodes.iter().find(|d| d.id == id).and_then(|d| d.next.clone());
    let next = next.expect("a node came for it");
    world.nodes.iter().find(|n| n.id == next).expect("in the world")
}

/// How many nodes of each kind and richness there are, a waiting one counted.
fn counts(world: &WorldState) -> BTreeMap<String, usize> {
    let mut out = BTreeMap::new();
    for n in world.nodes.iter().chain(world.waiting_veins.iter().map(|w| &w.node)) {
        *out.entry(format!("{:?} {:?}", n.kind, n.richness)).or_default() += 1;
    }
    out
}

#[test]
fn a_dry_node_has_a_new_one_of_its_kind_and_richness_in_another_fitting_region_out_of_sight() {
    let (mut world, terrain, regions) = generated();
    let spots = contested_spots(SIZE, &regions);
    let kind_of = |x: f64, y: f64| regions.region_at(x as i32, y as i32).map(|r| r.kind);
    // Every kind and richness of node that runs dry on this map.
    let mut kinds: Vec<(ResourceKind, Richness)> =
        world.nodes.iter().filter(|n| n.runs_dry()).map(|n| (n.kind, n.richness)).collect();
    kinds.dedup();
    kinds.sort_by_key(|k| format!("{k:?}"));
    kinds.dedup();
    assert!(kinds.len() >= 4, "{kinds:?}");
    for (kind, richness) in kinds {
        let before = counts(&world);
        let i = first(&world, kind, richness);
        let dry = run_dry(&mut world, i);
        let mut scratch = Scratch { land: Some(land(&world, &terrain)), ..Scratch::default() };
        step_new_veins(&mut world, &terrain, &mut scratch);
        let n = next_of(&world, &dry.id).clone();
        assert_eq!((n.kind, n.richness), (kind, richness));
        assert!(n.stock.is_some_and(|s| s.left == s.first), "{n:?}");
        assert!(fits_terrain(kind, terrain.tiles[(n.y as i32 * SIZE + n.x as i32) as usize]));
        // In a region that fits, not the one it lay in.
        let region = kind_of(n.x, n.y);
        match richness {
            Richness::Rich => {
                let at = (n.x as i32, n.y as i32);
                let id = regions.id_at(at.0, at.1).unwrap();
                let contested = spots
                    .get(&id)
                    .into_iter()
                    .flatten()
                    .any(|&s| wrap_distance(SIZE, at, s) <= NEW_VEIN_SPOT_REACH);
                assert!(
                    region == Some(RegionKind::Island)
                        || (region == Some(RegionKind::Frontier) && contested),
                    "a rich node at {at:?} in {region:?}"
                );
            }
            _ => assert_eq!(region, Some(RegionKind::Frontier)),
        }
        assert_ne!(
            regions.id_at(n.x as i32, n.y as i32),
            regions.id_at(dry.x as i32, dry.y as i32)
        );
        // Out of w1's sight; nobody explored anything, so nothing is hidden.
        let w1 = (world.residents[0].x as i32, world.residents[0].y as i32);
        assert!(wrap_distance(SIZE, w1, (n.x as i32, n.y as i32)) > SIGHT_RANGE);
        assert!(world.new_veins.is_empty());
        assert_eq!(counts(&world), before);
        assert_eq!(veins_counted(&world), []);
        assert_eq!(veins_sound(&world), []);
        // Nobody is told.
        assert!(world.events.is_empty(), "{:?}", world.events);
    }
}

#[test]
fn the_same_seed_places_the_new_node_on_the_same_tile() {
    let (mut world, terrain, _) = generated();
    let i = first(&world, ResourceKind::IronOre, Richness::Normal);
    let dry = run_dry(&mut world, i);
    let placed = |mut world: WorldState| {
        step_new_veins(&mut world, &terrain, &mut Scratch::default());
        let n = next_of(&world, &dry.id);
        (n.x, n.y)
    };
    let once = placed(world.clone());
    assert_eq!(placed(world.clone()), once);
    // Another world's seed draws another order of tiles.
    let mut other = world.clone();
    other.seed += 1;
    let mut places = vec![once, placed(other)];
    places.dedup();
    assert_eq!(places.len(), 2, "{places:?}");
}

#[test]
fn a_player_who_explored_the_tile_before_sees_no_node_there_until_they_look_again() {
    let (mut world, terrain, _) = generated();
    let shared = land(&world, &terrain);
    // Mara has explored the whole map, so the new node comes into being where she explored.
    shared.lock().unwrap().explore_all(MARA);
    let i = first(&world, ResourceKind::IronOre, Richness::Rich);
    let dry = run_dry(&mut world, i);
    let mut scratch = Scratch { land: Some(Arc::clone(&shared)), ..Scratch::default() };
    step_new_veins(&mut world, &terrain, &mut scratch);
    let n = next_of(&world, &dry.id).clone();
    let at = (n.x as i32, n.y as i32);
    assert_eq!(world.new_veins.len(), 1);
    assert_eq!(world.new_veins[0].unseen_by, [MARA]);
    assert_eq!(veins_counted(&world), []);
    let nodes_at = |land: &ExploredTerrain| {
        let (cx, cy) = (at.0 / CHUNK_SIZE, at.1 / CHUNK_SIZE);
        let chunk = land.chunk(MARA, cx, cy).expect("explored");
        decode_chunk(cx, cy, &chunk).nodes.iter().filter(|k| (k.x, k.y) == at).count()
    };
    // Her map shows no node there; another Player who explores it now sees it.
    assert_eq!(nodes_at(&shared.lock().unwrap()), 0);
    shared.lock().unwrap().explore(99, at.0, at.1, 1);
    let chunk = shared.lock().unwrap().chunk(99, at.0 / CHUNK_SIZE, at.1 / CHUNK_SIZE).unwrap();
    assert_eq!(
        decode_chunk(at.0 / CHUNK_SIZE, at.1 / CHUNK_SIZE, &chunk)
            .nodes
            .iter()
            .filter(|k| (k.x, k.y) == at)
            .count(),
        1
    );
    // Away from it, a refresh of her Last seen shows her nothing.
    let realms = ["r1".to_string()];
    refresh_last_seen(&mut world, SIZE, &realms, &mut scratch.last_seen, &mut None, None);
    reveal_new_veins(&mut scratch);
    assert!(scratch.found_veins.is_empty());
    assert_eq!(nodes_at(&shared.lock().unwrap()), 0);
    // She looks again: the node shows, and her map loads its chunk again.
    world.residents[0].x = n.x;
    world.residents[0].y = n.y;
    refresh_last_seen(&mut world, SIZE, &realms, &mut scratch.last_seen, &mut None, None);
    reveal_new_veins(&mut scratch);
    let chunk = shared.lock().unwrap().map().chunk_of(at.0, at.1);
    assert_eq!(scratch.found_veins, [(MARA, chunk)]);
    assert_eq!(nodes_at(&shared.lock().unwrap()), 1);
    assert!(world.new_veins.is_empty());
    assert_eq!(veins_counted(&world), []);
}

#[test]
fn the_nodes_of_each_kind_and_richness_stay_as_many_over_many_dry_nodes() {
    let (mut world, terrain, _) = generated();
    let before = counts(&world);
    let shared = land(&world, &terrain);
    shared.lock().unwrap().explore(MARA, 128, 128, 60);
    let mut scratch = Scratch { land: Some(shared), ..Scratch::default() };
    for round in 0..40 {
        // The ore nodes take turns, the new ones too.
        let i = world
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.runs_dry())
            .map(|(i, _)| i)
            .nth(round % 7);
        let i = i.expect("an ore node that runs dry");
        let dry = run_dry(&mut world, i);
        step_new_veins(&mut world, &terrain, &mut scratch);
        world.tick += 1;
        // Where the map allows, on a tile nobody explored.
        let n = next_of(&world, &dry.id);
        let land = scratch.land.as_ref().unwrap().lock().unwrap();
        assert!(!land.is_explored(MARA, n.x as i32, n.y as i32), "round {round}: {n:?}");
        drop(land);
        assert_eq!(counts(&world), before, "round {round}");
        assert_eq!(veins_counted(&world), [], "round {round}");
        assert_eq!(veins_sound(&world), [], "round {round}");
    }
    assert_eq!(world.dry_nodes.len(), 40);
}

#[test]
fn the_invariant_names_a_dry_node_none_came_for_and_one_followed_by_another_kind() {
    let (mut world, terrain, _) = generated();
    let i = first(&world, ResourceKind::IronOre, Richness::Normal);
    let dry = run_dry(&mut world, i);
    assert_eq!(veins_counted(&world).len(), 1);
    step_new_veins(&mut world, &terrain, &mut Scratch::default());
    assert_eq!(veins_counted(&world), []);
    let next = world.dry_nodes[0].next.clone().unwrap();
    let n = world.nodes.iter_mut().find(|n| n.id == next).unwrap();
    n.richness = Richness::Rich;
    let broken = veins_counted(&world);
    assert_eq!(broken.len(), 1, "{broken:?}");
    assert!(broken[0].message.contains(&dry.id), "{}", broken[0].message);
}

#[test]
fn with_no_fitting_tile_the_node_comes_back_where_it_was_after_its_days() {
    // A tiny plains map: no region on it fits a rich iron node.
    let mut terrain = plains(16);
    terrain.tiles[16 + 7] = Terrain::Hills as u8;
    let mut world = empty_world(&terrain);
    let mut n = ResourceNode::new("n1", ResourceKind::IronOre, 7.0, 1.0);
    n.richness = Richness::Rich;
    n.fill_stock();
    world.nodes.push(n);
    run_dry(&mut world, 0);
    let mut scratch = Scratch::default();
    step_new_veins(&mut world, &terrain, &mut scratch);
    assert!(world.nodes.is_empty());
    assert_eq!(world.waiting_veins.len(), 1);
    assert_eq!(scratch.vein_log.len(), 1, "the server logs it");
    assert_eq!(counts(&world).values().sum::<usize>(), 1);
    assert_eq!(veins_counted(&world), []);
    let back_at = (VEIN_RETURN_DAYS * TICKS_PER_GAME_DAY) as u64;
    assert_eq!(world.waiting_veins[0].back_at, back_at);
    world.tick = back_at - 1;
    step_new_veins(&mut world, &terrain, &mut scratch);
    assert!(world.nodes.is_empty());
    world.tick = back_at;
    scratch.vein_log.clear();
    step_new_veins(&mut world, &terrain, &mut scratch);
    assert!(world.waiting_veins.is_empty());
    let back = &world.nodes[0];
    assert_eq!(
        (back.kind, back.richness, back.x, back.y),
        (ResourceKind::IronOre, Richness::Rich, 7.0, 1.0)
    );
    assert!(back.stock.is_some_and(|s| s.left == s.first));
    assert_eq!(world.dry_nodes[0].next.as_deref(), Some(back.id.as_str()));
    assert_eq!(scratch.vein_log.len(), 1);
    assert_eq!(veins_counted(&world), []);
    assert_eq!(veins_sound(&world), []);
}
