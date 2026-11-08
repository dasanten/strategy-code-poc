//! Building queries of `packages/shared/src/building.ts`: what stands on a tile, the finished
//! roads, recipes.

use std::collections::HashSet;

use csp_shared::balance::{Recipe, RECIPES};
use csp_shared::footprint::covers;
use csp_shared::terrain::tile_index;
use csp_shared::world::{Building, BuildingKind, WorldState};

use super::names::{kind_name, placed};

/// Kinds that may share a tile with a building (`SHARES_A_TILE`): roads and carriage sites.
pub const SHARES_A_TILE: [BuildingKind; 2] = [BuildingKind::Road, BuildingKind::Carriage];

/// Kinds that keep goods (`KEEPS_GOODS`): storages, warehouses and stables.
pub const KEEPS_GOODS: [BuildingKind; 3] =
    [BuildingKind::Storage, BuildingKind::Warehouse, BuildingKind::Stable];

/// Where in `world.buildings` the building or construction site whose footprint covers (x, y)
/// stands, if one does (`buildingAt`): the first in the world's order, roads and carriage sites
/// aside.
pub fn building_index_at(world: &WorldState, x: i32, y: i32, size: i32) -> Option<usize> {
    world
        .buildings
        .iter()
        .position(|b| covers(placed(b), x, y, size) && !SHARES_A_TILE.contains(&b.kind))
}

/// The building or construction site whose footprint covers (x, y) (`buildingAt`).
pub fn building_at(world: &WorldState, x: i32, y: i32, size: i32) -> Option<&Building> {
    building_index_at(world, x, y, size).map(|i| &world.buildings[i])
}

/// The tiles with a finished road (`roadTiles`), as tile indices.
pub fn road_tiles(world: &WorldState, size: i32) -> HashSet<usize> {
    world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Road && b.site.is_none())
        .map(|b| tile_index(size, b.x as i32, b.y as i32))
        .collect()
}

/// The good a recipe makes (`recipeGood`): its first output.
pub fn recipe_good(recipe: &Recipe) -> &'static str {
    recipe.output.0[0].0
}

/// The recipe a worker follows at a workplace that processes goods (`recipeFor`): the one that
/// makes `makes`, or with none the workplace's only recipe.
pub fn recipe_for(kind: BuildingKind, makes: Option<&str>) -> Option<&'static Recipe> {
    let recipes = RECIPES.get(kind_name(kind)).unwrap_or(&[]);
    match makes {
        None => (recipes.len() == 1).then(|| &recipes[0]),
        Some(good) => recipes.iter().find(|r| recipe_good(r) == good),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_smithy_needs_to_be_told_what_it_makes() {
        assert!(recipe_for(BuildingKind::Smithy, None).is_none());
        let spear = recipe_for(BuildingKind::Smithy, Some("spear")).unwrap();
        assert_eq!(recipe_good(spear), "spear");
        assert_eq!(recipe_good(recipe_for(BuildingKind::Mint, None).unwrap()), "coins");
        assert!(recipe_for(BuildingKind::House, None).is_none());
    }
}
