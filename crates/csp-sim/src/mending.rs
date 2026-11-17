//! Mending and worn prices (`CONTEXT.md`: Mending, Wear). A smithy worker set to mend (a work-at
//! order with `makes: "mend"`) puts the most worn piece at the smithy back to good: the gear its
//! workers carry and what lies on its pile, any piece worn or nearly broken. It takes a share of
//! that piece's recipe (`MEND_RECIPE_SHARE`), used up like a batch's input, and a share of a
//! batch's work (`MEND_WORK_SHARE`).
//!
//! A worn piece sells and buys for less: a trade prices each unit it moves at its condition's
//! share (`price_share`), the units going in the order goods move between holders (new first,
//! then the least worn, `crate::wear::move_wear`).

use csp_shared::balance::MAP_SIZE;
use csp_shared::balance::{
    MEND_RECIPE_SHARE, MEND_WORK_SHARE, NEARLY_BROKEN_PRICE_SHARE, RECIPES, WORN_FROM,
    WORN_PRICE_SHARE,
};
use csp_shared::footprint::is_at;
use csp_shared::world::{Building, BuildingKind, Good, Resident, Stock, WorldState};

use crate::queries::building::{building_pile_index, input_at, recipe_input, worker_indices};
use crate::queries::names::{good_of, held, placed};
use crate::wear::{condition_of, lasts, PieceCondition};

/// What a smithy worker names as what they make to mend instead (`workAt("mend")`).
pub const MEND: &str = "mend";

/// The input mending one piece of `good` takes (`CONTEXT.md`: Mending): `MEND_RECIPE_SHARE` of
/// each input of the smithy recipe that makes it, rounded, and at least one unit of its biggest
/// input. `None` for a good no smithy makes.
pub fn mend_input(good: Good) -> Option<Vec<(Good, f64)>> {
    let recipe = RECIPES
        .get("smithy")?
        .iter()
        .find(|r| r.output.0.iter().any(|(g, _)| good_of(g) == Some(good)))?;
    let full = recipe_input(recipe);
    let mut input: Vec<(Good, f64)> = full
        .iter()
        .map(|&(g, n)| (g, (n * MEND_RECIPE_SHARE).round()))
        .filter(|&(_, n)| n > 0.0)
        .collect();
    if input.is_empty() {
        let biggest = full.iter().max_by(|a, b| a.1.total_cmp(&b.1))?;
        input.push((biggest.0, 1.0));
    }
    Some(input)
}

/// Whether a piece with `worn` of its life worn away wants mending: worn or nearly broken.
pub fn wants_mending(worn: f64) -> bool {
    worn >= WORN_FROM
}

/// A piece at a smithy that wants mending: who keeps it, its good, and where in their list of
/// worn pieces it stands.
#[derive(Debug, Clone, PartialEq)]
pub struct WornPiece {
    pub holder_id: String,
    pub good: Good,
    pub index: usize,
    pub worn: f64,
}

/// The most worn piece at a smithy that wants mending and that a smithy can mend (`mend_input`):
/// among what its workers carry, what lies on its pile, and what anyone on their side (their
/// realm, or their city for the game's) standing on the smithy carries: a soldier who brought
/// their worn sword. Ties go to the workers first.
pub fn piece_to_mend(world: &WorldState, smithy: &Building) -> Option<WornPiece> {
    piece_to_mend_for(world, smithy, None)
}

/// [`piece_to_mend`], counting also the residents of game-run city `city_id` standing on the smithy:
/// a city mends its soldiers' gear even while nobody works its smithy yet.
pub fn piece_to_mend_for(
    world: &WorldState,
    smithy: &Building,
    city_id: Option<&str>,
) -> Option<WornPiece> {
    if smithy.kind != BuildingKind::Smithy || smithy.site.is_some() {
        return None;
    }
    let workers = worker_indices(world, smithy);
    let side = |r: &Resident| (r.owner.clone(), r.owner.is_none().then(|| r.city_id.clone()));
    let mut sides: Vec<_> = workers.iter().map(|&i| side(&world.residents[i])).collect();
    if let Some(c) = city_id {
        sides.push((None, Some(Some(c.to_string()))));
    }
    let mut holders: Vec<&str> = workers.iter().map(|&i| world.residents[i].id.as_str()).collect();
    for r in &world.residents {
        let here = is_at((r.x as i32, r.y as i32), placed(smithy), MAP_SIZE);
        if here && r.health > 0.0 && !holders.contains(&r.id.as_str()) && sides.contains(&side(r)) {
            holders.push(&r.id);
        }
    }
    if let Some(p) = building_pile_index(world, smithy) {
        holders.push(&world.piles[p].id);
    }
    let mut best: Option<WornPiece> = None;
    for id in holders {
        let Some(kept) = world.wear.get(id) else { continue };
        for (good, pieces) in kept {
            if mend_input(*good).is_none() {
                continue;
            }
            for (index, &worn) in pieces.iter().enumerate() {
                if wants_mending(worn) && best.as_ref().is_none_or(|b| worn > b.worn) {
                    best = Some(WornPiece { holder_id: id.to_string(), good: *good, index, worn });
                }
            }
        }
    }
    best
}

/// Whether the smithy holds the input to mend `piece` (what its workers carry and its pile).
pub fn has_mend_input(world: &WorldState, smithy: &Building, piece: &WornPiece) -> bool {
    let at = input_at(world, smithy);
    mend_input(piece.good).is_some_and(|input| input.iter().all(|&(g, n)| held(&at, g) >= n))
}

/// What a resident working a smithy fetches to mend its next piece (`inputToFetch(.., "mend")`):
/// what the smithy lacks of that piece's mending input; nothing with nothing to mend.
pub fn mend_input_to_fetch(world: &WorldState, smithy: &Building) -> Stock {
    let Some(piece) = piece_to_mend(world, smithy) else { return Stock::new() };
    let at = input_at(world, smithy);
    mend_input(piece.good)
        .unwrap_or_default()
        .into_iter()
        .filter(|&(g, n)| held(&at, g) < n)
        .map(|(g, n)| (g, n - held(&at, g)))
        .collect()
}

/// The share of a batch's work mending takes, as the factor a mender's batch work goes faster by.
pub fn mend_pace() -> f64 {
    1.0 / MEND_WORK_SHARE
}

/// Puts a worn piece back to good: its wear is gone, so it counts as new.
pub fn mend_piece(world: &mut WorldState, piece: &WornPiece) {
    let Some(kept) = world.wear.get_mut(&piece.holder_id) else { return };
    let Some(pieces) = kept.get_mut(&piece.good) else { return };
    if piece.index < pieces.len() {
        pieces.remove(piece.index);
    }
    if pieces.is_empty() {
        kept.shift_remove(&piece.good);
    }
    if kept.is_empty() {
        world.wear.shift_remove(&piece.holder_id);
    }
}

/// What a piece in `condition` sells and buys for, as a share of a new one's price.
pub fn price_share(condition: PieceCondition) -> f64 {
    match condition {
        PieceCondition::Good => 1.0,
        PieceCondition::Worn => WORN_PRICE_SHARE,
        PieceCondition::NearlyBroken => NEARLY_BROKEN_PRICE_SHARE,
    }
}

/// A unit's price at `share` of a new one's `price`: whole coins, at least one.
pub fn worn_price(price: f64, share: f64) -> f64 {
    if share >= 1.0 {
        price
    } else {
        (price * share).floor().max(1.0)
    }
}

/// The price share of each unit of `good` holder `holder_id` (keeping `units` of it) gives up, in
/// the order they leave it: new pieces first, then the least worn (`crate::wear::move_wear`). A
/// good that doesn't wear, or a holder of only new pieces, gives an empty list: all at full price.
pub fn leaving_shares(world: &WorldState, holder_id: &str, units: f64, good: Good) -> Vec<f64> {
    if lasts(good).is_none() {
        return Vec::new();
    }
    let Some(pieces) = world.wear.get(holder_id).and_then(|w| w.get(&good)) else {
        return Vec::new();
    };
    let new = (units.floor() - pieces.len() as f64).max(0.0) as usize;
    let mut out = vec![1.0; new];
    out.extend(pieces.iter().rev().map(|&w| price_share(condition_of(w))));
    out
}

/// The `n`th unit's (from 0) share of the price among `shares` (`leaving_shares`): 1 past its end.
pub fn share_of(shares: &[f64], n: usize) -> f64 {
    shares.get(n).copied().unwrap_or(1.0)
}

/// How many of the `units` of `good` a holder keeps are in good condition (`CONTEXT.md`: Mending:
/// an NPC city counts only those towards its reserve).
pub fn good_units(world: &WorldState, holder_id: &str, units: f64, good: Good) -> f64 {
    let worn = world
        .wear
        .get(holder_id)
        .and_then(|w| w.get(&good))
        .map_or(0, |p| p.iter().filter(|&&w| wants_mending(w)).count());
    (units - worn as f64).max(0.0)
}

#[cfg(test)]
#[path = "mending/tests.rs"]
mod tests;
