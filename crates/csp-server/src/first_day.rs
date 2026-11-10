//! The first-day card (`CONTEXT.md`: First day; `apps/server/src/first-day.ts` with the card's
//! rules from `packages/shared/src/first-day.ts`), kept per Player on their account row, not in
//! the world, so it outlasts a Leader's death.

use csp_shared::world::protocol::OrderRequest;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where the client reports a line done (POST `{ line }`) and dismisses the card (POST).
pub const FIRST_DAY_PATH: &str = "/api/first-day";
pub const FIRST_DAY_DISMISS_PATH: &str = "/api/first-day/dismiss";

/// The card's lines, in its order (`FIRST_DAY_LINES`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum FirstDayLine {
    ClaimHorses,
    PickResident,
    GiveOrder,
    OpenWiki,
}

pub const FIRST_DAY_LINES: [FirstDayLine; 4] = [
    FirstDayLine::ClaimHorses,
    FirstDayLine::PickResident,
    FirstDayLine::GiveOrder,
    FirstDayLine::OpenWiki,
];

/// `ClientFirstDayLine`: the lines the client may report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ClientFirstDayLine {
    PickResident,
    OpenWiki,
}

/// The lines the client reports; the server sees the others itself, as the orders come in, and
/// ignores a report of them (`CLIENT_FIRST_DAY_LINES`).
pub const CLIENT_FIRST_DAY_LINES: [FirstDayLine; 2] =
    [FirstDayLine::PickResident, FirstDayLine::OpenWiki];

impl FirstDayLine {
    pub fn name(self) -> &'static str {
        match self {
            FirstDayLine::ClaimHorses => "claimHorses",
            FirstDayLine::PickResident => "pickResident",
            FirstDayLine::GiveOrder => "giveOrder",
            FirstDayLine::OpenWiki => "openWiki",
        }
    }

    /// The line `name` names, if any (`isFirstDayLine`).
    pub fn parse(name: &str) -> Option<FirstDayLine> {
        FIRST_DAY_LINES.into_iter().find(|l| l.name() == name)
    }

    /// The line a client may report, if `value` names one (`isClientFirstDayLine`).
    pub fn client(value: &serde_json::Value) -> Option<FirstDayLine> {
        value.as_str().and_then(Self::parse).filter(|l| CLIENT_FIRST_DAY_LINES.contains(l))
    }
}

/// A Player's first-day card: the lines ticked, in the card's order, and whether they dismissed
/// it (`FirstDay`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FirstDay {
    pub done: Vec<FirstDayLine>,
    pub dismissed: bool,
}

/// The card with `line` ticked too, its lines kept in the card's order (`tickFirstDay`); `None`
/// when it was ticked already.
pub fn tick_first_day(card: &FirstDay, line: FirstDayLine) -> Option<FirstDay> {
    if card.done.contains(&line) {
        return None;
    }
    let done =
        FIRST_DAY_LINES.into_iter().filter(|&l| l == line || card.done.contains(&l)).collect();
    Some(FirstDay { done, dismissed: card.dismissed })
}

/// Whether the card shows: until every line is ticked or the Player dismisses it, for good
/// (`firstDayShown`).
pub fn first_day_shown(card: &FirstDay) -> bool {
    !card.dismissed && FIRST_DAY_LINES.iter().any(|l| !card.done.contains(l))
}

/// A Player's first-day card as kept.
pub fn read_first_day(conn: &Connection, user_id: i64) -> rusqlite::Result<FirstDay> {
    let row: Option<(String, bool)> = conn
        .query_row(
            "SELECT first_day_done, first_day_dismissed FROM users WHERE id = ?1",
            [user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(match row {
        None => FirstDay { done: Vec::new(), dismissed: true },
        Some((done, dismissed)) => {
            FirstDay { done: done.split(',').filter_map(FirstDayLine::parse).collect(), dismissed }
        }
    })
}

/// Ticks `line` on the Player's card. Answers the card when that changed it, `None` when the line
/// was ticked already.
pub fn mark_first_day(
    conn: &Connection,
    user_id: i64,
    line: FirstDayLine,
) -> rusqlite::Result<Option<FirstDay>> {
    let card = read_first_day(conn, user_id)?;
    let Some(ticked) = tick_first_day(&card, line) else { return Ok(None) };
    let done: Vec<&str> = ticked.done.iter().map(|l| l.name()).collect();
    conn.execute(
        "UPDATE users SET first_day_done = ?1 WHERE id = ?2",
        params![done.join(","), user_id],
    )?;
    Ok(Some(ticked))
}

/// The Player dismissed the card: it never shows again.
pub fn dismiss_first_day(conn: &Connection, user_id: i64) -> rusqlite::Result<FirstDay> {
    conn.execute("UPDATE users SET first_day_dismissed = 1 WHERE id = ?1", [user_id])?;
    read_first_day(conn, user_id)
}

/// The line an order the server accepted ticks: claiming the Horse offer, or giving any order to
/// a resident (`firstDayLineOf`).
pub fn first_day_line_of(order: &OrderRequest) -> Option<FirstDayLine> {
    if order.kind == "claimHorses" {
        return Some(FirstDayLine::ClaimHorses);
    }
    order.fields.get("residentId").filter(|v| v.is_string()).map(|_| FirstDayLine::GiveOrder)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_a_line_keeping_the_cards_order() {
        let card = FirstDay { done: vec![FirstDayLine::OpenWiki], dismissed: false };
        let ticked = tick_first_day(&card, FirstDayLine::ClaimHorses).unwrap();
        assert_eq!(ticked.done, [FirstDayLine::ClaimHorses, FirstDayLine::OpenWiki]);
        assert_eq!(tick_first_day(&ticked, FirstDayLine::OpenWiki), None);
    }

    #[test]
    fn shows_the_card_until_every_line_is_ticked_or_it_is_dismissed() {
        assert!(first_day_shown(&FirstDay { done: vec![], dismissed: false }));
        assert!(!first_day_shown(&FirstDay { done: vec![], dismissed: true }));
        assert!(!first_day_shown(&FirstDay { done: FIRST_DAY_LINES.to_vec(), dismissed: false }));
    }
}
