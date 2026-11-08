//! `apps/server/src/renaming.test.ts`, ported one to one. Renaming from a script is the game
//! API's (T86.12); Last seen keeping a city's old name is T86.13's.

use csp_shared::balance::{
    CITY_NAME_MAX_LENGTH, HORSE_NAME_MAX_LENGTH, REALM_NAME_MAX_LENGTH, RESIDENT_NAME_MAX_LENGTH,
};
use csp_shared::world::{DeathCause, RealmEventWhat, ResidentOrder, Tile, WalkOrder, WorldState};

use super::*;
use crate::pending::record_event;
use crate::queries::alliance::realm_name;
use crate::queries::residents::can_work;
use crate::starting_city::found_starting_city;
use crate::test_world::{city_terrain, live, live_mut};
use crate::world::create_world;

const MARA: u64 = 1;
const TOBIN: u64 = 2;

/// Mara's and Tobin's starting cities, Mara's Leader, a grown resident of hers who isn't her
/// Leader, and Tobin's Leader.
struct Setup {
    world: WorldState,
    leader: String,
    miner: String,
    stranger: String,
}

fn setup() -> Setup {
    let terrain = city_terrain();
    let mut world = create_world(terrain, 1);
    found_starting_city(&mut world, terrain, MARA, None);
    found_starting_city(&mut world, terrain, TOBIN, None);
    let realm = world.realms.iter().find(|r| r.user_id == MARA).unwrap().clone();
    let leader = realm.leader_id.clone();
    let miner = world
        .residents
        .iter()
        .find(|r| {
            r.owner.as_deref() == Some(realm.id.as_str())
                && r.id != leader
                && can_work(r.born_at, world.tick as f64)
        })
        .unwrap()
        .id
        .clone();
    let stranger = world.realms.iter().find(|r| r.user_id == TOBIN).unwrap().leader_id.clone();
    Setup { world, leader, miner, stranger }
}

fn mara_realm(world: &WorldState) -> &csp_shared::world::Realm {
    world.realms.iter().find(|r| r.user_id == MARA).unwrap()
}

/// Renames `target` by hand, as the selection card does (asked by the target).
fn rename(
    world: &mut WorldState,
    target: &str,
    name: Given,
    realm_name: Given,
    sender: u64,
) -> String {
    rename_by(world, target, target, name, realm_name, sender)
}

fn rename_by(
    world: &mut WorldState,
    asker: &str,
    target: &str,
    name: Given,
    realm_name: Given,
    sender: u64,
) -> String {
    let o = RenameRequest {
        resident_id: Some(asker),
        target_id: Some(target),
        name,
        realm_name,
        ..Default::default()
    };
    if let Some(reason) = validate_rename(world, sender, &o) {
        return reason;
    }
    apply_rename(world, sender, &o);
    "ok".into()
}

fn text(s: &str) -> Given<'_> {
    Given::Text(s)
}

#[test]
fn gives_one_of_your_own_residents_the_new_name_trimmed_from_anywhere() {
    let Setup { mut world, miner, .. } = setup();
    let m = live_mut(&mut world, &miner);
    m.x += 40.0;
    m.y += 40.0;
    assert_eq!(rename(&mut world, &miner, text("  Old Gerd  "), Given::Missing, MARA), "ok");
    assert_eq!(live(&world, &miner).unwrap().name, "Old Gerd");
    assert_eq!(mara_realm(&world).name, None);
    assert!(resident_names_well_formed(&world).is_empty());
}

#[test]
fn lets_names_repeat() {
    let Setup { mut world, leader, miner, .. } = setup();
    let name = live(&world, &leader).unwrap().name.clone();
    assert_eq!(rename(&mut world, &miner, text(&name), Given::Missing, MARA), "ok");
    assert_eq!(live(&world, &miner).unwrap().name, name);
}

#[test]
fn leaves_what_the_resident_was_doing_and_their_script_as_it_was() {
    let Setup { mut world, miner, .. } = setup();
    let order = ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x: 1.0, y: 1.0 },
        path: None,
        progress: 0.0,
        army: None,
    });
    live_mut(&mut world, &miner).order = Some(order.clone());
    assert_eq!(rename(&mut world, &miner, text("Gerd"), Given::Missing, MARA), "ok");
    assert_eq!(live(&world, &miner).unwrap().order, Some(order));
    assert!(live(&world, &miner).unwrap().script.is_some());
}

#[test]
fn refuses_residents_of_other_realms() {
    let Setup { mut world, miner, stranger, .. } = setup();
    let before = live(&world, &stranger).unwrap().name.clone();
    assert_eq!(
        rename(&mut world, &stranger, text("Mine now"), Given::Missing, MARA),
        "not one of your residents"
    );
    // Nor through one of your own asking.
    assert_eq!(
        rename_by(&mut world, &miner, &stranger, text("X"), Given::Missing, MARA),
        "not one of your residents"
    );
    assert_eq!(live(&world, &stranger).unwrap().name, before);
}

#[test]
fn refuses_bad_names() {
    let Setup { mut world, miner, .. } = setup();
    let before = live(&world, &miner).unwrap().name.clone();
    assert_eq!(rename(&mut world, &miner, text(""), Given::Missing, MARA), "Name: needs a name");
    assert_eq!(rename(&mut world, &miner, text("   "), Given::Missing, MARA), "Name: needs a name");
    assert_eq!(
        rename(&mut world, &miner, Given::NotText, Given::Missing, MARA),
        "Name: needs a name"
    );
    let max = RESIDENT_NAME_MAX_LENGTH as usize;
    let long = "x".repeat(max + 1);
    assert_eq!(
        rename(&mut world, &miner, text(&long), Given::Missing, MARA),
        format!("Name: at most {max} characters")
    );
    assert_eq!(rename(&mut world, &miner, text(&"x".repeat(max)), Given::Missing, MARA), "ok");
    assert_ne!(live(&world, &miner).unwrap().name, before);
}

#[test]
fn keeps_the_old_name_in_realm_log_entries_from_before() {
    let Setup { mut world, miner, .. } = setup();
    let before = live(&world, &miner).unwrap().name.clone();
    let realm = mara_realm(&world).id.clone();
    let what = RealmEventWhat::Died {
        resident_id: miner.clone(),
        name: before.clone(),
        cause: DeathCause::Starved,
        leader: false,
        by: None,
    };
    record_event(&mut world, Some(&realm), what);
    let logged = world.events.clone();
    assert_eq!(rename(&mut world, &miner, text("Gerd"), Given::Missing, MARA), "ok");
    assert_eq!(world.events, logged);
    assert!(
        matches!(&logged.last().unwrap().what, RealmEventWhat::Died { name, .. } if *name == before)
    );
}

#[test]
fn renaming_the_leader_of_a_realm_with_no_name_yet_needs_a_realm_name_and_names_the_realm() {
    let Setup { mut world, leader, .. } = setup();
    let before = live(&world, &leader).unwrap().name.clone();
    assert_eq!(mara_realm(&world).name, None);
    assert!(rename(&mut world, &leader, text("Queen Mara"), Given::Missing, MARA)
        .starts_with("Realm name: needs a name"));
    assert!(rename(&mut world, &leader, text("Queen Mara"), text("  "), MARA)
        .starts_with("Realm name: needs"));
    let max = REALM_NAME_MAX_LENGTH as usize;
    let long = "x".repeat(max + 1);
    assert!(rename(&mut world, &leader, text("Queen Mara"), text(&long), MARA)
        .contains(&format!("Realm name: at most {max} characters")));
    assert_eq!(live(&world, &leader).unwrap().name, before);
    assert_eq!(mara_realm(&world).name, None);
    assert_eq!(rename(&mut world, &leader, text("Queen Mara"), text(" Ironvale "), MARA), "ok");
    assert_eq!(live(&world, &leader).unwrap().name, "Queen Mara");
    assert_eq!(mara_realm(&world).name.as_deref(), Some("Ironvale"));
}

#[test]
fn renaming_the_leader_of_a_named_realm_never_renames_the_realm() {
    let Setup { mut world, leader, .. } = setup();
    let realm = mara_realm(&world).id.clone();
    world.realms.iter_mut().find(|r| r.id == realm).unwrap().name = Some("Ironvale".into());
    assert_eq!(rename(&mut world, &leader, text("Queen Mara"), Given::Missing, MARA), "ok");
    assert_eq!(live(&world, &leader).unwrap().name, "Queen Mara");
    assert_eq!(realm_name(&world, &realm), "Ironvale");
    assert_eq!(
        rename(&mut world, &leader, text("Mara"), text("Elsewhere"), MARA),
        "your realm has its name already"
    );
    assert_eq!(mara_realm(&world).name.as_deref(), Some("Ironvale"));
}

#[test]
fn a_realm_name_comes_only_with_renaming_the_leader() {
    let Setup { mut world, miner, .. } = setup();
    assert_eq!(
        rename(&mut world, &miner, text("Gerd"), text("Ironvale"), MARA),
        "only renaming your Leader names your realm"
    );
    assert_eq!(mara_realm(&world).name, None);
}

#[test]
#[ignore = "needs the game API (T86.12)"]
fn renaming_from_a_script_is_in_the_script_api_and_does_what_the_order_does() {}

fn rename_horse(
    world: &mut WorldState,
    asker: &str,
    horse: &str,
    name: Given,
    sender: u64,
) -> String {
    let o = RenameRequest {
        resident_id: Some(asker),
        horse_id: Some(horse),
        name,
        ..Default::default()
    };
    if let Some(reason) = validate_rename_horse(world, sender, &o) {
        return reason;
    }
    apply_rename_horse(world, sender, &o);
    "ok".into()
}

fn own_horses(world: &WorldState) -> Vec<String> {
    let realm = mara_realm(world).id.clone();
    world
        .horses
        .iter()
        .filter(|h| h.realm_id.as_deref() == Some(realm.as_str()))
        .map(|h| h.id.clone())
        .collect()
}

fn horse_name_of(world: &WorldState, id: &str) -> String {
    world.horses.iter().find(|h| h.id == id).unwrap().name.clone()
}

#[test]
fn gives_a_horse_of_your_realm_the_new_name_trimmed_from_anywhere() {
    let Setup { mut world, leader, .. } = setup();
    let horse = own_horses(&world)[0].clone();
    // Every horse has a name from the start.
    assert!(horse_name_of(&world, &horse).chars().any(|c| !c.is_whitespace()));
    let l = live_mut(&mut world, &leader);
    l.x += 40.0;
    l.y += 40.0;
    assert_eq!(rename_horse(&mut world, &leader, &horse, text("  Old Grey  "), MARA), "ok");
    assert_eq!(horse_name_of(&world, &horse), "Old Grey");
    assert!(horse_names_well_formed(&world).is_empty());
}

#[test]
fn lets_horse_names_repeat() {
    let Setup { mut world, leader, .. } = setup();
    let horses = own_horses(&world);
    assert_eq!(rename_horse(&mut world, &leader, &horses[0], text("Twin"), MARA), "ok");
    assert_eq!(rename_horse(&mut world, &leader, &horses[1], text("Twin"), MARA), "ok");
    assert_eq!(
        (horse_name_of(&world, &horses[0]), horse_name_of(&world, &horses[1])),
        ("Twin".into(), "Twin".into())
    );
}

#[test]
fn refuses_other_realms_horses_npc_cities_horses_and_bad_names() {
    let Setup { mut world, leader, stranger, .. } = setup();
    let horse = own_horses(&world)[0].clone();
    let was = horse_name_of(&world, &horse);
    let stranger_realm = live(&world, &stranger).unwrap().owner.clone();
    let theirs = world.horses.iter().find(|h| h.realm_id == stranger_realm).unwrap().id.clone();
    assert_eq!(
        rename_horse(&mut world, &leader, &theirs, text("Mine"), MARA),
        "not one of your horses"
    );
    let mut npc = world.horses.iter().find(|h| h.id == horse).unwrap().clone();
    npc.id = "npc-horse".into();
    npc.realm_id = None;
    npc.city_id = Some("npc".into());
    world.horses.push(npc);
    assert_eq!(
        rename_horse(&mut world, &leader, "npc-horse", text("Mine"), MARA),
        "not one of your horses"
    );
    assert_eq!(
        rename_horse(&mut world, &leader, "no-such-horse", text("Mine"), MARA),
        "not one of your horses"
    );
    // Tobin can't rename Mara's horse, not even asking through his own Leader.
    assert_eq!(
        rename_horse(&mut world, &stranger, &horse, text("Mine"), TOBIN),
        "not one of your horses"
    );
    assert_eq!(rename_horse(&mut world, &leader, &horse, text(""), MARA), "Name: needs a name");
    assert_eq!(rename_horse(&mut world, &leader, &horse, text("   "), MARA), "Name: needs a name");
    assert_eq!(
        rename_horse(&mut world, &leader, &horse, Given::NotText, MARA),
        "Name: needs a name"
    );
    let max = HORSE_NAME_MAX_LENGTH as usize;
    assert_eq!(
        rename_horse(&mut world, &leader, &horse, text(&"x".repeat(max + 1)), MARA),
        format!("Name: at most {max} characters")
    );
    assert_eq!(horse_name_of(&world, &horse), was);
}

#[test]
fn keeps_a_horses_old_name_in_realm_log_entries_from_before() {
    let Setup { mut world, leader, .. } = setup();
    let horse = own_horses(&world)[0].clone();
    let was = horse_name_of(&world, &horse);
    let realm = mara_realm(&world).id.clone();
    let what = RealmEventWhat::Foaled {
        horse_id: horse.clone(),
        stable_id: "s".into(),
        name: Some(was.clone()),
    };
    record_event(&mut world, Some(&realm), what);
    assert_eq!(rename_horse(&mut world, &leader, &horse, text("Grey"), MARA), "ok");
    assert!(
        matches!(&world.events.last().unwrap().what, RealmEventWhat::Foaled { name: Some(n), .. } if *n == was)
    );
}

#[test]
fn horse_names_well_formed_reports_an_empty_untrimmed_or_too_long_name() {
    let Setup { mut world, .. } = setup();
    assert!(horse_names_well_formed(&world).is_empty());
    let horses = own_horses(&world);
    world.horses.iter_mut().find(|h| h.id == horses[0]).unwrap().name = " Grey".into();
    world.horses.iter_mut().find(|h| h.id == horses[1]).unwrap().name =
        "x".repeat(HORSE_NAME_MAX_LENGTH as usize + 1);
    let ids: Vec<Vec<String>> =
        horse_names_well_formed(&world).into_iter().map(|v| v.entity_ids).collect();
    assert_eq!(ids, vec![vec![horses[0].clone()], vec![horses[1].clone()]]);
}

#[test]
fn resident_names_well_formed_reports_an_empty_untrimmed_or_too_long_name() {
    let Setup { mut world, leader, miner, .. } = setup();
    assert!(resident_names_well_formed(&world).is_empty());
    live_mut(&mut world, &miner).name = " Gerd".into();
    live_mut(&mut world, &leader).name = "x".repeat(RESIDENT_NAME_MAX_LENGTH as usize + 1);
    let ids: Vec<Vec<String>> =
        resident_names_well_formed(&world).into_iter().map(|v| v.entity_ids).collect();
    assert_eq!(ids, vec![vec![leader.clone()], vec![miner.clone()]]);
}

fn rename_city(
    world: &mut WorldState,
    asker: &str,
    city: &str,
    name: Given,
    sender: u64,
) -> String {
    let o =
        RenameRequest { resident_id: Some(asker), city_id: Some(city), name, ..Default::default() };
    if let Some(reason) = validate_rename_city(world, sender, &o) {
        return reason;
    }
    apply_rename_city(world, sender, &o);
    "ok".into()
}

/// Mara's starting city and Tobin's, by id.
fn cities(world: &WorldState, stranger: &str) -> (String, String) {
    let mine = mara_realm(world).id.clone();
    let theirs = live(world, stranger).unwrap().owner.clone();
    let city = world
        .cities
        .iter()
        .find(|c| c.realm_id.as_deref() == Some(mine.as_str()))
        .unwrap()
        .id
        .clone();
    let other = world.cities.iter().find(|c| c.realm_id == theirs).unwrap().id.clone();
    (city, other)
}

fn city_name(world: &WorldState, id: &str) -> String {
    world.cities.iter().find(|c| c.id == id).unwrap().name.clone()
}

#[test]
fn gives_a_city_of_your_realm_the_new_name_trimmed_from_anywhere() {
    let Setup { mut world, leader, stranger, .. } = setup();
    let (city, _) = cities(&world, &stranger);
    let l = live_mut(&mut world, &leader);
    l.x += 60.0;
    l.y += 60.0;
    assert_eq!(rename_city(&mut world, &leader, &city, text("  Ironhold "), MARA), "ok");
    assert_eq!(city_name(&world, &city), "Ironhold");
    assert!(city_names_well_formed(&world).is_empty());
}

#[test]
fn lets_city_names_repeat() {
    let Setup { mut world, leader, stranger, .. } = setup();
    let (city, theirs) = cities(&world, &stranger);
    let name = city_name(&world, &theirs);
    assert_eq!(rename_city(&mut world, &leader, &city, text(&name), MARA), "ok");
    assert_eq!(city_name(&world, &city), name);
}

#[test]
fn refuses_other_realms_cities_and_npc_cities() {
    let Setup { mut world, leader, stranger, .. } = setup();
    let (city, theirs) = cities(&world, &stranger);
    let before = city_name(&world, &theirs);
    assert_eq!(
        rename_city(&mut world, &leader, &theirs, text("Mine now"), MARA),
        "not one of your cities"
    );
    assert_eq!(city_name(&world, &theirs), before);
    // An NPC city keeps its name, also when a Player's resident is the one asking.
    world.cities.iter_mut().find(|c| c.id == city).unwrap().realm_id = None;
    assert_eq!(
        rename_city(&mut world, &leader, &city, text("Mine now"), MARA),
        "not one of your cities"
    );
    // Nor through a resident of someone else's.
    let theirs_realm = live(&world, &stranger).unwrap().owner.clone();
    world.cities.iter_mut().find(|c| c.id == city).unwrap().realm_id = theirs_realm;
    assert_eq!(
        rename_city(&mut world, &stranger, &city, text("X"), MARA),
        "not one of your residents"
    );
    assert!(world.cities.iter().all(|c| c.name != "Mine now" && c.name != "X"));
}

#[test]
fn refuses_bad_city_names() {
    let Setup { mut world, leader, stranger, .. } = setup();
    let (city, _) = cities(&world, &stranger);
    let before = city_name(&world, &city);
    assert_eq!(rename_city(&mut world, &leader, &city, text(""), MARA), "Name: needs a name");
    assert_eq!(rename_city(&mut world, &leader, &city, text("  "), MARA), "Name: needs a name");
    assert_eq!(rename_city(&mut world, &leader, &city, Given::NotText, MARA), "Name: needs a name");
    let max = CITY_NAME_MAX_LENGTH as usize;
    assert_eq!(
        rename_city(&mut world, &leader, &city, text(&"x".repeat(max + 1)), MARA),
        format!("Name: at most {max} characters")
    );
    assert_eq!(city_name(&world, &city), before);
    assert_eq!(rename_city(&mut world, &leader, &city, text(&"x".repeat(max)), MARA), "ok");
}

#[test]
fn keeps_its_name_when_it_changes_hands_until_its_new_owner_renames_it() {
    let Setup { mut world, leader, stranger, .. } = setup();
    let (city, _) = cities(&world, &stranger);
    let before = city_name(&world, &city);
    let theirs_realm = live(&world, &stranger).unwrap().owner.clone();
    world.cities.iter_mut().find(|c| c.id == city).unwrap().realm_id = theirs_realm;
    assert_eq!(city_name(&world, &city), before);
    assert_eq!(
        rename_city(&mut world, &leader, &city, text("Ironhold"), MARA),
        "not one of your cities"
    );
    assert_eq!(rename_city(&mut world, &stranger, &city, text("Tobinsby"), TOBIN), "ok");
    assert_eq!(city_name(&world, &city), "Tobinsby");
}

#[test]
fn keeps_a_citys_old_name_in_realm_log_entries_from_before() {
    let Setup { mut world, leader, stranger, .. } = setup();
    let (city, _) = cities(&world, &stranger);
    let before = city_name(&world, &city);
    let logged = world.events.clone();
    assert!(world.events.iter().any(|e| e.user_id == MARA
        && matches!(&e.what, RealmEventWhat::Founded { city, .. } if *city == before)));
    assert_eq!(rename_city(&mut world, &leader, &city, text("Ironhold"), MARA), "ok");
    assert_eq!(world.events, logged);
}

#[test]
#[ignore = "needs Last seen (T86.13)"]
fn a_new_city_name_is_learnt_by_others_only_by_sight() {}

#[test]
#[ignore = "needs the game API (T86.12)"]
fn renaming_a_horse_or_a_city_from_a_script_is_in_the_script_api() {}

#[test]
fn city_names_well_formed_reports_an_empty_untrimmed_or_too_long_name() {
    let Setup { mut world, stranger, .. } = setup();
    assert!(city_names_well_formed(&world).is_empty());
    let (city, theirs) = cities(&world, &stranger);
    world.cities.iter_mut().find(|c| c.id == city).unwrap().name = "Ironhold ".into();
    world.cities.iter_mut().find(|c| c.id == theirs).unwrap().name = String::new();
    let ids: Vec<Vec<String>> =
        city_names_well_formed(&world).into_iter().map(|v| v.entity_ids).collect();
    assert_eq!(ids, vec![vec![city], vec![theirs]]);
}
