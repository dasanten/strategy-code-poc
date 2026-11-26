//! City areas for the client (T122.7, `CONTEXT.md`: City area): `csp-sim`'s own rules, asked of
//! the buildings the client passes in rather than of the mirror, as the client draws and checks
//! areas from the buildings it knows, those it remembers out of sight too (Last seen), which the
//! mirror doesn't hold. Each call crosses once with a typed array of buildings and answers for all
//! the tiles it is asked about.
//!
//! A building is four numbers: its north-west tile `x`, `y`, its kind as its place in
//! `BuildingKind::ALL` (the client's `BUILDING_KINDS`), and its city, a number the client gives
//! each city it asks about (-1 for none), plus 1000 when it is a construction site.

use std::cell::Cell;

use csp_shared::world::{Building, BuildingKind, ConstructionSite, WorldState};
use csp_sim::queries::city_area;
use wasm_bindgen::prelude::wasm_bindgen;

/// What the client adds to a building's city number when it is a site.
const SITE: i32 = 1000;

thread_local! {
    /// Each world built here gets a `next_id` of its own, so `csp-sim`'s building lookups, cached
    /// by the world they were read from, never take one for another.
    static WORLDS: Cell<u64> = const { Cell::new(0) };
}

/// A world of just these buildings, each of the city `"<n>"` its number names.
fn world_of(buildings: &[i32]) -> Result<WorldState, String> {
    if buildings.len() % 4 != 0 {
        return Err("buildings come four numbers each".into());
    }
    let mut world = WorldState::default();
    world.next_id = WORLDS.with(|n| {
        n.set(n.get() + 1);
        n.get()
    });
    for (i, b) in buildings.chunks_exact(4).enumerate() {
        let kind = *usize::try_from(b[2])
            .ok()
            .and_then(|k| BuildingKind::ALL.get(k))
            .ok_or_else(|| format!("no building kind {}", b[2]))?;
        let (city, site) = if b[3] >= SITE { (b[3] - SITE, true) } else { (b[3], false) };
        world.buildings.push(Building {
            id: format!("b{i}"),
            kind,
            city_id: (city >= 0).then(|| city.to_string()),
            realm_id: None,
            x: f64::from(b[0]),
            y: f64::from(b[1]),
            stock: None,
            site: site.then(|| ConstructionSite { delivered: Default::default(), work: 0.0 }),
            teardown: None,
            closed: None,
            damage: None,
            breedings: None,
            decay: None,
            repair: None,
            ruined_at: None,
            material: None,
        });
    }
    Ok(world)
}

/// Every tile in the area of city `city` among `buildings` (`cityAreaTiles`), each once, as
/// `x, y` pairs.
#[wasm_bindgen(js_name = cityAreaTiles)]
pub fn city_area_tiles(buildings: &[i32], city: i32, size: i32) -> Result<Vec<i32>, String> {
    let world = world_of(buildings)?;
    let tiles = city_area::city_area_tiles(&world, &city.to_string(), size);
    Ok(tiles.into_iter().flat_map(|(x, y)| [x, y]).collect())
}

/// For each tile of `tiles` (`x, y` pairs), whether it lies in the area of city `city` among
/// `buildings` or within `reach` tiles of it (`inCityArea`, `nearCityArea`): 1 or 0.
#[wasm_bindgen(js_name = nearCityArea)]
pub fn near_city_area(
    buildings: &[i32],
    city: i32,
    tiles: &[i32],
    reach: f64,
    size: i32,
) -> Result<Vec<u8>, String> {
    let world = world_of(buildings)?;
    let id = city.to_string();
    Ok(tiles
        .chunks_exact(2)
        .map(|t| {
            let (x, y) = (f64::from(t[0]), f64::from(t[1]));
            u8::from(city_area::near_city_area(&world, &id, x, y, reach, size))
        })
        .collect())
}

/// The cities whose area tile (x, y) lies in (`cityIdsAt`), by their numbers, in the order of
/// their first building among `buildings`.
#[wasm_bindgen(js_name = cityIdsAt)]
pub fn city_ids_at(buildings: &[i32], x: i32, y: i32, size: i32) -> Result<Vec<i32>, String> {
    let world = world_of(buildings)?;
    Ok(city_area::city_ids_at(&world, f64::from(x), f64::from(y), size)
        .iter()
        .filter_map(|id| id.parse().ok())
        .collect())
}

/// For each tile of `tiles` (`x, y` pairs), whether it lies in the area of any city among
/// `buildings` (`citiesAt` not empty): 1 or 0.
#[wasm_bindgen(js_name = inAnyCityArea)]
pub fn in_any_city_area(buildings: &[i32], tiles: &[i32], size: i32) -> Result<Vec<u8>, String> {
    let world = world_of(buildings)?;
    Ok(tiles
        .chunks_exact(2)
        .map(|t| {
            let ids = city_area::city_ids_at(&world, f64::from(t[0]), f64::from(t[1]), size);
            u8::from(!ids.is_empty())
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUSE: i32 = 1;

    fn kind(k: BuildingKind) -> i32 {
        BuildingKind::ALL.iter().position(|x| *x == k).unwrap() as i32
    }

    #[test]
    fn reads_the_kinds_in_their_order() {
        assert_eq!(kind(BuildingKind::House), HOUSE);
    }

    #[test]
    fn answers_as_csp_sim_does_on_the_same_buildings() {
        let size = 64;
        let b = [10, 10, HOUSE, 0, 30, 30, HOUSE, 1, 12, 10, HOUSE, 1000];
        let world = world_of(&b).unwrap();
        let ours = city_area_tiles(&b, 0, size).unwrap();
        let theirs: Vec<i32> = city_area::city_area_tiles(&world, "0", size)
            .into_iter()
            .flat_map(|(x, y)| [x, y])
            .collect();
        assert_eq!(ours, theirs);
        assert!(!ours.is_empty());
        assert_eq!(near_city_area(&b, 0, &[10, 10, 31, 31], 0.0, size).unwrap(), [1, 0]);
        assert_eq!(city_ids_at(&b, 31, 31, size).unwrap(), [1]);
        assert_eq!(in_any_city_area(&b, &[31, 31, 50, 50], size).unwrap(), [1, 0]);
        // A site counts toward no area.
        assert!(city_area_tiles(&[12, 10, HOUSE, 1000], 0, size).unwrap().is_empty());
    }

    #[test]
    fn never_takes_one_worlds_lookup_for_anothers() {
        let size = 64;
        for (x, want) in [(10, [1u8]), (40, [0u8]), (10, [1u8])] {
            assert_eq!(near_city_area(&[x, 10, HOUSE, 0], 0, &[10, 10], 0.0, size).unwrap(), want);
        }
    }
}
