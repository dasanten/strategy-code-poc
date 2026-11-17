//! Wear (`CONTEXT.md`: Wear): a weapon wears with each blow it strikes, a shield or armour with
//! each blow it takes, and all of them a little in training. A piece fights as well as new until
//! it is worn out; then it **breaks** and is gone from wherever it was.
//!
//! Goods are counted, so a piece's wear is kept apart from the counts, in `WorldState::wear`: by
//! the id of the resident, building, carriage, vessel or pile keeping it, for each good the share
//! of its life each *used* piece has worn away, most worn first. Units not listed are as new, so
//! storages and carriages full of new gear list nothing, and a save from before Wear reads as all
//! gear in good condition.
//!
//! A resident uses the most worn piece of a kind they carry ([`in_use`]): that is the one a blow
//! wears. Goods moved between two holders ([`crate::holders::move_between`]) take their wear along,
//! new pieces first, then the least worn, so the piece in use stays with whoever uses it. Where
//! goods move some other way, [`settle_wear`] (at the end of each tick) keeps every list within
//! the units its holder still has, dropping the least worn first, and forgets holders that are
//! gone.

use csp_shared::balance::{NEARLY_BROKEN_FROM, TRAINING_WEAR_BLOWS_PER_DAY, WEAR_BLOWS, WORN_FROM};
use csp_shared::time::TICKS_PER_GAME_DAY;
pub use csp_shared::world::{GearCondition, PieceCondition};
use csp_shared::world::{Good, Resident, Stock, Wear, WorldState};
use indexmap::IndexMap;

use crate::equipment::{equipped, settle_equipment, Slot, SLOTS};
use crate::invariants::InvariantViolation;
use crate::queries::goods::take_out;
use crate::queries::names::{good_name, held};

/// The condition of a piece with `worn` of its life worn away.
pub fn condition_of(worn: f64) -> PieceCondition {
    if worn >= NEARLY_BROKEN_FROM {
        PieceCondition::NearlyBroken
    } else if worn >= WORN_FROM {
        PieceCondition::Worn
    } else {
        PieceCondition::Good
    }
}

/// The condition's name in scripts and on the card: `good`, `worn` or `nearlyBroken`.
pub fn condition_name(c: PieceCondition) -> &'static str {
    match c {
        PieceCondition::Good => "good",
        PieceCondition::Worn => "worn",
        PieceCondition::NearlyBroken => "nearlyBroken",
    }
}

/// How many blows a piece of `good` lasts (`WEAR_BLOWS`); `None` for a good that doesn't wear.
pub fn lasts(good: Good) -> Option<f64> {
    WEAR_BLOWS.get(good_name(good))
}

/// The share of its life the piece of `good` that `holder_id` uses has worn away: the most worn
/// one they keep, 0 when all of them are new.
pub fn in_use(world: &WorldState, holder_id: &str, good: Good) -> f64 {
    world
        .wear
        .get(holder_id)
        .and_then(|w| w.get(&good))
        .and_then(|p| p.first())
        .copied()
        .unwrap_or(0.0)
}

/// The condition of what a resident has in `slot` as the rules count it, if anything.
pub fn slot_condition(world: &WorldState, r: &Resident, slot: Slot) -> Option<PieceCondition> {
    equipped(r, slot).map(|g| condition_of(in_use(world, &r.id, g)))
}

/// What a resident's slots hold, in condition: `{ weapon, shield, armour }`, each `good`, `worn`
/// or `nearlyBroken`, an empty slot left out. Only for the realm carrying it (`CONTEXT.md`: Wear).
pub fn gear_condition(world: &WorldState, r: &Resident) -> GearCondition {
    let c = |slot| slot_condition(world, r, slot);
    GearCondition { weapon: c(Slot::Weapon), shield: c(Slot::Shield), armour: c(Slot::Armour) }
}

/// The JSON of [`gear_condition`]: what a script's view of one of its own residents shows.
pub fn condition_json(world: &WorldState, r: &Resident) -> serde_json::Value {
    serde_json::to_value(gear_condition(world, r)).unwrap_or(serde_json::Value::Null)
}

/// Wears the piece of `good` in use among `stock` (kept by `holder_id`) by `blows` blows. Worn
/// out, it breaks: it is gone from `stock` and from the wear kept. Returns whether it broke.
fn wear_piece(
    wear: &mut IndexMap<String, Wear>,
    holder_id: &str,
    stock: &mut Stock,
    good: Good,
    blows: f64,
) -> bool {
    let Some(life) = lasts(good) else { return false };
    if held(stock, good) < 1.0 || blows <= 0.0 {
        return false;
    }
    let kept = wear.entry(holder_id.to_string()).or_default();
    let pieces = kept.entry(good).or_default();
    if pieces.is_empty() {
        pieces.push(0.0);
    }
    pieces[0] += blows / life;
    let broke = pieces[0] >= 1.0;
    if broke {
        pieces.remove(0);
        take_out(stock, good, 1.0);
    }
    if pieces.is_empty() {
        kept.shift_remove(&good);
    }
    if kept.is_empty() {
        wear.shift_remove(holder_id);
    }
    broke
}

/// Wears what resident `ri` has in `slot` by `blows` blows. A piece that breaks is gone, and the
/// slot fills with the next best carried (`CONTEXT.md`: Equipment). Returns the good that broke.
pub fn wear_slot(world: &mut WorldState, ri: usize, slot: Slot, blows: f64) -> Option<Good> {
    let r = &world.residents[ri];
    let good = equipped(r, slot)?;
    let id = r.id.clone();
    let r = &mut world.residents[ri];
    if !wear_piece(&mut world.wear, &id, &mut r.carried, good, blows) {
        return None;
    }
    settle_equipment(r);
    Some(good)
}

/// A tick of training for resident `ri` (`CONTEXT.md`: Wear): each piece they have equipped wears
/// by `TRAINING_WEAR_BLOWS_PER_DAY` over a game day.
pub fn wear_in_training(world: &mut WorldState, ri: usize) {
    for slot in SLOTS {
        wear_slot(world, ri, slot, TRAINING_WEAR_BLOWS_PER_DAY / TICKS_PER_GAME_DAY);
    }
}

/// Moves the wear of `units` units of `good` from holder `from` (which kept `from_units` of it
/// before) to holder `to`: new pieces go first, then the least worn.
pub fn move_wear(
    world: &mut WorldState,
    from: &str,
    to: &str,
    good: Good,
    units: f64,
    from_units: f64,
) {
    let Some(kept) = world.wear.get_mut(from) else { return };
    let Some(pieces) = kept.get_mut(&good) else { return };
    let new = (from_units.floor() - pieces.len() as f64).max(0.0);
    let used = ((units.floor() - new).max(0.0) as usize).min(pieces.len());
    if used == 0 {
        return;
    }
    let moved = pieces.split_off(pieces.len() - used);
    if pieces.is_empty() {
        kept.shift_remove(&good);
    }
    if kept.is_empty() {
        world.wear.shift_remove(from);
    }
    let into = world.wear.entry(to.to_string()).or_default().entry(good).or_default();
    into.extend(moved);
    into.sort_by(|a, b| b.total_cmp(a));
}

/// Hands all the wear `from` kept to `to`, which took every unit `from` had (a fallen resident's
/// loot).
pub fn hand_over_wear(world: &mut WorldState, from: &str, to: &str) {
    let Some(w) = world.wear.shift_remove(from) else { return };
    let kept = world.wear.entry(to.to_string()).or_default();
    for (good, pieces) in w {
        let into = kept.entry(good).or_default();
        into.extend(pieces);
        into.sort_by(|a, b| b.total_cmp(a));
    }
}

/// Keeps each list of worn pieces within what its holder keeps (`settle_wear`).
fn within(w: &mut Wear, stock: &Stock) {
    w.retain(|g, pieces| {
        pieces.truncate(held(stock, *g).floor().max(0.0) as usize);
        !pieces.is_empty() && lasts(*g).is_some()
    });
}

/// Keeps the wear in step with the goods (end of each tick): each holder's worn pieces within the
/// units it still keeps, the least worn going first, and nothing kept for a holder that is gone.
pub fn settle_wear(world: &mut WorldState) {
    if world.wear.is_empty() {
        return;
    }
    let mut left = std::mem::take(&mut world.wear);
    let mut kept: IndexMap<String, Wear> = IndexMap::new();
    let mut settle = |id: &str, stock: &Stock| {
        if let Some(mut w) = left.swap_remove(id) {
            within(&mut w, stock);
            if !w.is_empty() {
                kept.insert(id.to_string(), w);
            }
        }
    };
    let empty = Stock::new();
    for r in &world.residents {
        settle(&r.id, &r.carried);
    }
    for b in &world.buildings {
        settle(&b.id, b.stock.as_ref().unwrap_or(&empty));
    }
    for c in &world.carriages {
        settle(&c.id, &c.load);
    }
    for v in &world.vessels {
        settle(&v.id, &v.load);
    }
    for p in &world.piles {
        settle(&p.id, &p.goods);
    }
    world.wear = kept;
}

/// What breaks the Wear rules, if anything (ADR 0004): every holder kept wear for is in the
/// world, each piece's wear stays within 0 up to 1 (a worn-out piece broke and is gone), the
/// pieces listed are no more than the units kept, most worn first, and only gear wears.
pub fn wear_problems(world: &WorldState) -> Vec<InvariantViolation> {
    let name = "wear-sound";
    let mut stocks: IndexMap<&str, &Stock> = IndexMap::new();
    let empty = Stock::new();
    for r in &world.residents {
        stocks.insert(&r.id, &r.carried);
    }
    for b in &world.buildings {
        stocks.insert(&b.id, b.stock.as_ref().unwrap_or(&empty));
    }
    for c in &world.carriages {
        stocks.insert(&c.id, &c.load);
    }
    for v in &world.vessels {
        stocks.insert(&v.id, &v.load);
    }
    for p in &world.piles {
        stocks.insert(&p.id, &p.goods);
    }
    let mut out = Vec::new();
    let mut flag = |id: &str, msg: String| {
        out.push(crate::invariants::violation(name, format!("{id}: {msg}"), &[id]));
    };
    for (id, w) in &world.wear {
        let Some(stock) = stocks.get(id.as_str()) else {
            flag(id, "wear kept for a holder that is gone".into());
            continue;
        };
        for (g, pieces) in w {
            let gn = good_name(*g);
            if lasts(*g).is_none() {
                flag(id, format!("{gn} wears but is no gear"));
            }
            if pieces.is_empty() {
                flag(id, format!("an empty list of worn {gn}"));
            }
            if pieces.iter().any(|p| !(0.0..1.0).contains(p)) {
                flag(id, format!("{gn} worn {pieces:?}, outside 0 to 1"));
            }
            if pieces.len() as f64 > held(stock, *g).floor() {
                flag(id, format!("{} worn {gn} but {} kept", pieces.len(), held(stock, *g)));
            }
            if pieces.windows(2).any(|p| p[0] < p[1]) {
                flag(id, format!("worn {gn} not most worn first: {pieces:?}"));
            }
        }
    }
    out
}

#[cfg(test)]
#[path = "wear/tests.rs"]
mod tests;
