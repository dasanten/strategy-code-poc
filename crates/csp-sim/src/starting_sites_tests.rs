use std::collections::BTreeMap;

use super::*;
use crate::invariants::map::nodes_on_fitting_terrain;
use crate::terrain_gen::generate_terrain;
use crate::world::{create_world, generate_world};
use csp_shared::balance::HEARTLAND_COUNT;

/// A world with its nodes and starting sites placed, its regions and terrain.
fn placed(seed: i64, size: i32) -> (WorldState, TerrainMap, Regions) {
    let terrain = generate_terrain(seed, size);
    let mut world = create_world(&terrain, seed);
    place_starting_sites(&mut world, &terrain);
    let regions = Regions::of(seed, &terrain);
    (world, terrain, regions)
}

/// Every rule of the starting sites (`CONTEXT.md`: Starting site) on one generated map: every
/// heartland has its number of them, none closer to another than the rules allow, a walk of
/// `min_seconds` to `max_seconds` (20 to 40 real minutes on a full-size map) from each to the
/// nearest other one, a forest, stone and iron node in reach of each and room for a starting city
/// on each; and the nodes placed for them keep the nodes' own rules.
fn assert_the_sites(seed: i64, size: i32) {
    let (world, terrain, regions) = placed(seed, size);
    let rules = SiteRules::for_size(size);
    let mut per: BTreeMap<u32, usize> = BTreeMap::new();
    for s in &world.starting_sites {
        *per.entry(s.region).or_default() += 1;
    }
    for h in regions.of_kind(RegionKind::Heartland) {
        assert_eq!(
            per.get(&h.id).copied(),
            Some(STARTING_SITES_PER_HEARTLAND as usize),
            "{seed}-{size}: heartland {}",
            h.name
        );
    }
    assert_eq!(per.len(), HEARTLAND_COUNT as usize, "{seed}-{size}: sites outside the heartlands");
    assert_eq!(check_starting_sites(&world, &terrain, &regions), [], "{seed}-{size}");

    // The walk to the nearest other site, in its heartland, apart from the check.
    for s in &world.starting_sites {
        let others: Vec<(i32, i32)> = world
            .starting_sites
            .iter()
            .filter(|o| o.region == s.region && *o != s)
            .map(site_middle)
            .collect();
        let walk = walk_seconds(&terrain, site_middle(s), &others, rules.max_seconds);
        let walk = walk.unwrap_or_else(|| panic!("{seed}-{size}: {s:?} has no neighbour"));
        assert!(walk >= rules.min_seconds, "{seed}-{size}: {s:?} {walk} s from the next");
    }

    // A forest node a short walk away (T113.2): within the forest reach, on Forest.
    for s in &world.starting_sites {
        let m = site_middle(s);
        let near = world.nodes.iter().any(|n| {
            let at = (n.x as i32, n.y as i32);
            n.kind == ResourceKind::Forest
                && wrap_distance(size, at, m) <= STARTING_SITE_FOREST_REACH
                && terrain_at(&terrain, at.0, at.1) == Terrain::Forest as u8
        });
        assert!(near, "{seed}-{size}: {s:?} has no forest node a short walk away");
    }

    // The nodes: on fitting terrain, apart, with unique ids, and none on a site.
    assert_eq!(nodes_on_fitting_terrain(&world, &terrain), []);
    let ids: HashSet<&str> = world.nodes.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids.len(), world.nodes.len());
    let spacing = NODE_MIN_SPACING as i32;
    let mut by_cell: BTreeMap<(i32, i32), Vec<(i32, i32)>> = BTreeMap::new();
    for n in &world.nodes {
        let at = (n.x as i32, n.y as i32);
        for cy in at.1 / spacing - 1..=at.1 / spacing + 1 {
            for cx in at.0 / spacing - 1..=at.0 / spacing + 1 {
                for &o in by_cell.get(&(cx, cy)).into_iter().flatten() {
                    let apart = wrap_delta(o.0, at.0, size).abs() >= spacing
                        || wrap_delta(o.1, at.1, size).abs() >= spacing;
                    assert!(apart, "{seed}-{size}: nodes at {o:?} and {at:?}");
                }
            }
        }
        by_cell.entry((at.0 / spacing, at.1 / spacing)).or_default().push(at);
        for s in &world.starting_sites {
            assert!(!on_site(size, (s.x, s.y), at), "{seed}-{size}: node at {at:?} on {s:?}");
        }
    }
}

#[test]
fn every_heartland_has_its_starting_sites_seed_1_1536() {
    assert_the_sites(1, 1536);
}

#[test]
fn every_heartland_has_its_starting_sites_seed_3_1536() {
    assert_the_sites(3, 1536);
}

#[test]
fn every_heartland_has_its_starting_sites_seed_2_2048() {
    assert_the_sites(2, 2048);
}

#[test]
fn every_heartland_has_its_starting_sites_seed_4_2048() {
    assert_the_sites(4, 2048);
}

/// On full-size maps, with the balance file's numbers as they are: the walk between neighbouring
/// sites takes 20 to 40 real minutes. Run with `cargo test --release -- --ignored`.
#[test]
#[ignore = "25.1 s alone: generates full-size maps"]
fn starting_sites_are_a_20_to_40_minute_walk_apart_on_full_size_maps() {
    let rules = SiteRules::for_size(MAP_SIZE);
    assert_eq!(rules.min_seconds, STARTING_SITE_WALK.min_minutes * 60.0);
    assert_eq!(rules.max_seconds, STARTING_SITE_WALK.max_minutes * 60.0);
    assert_eq!(rules.min_seconds, 20.0 * 60.0);
    assert_eq!(rules.max_seconds, 40.0 * 60.0);
    for seed in [1, 2, 3] {
        assert_the_sites(seed, MAP_SIZE);
    }
}

#[test]
fn the_same_world_gets_the_same_sites_and_another_world_other_ones() {
    let (world, _, _) = placed(1, 1536);
    assert_eq!(placed(1, 1536).0, world);
    assert_ne!(placed(2, 1536).0.starting_sites, world.starting_sites);
}

#[test]
fn frontier_regions_and_islands_hold_denser_nodes_than_heartlands() {
    let terrain = generate_terrain(1, 2048);
    let regions = Regions::of(1, &terrain);
    let nodes = place_resource_nodes_by_region(&terrain, 1, &regions);
    // Nodes per tile of terrain an iron or stone node may lie on, by kind of region.
    let mut tiles: BTreeMap<u8, f64> = BTreeMap::new();
    for (t, &tile) in terrain.tiles.iter().enumerate() {
        if tile == Terrain::Hills as u8
            || tile == Terrain::Mountain as u8
            || tile == Terrain::Forest as u8
        {
            if let Some(r) = regions.id_of_tile(t) {
                *tiles.entry(regions.regions[r as usize].kind as u8).or_default() += 1.0;
            }
        }
    }
    let mut count: BTreeMap<u8, f64> = BTreeMap::new();
    for n in &nodes {
        if let Some(r) = regions.id_at(n.x as i32, n.y as i32) {
            *count.entry(regions.regions[r as usize].kind as u8).or_default() += 1.0;
        }
    }
    let per = |k: RegionKind| count.get(&(k as u8)).copied().unwrap_or(0.0) / tiles[&(k as u8)];
    assert!(per(RegionKind::Frontier) > per(RegionKind::Heartland) * 1.2, "{count:?} {tiles:?}");
    assert!(per(RegionKind::Island) > per(RegionKind::Heartland) * 1.2, "{count:?} {tiles:?}");
}

/// Coal (`CONTEXT.md`: Rare goods) lies in frontier regions and on islands, on Hills and
/// Mountain, and in no heartland; a map without regions has none.
#[test]
fn coal_lies_only_in_frontier_regions_and_on_islands() {
    let terrain = generate_terrain(1, 1536);
    let regions = Regions::of(1, &terrain);
    let nodes = place_resource_nodes_by_region(&terrain, 1, &regions);
    let mut coal: BTreeMap<u8, usize> = BTreeMap::new();
    for n in nodes.iter().filter(|n| n.kind == ResourceKind::Coal) {
        let t = terrain_at(&terrain, n.x as i32, n.y as i32);
        assert!(t == Terrain::Hills as u8 || t == Terrain::Mountain as u8, "{n:?} on {t}");
        let r = regions.id_at(n.x as i32, n.y as i32).expect("coal in a region");
        *coal.entry(regions.regions[r as usize].kind as u8).or_default() += 1;
    }
    assert_eq!(coal.get(&(RegionKind::Heartland as u8)), None, "{coal:?}");
    assert!(coal.get(&(RegionKind::Frontier as u8)).copied().unwrap_or(0) > 5, "{coal:?}");
    assert!(coal.get(&(RegionKind::Island as u8)).copied().unwrap_or(0) > 0, "{coal:?}");
    let plain = crate::node_gen::place_resource_nodes(&terrain, 1);
    assert!(plain.iter().all(|n| n.kind != ResourceKind::Coal));
}

/// The world generator places the sites before any city, all of them free, and the Trade Org HQ,
/// trading posts and NPC cities it places after them leave each site its room.
#[test]
fn a_generated_world_has_the_starting_sites_all_free_with_room_for_a_city() {
    let terrain = generate_terrain(1, 1536);
    let world = generate_world(&terrain, 1);
    assert_eq!(
        world.starting_sites.len(),
        (STARTING_SITES_PER_HEARTLAND * HEARTLAND_COUNT) as usize
    );
    assert!(world.starting_sites.iter().all(|s| s.city_id.is_none()));
    let mut only = create_world(&terrain, 1);
    place_starting_sites(&mut only, &terrain);
    assert_eq!(world.starting_sites, only.starting_sites);
    assert_eq!(free_starting_sites(&world, world.starting_sites[0].region).count(), 10);
    assert_eq!(check_starting_sites(&world, &terrain, &Regions::of(1, &terrain)), []);
}

/// `CONTEXT.md`: Richness. Every heartland node is poor, the starting sites' own ones too; every
/// island node is rich; a frontier region's nodes are normal but for its `FRONTIER_RICH_NODES`
/// nearest its ways and its borders with other frontier regions.
#[test]
fn heartland_nodes_are_poor_island_nodes_rich_and_frontier_ones_normal_but_for_a_few() {
    use csp_shared::balance::FRONTIER_RICH_NODES;
    use csp_shared::world::Richness;
    let (world, _, regions) = placed(1, 1536);
    let mut rich_in: BTreeMap<u32, usize> = BTreeMap::new();
    let mut in_frontier: BTreeMap<u32, usize> = BTreeMap::new();
    let mut kinds_seen = [false; 3];
    for n in &world.nodes {
        let region = regions.region_at(n.x as i32, n.y as i32).expect("a node on land");
        kinds_seen[region.kind as usize] = true;
        match region.kind {
            RegionKind::Heartland => assert_eq!(n.richness, Richness::Poor, "{n:?}"),
            RegionKind::Island => assert_eq!(n.richness, Richness::Rich, "{n:?}"),
            RegionKind::Frontier => {
                assert_ne!(n.richness, Richness::Poor, "{n:?}");
                *in_frontier.entry(region.id).or_default() += 1;
                if n.richness == Richness::Rich {
                    *rich_in.entry(region.id).or_default() += 1;
                }
            }
        }
    }
    assert_eq!(kinds_seen, [true; 3], "nodes in every kind of region");
    for (id, count) in in_frontier {
        let want = count.min(FRONTIER_RICH_NODES as usize);
        assert_eq!(rich_in.get(&id).copied().unwrap_or(0), want, "frontier region {id}");
    }
}

/// The rich nodes of a frontier region lie nearer its ways and borders than its normal ones do,
/// on the whole.
#[test]
fn a_frontier_regions_rich_nodes_lie_near_its_ways_and_borders() {
    use csp_shared::terrain::wrap_distance;
    use csp_shared::world::Richness;
    let (world, terrain, regions) = placed(1, 1536);
    let mut near = [0.0f64; 3];
    let mut count = [0.0f64; 3];
    for n in &world.nodes {
        let at = (n.x as i32, n.y as i32);
        let Some(r) = regions.region_at(at.0, at.1) else { continue };
        if r.kind != RegionKind::Frontier {
            continue;
        }
        let d = regions
            .ways
            .iter()
            .filter(|w| w.between.contains(&r.id))
            .map(|w| wrap_distance(terrain.size, at, (w.x, w.y)))
            .fold(f64::INFINITY, f64::min);
        if d.is_finite() {
            near[n.richness as usize] += d;
            count[n.richness as usize] += 1.0;
        }
    }
    let mean = |r: Richness| near[r as usize] / count[r as usize];
    assert!(count[Richness::Rich as usize] > 0.0 && count[Richness::Normal as usize] > 0.0);
    assert!(mean(Richness::Rich) < mean(Richness::Normal), "{near:?} {count:?}");
}
