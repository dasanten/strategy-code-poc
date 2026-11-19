//! A Player's Zeal (T116.1, `CONTEXT.md`: Zeal): a new Player starts full, a lowered pool fills
//! at the pace and stops at the cap, also over a save and load, a Leader handover and a Leader
//! death keep it, and the invariant.

use csp_shared::balance::{ZEAL_CAP_HOURS, ZEAL_FILL_TICKS, ZEAL_PER_TICK};
use csp_shared::world::{parse_save, DeathCause, WorldState, WORLD_FORMAT_VERSION};

use super::*;
use crate::invariants::check_all;
use crate::leader::{apply_hand_over, validate_hand_over, HandOverRequest};
use crate::queries::city::town_hall_of;
use crate::queries::residents::can_work;
use crate::survival::die_all;
use crate::test_world::{city_terrain, live_mut, world_with_city};
use crate::tick::Scratch;
use crate::world::step_world;

/// Player 1's account in `world_with_city`.
const PLAYER: u64 = 1;

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

fn zeal_problems(world: &WorldState) -> Vec<String> {
    check_all(world, city_terrain())
        .into_iter()
        .filter(|v| v.invariant == "zeal-within-cap")
        .map(|v| v.message)
        .collect()
}

#[test]
fn a_new_player_starts_full_and_a_full_pool_keeps_no_entry() {
    let world = world_with_city();
    assert_eq!(zeal_of(&world, PLAYER), ZEAL_CAP_HOURS);
    assert!(world.zeal.is_empty());
    // An account with no realm yet holds a full pool too.
    assert_eq!(zeal_of(&world, 99), ZEAL_CAP_HOURS);
}

#[test]
fn the_balance_fills_an_empty_pool_in_two_real_hours() {
    // One tick is one real second (`CONTEXT.md`: Game time).
    assert_eq!(ZEAL_FILL_TICKS, 7200.0);
    assert_eq!(ZEAL_CAP_HOURS, 48.0);
    assert!(close(ZEAL_PER_TICK * ZEAL_FILL_TICKS, ZEAL_CAP_HOURS));
}

#[test]
fn a_lowered_pool_fills_at_the_pace_and_stops_at_the_cap() {
    let mut world = world_with_city();
    set_zeal(&mut world, PLAYER, 0.0);
    assert_eq!(zeal_of(&world, PLAYER), 0.0);
    // Half the fill time gives half the pool.
    for _ in 0..(ZEAL_FILL_TICKS / 2.0) as usize {
        step_zeal(&mut world);
    }
    assert!(close(zeal_of(&world, PLAYER), ZEAL_CAP_HOURS / 2.0));
    // The rest, and more, stop at the cap with the entry gone.
    for _ in 0..(ZEAL_FILL_TICKS / 2.0) as usize + 100 {
        step_zeal(&mut world);
        assert!(zeal_of(&world, PLAYER) <= ZEAL_CAP_HOURS);
    }
    assert_eq!(zeal_of(&world, PLAYER), ZEAL_CAP_HOURS);
    assert!(world.zeal.is_empty());
}

#[test]
fn the_world_tick_fills_it() {
    let mut world = world_with_city();
    set_zeal(&mut world, PLAYER, 10.0);
    let mut scratch = Scratch::default();
    for _ in 0..3 {
        step_world(&mut world, city_terrain(), &mut scratch, None, None);
    }
    assert!(close(zeal_of(&world, PLAYER), 10.0 + 3.0 * ZEAL_PER_TICK));
    assert!(zeal_problems(&world).is_empty());
}

#[test]
fn set_zeal_keeps_it_between_empty_and_the_cap() {
    let mut world = world_with_city();
    set_zeal(&mut world, PLAYER, -5.0);
    assert_eq!(zeal_of(&world, PLAYER), 0.0);
    set_zeal(&mut world, PLAYER, f64::NAN);
    assert_eq!(zeal_of(&world, PLAYER), 0.0);
    set_zeal(&mut world, PLAYER, ZEAL_CAP_HOURS + 5.0);
    assert_eq!(zeal_of(&world, PLAYER), ZEAL_CAP_HOURS);
    assert!(world.zeal.is_empty());
}

#[test]
fn it_is_kept_over_a_save_and_load_and_fills_on_from_there() {
    let mut world = world_with_city();
    // A save with every pool full says nothing of Zeal, as one from before format 146.
    let full = serde_json::to_value(&world).unwrap();
    assert!(full.get("zeal").is_none());
    set_zeal(&mut world, PLAYER, 12.5);
    let json = serde_json::to_vec(&world).unwrap();
    let mut loaded = parse_save(WORLD_FORMAT_VERSION, &json).unwrap();
    assert_eq!(zeal_of(&loaded, PLAYER), 12.5);
    step_zeal(&mut loaded);
    assert!(close(zeal_of(&loaded, PLAYER), 12.5 + ZEAL_PER_TICK));
}

#[test]
fn a_leader_death_keeps_it() {
    let mut world = world_with_city();
    set_zeal(&mut world, PLAYER, 5.0);
    let realm = world.realms.iter().find(|r| r.user_id == PLAYER).unwrap().clone();
    let size = city_terrain().size;
    // No heir: the realm ends with its Leader, and the Player's pool is still theirs.
    let (_, ended) = die_all(&mut world, &[realm.leader_id], DeathCause::Killed, size, None);
    assert_eq!(ended.len(), 1);
    assert!(!world.realms.iter().any(|r| r.user_id == PLAYER));
    assert_eq!(zeal_of(&world, PLAYER), 5.0);
    // And it fills on while they have no realm.
    step_world(&mut world, city_terrain(), &mut Scratch::default(), None, None);
    assert!(close(zeal_of(&world, PLAYER), 5.0 + ZEAL_PER_TICK));
}

#[test]
fn a_leader_handover_keeps_it() {
    let mut world = world_with_city();
    set_zeal(&mut world, PLAYER, 7.0);
    let realm = world.realms.iter().find(|r| r.user_id == PLAYER).unwrap().clone();
    let tick = world.tick as f64;
    let new_leader = world
        .residents
        .iter()
        .find(|r| {
            r.owner.as_deref() == Some(realm.id.as_str())
                && r.id != realm.leader_id
                && can_work(r.born_at, tick)
        })
        .unwrap()
        .id
        .clone();
    // A handover needs both in the same city: on its town hall.
    let city = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm.id.as_str()));
    let hall = town_hall_of(&world, city.unwrap()).unwrap().clone();
    for id in [&realm.leader_id, &new_leader] {
        let r = live_mut(&mut world, id);
        (r.x, r.y) = (hall.x, hall.y);
    }
    let size = Some(city_terrain().size);
    let o = HandOverRequest {
        resident_id: Some(&realm.leader_id),
        new_leader_id: Some(&new_leader),
    };
    assert_eq!(validate_hand_over(&world, PLAYER, &o, size), None);
    apply_hand_over(&mut world, PLAYER, &o, size);
    assert_eq!(world.realms.iter().find(|r| r.id == realm.id).unwrap().leader_id, new_leader);
    assert_eq!(zeal_of(&world, PLAYER), 7.0);
}

#[test]
fn invariant_zeal_is_never_below_zero_or_above_the_cap() {
    let mut world = world_with_city();
    set_zeal(&mut world, PLAYER, 3.0);
    assert!(zeal_problems(&world).is_empty());
    world.zeal.insert(PLAYER, -0.5);
    assert_eq!(zeal_problems(&world).len(), 1);
    world.zeal.insert(PLAYER, ZEAL_CAP_HOURS + 1.0);
    assert_eq!(zeal_problems(&world).len(), 1);
    world.zeal.insert(PLAYER, f64::NAN);
    assert_eq!(zeal_problems(&world).len(), 1);
}
