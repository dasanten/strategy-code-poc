use std::collections::BTreeSet;

use csp_shared::world::ResidentOrder;
use serde_json::json;

use super::{meta_of, OrderMeta, Requests, ORDER_METAS, RUNNING};
use crate::orders::order_kinds;

type Flag = fn(&OrderMeta) -> bool;

/// The lists the flags replaced, as they were before T121.5 (until Epic 121 ends).
const FORMER_LISTS: &[(&str, Flag, &[&str])] = &[
    (
        "queue_step",
        |m| m.queue_step,
        &[
            "walkTo",
            "drive",
            "row",
            "sail",
            "unhitch",
            "hitch",
            "board",
            "getOff",
            "pickUp",
            "drop",
            "store",
            "fetch",
            "build",
            "tearDown",
            "workAt",
            "teach",
            "haul",
            "roadLine",
            "wallLine",
            "mount",
            "dismount",
            "relocate",
            "feed",
            "equip",
            "takeOff",
            "task",
            "runScript",
            "waitUntil",
        ],
    ),
    ("never_ends", |m| m.never_ends, &["workAt", "haul", "teach"]),
    (
        "gets_off_first",
        |m| m.gets_off_first,
        &[
            "walkTo",
            "relocate",
            "drive",
            "unhitch",
            "hitch",
            "haul",
            "pickUp",
            "drop",
            "store",
            "fetch",
            "build",
            "tearDown",
            "repair",
            "workAt",
            "gather",
            "teach",
            "train",
            "breed",
            "attack",
            "climb",
            "mount",
            "roadLine",
            "wallLine",
            "buyCity",
            "buy",
            "sell",
            "swap",
            "buyHorse",
            "sellHorse",
            "handIn",
            "transfer",
            "buyOff",
            "payDebt",
            "acceptOffer",
            "feed",
            "crew",
        ],
    ),
    (
        "keeps_script",
        |m| m.keeps_script,
        &[
            "runScript",
            "pair",
            "handOver",
            "nameHeir",
            "clearHeir",
            "rename",
            "renameCity",
            "renameHorse",
            "claimHorses",
            "sendDemand",
            "acceptDemand",
            "declineDemand",
            "setScriptParam",
            "setDefenceScript",
            "setAlarmScript",
            "editQueue",
            "postOffer",
            "takeDownOffer",
            "sendDirectOffer",
            "declineOffer",
            "sendCarriedOffer",
            "acceptCarriedOffer",
            "addWaypoint",
            "renameWaypoint",
            "removeWaypoint",
        ],
    ),
    (
        "to_army",
        |m| m.to_army,
        &[
            "formArmy",
            "disbandArmy",
            "armyWalkTo",
            "armyGuard",
            "armyAttack",
            "armyFollow",
            "armyStop",
            "armyRunScript",
        ],
    ),
    (
        "adults_only",
        |m| m.adults_only,
        &[
            "build", "roadLine", "wallLine", "tearDown", "repair", "workAt", "teach", "train",
            "breed", "drive", "feed", "crew", "push", "ram", "throw", "gather",
        ],
    ),
    (
        "npc_city",
        |m| m.npc_city,
        &[
            "walkTo", "pickUp", "drop", "store", "fetch", "workAt", "build", "tearDown", "repair",
            "breed", "attack", "trade", "feed", "teach", "train",
        ],
    ),
    (
        "blocked_carrying_child",
        |m| m.blocked_carrying_child,
        &[
            "workAt",
            "gather",
            "breed",
            "build",
            "roadLine",
            "wallLine",
            "tearDown",
            "repair",
            "haul",
            "haulByWater",
            "relocate",
        ],
    ),
    (
        "goes_on_until_stopped",
        |m| m.goes_on_until_stopped,
        &["haul", "haulByWater", "workAt", "teach", "train"],
    ),
];

#[test]
fn each_flag_holds_for_the_kinds_of_its_former_list() {
    for (name, flag, former) in FORMER_LISTS {
        let derived: BTreeSet<&str> =
            ORDER_METAS.iter().filter(|m| flag(m)).map(|m| m.kind).collect();
        assert_eq!(derived, former.iter().copied().collect(), "{name}");
    }
}

#[test]
fn every_kind_is_declared_once() {
    let kinds: BTreeSet<&str> = ORDER_METAS.iter().map(|m| m.kind).collect();
    assert_eq!(kinds.len(), ORDER_METAS.len());
    for m in ORDER_METAS {
        assert!(std::ptr::eq(meta_of(m.kind).unwrap(), *m), "{}", m.kind);
    }
}

#[test]
fn the_registry_holds_every_kind_that_needs_no_host() {
    let kinds = order_kinds();
    for m in ORDER_METAS {
        let built = matches!(m.requests, Requests::Kind(_) | Requests::Fns(_));
        assert_eq!(kinds.contains(m.kind), built, "{}", m.kind);
    }
}

/// A resident's order has the kind its save has: serde names a variant by its name in camelCase,
/// and lists them all when it knows none.
#[test]
fn a_running_orders_kind_is_the_one_in_the_save() {
    for (variant, m) in RUNNING {
        let mut name = variant.to_string();
        name[..1].make_ascii_lowercase();
        assert_eq!(m.kind, name);
        assert!(std::ptr::eq(meta_of(m.kind).unwrap(), *m), "{variant} is not in ORDER_METAS");
    }
    let unknown = serde_json::from_value::<ResidentOrder>(json!({ "kind": "?" })).unwrap_err();
    let message = unknown.to_string();
    let saved: BTreeSet<&str> = message.split('`').skip(3).step_by(2).collect();
    assert_eq!(saved, RUNNING.iter().map(|(_, m)| m.kind).collect());
}
