//! `apps/server/src/standing.test.ts`, ported one to one. The Trade Org HQ is a city with its
//! town hall (`add_city`) in place of `foundTradeOrgHq` (T86.9); standing only asks whether a
//! city is the Trade Organization's. `diplomacyFor` is T86.11's.

use csp_shared::balance::{STANDING_DRIFT_PER_DAY, STANDING_RANGE};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Standing, TradeOrgCity, WorldState};

use super::*;
use crate::queries::standing::{standings_for, OrganizationIs, StandingView, TRADE_ORG_NAME};
use crate::test_world::{add_city, empty_world, realm};

/// Realms r1 and r2 with a city each, an NPC city n1, and the Trade Org HQ `hq`.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    add_city(&mut world, "c1", Some("r1"), 5.0, 5.0, None);
    add_city(&mut world, "c2", Some("r2"), 110.0, 110.0, None);
    add_city(&mut world, "n1", None, 20.0, 110.0, None);
    world.cities[2].name = "Oakford".into();
    add_city(&mut world, "hq", None, 64.0, 64.0, Some(TradeOrgCity::Hq));
    world
}

fn messages(world: &WorldState) -> Vec<String> {
    standings_sound(world).into_iter().map(|v| v.message).collect()
}

#[test]
fn is_neutral_until_something_happens_and_one_sided() {
    let mut world = setup();
    assert_eq!(standing_of(&world, "r1", "r2"), 0.0);
    change_standing(&mut world, "n1", "r1", -12.0);
    assert_eq!(standing_of(&world, "n1", "r1"), -12.0);
    assert_eq!(standing_of(&world, "r1", "n1"), 0.0);
    assert!(messages(&world).is_empty());
}

#[test]
fn stays_within_its_range() {
    let mut world = setup();
    change_standing(&mut world, "n1", "r1", -500.0);
    assert_eq!(standing_of(&world, "n1", "r1"), -STANDING_RANGE);
    change_standing(&mut world, "r1", "r2", 80.0);
    change_standing(&mut world, "r1", "r2", 80.0);
    assert_eq!(standing_of(&world, "r1", "r2"), STANDING_RANGE);
    assert!(messages(&world).is_empty());
}

#[test]
fn is_never_held_toward_oneself_and_names_the_trade_organization_as_one() {
    let mut world = setup();
    change_standing(&mut world, "r1", "r1", 10.0);
    assert!(world.standings.is_empty());
    change_standing(&mut world, "hq", "r1", -5.0);
    assert_eq!(
        world.standings,
        vec![Standing { of: TRADE_ORG.into(), toward: "r1".into(), value: -5.0 }]
    );
    assert_eq!(standing_of(&world, TRADE_ORG, "r1"), -5.0);
}

#[test]
fn drifts_back_to_neutral_and_is_dropped_once_there() {
    let mut world = setup();
    change_standing(&mut world, "n1", "r1", -2.0 * STANDING_DRIFT_PER_DAY);
    change_standing(&mut world, "r2", "r1", STANDING_DRIFT_PER_DAY);
    for _ in 0..TICKS_PER_GAME_DAY as usize {
        step_standing(&mut world);
    }
    assert!((standing_of(&world, "n1", "r1") + STANDING_DRIFT_PER_DAY).abs() < 1e-6);
    assert!(standing_of(&world, "r2", "r1").abs() < 1e-6);
    for _ in 0..TICKS_PER_GAME_DAY as usize + 1 {
        step_standing(&mut world);
    }
    assert!(world.standings.is_empty());
    assert!(messages(&world).is_empty());
}

#[test]
fn is_forgotten_with_an_organization_that_is_gone() {
    let mut world = setup();
    change_standing(&mut world, "n1", "r2", -30.0);
    change_standing(&mut world, "r1", "r2", 30.0);
    change_standing(&mut world, "r1", "n1", 5.0);
    // The realm of r2 ended; n1 joined r1's realm and is part of its Organization now.
    world.realms.retain(|r| r.id != "r2");
    world.cities.iter_mut().find(|c| c.id == "n1").unwrap().realm_id = Some("r1".into());
    assert_eq!(
        messages(&world),
        vec![
            "standing n1 → r2 names n1, which is gone",
            "standing n1 → r2 names r2, which is gone",
            "standing r1 → r2 names r2, which is gone",
            "standing r1 → n1 names n1, which is gone",
        ]
    );
    step_standing(&mut world);
    assert!(world.standings.is_empty());
}

#[test]
fn has_an_invariant_that_catches_standing_out_of_range_neutral_twice_or_toward_itself() {
    let mut world = setup();
    let s = |of: &str, toward: &str, value: f64| Standing {
        of: of.into(),
        toward: toward.into(),
        value,
    };
    world.standings = vec![
        s("r1", "r2", 101.0),
        s("r1", "r2", 5.0),
        s("r2", "r1", 0.0),
        s("r1", "r1", 3.0),
        s("hq", "r1", 3.0),
    ];
    assert_eq!(
        messages(&world),
        vec![
            "standing r1 → r2 is 101, out of its range",
            "standing r1 → r2 is kept twice",
            "standing r2 → r1 is neutral but kept",
            "r1 has a standing toward itself",
            "standing hq → r1 names a Trade Org city instead of the Trade Organization",
        ]
    );
}

#[test]
fn shows_a_player_how_others_regard_their_realm_and_how_it_regards_them_worst_first() {
    let mut world = setup();
    change_standing(&mut world, TRADE_ORG, "r1", 20.4);
    change_standing(&mut world, "r1", TRADE_ORG, 3.0);
    change_standing(&mut world, "n1", "r1", -40.0);
    change_standing(&mut world, "r1", "r2", -7.0);
    change_standing(&mut world, "r2", "n1", -90.0);
    let view = |org: &str, name: &str, is, theirs, yours| StandingView {
        org: org.into(),
        name: name.into(),
        is,
        theirs,
        yours,
    };
    assert_eq!(
        standings_for(&world, "r1"),
        vec![
            view("n1", "Oakford", OrganizationIs::City, -40.0, 0.0),
            view("r2", "a fallen realm", OrganizationIs::Realm, 0.0, -7.0),
            view(TRADE_ORG, TRADE_ORG_NAME, OrganizationIs::TradeOrg, 20.0, 3.0),
        ]
    );
    assert_eq!(
        standings_for(&world, "r2"),
        vec![
            view("r1", "a fallen realm", OrganizationIs::Realm, -7.0, 0.0),
            view("n1", "Oakford", OrganizationIs::City, 0.0, -90.0),
        ]
    );
}
