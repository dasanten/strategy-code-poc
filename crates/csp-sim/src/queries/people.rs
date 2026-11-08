//! The people queries of `packages/shared`: relocating (`relocate.ts`), the Leader handover
//! (`leader.ts`), the names Players give (`names.ts`) and the first-day card (`first-day.ts`).
//! `CONTEXT.md`: Relocate, Leader handover, Renaming a resident, Renaming a city, Renaming a
//! horse, Realm name, First day.

use std::collections::HashSet;

use csp_shared::balance::{
    CITY_NAME_MAX_LENGTH, HORSE_NAME_MAX_LENGTH, REALM_NAME_MAX_LENGTH, RESIDENT_NAME_MAX_LENGTH,
};
use csp_shared::world::{City, Horse, Realm, Resident, ResidentOrder, WorldState};

use super::city_area::free_housing;

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

#[cfg(test)]
mod tests {
    //! Shared `first-day.test.ts` and `firstDayLineOf` of the server's (the account rows are the
    //! shell's: Epic 87).
    use super::*;

    fn fresh() -> FirstDay {
        FirstDay { done: vec![], dismissed: false }
    }

    #[test]
    fn shows_for_a_new_player_with_nothing_ticked() {
        assert!(first_day_shown(&fresh()));
    }

    #[test]
    fn ticks_each_line_once_kept_in_the_cards_order_whatever_order_they_were_done_in() {
        let card = tick_first_day(&tick_first_day(&fresh(), "openWiki"), "claimHorses");
        assert_eq!(card.done, vec!["claimHorses", "openWiki"]);
        assert_eq!(tick_first_day(&card, "openWiki"), card);
    }

    #[test]
    fn goes_for_good_once_every_line_is_ticked() {
        let card = FIRST_DAY_LINES.iter().fold(fresh(), |c, l| tick_first_day(&c, l));
        assert_eq!(card.done, FIRST_DAY_LINES.to_vec());
        assert!(!first_day_shown(&card));
    }

    #[test]
    fn goes_for_good_once_dismissed_however_few_lines_are_ticked() {
        assert!(!first_day_shown(&FirstDay { done: vec!["claimHorses".into()], dismissed: true }));
    }

    #[test]
    fn lets_the_client_report_only_picking_a_resident_and_opening_the_wiki() {
        let client: Vec<&str> =
            FIRST_DAY_LINES.iter().copied().filter(|l| is_client_first_day_line(l)).collect();
        assert_eq!(client, vec!["pickResident", "openWiki"]);
        assert!(!is_client_first_day_line("claimHorses"));
        assert!(!is_client_first_day_line("constructor"));
        assert!(is_first_day_line("giveOrder"));
    }

    #[test]
    fn knows_which_line_an_accepted_order_ticks() {
        assert_eq!(first_day_line_of("claimHorses", false), Some("claimHorses"));
        assert_eq!(first_day_line_of("walkTo", true), Some("giveOrder"));
        assert_eq!(first_day_line_of("armyStop", false), None);
    }
}
