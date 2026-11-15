use super::*;
use crate::terrain_gen::{check_terrain, generate_terrain};

/// Seeds and sizes the rules are checked on: big enough for every region to have room.
const MAPS: [(i64, i32); 5] = [(1, 512), (2, 512), (10, 512), (7, 768), (16, 256)];

fn region_of(regions: &Regions, t: usize) -> Option<u32> {
    regions.id_of_tile(t)
}

/// Whether a carriage can get from a tile of region `a` to one of region `b` on their own tiles
/// (4 neighbours, drivable terrain) once the tiles in `closed` are shut.
fn drives_across(
    map: &TerrainMap,
    regions: &Regions,
    a: u32,
    b: u32,
    closed: &HashSet<usize>,
) -> bool {
    let on = |t: usize| {
        !closed.contains(&t) && matches!(region_of(regions, t), Some(r) if r == a || r == b)
    };
    let mut seen = vec![false; map.tiles.len()];
    let mut stack = Vec::new();
    for start in 0..map.tiles.len() {
        if seen[start] || region_of(regions, start) != Some(a) || !on(start) {
            continue;
        }
        if !drivable(map.tiles[start]) {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        while let Some(t) = stack.pop() {
            if region_of(regions, t) == Some(b) {
                return true;
            }
            for nb in neighbours(map.size, t) {
                if !seen[nb] && on(nb) && drivable(map.tiles[nb]) {
                    seen[nb] = true;
                    stack.push(nb);
                }
            }
        }
    }
    false
}

/// The pairs of mainland regions whose tiles touch (4 neighbours).
fn touching(map: &TerrainMap, regions: &Regions) -> BTreeMap<(u32, u32), usize> {
    let mut pairs = BTreeMap::new();
    for t in 0..map.tiles.len() {
        let Some(a) = region_of(regions, t) else { continue };
        if regions.regions[a as usize].kind == RegionKind::Island {
            continue;
        }
        for nb in neighbours(map.size, t) {
            if let Some(b) = region_of(regions, nb) {
                if b != a {
                    *pairs.entry(pair(a, b)).or_default() += 1;
                }
            }
        }
    }
    pairs
}

#[test]
fn every_land_tile_has_one_region_and_the_counts_are_the_balance_numbers() {
    for (seed, size) in MAPS {
        let map = generate_terrain(seed, size);
        assert_eq!(check_terrain(&map), [], "{seed}-{size}");
        let regions = Regions::of(seed, &map);
        assert_eq!(check_regions(&map, &regions), [], "{seed}-{size}");
        let land = Land::of(&map);
        for t in 0..map.tiles.len() {
            assert_eq!(land.group[t] != -1, region_of(&regions, t).is_some(), "{seed}-{size} {t}");
        }
        let count = |k| regions.of_kind(k).filter(|r| r.tiles > 0).count();
        assert_eq!(count(RegionKind::Heartland), HEARTLAND_COUNT as usize);
        assert_eq!(count(RegionKind::Frontier), FRONTIER_REGION_COUNT as usize);
        assert_eq!(count(RegionKind::Island), land.islands().count());
        // Each island is its own region, the whole of it.
        for g in land.islands() {
            let ids: HashSet<Option<u32>> = (0..map.tiles.len())
                .filter(|&t| land.group[t] == g)
                .map(|t| region_of(&regions, t))
                .collect();
            assert_eq!(ids.len(), 1, "island {g}");
        }
        // Every region's tile to point at is its own.
        for r in &regions.regions {
            assert_eq!(regions.id_at(r.x, r.y), Some(r.id), "{}", r.name);
        }
    }
}

#[test]
fn a_carriage_drives_between_any_two_mainland_regions_and_crosses_a_border_only_at_its_ways() {
    for (seed, size) in MAPS {
        let map = generate_terrain(seed, size);
        let regions = Regions::of(seed, &map);
        // One group for a carriage over the whole mainland: a path between every two regions.
        let mainland = |t: usize| {
            region_of(&regions, t)
                .is_some_and(|id| regions.regions[id as usize].kind != RegionKind::Island)
        };
        assert_eq!(drive_groups(&map, &mainland).len(), 1, "{seed}-{size}");
        let pairs = touching(&map, &regions);
        assert!(pairs.len() >= HEARTLAND_COUNT as usize + FRONTIER_REGION_COUNT as usize - 1);
        for &(a, b) in pairs.keys() {
            let ways: Vec<&Way> = regions.ways_between(a, b).collect();
            let closed: HashSet<usize> =
                ways.iter().flat_map(|w| w.tiles.iter().copied()).collect();
            assert!(
                !drives_across(&map, &regions, a, b, &closed),
                "{seed}-{size}: a carriage crosses between {a} and {b} outside its ways"
            );
            for way in ways {
                assert!(way.width >= pass_width(size) as u32, "{way:?}");
                for &t in &way.tiles {
                    assert_ne!(map.tiles[t], Terrain::Mountain as u8);
                }
                if way.kind == WayKind::Pass {
                    let (x, y) = (way.x, way.y);
                    assert_eq!(
                        csp_shared::terrain::terrain_at(&map, x, y),
                        Terrain::Hills as u8,
                        "a pass is a gap of Hills"
                    );
                }
            }
        }
        // Most pairs of touching regions have one or two ways.
        let few =
            pairs.keys().filter(|&&(a, b)| (1..=2).contains(&regions.ways_between(a, b).count()));
        assert!(few.count() * 2 >= pairs.len(), "{seed}-{size}");
    }
}

#[test]
fn borders_are_ranges_and_arms_of_the_sea_with_passes_and_land_bridges() {
    let mut kinds = HashSet::new();
    for (seed, size) in MAPS {
        let map = generate_terrain(seed, size);
        let regions = Regions::of(seed, &map);
        kinds.extend(regions.ways.iter().map(|w| w.kind));
    }
    assert!(kinds.contains(&WayKind::Pass) && kinds.contains(&WayKind::LandBridge), "{kinds:?}");
}

#[test]
fn heartlands_are_mostly_plains_and_do_not_touch() {
    // Land tiles of each kind of region, and of those how many are Plains and how many high
    // (Hills or Mountain), over all the maps: an island alone may be all forest.
    let mut counts: HashMap<RegionKind, [usize; 3]> = HashMap::new();
    for (seed, size) in MAPS {
        let map = generate_terrain(seed, size);
        let regions = Regions::of(seed, &map);
        let mut heart = [0usize; 3];
        for t in 0..map.tiles.len() {
            let Some(id) = region_of(&regions, t) else { continue };
            let kind = regions.regions[id as usize].kind;
            let tile = Terrain::from_byte(map.tiles[t]);
            let add = [
                1,
                usize::from(tile == Some(Terrain::Plains)),
                usize::from(matches!(tile, Some(Terrain::Hills | Terrain::Mountain))),
            ];
            let c = counts.entry(kind).or_default();
            for i in 0..3 {
                c[i] += add[i];
                if kind == RegionKind::Heartland {
                    heart[i] += add[i];
                }
            }
        }
        let plains = heart[1] as f64 / heart[0] as f64;
        assert!(plains > 0.5, "{seed}-{size}: heartlands are {plains} Plains");
        for &(a, b) in touching(&map, &regions).keys() {
            let both = [a, b].map(|id| regions.regions[id as usize].kind);
            assert_ne!(
                both,
                [RegionKind::Heartland; 2],
                "{seed}-{size}: heartlands {a} and {b} touch"
            );
        }
    }
    let high = |kind| {
        let c = counts[&kind];
        c[2] as f64 / c[0] as f64
    };
    assert!(high(RegionKind::Frontier) > high(RegionKind::Heartland) + 0.1);
    assert!(high(RegionKind::Island) > high(RegionKind::Heartland) + 0.1);
}

#[test]
fn regions_names_and_ways_are_the_same_for_the_same_seed() {
    let map = generate_terrain(3, 512);
    let regions = Regions::of(3, &map);
    assert_eq!(generate_terrain(3, 512), map);
    assert_eq!(Regions::of(3, &map), regions);
    let names: HashSet<&str> = regions.regions.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names.len(), regions.regions.len(), "every region has a name of its own");
    let other = Regions::of(4, &generate_terrain(4, 512));
    assert_ne!(other.ways, regions.ways);
}

#[test]
fn names_run_on_with_a_numeral_once_the_list_is_used() {
    let names = region_names(1, REGION_NAMES.len() + 2);
    let distinct: HashSet<&String> = names.iter().collect();
    assert_eq!(distinct.len(), names.len());
    assert!(names[REGION_NAMES.len()].ends_with(" 2"));
}

#[test]
fn a_tiny_map_keeps_the_rules_of_the_land() {
    let map = generate_terrain(1, 64);
    assert_eq!(check_terrain(&map), []);
    let regions = Regions::of(1, &map);
    let land = Land::of(&map);
    for t in 0..map.tiles.len() {
        assert_eq!(land.group[t] != -1, region_of(&regions, t).is_some());
    }
}

#[test]
fn reports_land_without_a_region_and_a_mainland_split_for_carriages() {
    let mut map = generate_terrain(1, 512);
    let regions = Regions::of(1, &map);
    // A wall of Mountain across the mainland's middle row splits it for a carriage.
    let y = 256;
    for x in 0..512 {
        let t = (y * 512 + x) as usize;
        if map.tiles[t] != Terrain::Sea as u8 && map.tiles[t] != Terrain::Lake as u8 {
            map.tiles[t] = Terrain::Mountain as u8;
        }
    }
    let rules: Vec<&str> = check_regions(&map, &regions).iter().map(|p| p.rule).collect();
    assert!(rules.contains(&"mainland-drivable"), "{rules:?}");
    // Land where the regions say water.
    let water = (0..map.tiles.len()).find(|&t| map.tiles[t] == Terrain::Sea as u8 && t > 512 * 40);
    let mut map = generate_terrain(1, 512);
    map.tiles[water.expect("sea")] = Terrain::Plains as u8;
    let rules: Vec<&str> = check_regions(&map, &regions).iter().map(|p| p.rule).collect();
    assert!(rules.contains(&"region-everywhere"), "{rules:?}");
}
