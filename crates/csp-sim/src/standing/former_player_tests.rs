//! `apps/server/src/former-player.test.ts`, ported one to one. A Leader's death is `endRealm`'s
//! (T86.3); `after_death` does the part of it these rules see: the realm is gone, its city is a
//! city of no realm, and it remembers its Player (`rememberFormerPlayer`).

use csp_shared::balance::{
    CITY_PRICE_STANDING_SWING, FORMER_PLAYER_STANDING, PERSUADE_STANDING, STANDING_DRIFT_PER_DAY,
    STANDING_RANGE,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{FormerPlayer, Realm, WorldState};

use super::*;
use crate::queries::city::city_price;
use crate::queries::persuasion::holds_high;
use crate::starting_city::found_starting_city;
use crate::test_world::{city_terrain, world_with_city};

/// Player 1's Leader has died: their starting city is self-managed now. The city's index.
fn after_death() -> (WorldState, usize) {
    let mut world = world_with_city();
    let realm = world.realms.remove(0);
    let ci =
        world.cities.iter().position(|c| c.realm_id.as_deref() == Some(realm.id.as_str())).unwrap();
    world.cities[ci].realm_id = None;
    let city = world.cities[ci].id.clone();
    remember_former_player(&mut world, &[city], realm.user_id);
    (world, ci)
}

/// Lets `days` game days pass for standing alone.
fn pass_days(world: &mut WorldState, days: f64) {
    for _ in 0..(days * TICKS_PER_GAME_DAY) as usize {
        world.tick += 1;
        step_standing(world);
    }
}

fn found(world: &mut WorldState, user: u64) -> Realm {
    let r = found_starting_city(world, city_terrain(), user, None);
    world.realms[r].clone()
}

#[test]
fn holds_the_players_new_realm_in_good_standing() {
    let (mut world, ci) = after_death();
    assert_eq!(
        world.cities[ci].former_player,
        Some(FormerPlayer { user_id: 1, tick: world.tick as f64 })
    );
    assert!(former_players_sound(&world).is_empty());
    let realm = found(&mut world, 1);
    let city = world.cities[ci].id.clone();
    assert_eq!(standing_of(&world, &city, &realm.id), FORMER_PLAYER_STANDING);
    // One-sided: the Player's realm holds no opinion of its own.
    assert_eq!(standing_of(&world, &realm.id, &city), 0.0);
    // The memory lives on as that standing now.
    assert_eq!(world.cities[ci].former_player, None);
    assert!(former_players_sound(&world).is_empty());
}

#[test]
fn sells_itself_back_to_the_players_new_realm_cheaper_than_to_a_stranger() {
    let (mut world, ci) = after_death();
    let realm = found(&mut world, 1);
    let stranger = found(&mut world, 2);
    let city = &world.cities[ci];
    let worth = city_price(&world, city, None);
    assert_eq!(city_price(&world, city, Some(&stranger.id)), worth);
    assert!(city_price(&world, city, Some(&realm.id)) < worth);
    let expected = crate::queries::js_round(
        worth * (1.0 - CITY_PRICE_STANDING_SWING * FORMER_PLAYER_STANDING / STANDING_RANGE),
    );
    assert_eq!(city_price(&world, city, Some(&realm.id)), expected);
}

#[test]
fn holds_the_players_new_realm_high_enough_to_ask_it_to_join_for_a_while() {
    let (mut world, ci) = after_death();
    let realm = found(&mut world, 1);
    let stranger = found(&mut world, 2);
    assert!(holds_high(&world, &world.cities[ci], &realm.id));
    assert!(!holds_high(&world, &world.cities[ci], &stranger.id));
    // Until it has faded below high standing.
    let days = (FORMER_PLAYER_STANDING - PERSUADE_STANDING) / STANDING_DRIFT_PER_DAY;
    pass_days(&mut world, days - 1.0);
    assert!(holds_high(&world, &world.cities[ci], &realm.id));
    pass_days(&mut world, 2.0);
    assert!(!holds_high(&world, &world.cities[ci], &realm.id));
}

#[test]
fn fades_from_the_leaders_death_on_also_while_the_player_is_away() {
    let (mut world, ci) = after_death();
    pass_days(&mut world, 10.0);
    let faded = |d: f64| FORMER_PLAYER_STANDING - d * STANDING_DRIFT_PER_DAY;
    assert!(
        (former_player_standing(&world.cities[ci], world.tick as f64) - faded(10.0)).abs() < 0.01
    );
    let realm = found(&mut world, 1);
    let city = world.cities[ci].id.clone();
    assert!((standing_of(&world, &city, &realm.id) - faded(10.0)).abs() < 0.01);
    pass_days(&mut world, 5.0);
    assert!((standing_of(&world, &city, &realm.id) - faded(15.0)).abs() < 0.01);
    assert!(former_players_sound(&world).is_empty());
}

#[test]
fn is_forgotten_once_faded_and_a_player_back_after_that_is_a_stranger() {
    let (mut world, ci) = after_death();
    pass_days(&mut world, FORMER_PLAYER_STANDING / STANDING_DRIFT_PER_DAY);
    assert_eq!(world.cities[ci].former_player, None);
    let realm = found(&mut world, 1);
    let city = world.cities[ci].id.clone();
    assert_eq!(standing_of(&world, &city, &realm.id), 0.0);
}

#[test]
fn is_forgotten_by_a_city_that_joins_a_realm() {
    let (mut world, ci) = after_death();
    world.realms.push(Realm {
        id: "other".into(),
        user_id: 2,
        leader_id: "nobody".into(),
        name: None,
        demands_sent_at: None,
    });
    world.cities[ci].realm_id = Some("other".into());
    step_standing(&mut world);
    assert_eq!(world.cities[ci].former_player, None);
    let realm = found(&mut world, 1);
    let city = world.cities[ci].id.clone();
    assert_eq!(standing_of(&world, &city, &realm.id), 0.0);
}

#[test]
fn goes_only_to_that_player() {
    let (mut world, ci) = after_death();
    let stranger = found(&mut world, 2);
    let city = world.cities[ci].id.clone();
    assert_eq!(standing_of(&world, &city, &stranger.id), 0.0);
    assert_eq!(world.cities[ci].former_player.as_ref().map(|f| f.user_id), Some(1));
    assert!(former_players_sound(&world).is_empty());
}

#[test]
fn is_checked_by_an_invariant() {
    let (mut world, ci) = after_death();
    let check = |world: &WorldState| {
        former_players_sound(world).into_iter().map(|v| v.message).collect::<Vec<_>>()
    };
    assert!(check(&world).is_empty());
    let tick = world.tick as f64;
    world.cities[ci].former_player = Some(FormerPlayer { user_id: 1, tick: tick + 1.0 });
    assert!(matches!(check(&world).as_slice(), [m] if m.contains("still to come")));
    world.cities[ci].former_player = Some(FormerPlayer { user_id: 1, tick });
    world.realms.push(Realm {
        id: "again".into(),
        user_id: 1,
        leader_id: "nobody".into(),
        name: None,
        demands_sent_at: None,
    });
    assert!(matches!(check(&world).as_slice(), [m] if m.contains("has a realm again")));
    world.realms.pop();
    world.cities[ci].realm_id = Some("again".into());
    assert!(check(&world).iter().any(|m| m.contains("belongs to a realm")));
}
