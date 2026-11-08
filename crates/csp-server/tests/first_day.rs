//! The first-day card on the account (`first-day.test.ts`, its first half; the requests are in
//! `tests/app.rs`).
use csp_server::auth::create_admin;
use csp_server::db::open_db;
use csp_server::first_day::{
    first_day_line_of, mark_first_day, read_first_day, FirstDay, FirstDayLine,
};
use csp_shared::world::protocol::OrderRequest;
use rusqlite::Connection;

fn mara() -> (Connection, i64) {
    let db = open_db(":memory:", None).unwrap();
    create_admin(&db, Some("Mara"), Some("correct horse")).unwrap();
    let id = db.query_row("SELECT id FROM users", [], |r| r.get(0)).unwrap();
    (db, id)
}

fn order(json: serde_json::Value) -> OrderRequest {
    serde_json::from_value(json).unwrap()
}

#[test]
fn starts_with_nothing_ticked_for_a_new_player() {
    let (db, id) = mara();
    assert_eq!(read_first_day(&db, id).unwrap(), FirstDay { done: vec![], dismissed: false });
}

#[test]
fn ticks_a_line_once_and_says_so_only_the_first_time() {
    let (db, id) = mara();
    assert_eq!(
        mark_first_day(&db, id, FirstDayLine::ClaimHorses).unwrap(),
        Some(FirstDay { done: vec![FirstDayLine::ClaimHorses], dismissed: false })
    );
    assert_eq!(mark_first_day(&db, id, FirstDayLine::ClaimHorses).unwrap(), None);
    mark_first_day(&db, id, FirstDayLine::OpenWiki).unwrap();
    assert_eq!(
        read_first_day(&db, id).unwrap().done,
        [FirstDayLine::ClaimHorses, FirstDayLine::OpenWiki]
    );
}

#[test]
fn knows_which_line_an_accepted_order_ticks() {
    use serde_json::json;
    assert_eq!(
        first_day_line_of(&order(json!({ "kind": "claimHorses" }))),
        Some(FirstDayLine::ClaimHorses)
    );
    assert_eq!(
        first_day_line_of(&order(json!({ "kind": "walkTo", "residentId": "r1", "x": 1, "y": 2 }))),
        Some(FirstDayLine::GiveOrder)
    );
    assert_eq!(first_day_line_of(&order(json!({ "kind": "armyStop", "armyId": "a1" }))), None);
}
