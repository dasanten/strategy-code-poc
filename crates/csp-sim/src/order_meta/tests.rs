use std::collections::BTreeSet;

use csp_shared::world::ResidentOrder;
use serde_json::json;

use super::{meta_of, Requests, ORDER_METAS, RUNNING};
use crate::orders::order_kinds;

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
