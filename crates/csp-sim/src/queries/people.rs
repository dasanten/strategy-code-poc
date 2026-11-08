//! The people queries of `packages/shared`: relocating (`relocate.ts`), the Leader handover
//! (`leader.ts`), the names Players give (`names.ts`) and the first-day card (`first-day.ts`).
//! `CONTEXT.md`: Relocate, Leader handover, Renaming a resident, Renaming a city, Renaming a
//! horse, Realm name, First day.

use std::collections::HashSet;

use csp_shared::balance::{
    CITY_NAME_MAX_LENGTH, HORSE_NAME_MAX_LENGTH, REALM_NAME_MAX_LENGTH, RESIDENT_NAME_MAX_LENGTH,
};
use csp_shared::world::{City, Horse, Realm, Resident, ResidentOrder, WorldState};

use super::alliance::{contract_of, handed_over_to};
use super::city_area::{free_housing, in_city_area};
use super::residents::can_work;

/// Why a resident can't hold a working order while carrying a child (`CARRYING_A_CHILD`).
pub const CARRYING_A_CHILD: &str = "carrying a child";

/// The residents relocating to a city (`relocatingTo`): on their way, not moved in yet.
pub fn relocating_to<'w>(world: &'w WorldState, city_id: &str) -> Vec<&'w Resident> {
    world
        .residents
        .iter()
        .filter(|r| {
            matches!(&r.order, Some(ResidentOrder::Relocate(o)) if o.city_id == city_id)
                && r.city_id.as_deref() != Some(city_id)
        })
        .collect()
}

/// A city's free housing for residents told to relocate there (`relocateRoom`): its free housing
/// less those already relocating there, but for those in `ordered`, told again. Can be below 0.
pub fn relocate_room(world: &WorldState, city_id: &str, ordered: &HashSet<String>) -> f64 {
    let coming = relocating_to(world, city_id).iter().filter(|r| !ordered.contains(&r.id)).count();
    free_housing(world, city_id) - coming as f64
}

/// Why the realm can't tell `residents` to relocate to `city_id` now (`relocateProblem`).
pub fn relocate_problem(
    world: &WorldState,
    realm_id: &str,
    residents: &[&Resident],
    city_id: Option<&str>,
) -> Option<String> {
    let Some(city) = world.cities.iter().find(|c| Some(c.id.as_str()) == city_id) else {
        return Some("not a city of your realm".into());
    };
    if city.realm_id.as_deref() != Some(realm_id) {
        return Some("not a city of your realm".into());
    }
    for r in residents {
        if r.owner.as_deref() != Some(realm_id) {
            return Some("not one of your residents".into());
        }
        if r.city_id.as_deref() == Some(city.id.as_str()) {
            return Some(format!("{} already lives in {}", r.name, city.name));
        }
        if r.carrying.is_some() {
            return Some(format!("{} is {CARRYING_A_CHILD}", r.name));
        }
    }
    let room = relocate_room(world, &city.id, &residents.iter().map(|r| r.id.clone()).collect());
    if room >= residents.len() as f64 {
        return None;
    }
    if room <= 0.0 {
        return Some("no free housing".into());
    }
    Some(format!("free housing for {room} only"))
}

/// Whom a resident serves besides their own realm (`servesOthers`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Serves {
    Contract,
    AllianceArmy,
}

/// Whom a resident serves besides their own realm (`servesOthers`), if anyone.
pub fn serves_others(world: &WorldState, resident_id: &str) -> Option<Serves> {
    if handed_over_to(world, resident_id).is_some() {
        return Some(Serves::AllianceArmy);
    }
    contract_of(world, resident_id).map(|_| Serves::Contract)
}

/// Why the realm's Leader can't hand the realm over to `target` now (`handOverProblem`).
pub fn hand_over_problem(
    world: &WorldState,
    realm: &Realm,
    leader: Option<&Resident>,
    target: Option<&Resident>,
    size: i32,
) -> Option<String> {
    let Some(leader) =
        leader.filter(|l| l.id == realm.leader_id && l.owner.as_deref() == Some(realm.id.as_str()))
    else {
        return Some("only your Leader can hand over the realm".into());
    };
    let Some(target) =
        target.filter(|t| t.owner.as_deref() == Some(realm.id.as_str()) && t.health > 0.0)
    else {
        return Some("not one of your residents".into());
    };
    if target.id == leader.id {
        return Some(format!("{} is your Leader already", target.name));
    }
    if !can_work(target.born_at, world.tick as f64) {
        return Some(format!("{} is a child", target.name));
    }
    match serves_others(world, &target.id) {
        Some(Serves::Contract) => {
            return Some(format!("{} is in a mercenary contract", target.name))
        }
        Some(Serves::AllianceArmy) => {
            return Some(format!("{} is in the alliance army", target.name))
        }
        None => {}
    }
    // An offer could start once they lead, and a Leader is never hired out.
    if world.contracts.iter().any(|c| c.resident_ids.contains(&target.id)) {
        return Some(format!("{} is named in a mercenary contract offer", target.name));
    }
    let shared = world.cities.iter().any(|c| {
        c.realm_id.as_deref() == Some(realm.id.as_str())
            && in_city_area(world, &c.id, leader.x, leader.y, size)
            && in_city_area(world, &c.id, target.x, target.y, size)
    });
    if !shared {
        return Some(format!("{} must stand in the same city as your Leader", target.name));
    }
    None
}

/// What is wrong with a name a Player gives (`nameProblem`): text, trimmed not empty and at most
/// `max_length` characters (UTF-16 code units, as `length` counts them).
pub fn name_problem(name: Option<&str>, max_length: f64) -> Option<String> {
    let Some(name) = name else { return Some("needs a name".into()) };
    let trimmed = js_trim(name);
    if trimmed.is_empty() {
        return Some("needs a name".into());
    }
    if trimmed.encode_utf16().count() as f64 > max_length {
        return Some(format!("at most {max_length} characters"));
    }
    None
}

/// `String.prototype.trim`: JavaScript's white space and line terminators, which `str::trim`'s
/// Unicode `White_Space` matches but for U+FEFF.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// What is wrong with the names a Player gives when founding their realm (`foundingProblem`).
pub fn founding_problem(realm_name: Option<&str>, leader_name: Option<&str>) -> Option<String> {
    if let Some(p) = name_problem(realm_name, REALM_NAME_MAX_LENGTH) {
        return Some(format!("Realm name: {p}"));
    }
    name_problem(leader_name, RESIDENT_NAME_MAX_LENGTH).map(|p| format!("Leader name: {p}"))
}

/// A value an order may carry for a name: text, something else, or nothing (`unknown`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Given<'a> {
    #[default]
    Missing,
    Text(&'a str),
    NotText,
}

impl<'a> Given<'a> {
    fn text(self) -> Option<&'a str> {
        match self {
            Given::Text(s) => Some(s),
            _ => None,
        }
    }
}

/// Why the Player of `realm` can't rename `target` to `name` now (`renameProblem`).
pub fn rename_problem(
    realm: &Realm,
    target: Option<&Resident>,
    name: Given,
    realm_name: Given,
) -> Option<String> {
    let Some(target) =
        target.filter(|t| t.owner.as_deref() == Some(realm.id.as_str()) && t.health > 0.0)
    else {
        return Some("not one of your residents".into());
    };
    if let Some(bad) = name_problem(name.text(), RESIDENT_NAME_MAX_LENGTH) {
        return Some(format!("Name: {bad}"));
    }
    let naming = target.id == realm.leader_id && realm.name.as_deref().is_none_or(str::is_empty);
    if naming {
        if let Some(bad) = name_problem(realm_name.text(), REALM_NAME_MAX_LENGTH) {
            return Some(format!(
                "Realm name: {bad}; your realm needs one when you rename your Leader"
            ));
        }
    } else if realm_name != Given::Missing {
        return Some(if realm.name.as_deref().is_some_and(|n| !n.is_empty()) {
            "your realm has its name already".into()
        } else {
            "only renaming your Leader names your realm".into()
        });
    }
    None
}

/// Why the Player of `realm` can't rename `city` to `name` now (`cityRenameProblem`).
pub fn city_rename_problem(realm: &Realm, city: Option<&City>, name: Given) -> Option<String> {
    if city.is_none_or(|c| c.realm_id.as_deref() != Some(realm.id.as_str())) {
        return Some("not one of your cities".into());
    }
    name_problem(name.text(), CITY_NAME_MAX_LENGTH).map(|b| format!("Name: {b}"))
}

/// Why the Player of `realm` can't rename `horse` to `name` now (`horseRenameProblem`).
pub fn horse_rename_problem(realm: &Realm, horse: Option<&Horse>, name: Given) -> Option<String> {
    if horse.is_none_or(|h| h.realm_id.as_deref() != Some(realm.id.as_str())) {
        return Some("not one of your horses".into());
    }
    name_problem(name.text(), HORSE_NAME_MAX_LENGTH).map(|b| format!("Name: {b}"))
}

/// The first-day card's lines, in its order (`FIRST_DAY_LINES`).
pub const FIRST_DAY_LINES: [&str; 4] = ["claimHorses", "pickResident", "giveOrder", "openWiki"];

/// The lines the client reports (`CLIENT_FIRST_DAY_LINES`).
pub const CLIENT_FIRST_DAY_LINES: [&str; 2] = ["pickResident", "openWiki"];

/// Where the client reports a line done and dismisses the card (`FIRST_DAY_PATH`,
/// `FIRST_DAY_DISMISS_PATH`).
pub const FIRST_DAY_PATH: &str = "/api/first-day";
pub const FIRST_DAY_DISMISS_PATH: &str = "/api/first-day/dismiss";

/// A Player's first-day card (`FirstDay`): the lines ticked, in the card's order, and whether
/// they dismissed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FirstDay {
    pub done: Vec<String>,
    pub dismissed: bool,
}

/// Whether `line` names one of the card's lines (`isFirstDayLine`).
pub fn is_first_day_line(line: &str) -> bool {
    FIRST_DAY_LINES.contains(&line)
}

/// Whether the client may report `line` (`isClientFirstDayLine`).
pub fn is_client_first_day_line(line: &str) -> bool {
    CLIENT_FIRST_DAY_LINES.contains(&line)
}

/// The card with `line` ticked too, its lines in the card's order (`tickFirstDay`); the same card
/// when it was ticked already.
pub fn tick_first_day(card: &FirstDay, line: &str) -> FirstDay {
    if card.done.iter().any(|l| l == line) {
        return card.clone();
    }
    let done = FIRST_DAY_LINES
        .iter()
        .filter(|l| **l == line || card.done.iter().any(|d| d == *l))
        .map(|l| l.to_string())
        .collect();
    FirstDay { done, dismissed: card.dismissed }
}

/// Whether the card shows (`firstDayShown`): until every line is ticked or it is dismissed.
pub fn first_day_shown(card: &FirstDay) -> bool {
    !card.dismissed && FIRST_DAY_LINES.iter().any(|l| !card.done.iter().any(|d| d == l))
}

/// The line an order the server accepted ticks (`firstDayLineOf`): claiming the Horse offer, or
/// giving any order to a resident (`has_resident` when the order names one by a string id).
pub fn first_day_line_of(kind: &str, has_resident: bool) -> Option<&'static str> {
    if kind == "claimHorses" {
        return Some("claimHorses");
    }
    has_resident.then_some("giveOrder")
}
