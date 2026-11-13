//! `apps/server/src/persuasion.test.ts` and the respect queries of shared `persuasion.ts`, ported
//! one to one. `diplomacyFor` (the Player's view of the asks) is T86.11's; the full invariant
//! check after a city joins is T86.13's. Respect by strength near the city is ADR 0033's (T96.1).

use csp_shared::balance::{
    BLOW_BASE, COMBAT_SKILL_LIMIT, PERSUADE_ASK_AGAIN_DAYS, PERSUADE_CHECK_TICKS,
    PERSUADE_STANDING, PROTECTION_DEFENCE, RESPECT_PER_WALL, SIGHT_RANGE, SKILL_MAX, WEAPON_ATTACK,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, JoinRequest, RealmEventWhat, SkillName, WorldState};

use super::*;
use crate::queries::persuasion::{city_strength, fighter_strength, persuaded_by, respect_seen_by};
use crate::standing::{change_standing, step_standing};
use crate::test_world::{add_city, building, empty_world, realm, resident};

const SIZE: i32 = 128;
const MARA: u64 = 7;

fn citizen(
    world: &mut WorldState,
    id: &str,
    owner: Option<&str>,
    x: f64,
    y: f64,
    city: Option<&str>,
) -> usize {
    let i = resident(world, id, owner, x, y);
    world.residents[i].city_id = city.map(str::to_string);
    i
}

/// Realm r1 (Player 7, Leader a1 at home in c1) and realm r2 (Player 8), and the NPC city n1 at
/// (40, 40), where n1a lives, armed, and n1b, unarmed. r1's `armed` residents stand just outside
/// n1, in its sight; r1 has `walls` wall tiles of c1 near n1 too.
fn setup(armed: usize, walls: usize) -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    add_city(&mut world, "c1", Some("r1"), 5.0, 5.0, None);
    add_city(&mut world, "n1", None, 40.0, 40.0, None);
    world.cities[1].name = "Oakford".into();
    citizen(&mut world, "a1", Some("r1"), 5.0, 5.0, Some("c1"));
    citizen(&mut world, "b1", Some("r2"), 100.0, 100.0, None);
    let n1a = citizen(&mut world, "n1a", None, 40.0, 40.0, Some("n1"));
    world.residents[n1a].carried.insert(Good::Spear, 1.0);
    citizen(&mut world, "n1b", None, 41.0, 40.0, Some("n1"));
    for i in 0..armed {
        let s =
            citizen(&mut world, &format!("s{i}"), Some("r1"), 45.0, 40.0 + i as f64, Some("c1"));
        world.residents[s].carried.insert(Good::Sword, 1.0);
    }
    for i in 0..walls {
        building(
            &mut world,
            &format!("w{i}"),
            BuildingKind::Wall,
            Some("c1"),
            36.0,
            40.0 + i as f64,
        );
    }
    world
}

fn n1(world: &WorldState) -> &csp_shared::world::City {
    world.cities.iter().find(|c| c.id == "n1").unwrap()
}

/// Steps persuasion at the next check and checks its invariant.
fn check(world: &mut WorldState) {
    let every = PERSUADE_CHECK_TICKS as u64;
    world.tick = (world.tick + 1).div_ceil(every) * every;
    step_persuasion(world, SIZE);
    assert!(join_requests_sound(world).is_empty());
}

fn accept(world: &mut WorldState, city: &str) -> &'static str {
    if let Some(reason) = validate_accept_join(world, MARA, Some(city)) {
        return reason;
    }
    apply_accept_join(world, MARA, Some(city), Some(SIZE));
    "ack"
}

fn decline(world: &mut WorldState, city: &str) -> &'static str {
    if let Some(reason) = validate_decline_join(world, MARA, Some(city)) {
        return reason;
    }
    apply_decline_join(world, MARA, Some(city));
    "ack"
}

fn asks(world: &WorldState) -> Vec<&RealmEventWhat> {
    world
        .events
        .iter()
        .map(|e| &e.what)
        .filter(|w| matches!(w, RealmEventWhat::JoinAsked { .. }))
        .collect()
}

/// Gives the resident a shield, armour and full Combat skill.
fn train_and_armour(world: &mut WorldState, i: usize) {
    let r = &mut world.residents[i];
    r.carried.insert(Good::Shield, 1.0);
    r.carried.insert(Good::Armour, 1.0);
    r.skills.insert(SkillName::Combat, SKILL_MAX.combat);
}

#[test]
fn a_fighter_counts_by_gear_and_training_as_combat_weighs_them() {
    let mut world = setup(0, 0);
    let p = citizen(&mut world, "p", Some("r1"), 45.0, 40.0, None);
    assert_eq!(fighter_strength(&world.residents[p]), 0.0);
    world.residents[p].carried.insert(Good::Spear, 1.0);
    let spear = fighter_strength(&world.residents[p]);
    assert_eq!(spear, BLOW_BASE + WEAPON_ATTACK.get("spear").unwrap());
    world.residents[p].carried.insert(Good::Sword, 1.0);
    let sword = fighter_strength(&world.residents[p]);
    assert!(sword > spear);
    train_and_armour(&mut world, p);
    let trained = fighter_strength(&world.residents[p]);
    let protection =
        PROTECTION_DEFENCE.get("shield").unwrap() + PROTECTION_DEFENCE.get("armour").unwrap();
    assert_eq!(trained, sword * (1.0 + COMBAT_SKILL_LIMIT) + protection);
}

#[test]
fn respect_weighs_the_armed_residents_near_the_city_but_not_their_walls() {
    let world = setup(2, 3);
    let sword = fighter_strength(world.residents.iter().find(|r| r.id == "s0").unwrap());
    assert_eq!(respect_seen_by(&world, n1(&world), "r1", SIZE), 2.0 * sword);
    assert_eq!(respect_seen_by(&world, n1(&world), "r2", SIZE), 0.0);
    // The sender's walls, however many, add nothing.
    let walled = setup(0, 30);
    assert_eq!(respect_seen_by(&walled, n1(&walled), "r1", SIZE), 0.0);
}

#[test]
fn respect_leaves_out_unarmed_residents_and_what_is_out_of_sight_of_home() {
    let mut world = setup(1, 0);
    let one = respect_seen_by(&world, n1(&world), "r1", SIZE);
    citizen(&mut world, "unarmed", Some("r1"), 44.0, 40.0, Some("c1"));
    let far = citizen(&mut world, "far", Some("r1"), 42.0 + SIGHT_RANGE, 40.0, Some("c1"));
    world.residents[far].carried.insert(Good::Spear, 1.0);
    assert_eq!(respect_seen_by(&world, n1(&world), "r1", SIZE), one);
    // The city's scout, far from home, sees the far one; that counts for nothing.
    world.residents.iter_mut().find(|r| r.id == "n1b").unwrap().x = 80.0;
    assert_eq!(respect_seen_by(&world, n1(&world), "r1", SIZE), one);
}

#[test]
fn respect_is_nothing_when_nobody_of_the_city_is_at_home_to_see_it() {
    let mut world = setup(3, 0);
    for r in world.residents.iter_mut().filter(|r| r.city_id.as_deref() == Some("n1")) {
        r.x = 90.0;
    }
    assert_eq!(respect_seen_by(&world, n1(&world), "r1", SIZE), 0.0);
    world.residents.retain(|r| r.city_id.as_deref() != Some("n1"));
    assert_eq!(respect_seen_by(&world, n1(&world), "r1", SIZE), 0.0);
}

#[test]
fn residents_the_city_lent_never_count_as_the_hirers_fighters() {
    let mut world = setup(0, 0);
    let lent = citizen(&mut world, "lent", None, 45.0, 40.0, Some("n1"));
    world.residents[lent].carried.insert(Good::Sword, 1.0);
    let contract = serde_json::json!({
        "id": "k1", "lenderId": "n1", "hirerId": "r1", "offeredBy": "lender",
        "residentIds": ["lent"], "days": 7, "pricePerWeek": 5, "storageId": "n1-hall",
        "startedAt": 0, "paidWeeks": 1,
    });
    world.contracts.push(serde_json::from_value(contract).unwrap());
    assert_eq!(respect_seen_by(&world, n1(&world), "r1", SIZE), 0.0);
    // Even were they the hirer's to command by owner, they are the city's own.
    world.residents[lent].owner = Some("r1".into());
    assert_eq!(respect_seen_by(&world, n1(&world), "r1", SIZE), 0.0);
}

#[test]
fn the_citys_own_side_is_its_soldiers_by_strength_and_its_walls() {
    let mut world = setup(0, 0);
    let spear = fighter_strength(world.residents.iter().find(|r| r.id == "n1a").unwrap());
    assert_eq!(city_strength(&world, n1(&world)), spear);
    for i in 0..4 {
        building(
            &mut world,
            &format!("nw{i}"),
            BuildingKind::Wall,
            Some("n1"),
            44.0,
            36.0 + i as f64,
        );
    }
    building(&mut world, "ng", BuildingKind::Gate, Some("n1"), 44.0, 41.0);
    assert_eq!(city_strength(&world, n1(&world)), spear + 5.0 * RESPECT_PER_WALL);
}

#[test]
fn needs_high_standing_and_more_respect_than_the_citys_own_side() {
    // One resident with a spear against the city's one with a spear: not more.
    let mut world = setup(0, 0);
    let s = citizen(&mut world, "s", Some("r1"), 46.0, 40.0, Some("c1"));
    world.residents[s].carried.insert(Good::Spear, 1.0);
    change_standing(&mut world, "n1", "r1", PERSUADE_STANDING);
    assert!(!persuaded_by(&world, n1(&world), "r1", SIZE));
    world.residents[s].carried.insert(Good::Shield, 1.0);
    assert!(persuaded_by(&world, n1(&world), "r1", SIZE));
    change_standing(&mut world, "n1", "r1", -1.0);
    assert!(!persuaded_by(&world, n1(&world), "r1", SIZE));
}

#[test]
fn makes_the_city_ask_to_join_once_in_the_realm_log() {
    let mut world = setup(2, 0);
    change_standing(&mut world, "n1", "r1", 60.0);
    check(&mut world);
    let at = world.tick as f64;
    assert_eq!(
        world.join_requests,
        vec![JoinRequest { city_id: "n1".into(), realm_id: "r1".into(), at, declined: false }]
    );
    assert!(matches!(asks(&world).as_slice(),
        [RealmEventWhat::JoinAsked { city, x, y, .. }] if city == "Oakford" && *x == 40.0 && *y == 40.0));
    check(&mut world);
    assert_eq!(asks(&world).len(), 1);
}

#[test]
fn asks_only_between_checks_and_not_without_high_standing() {
    let mut world = setup(2, 0);
    check(&mut world);
    assert!(world.join_requests.is_empty());
    change_standing(&mut world, "n1", "r1", 60.0);
    world.tick = PERSUADE_CHECK_TICKS as u64 + 1;
    step_persuasion(&mut world, SIZE);
    assert!(world.join_requests.is_empty());
}

#[test]
fn asks_the_realm_it_holds_in_the_highest_standing() {
    let mut world = setup(2, 0);
    for i in 0..2 {
        let t = citizen(&mut world, &format!("t{i}"), Some("r2"), 35.0, 40.0 + i as f64, None);
        world.residents[t].carried.insert(Good::Sword, 1.0);
    }
    change_standing(&mut world, "n1", "r1", 60.0);
    change_standing(&mut world, "n1", "r2", 80.0);
    check(&mut world);
    assert_eq!(
        world.join_requests.iter().map(|q| q.realm_id.as_str()).collect::<Vec<_>>(),
        vec!["r2"]
    );
}

#[test]
fn never_makes_a_realms_city_or_the_trade_organization_ask() {
    let mut world = setup(2, 0);
    add_city(&mut world, "c2", Some("r2"), 42.0, 42.0, None);
    citizen(&mut world, "c2a", Some("r2"), 42.0, 42.0, Some("c2"));
    change_standing(&mut world, "n1", "r1", 60.0);
    check(&mut world);
    assert_eq!(
        world.join_requests.iter().map(|q| q.city_id.as_str()).collect::<Vec<_>>(),
        vec!["n1"]
    );
}

#[test]
fn integrates_the_city_when_accepted() {
    let mut world = setup(2, 0);
    change_standing(&mut world, "n1", "r1", 60.0);
    check(&mut world);
    assert_eq!(accept(&mut world, "n1"), "ack");
    assert_eq!(n1(&world).realm_id.as_deref(), Some("r1"));
    let owners: Vec<_> = world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some("n1"))
        .map(|r| r.owner.clone())
        .collect();
    assert_eq!(owners, vec![Some("r1".to_string()), Some("r1".to_string())]);
    assert!(world.join_requests.is_empty());
    assert!(matches!(&world.events.last().unwrap().what,
        RealmEventWhat::CityPersuaded { city, residents, .. } if city == "Oakford" && *residents == 2.0));
    // Standing toward the city it was is dropped later in the same tick.
    step_standing(&mut world);
    assert!(crate::standing::standings_sound(&world).is_empty());
    assert!(join_requests_sound(&world).is_empty());
}

#[test]
fn only_takes_an_answer_from_the_realm_asked_while_the_ask_stands() {
    let mut world = setup(2, 0);
    assert_eq!(accept(&mut world, "n1"), "that city isn’t asking to join your realm");
    world.join_requests.push(JoinRequest {
        city_id: "n1".into(),
        realm_id: "r2".into(),
        at: 0.0,
        declined: false,
    });
    assert_eq!(decline(&mut world, "n1"), "that city isn’t asking to join your realm");
}

#[test]
fn doesnt_ask_a_realm_again_for_a_while_once_declined() {
    let mut world = setup(2, 0);
    change_standing(&mut world, "n1", "r1", 100.0);
    check(&mut world);
    assert_eq!(decline(&mut world, "n1"), "ack");
    assert!(matches!(world.join_requests.as_slice(), [q] if q.declined));
    assert_ne!(accept(&mut world, "n1"), "ack");
    world.tick += (PERSUADE_ASK_AGAIN_DAYS * TICKS_PER_GAME_DAY / 2.0) as u64;
    check(&mut world);
    assert_eq!(asks(&world).len(), 1);
    world.tick += (PERSUADE_ASK_AGAIN_DAYS * TICKS_PER_GAME_DAY) as u64;
    check(&mut world);
    assert_eq!(asks(&world).len(), 2);
    assert!(matches!(world.join_requests.as_slice(), [q] if !q.declined));
}

#[test]
fn withdraws_the_ask_once_the_city_no_longer_holds_the_realm_in_high_standing() {
    let mut world = setup(2, 0);
    change_standing(&mut world, "n1", "r1", PERSUADE_STANDING);
    check(&mut world);
    change_standing(&mut world, "n1", "r1", -10.0);
    world.tick += 1;
    step_persuasion(&mut world, SIZE);
    assert!(world.join_requests.is_empty());
    assert!(
        matches!(&world.events.last().unwrap().what, RealmEventWhat::JoinWithdrawn { city, .. } if city == "Oakford")
    );
}

#[test]
fn drops_the_ask_when_the_city_joins_a_realm_some_other_way() {
    let mut world = setup(2, 0);
    change_standing(&mut world, "n1", "r1", 60.0);
    check(&mut world);
    world.cities.iter_mut().find(|c| c.id == "n1").unwrap().realm_id = Some("r2".into());
    world.tick += 1;
    step_persuasion(&mut world, SIZE);
    assert!(world.join_requests.is_empty());
}

#[test]
fn is_caught_by_its_invariant_when_an_ask_goes_wrong() {
    let mut world = setup(2, 0);
    let ask = |city: &str, realm: &str, declined| JoinRequest {
        city_id: city.into(),
        realm_id: realm.into(),
        at: 0.0,
        declined,
    };
    world.join_requests.extend([
        ask("n1", "r1", false),
        ask("n1", "r2", false),
        ask("c1", "r2", true),
    ]);
    let messages: Vec<String> =
        join_requests_sound(&world).into_iter().map(|v| v.message).collect();
    for m in [
        "n1 asks r1 to join without holding it in high standing",
        "n1 asks more than one realm to join",
        "c1 asks r2 to join but is no NPC city",
    ] {
        assert!(messages.iter().any(|x| x == m), "{m} in {messages:?}");
    }
}

#[test]
fn respect_is_caught_by_its_invariant_when_a_weight_goes_below_nothing() {
    let mut world = setup(2, 0);
    world.join_requests.push(JoinRequest {
        city_id: "n1".into(),
        realm_id: "r1".into(),
        at: 0.0,
        declined: false,
    });
    assert_eq!(respect_sound(&world, SIZE), vec![]);
    let s0 = world.residents.iter_mut().find(|r| r.id == "s0").unwrap();
    s0.skills.insert(SkillName::Combat, -100.0);
    let found: Vec<_> = respect_sound(&world, SIZE).into_iter().map(|v| v.entity_ids).collect();
    assert_eq!(found, vec![vec!["n1".to_string(), "r1".to_string()]]);
}
