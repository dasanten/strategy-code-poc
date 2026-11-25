use std::collections::BTreeSet;

use super::{script_actions, Given, Request};
use crate::order_meta::meta_of;
use crate::script_api::{Is, SCRIPT_API};
use crate::script_bindings::irregular::{IRREGULAR_ACTIONS, OWN_ACTIONS};
use crate::script_bindings::script_order_kinds;

/// Every action is made from its order or in a list of those bound by hand, and every order's
/// action is in the game API, once.
#[test]
fn every_action_is_regular_or_listed_as_irregular() {
    let in_api: Vec<&str> =
        SCRIPT_API.iter().filter(|b| b.is == Is::Action).map(|b| b.name).collect();
    let in_api_set: BTreeSet<&str> = in_api.iter().copied().collect();
    assert_eq!(in_api.len(), in_api_set.len());

    let by_hand: BTreeSet<&str> = script_actions()
        .filter(|(_, a)| matches!(a.request, Request::ByHand(_)))
        .map(|(_, a)| a.name)
        .collect();
    assert_eq!(by_hand, IRREGULAR_ACTIONS.iter().map(|(name, _)| *name).collect());
    let of_orders = script_actions().map(|(_, a)| a.name);
    let own = OWN_ACTIONS.iter().map(|(name, _)| *name);
    assert_eq!(in_api_set, of_orders.chain(own).collect());
    assert!(IRREGULAR_ACTIONS.iter().chain(OWN_ACTIONS).all(|(_, why)| !why.is_empty()));
}

/// An action named like an order asks for that order.
#[test]
fn an_action_named_like_an_order_asks_for_it() {
    for (kind, a) in script_actions() {
        assert!(a.name == kind || meta_of(a.name).is_none(), "{} asks for {kind}", a.name);
    }
}

/// A field is named like an argument without its `?`, or an argument is renamed on purpose; only
/// the last arguments may be left out.
#[test]
fn the_fields_are_plain_names() {
    for (_, a) in script_actions() {
        let Request::Fields(args) = a.request else { continue };
        let fields: BTreeSet<&str> = args.iter().map(|x| x.field).collect();
        assert_eq!(fields.len(), args.len(), "{}", a.name);
        for x in args {
            assert!(!x.field.contains('?'), "{}", a.name);
            assert!(x.given != Given::PlaceIfAny || x.name.ends_with('?'), "{}", a.name);
        }
        let optional = args.iter().skip_while(|x| !x.name.ends_with('?'));
        assert!(optional.into_iter().all(|x| x.name.ends_with('?')), "{}", a.name);
    }
}

/// The orders whose actions have other names than they have.
#[test]
fn the_actions_named_unlike_their_order() {
    let unlike: Vec<_> =
        script_actions().filter(|(kind, a)| *kind != a.name).map(|(k, a)| (a.name, k)).collect();
    assert_eq!(unlike, [("loadShip", "load"), ("unloadShip", "load"), ("shoot", "attack")]);
    // Left out until the bug is fixed (see `script_order_kinds`).
    assert!(!script_order_kinds().contains(&"load"));
    assert!(script_order_kinds().contains(&"attack"));
}
