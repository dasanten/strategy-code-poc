//! World queries of `packages/shared/src/goods.ts` about where goods are (ADR 0002: the game API
//! orders and scripts share). `put_away_units`, which needs no world, is in `csp_shared::goods`.

use csp_shared::footprint::covers;
use csp_shared::world::{Building, Good, Resident, WorldState};

use super::building::{pile_tile, KEEPS_GOODS};
use super::names::{held, placed};
use super::residents::{carry_capacity, good_weight, stock_weight};

/// Where in `world.piles` the pile reached from a tile lies, if goods lie there (`pileAt`): on a
/// building's footprint the building's one pile (`CONTEXT.md`: A building's pile), elsewhere the
/// goods on the tile. `size` is the map's (`MAP_SIZE` in the TypeScript).
pub fn pile_index_at(world: &WorldState, x: i32, y: i32, size: i32) -> Option<usize> {
    let (px, py) = pile_tile(world, x, y, size);
    world.piles.iter().position(|p| p.x == f64::from(px) && p.y == f64::from(py))
}

/// The finished building with a storage whose footprint covers a tile, if there is one
/// (`storageAt`): a storage, or a stable's storage for its horses' Food (`KEEPS_GOODS`).
pub fn storage_at(world: &WorldState, x: i32, y: i32, size: i32) -> Option<&Building> {
    world.buildings.iter().find(|b| {
        KEEPS_GOODS.contains(&b.kind) && b.site.is_none() && covers(placed(b), x, y, size)
    })
}

/// How many more whole units of a good fit in what the resident carries at `tick`
/// (`unitsThatFit`).
pub fn units_that_fit(r: &Resident, good: Good, tick: f64) -> f64 {
    let room = carry_capacity(r, tick) - stock_weight(&r.carried);
    (room / good_weight(good) + 1e-9).floor().max(0.0)
}

/// Units of Food a resident carries (`r.carried.food ?? 0`).
pub fn carried_food(r: &Resident) -> f64 {
    held(&r.carried, Good::Food)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::resident;

    #[test]
    fn counts_the_whole_units_that_still_fit() {
        let mut r = resident("r1");
        r.stats.strength.base = 10.0;
        // 10 + 2 * 10 kg.
        assert_eq!(units_that_fit(&r, Good::Food, 0.0), (30.0 / good_weight(Good::Food)).floor());
        r.carried.insert(Good::Stone, 1000.0);
        assert_eq!(units_that_fit(&r, Good::Food, 0.0), 0.0);
    }
}
