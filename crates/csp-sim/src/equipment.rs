//! Equipment (`CONTEXT.md`: Equipment, Soldier; ADR 0038): each resident's weapon, shield and
//! armour slot. A resident with an empty slot equips the best fitting item they carry at once, so
//! picking gear up from a storage, the ground, a carriage or a smithy equips it, and so does every
//! way the game arms residents (NPC cities, trading posts, the HQ, hired soldiers). With the slot
//! full, what they pick up is only carried, even a better one. Putting an equipped item down
//! (storing, dropping, losing it as loot) empties its slot, and the next best carried item of that
//! kind fills it.
//!
//! Goods move in many places, so the slots are not kept by each of them. What a slot holds as the
//! rules count it is [`equipped`]: the item in `Resident::equipped` while it is still carried,
//! otherwise the best fitting item carried, which is what the slot is filled with at once.
//! [`settle_equipment`] writes that back into `Resident::equipped`, so a better item picked up
//! later stays only carried; the tick runs it after every phase that moves goods
//! (`step_world`), and at the tick's end every resident's stored slots are what the rules count.
//! A save from before Equipment equips each resident's best carried weapon, shield and armour
//! the same way.

use csp_shared::balance::{PROTECTION_DEFENCE, WEAPON_ATTACK};
use csp_shared::goods::PROTECTION_KINDS;
use csp_shared::world::{Equipment, Good, Resident, Stock, WorldState};

use crate::queries::names::{good_name, held};

/// One of a resident's three equipment slots.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    Weapon,
    Shield,
    Armour,
}

/// Every slot, in the order a card shows them.
pub const SLOTS: [Slot; 3] = [Slot::Weapon, Slot::Shield, Slot::Armour];

impl Slot {
    /// How good `good` is in this slot (attack for a weapon, damage taken off for a shield or
    /// armour), or `None` when it doesn't fit.
    fn worth(self, good: Good) -> Option<f64> {
        let name = good_name(good);
        match self {
            Slot::Weapon => WEAPON_ATTACK.get(name),
            Slot::Shield if PROTECTION_KINDS[0].contains(&name) => PROTECTION_DEFENCE.get(name),
            Slot::Armour if PROTECTION_KINDS[1].contains(&name) => PROTECTION_DEFENCE.get(name),
            Slot::Shield | Slot::Armour => None,
        }
    }

    /// Whether `good` fits this slot.
    pub fn fits(self, good: Good) -> bool {
        self.worth(good).is_some()
    }
}

/// What `slot` of `e` holds, as stored.
pub fn in_slot(e: &Equipment, slot: Slot) -> Option<Good> {
    match slot {
        Slot::Weapon => e.weapon,
        Slot::Shield => e.shield,
        Slot::Armour => e.armour,
    }
}

fn slot_mut(e: &mut Equipment, slot: Slot) -> &mut Option<Good> {
    match slot {
        Slot::Weapon => &mut e.weapon,
        Slot::Shield => &mut e.shield,
        Slot::Armour => &mut e.armour,
    }
}

/// The best item for `slot` among `carried`.
pub fn best_for(carried: &Stock, slot: Slot) -> Option<Good> {
    let mut best: Option<(Good, f64)> = None;
    for (g, n) in carried {
        if *n <= 0.0 {
            continue;
        }
        if let Some(worth) = slot.worth(*g) {
            if best.is_none_or(|(_, b)| worth > b) {
                best = Some((*g, worth));
            }
        }
    }
    best.map(|(g, _)| g)
}

/// What a resident has in `slot` as the rules count it: the stored item while they still carry
/// it, otherwise the best fitting item they carry (an empty slot fills at once).
pub fn equipped(r: &Resident, slot: Slot) -> Option<Good> {
    in_slot(&r.equipped, slot)
        .filter(|g| held(&r.carried, *g) > 0.0)
        .or_else(|| best_for(&r.carried, slot))
}

/// Every slot of a resident as the rules count it ([`equipped`]).
pub fn equipment_of(r: &Resident) -> Equipment {
    Equipment {
        weapon: equipped(r, Slot::Weapon),
        shield: equipped(r, Slot::Shield),
        armour: equipped(r, Slot::Armour),
    }
}

/// The JSON of [`equipment_of`], an empty object for nothing equipped: what a script's view of a
/// resident is built from.
pub fn equipment_json(r: &Resident) -> serde_json::Value {
    serde_json::to_value(equipment_of(r)).unwrap_or(serde_json::Value::Null)
}

/// Writes what each slot holds ([`equipped`]) into `Resident::equipped`, so an item picked up
/// into a full slot stays only carried. Returns whether anything changed.
pub fn settle_equipment(r: &mut Resident) -> bool {
    let mut changed = false;
    for slot in SLOTS {
        let now = equipped(r, slot);
        let s = slot_mut(&mut r.equipped, slot);
        if *s != now {
            *s = now;
            changed = true;
        }
    }
    changed
}

/// [`settle_equipment`] for every resident.
pub fn settle_all(world: &mut WorldState) {
    for r in &mut world.residents {
        // Most residents carry no gear and have nothing stored: nothing to look at.
        if r.equipped.is_empty() && !r.carried.keys().any(|g| is_gear(*g)) {
            continue;
        }
        settle_equipment(r);
    }
}

/// Whether a good goes into any slot.
pub fn is_gear(good: Good) -> bool {
    let name = good_name(good);
    WEAPON_ATTACK.get(name).is_some() || PROTECTION_DEFENCE.get(name).is_some()
}

/// What breaks the Equipment rules in a resident's stored slots, if anything (ADR 0004): an
/// equipped item is always among what they carry, and a slot holds only its kind.
pub fn equipment_problem(r: &Resident) -> Option<String> {
    for slot in SLOTS {
        let Some(g) = in_slot(&r.equipped, slot) else { continue };
        if !slot.fits(g) {
            return Some(format!("{slot:?} slot holds {}", good_name(g)));
        }
        if held(&r.carried, g) <= 0.0 {
            return Some(format!("{} equipped but not carried", good_name(g)));
        }
    }
    None
}

#[cfg(test)]
#[path = "equipment/tests.rs"]
mod tests;
