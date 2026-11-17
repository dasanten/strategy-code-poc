//! Equipment (`CONTEXT.md`: Equipment, Soldier; ADR 0038): each resident's weapon, shield and
//! armour slot. A resident with an empty slot equips the best fitting item they carry at once, so
//! picking gear up from a storage, the ground, a carriage or a smithy equips it, and so does every
//! way the game arms residents (NPC cities, trading posts, the HQ, hired soldiers). With the slot
//! full, what they pick up is only carried, even a better one. Putting an equipped item down
//! (storing, dropping, losing it as loot) empties its slot, and the next best carried item of that
//! kind fills it. Swapping or taking an item off is an order ([`crate::equipping`]); a slot whose
//! item was taken off stays empty ([`kept_off`]) until more that fits it is picked up.
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
use csp_shared::goods::{PROTECTION_KINDS, TWO_HANDED};
use csp_shared::world::{Equipment, Good, KeptOff, Resident, Stock, WorldState};

use crate::queries::names::{good_name, held};

/// One of a resident's three equipment slots.
pub use csp_shared::world::EquipSlot as Slot;

/// Every slot, in the order a card shows them.
pub const SLOTS: [Slot; 3] = [Slot::Weapon, Slot::Shield, Slot::Armour];

/// What a slot takes.
pub trait SlotFits {
    /// How good `good` is in this slot (attack for a weapon, damage taken off for a shield or
    /// armour), or `None` when it doesn't fit.
    fn worth(self, good: Good) -> Option<f64>;
    /// Whether `good` fits this slot.
    fn fits(self, good: Good) -> bool;
}

impl SlotFits for Slot {
    fn worth(self, good: Good) -> Option<f64> {
        let name = good_name(good);
        match self {
            Slot::Weapon => WEAPON_ATTACK.get(name),
            Slot::Shield if PROTECTION_KINDS[0].contains(&name) => PROTECTION_DEFENCE.get(name),
            Slot::Armour if PROTECTION_KINDS[1].contains(&name) => PROTECTION_DEFENCE.get(name),
            Slot::Shield | Slot::Armour => None,
        }
    }

    fn fits(self, good: Good) -> bool {
        self.worth(good).is_some()
    }
}

/// The slot `good` goes into, if any (the slots take no good in common).
pub fn slot_of(good: Good) -> Option<Slot> {
    SLOTS.into_iter().find(|s| s.fits(good))
}

/// The slot's name in orders, scripts and on the card.
pub fn slot_name(slot: Slot) -> &'static str {
    match slot {
        Slot::Weapon => "weapon",
        Slot::Shield => "shield",
        Slot::Armour => "armour",
    }
}

/// The slot named `name` (`weapon`, `shield` or `armour`).
pub fn slot_named(name: &str) -> Option<Slot> {
    SLOTS.into_iter().find(|s| slot_name(*s) == name)
}

/// How many units fitting `slot` are among `carried`.
pub fn units_fitting(carried: &Stock, slot: Slot) -> f64 {
    carried.iter().filter(|(g, n)| **n > 0.0 && slot.fits(**g)).map(|(_, n)| *n).sum()
}

/// Whether `slot` is kept empty: its item was taken off, and nothing more that fits has been
/// picked up since.
pub fn kept_off(r: &Resident, slot: Slot) -> bool {
    r.equipped.kept_off.iter().any(|k| k.slot == slot && units_fitting(&r.carried, slot) <= k.units)
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

/// Whether `good` takes both hands (`TWO_HANDED`: a Bow or Crossbow).
pub fn is_two_handed(good: Good) -> bool {
    TWO_HANDED.contains(&good_name(good))
}

/// Whether the resident's weapon as the rules count it takes both hands, so their shield slot
/// stays empty (`CONTEXT.md`: Equipment).
pub fn hands_full(r: &Resident) -> bool {
    equipped(r, Slot::Weapon).is_some_and(is_two_handed)
}

/// What a resident has in `slot` as the rules count it: the stored item while they still carry
/// it, otherwise the best fitting item they carry (an empty slot fills at once), unless the slot
/// is [`kept_off`]. The shield slot is empty while a weapon that takes both hands is equipped;
/// the shield stays carried.
pub fn equipped(r: &Resident, slot: Slot) -> Option<Good> {
    if slot == Slot::Shield && hands_full(r) {
        return None;
    }
    in_slot(&r.equipped, slot).filter(|g| held(&r.carried, *g) > 0.0).or_else(|| {
        if kept_off(r, slot) {
            None
        } else {
            best_for(&r.carried, slot)
        }
    })
}

/// Every slot of a resident as the rules count it ([`equipped`]).
pub fn equipment_of(r: &Resident) -> Equipment {
    Equipment {
        weapon: equipped(r, Slot::Weapon),
        shield: equipped(r, Slot::Shield),
        armour: equipped(r, Slot::Armour),
        kept_off: Vec::new(),
    }
}

/// The JSON of [`equipment_of`], an empty object for nothing equipped: what a script's view of a
/// resident is built from.
pub fn equipment_json(r: &Resident) -> serde_json::Value {
    serde_json::to_value(equipment_of(r)).unwrap_or(serde_json::Value::Null)
}

/// Writes what each slot holds ([`equipped`]) into `Resident::equipped`, so an item picked up
/// into a full slot stays only carried. A slot kept empty stops being kept so once the resident
/// carries more that fits it than when its item came off; carrying less lowers that mark, so the
/// next pickup counts. Returns whether anything changed.
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
    let carried = &r.carried;
    let before = r.equipped.kept_off.len();
    r.equipped.kept_off.retain_mut(|k| {
        let units = units_fitting(carried, k.slot);
        if units < k.units {
            k.units = units;
            changed = true;
        }
        units <= k.units
    });
    changed || r.equipped.kept_off.len() != before
}

/// Puts `good` into `slot` (it fits, and the resident carries it), or with `None` takes the
/// slot's item off and keeps the slot empty (`CONTEXT.md`: Equipment). Either way the item that
/// was there stays carried.
pub fn set_slot(r: &mut Resident, slot: Slot, good: Option<Good>) {
    r.equipped.kept_off.retain(|k| k.slot != slot);
    *slot_mut(&mut r.equipped, slot) = good;
    if good.is_none() {
        let units = units_fitting(&r.carried, slot);
        r.equipped.kept_off.push(KeptOff { slot, units });
    }
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
/// equipped item is always among what they carry, a slot holds only its kind, and a slot kept
/// empty is empty and kept so once.
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
    if r.equipped.shield.is_some() && r.equipped.weapon.is_some_and(is_two_handed) {
        return Some("shield equipped beside a weapon that takes both hands".into());
    }
    for k in &r.equipped.kept_off {
        if in_slot(&r.equipped, k.slot).is_some() {
            return Some(format!("{:?} slot kept empty but holds something", k.slot));
        }
        if r.equipped.kept_off.iter().filter(|o| o.slot == k.slot).count() > 1 {
            return Some(format!("{:?} slot kept empty twice", k.slot));
        }
    }
    None
}

#[cfg(test)]
#[path = "equipment/tests.rs"]
mod tests;
