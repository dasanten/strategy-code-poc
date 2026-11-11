//! `apps/server/src/capture.test.ts`, ported one to one where the conflict phases run it
//! (`test_world::step` for `stepWorld`); refilling and the trading posts step the whole world.

use csp_shared::balance::{MAX_HEALTH, MAX_HUNGER, OCCUPATION_GAME_DAYS};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Carriage, Delivery, DeliveryKind, DriveOrder, Good, Heading, Horse, HorseStats,
    Occupation, Pair, RealmEventWhat, ResidentOrder, Stock, Tile, WalkOrder, WorldState,
};

use super::*;
use crate::caravans::route_end;
use crate::combat::attack_order;
use crate::invariants::check_all;
use crate::queries::city::town_hall_of;
use crate::queries::city_area::{defends_city, occupier_of, OCCUPATION_TICKS};
use crate::test_world::{add_city, building, empty_world, live, live_mut, realm, resident, step};
use crate::tick::Scratch;
use csp_shared::world::{Alliance, AllianceMember};

const SIZE: i32 = 64;

/// A grown resident at (x, y) with every stat 10 and Agility 1, living in `city`.
fn person(
    world: &mut WorldState,
    id: &str,
    owner: Option<&str>,
    x: f64,
    y: f64,
    city: Option<&str>,
) {
    let i = resident(world, id, owner, x, y);
    world.residents[i].stats.agility.base = 1.0;
    world.residents[i].city_id = city.map(str::to_string);
}

fn arm(world: &mut WorldState, id: &str) {
    live_mut(world, id).carried.insert(Good::Sword, 1.0);
}

/// Realm r1 (Player 7, Leader a1, far away), realm r2 (Player 8, Leader b1) and the NPC city npc,
/// its town hall on (20..22, 20..22), where n1 (on the hall, unarmed) and n2 live.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    person(&mut world, "a1", Some("r1"), 50.0, 50.0, None);
    person(&mut world, "b1", Some("r2"), 50.0, 10.0, None);
    add_city(&mut world, "npc", None, 20.0, 20.0, None);
    city_mut(&mut world, "npc").name = "Dunmere".into();
    person(&mut world, "n1", None, 20.0, 20.0, Some("npc"));
    person(&mut world, "n2", None, 30.0, 30.0, Some("npc"));
    world
}

fn city<'w>(world: &'w WorldState, id: &str) -> &'w csp_shared::world::City {
    world.cities.iter().find(|c| c.id == id).unwrap()
}

fn city_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut csp_shared::world::City {
    world.cities.iter_mut().find(|c| c.id == id).unwrap()
}

/// One tick of the occupation step alone, so nobody walks or fights meanwhile.
fn tick(world: &mut WorldState) -> Vec<Capture> {
    world.tick += 1;
    step_captures(world, SIZE, None, &mut crate::defence::NoAlarms)
}

/// `realm_id` has occupied the city's town hall for all but its last tick.
fn held_all_but_one_tick(world: &mut WorldState, city_id: &str, realm_id: &str) {
    let since = world.tick as f64 + 1.0 - OCCUPATION_TICKS;
    city_mut(world, city_id).occupation = Some(Occupation { realm_id: realm_id.into(), since });
}

fn occupation(world: &WorldState, id: &str) -> Option<(String, f64)> {
    city(world, id).occupation.as_ref().map(|o| (o.realm_id.clone(), o.since))
}

fn ally(world: &mut WorldState, a: &str, b: &str) {
    world.alliances.push(Alliance {
        id: "al1".into(),
        name: "North".into(),
        leader_id: a.into(),
        members: [a, b]
            .iter()
            .map(|id| AllianceMember { realm_id: (*id).into(), joined_at: 0.0, leaving: None })
            .collect(),
        invites: vec![],
        army: vec![],
    });
}

fn capture(city: &str, to: &str) -> Capture {
    Capture { city_id: city.into(), from: None, to: to.into() }
}

fn horse(id: &str, realm: Option<&str>, city: Option<&str>, x: f64, y: f64) -> Horse {
    Horse {
        id: id.into(),
        name: "Rowan".into(),
        realm_id: realm.map(str::to_string),
        city_id: city.map(str::to_string),
        x,
        y,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats: HorseStats { speed: 5.0, strength: 5.0, endurance: 5.0 },
        born_at: 0.0,
        down_until: None,
    }
}

fn carriage(id: &str, realm: Option<&str>, city: Option<&str>, x: f64, y: f64) -> Carriage {
    Carriage {
        id: id.into(),
        realm_id: realm.map(str::to_string),
        city_id: city.map(str::to_string),
        x,
        y,
        horse_id: None,
        load: Default::default(),
    }
}

/// Steps the world once and answers the captures: the step's captures are those of
/// `step_captures`, which `test_world::step` runs; here it is run alone after the rest.
fn step_world(world: &mut WorldState) -> Vec<Capture> {
    let before: Vec<Option<String>> = world.cities.iter().map(|c| c.realm_id.clone()).collect();
    step(world, SIZE);
    world
        .cities
        .iter()
        .zip(before)
        .filter(|(c, was)| c.realm_id != *was)
        .map(|(c, was)| Capture {
            city_id: c.id.clone(),
            from: was,
            to: c.realm_id.clone().unwrap_or_default(),
        })
        .collect()
}

#[test]
fn held_the_full_time_captures_an_npc_city_with_its_residents() {
    let mut world = setup();
    live_mut(&mut world, "n1").order = Some(ResidentOrder::WalkTo(csp_shared::world::WalkOrder {
        target: csp_shared::world::Tile { x: 0.0, y: 0.0 },
        path: None,
        progress: 0.0,
        army: None,
    }));
    person(&mut world, "a2", Some("r1"), 21.0, 21.0, None);
    arm(&mut world, "a2");
    assert_eq!(occupier_of(&world, city(&world, "npc"), SIZE).as_deref(), Some("r1"));
    assert!(step_world(&mut world).is_empty());
    assert_eq!(city(&world, "npc").realm_id, None);
    assert_eq!(occupation(&world, "npc"), Some(("r1".into(), world.tick as f64)));
    // The tick before the time is up it is still the NPC city's.
    world.tick = (occupation(&world, "npc").unwrap().1 + OCCUPATION_TICKS - 2.0) as u64;
    assert!(step_world(&mut world).is_empty());
    assert_eq!(city(&world, "npc").realm_id, None);
    assert_eq!(step_world(&mut world), vec![capture("npc", "r1")]);
    assert_eq!(city(&world, "npc").realm_id.as_deref(), Some("r1"));
    assert_eq!(city(&world, "npc").occupation, None);
    // Its residents join wherever they stand, loyal at once, and drop the orders they had.
    assert_eq!(live(&world, "n1").unwrap().owner.as_deref(), Some("r1"));
    assert_eq!(live(&world, "n2").unwrap().owner.as_deref(), Some("r1"));
    assert_eq!(live(&world, "n1").unwrap().order, None);
    assert_eq!(live(&world, "a2").unwrap().owner.as_deref(), Some("r1"));
    let captured: Vec<_> = world
        .events
        .iter()
        .filter(|e| matches!(e.what, RealmEventWhat::CityCaptured { .. }))
        .collect();
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0].user_id, 7);
    assert!(
        matches!(&captured[0].what, RealmEventWhat::CityCaptured { city_id, city, other: None, captor: true, residents }
        if city_id == "npc" && city == "Dunmere" && *residents == 2.0)
    );
}

#[test]
fn needs_the_occupier_armed_and_on_the_town_hall() {
    let mut world = setup();
    person(&mut world, "a2", Some("r1"), 21.0, 21.0, None);
    person(&mut world, "a3", Some("r1"), 25.0, 25.0, None);
    arm(&mut world, "a3");
    tick(&mut world);
    assert_eq!(occupation(&world, "npc"), None);
    arm(&mut world, "a2");
    tick(&mut world);
    assert_eq!(occupation(&world, "npc"), Some(("r1".into(), world.tick as f64)));
}

#[test]
fn a_defender_on_the_town_hall_breaks_it_and_the_next_starts_from_nothing() {
    let mut world = setup();
    live_mut(&mut world, "n1").x = 30.0;
    person(&mut world, "a2", Some("r1"), 21.0, 21.0, None);
    arm(&mut world, "a2");
    tick(&mut world);
    let first = world.tick as f64;
    world.tick += 5 * TICKS_PER_GAME_DAY as u64;
    tick(&mut world);
    assert_eq!(occupation(&world, "npc"), Some(("r1".into(), first)));
    arm(&mut world, "n1");
    let n1 = live_mut(&mut world, "n1");
    n1.x = 20.0;
    n1.y = 22.0;
    assert!(tick(&mut world).is_empty());
    assert_eq!(occupation(&world, "npc"), None);
    live_mut(&mut world, "n1").x = 30.0;
    tick(&mut world);
    assert_eq!(occupation(&world, "npc"), Some(("r1".into(), world.tick as f64)));
}

#[test]
fn defenders_elsewhere_in_the_city_dont_stop_the_clock() {
    let mut world = setup();
    arm(&mut world, "n1");
    let n1 = live_mut(&mut world, "n1");
    n1.x = 25.0;
    n1.y = 20.0;
    assert!(defends_city(&world, city(&world, "npc"), live(&world, "n1").unwrap(), SIZE));
    person(&mut world, "a2", Some("r1"), 21.0, 21.0, None);
    arm(&mut world, "a2");
    held_all_but_one_tick(&mut world, "npc", "r1");
    assert_eq!(tick(&mut world), vec![capture("npc", "r1")]);
    assert_eq!(city(&world, "npc").realm_id.as_deref(), Some("r1"));
}

#[test]
fn nobody_occupies_while_two_realms_armed_residents_are_on_the_hall_allied_or_not() {
    let mut world = setup();
    person(&mut world, "a2", Some("r1"), 21.0, 20.0, None);
    arm(&mut world, "a2");
    person(&mut world, "b2", Some("r2"), 20.0, 21.0, None);
    arm(&mut world, "b2");
    tick(&mut world);
    assert_eq!(occupation(&world, "npc"), None);
    ally(&mut world, "r1", "r2");
    tick(&mut world);
    assert_eq!(occupation(&world, "npc"), None);
    live_mut(&mut world, "b2").x = 30.0;
    tick(&mut world);
    assert_eq!(occupation(&world, "npc").map(|o| o.0).as_deref(), Some("r1"));
}

#[test]
fn a_running_occupation_is_broken_when_another_realm_steps_onto_the_hall() {
    let mut world = setup();
    person(&mut world, "a2", Some("r1"), 21.0, 20.0, None);
    arm(&mut world, "a2");
    held_all_but_one_tick(&mut world, "npc", "r1");
    person(&mut world, "b2", Some("r2"), 20.0, 21.0, None);
    arm(&mut world, "b2");
    assert!(tick(&mut world).is_empty());
    assert_eq!((city(&world, "npc").realm_id.clone(), occupation(&world, "npc")), (None, None));
    live_mut(&mut world, "b2").x = 30.0;
    tick(&mut world);
    assert_eq!(occupation(&world, "npc"), Some(("r1".into(), world.tick as f64)));
}

#[test]
fn an_ally_of_the_city_on_its_hall_defends_it_once_they_leave_another_realm_occupies_it() {
    let mut world = setup();
    add_city(&mut world, "c2", Some("r2"), 40.0, 40.0, None);
    ally(&mut world, "r1", "r2");
    realm(&mut world, "r3", 9, "c1");
    person(&mut world, "c1", Some("r3"), 5.0, 5.0, None);
    person(&mut world, "a2", Some("r1"), 40.0, 41.0, None);
    arm(&mut world, "a2");
    tick(&mut world);
    assert_eq!(occupation(&world, "c2"), None);
    person(&mut world, "c3", Some("r3"), 41.0, 41.0, None);
    arm(&mut world, "c3");
    tick(&mut world);
    assert_eq!(occupation(&world, "c2"), None);
    live_mut(&mut world, "a2").x = 10.0;
    tick(&mut world);
    assert_eq!(occupation(&world, "c2").map(|o| o.0).as_deref(), Some("r3"));
}

#[test]
fn an_npc_citys_residents_who_are_armed_defend_only_their_own_city() {
    let mut world = setup();
    add_city(&mut world, "npc2", None, 30.0, 20.0, None);
    person(&mut world, "m1", None, 20.0, 21.0, Some("npc2"));
    arm(&mut world, "m1");
    person(&mut world, "a2", Some("r1"), 21.0, 20.0, None);
    arm(&mut world, "a2");
    tick(&mut world);
    assert_eq!(occupation(&world, "npc").map(|o| o.0).as_deref(), Some("r1"));
}

#[test]
fn nobody_occupies_a_city_whose_town_hall_is_gone() {
    let mut world = setup();
    person(&mut world, "a2", Some("r1"), 21.0, 20.0, None);
    arm(&mut world, "a2");
    let hall = city(&world, "npc").town_hall_id.clone();
    world.buildings.retain(|b| b.id != hall);
    assert_eq!(occupier_of(&world, city(&world, "npc"), SIZE), None);
}

/// The occupation events in the world's logs, as (Player, kind, other, occupier).
fn logged(world: &WorldState) -> Vec<(u64, &'static str, Option<String>, bool)> {
    world
        .events
        .iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::HallOccupied { other, occupier, .. } => {
                Some((e.user_id, "hallOccupied", other.clone(), *occupier))
            }
            RealmEventWhat::OccupationBroken { other, occupier, .. } => {
                Some((e.user_id, "occupationBroken", other.clone(), *occupier))
            }
            _ => None,
        })
        .collect()
}

#[test]
fn an_npc_city_has_no_log_only_the_occupier_hears_it_is_occupied_and_broken() {
    let mut world = setup();
    live_mut(&mut world, "n1").x = 30.0;
    person(&mut world, "a2", Some("r1"), 21.0, 21.0, None);
    arm(&mut world, "a2");
    tick(&mut world);
    let occupied = world
        .events
        .iter()
        .find(|e| matches!(e.what, RealmEventWhat::HallOccupied { .. }))
        .unwrap();
    assert_eq!((occupied.user_id, occupied.tick), (7, world.tick));
    assert!(
        matches!(&occupied.what, RealmEventWhat::HallOccupied { city_id, city, other: None, occupier: true, days, x, y }
        if city_id == "npc" && city == "Dunmere" && *days == OCCUPATION_GAME_DAYS && *x == 20.0 && *y == 20.0)
    );
    tick(&mut world);
    assert_eq!(logged(&world), vec![(7, "hallOccupied", None, true)]);
    arm(&mut world, "n1");
    let n1 = live_mut(&mut world, "n1");
    n1.x = 20.0;
    n1.y = 22.0;
    tick(&mut world);
    let last = world.events.last().unwrap();
    assert_eq!(last.user_id, 7);
    assert!(
        matches!(&last.what, RealmEventWhat::OccupationBroken { city_id, x: Some(x), y: Some(y), .. }
        if city_id == "npc" && *x == 20.0 && *y == 20.0)
    );
    assert_eq!(
        logged(&world),
        vec![(7, "hallOccupied", None, true), (7, "occupationBroken", None, true)]
    );
}

#[test]
fn a_players_city_both_realms_hear_it_by_each_others_name_and_a_new_occupier_is_both() {
    let mut world = setup();
    realm(&mut world, "r3", 9, "c1");
    world.realms[2].name = Some("Northmarch".into());
    person(&mut world, "c1", Some("r3"), 5.0, 5.0, None);
    add_city(&mut world, "c2", Some("r2"), 40.0, 40.0, None);
    person(&mut world, "a2", Some("r1"), 40.0, 41.0, None);
    arm(&mut world, "a2");
    tick(&mut world);
    let r1 = Some(realm_name(&world, "r1"));
    let r2 = Some(realm_name(&world, "r2"));
    assert_eq!(
        logged(&world),
        vec![(7, "hallOccupied", r2.clone(), true), (8, "hallOccupied", r1.clone(), false)]
    );
    // r1 leaves the hall the tick r3 steps onto it: one occupation broken, the next started.
    world.events.clear();
    live_mut(&mut world, "a2").x = 10.0;
    person(&mut world, "c3", Some("r3"), 41.0, 41.0, None);
    arm(&mut world, "c3");
    tick(&mut world);
    assert_eq!(
        logged(&world),
        vec![
            (7, "occupationBroken", r2.clone(), true),
            (8, "occupationBroken", r1, false),
            (9, "hallOccupied", r2, true),
            (8, "hallOccupied", Some("Northmarch".into()), false),
        ]
    );
}

#[test]
fn a_capture_ends_the_occupation_without_a_break_in_the_logs() {
    let mut world = setup();
    person(&mut world, "a2", Some("r1"), 21.0, 20.0, None);
    arm(&mut world, "a2");
    held_all_but_one_tick(&mut world, "npc", "r1");
    tick(&mut world);
    assert_eq!(city(&world, "npc").realm_id.as_deref(), Some("r1"));
    tick(&mut world);
    let kinds: Vec<bool> = world
        .events
        .iter()
        .map(|e| matches!(e.what, RealmEventWhat::CityCaptured { .. }))
        .collect();
    assert_eq!(kinds, vec![true]);
}

#[test]
fn its_occupiers_at_home_there_now_refill_from_its_storage_the_tick_it_is_captured() {
    let mut world = setup();
    let land = crate::test_support::plains(SIZE);
    building(&mut world, "s1", BuildingKind::Storage, Some("npc"), 24.0, 20.0);
    world.buildings.last_mut().unwrap().stock = Some(Stock::from([(Good::Food, 50.0)]));
    person(&mut world, "a2", Some("r1"), 21.0, 20.0, None);
    live_mut(&mut world, "a2").carried = Stock::from([(Good::Sword, 1.0)]);
    held_all_but_one_tick(&mut world, "npc", "r1");
    crate::world::step_world(&mut world, &land, &mut Scratch::default(), None, None);
    assert_eq!(city(&world, "npc").realm_id.as_deref(), Some("r1"));
    assert!(live(&world, "a2").unwrap().carried.get(&Good::Food).copied().unwrap_or(0.0) > 0.0);
    assert_eq!(check_all(&world, &land), vec![]);
}

#[test]
fn takes_an_npc_city_with_its_own_horses_and_carriages_not_those_of_another_npc_city() {
    let mut world = setup();
    add_city(&mut world, "npc2", None, 60.0, 60.0, None);
    world.horses.push(horse("hN", None, Some("npc"), 21.0, 21.0));
    world.horses.push(horse("hO", None, Some("npc2"), 21.0, 21.0));
    world.carriages.push(carriage("kN", None, Some("npc"), 21.0, 21.0));
    person(&mut world, "a2", Some("r1"), 21.0, 20.0, None);
    arm(&mut world, "a2");
    held_all_but_one_tick(&mut world, "npc", "r1");
    step_world(&mut world);
    assert_eq!(city(&world, "npc").realm_id.as_deref(), Some("r1"));
    let horses: Vec<_> =
        world.horses.iter().map(|h| (h.realm_id.clone(), h.city_id.clone())).collect();
    assert_eq!(horses, vec![(Some("r1".into()), None), (None, Some("npc2".into()))]);
    assert_eq!(
        (world.carriages[0].realm_id.as_deref(), world.carriages[0].city_id.as_deref()),
        (Some("r1"), None)
    );
}

#[test]
fn takes_a_players_city_with_its_horses_and_carriages_and_both_realm_logs_show_it() {
    let mut world = setup();
    add_city(&mut world, "c2", Some("r2"), 40.0, 40.0, None);
    city_mut(&mut world, "c2").name = "Hartwell".into();
    building(&mut world, "h2", BuildingKind::House, Some("c2"), 43.0, 40.0);
    let leader = live_mut(&mut world, "b1");
    leader.x = 40.0;
    leader.y = 41.0;
    leader.city_id = Some("c2".into());
    person(&mut world, "b2", Some("r2"), 41.0, 41.0, Some("c2"));
    person(&mut world, "b3", Some("r2"), 41.0, 40.0, Some("c2"));
    live_mut(&mut world, "b2").pair = Some(Pair { partner_id: "b3".into(), since: 0.0 });
    live_mut(&mut world, "b3").pair = Some(Pair { partner_id: "b2".into(), since: 0.0 });
    person(&mut world, "b4", Some("r2"), 41.0, 39.0, None);
    world.horses.push(horse("hA", Some("r2"), None, 43.0, 40.0));
    world.horses.push(horse("hB", Some("r2"), None, 50.0, 40.0));
    world.carriages.push(carriage("kA", Some("r2"), None, 43.0, 41.0));
    world.carriages.push(carriage("kB", Some("r2"), None, 10.0, 40.0));
    person(&mut world, "a2", Some("r1"), 42.0, 42.0, None);
    arm(&mut world, "a2");
    live_mut(&mut world, "a2").order =
        Some(ResidentOrder::Attack(attack_order("b2", false, false)));
    held_all_but_one_tick(&mut world, "c2", "r1");
    // The capture alone, after the tick turns: in `stepRest` the strike before it can't reach b2
    // without walking, and is beside the point here.
    tick(&mut world);
    assert_eq!(city(&world, "c2").realm_id.as_deref(), Some("r1"));
    assert_eq!(live(&world, "b2").unwrap().owner.as_deref(), Some("r1"));
    assert_eq!(live(&world, "b3").unwrap().owner.as_deref(), Some("r1"));
    // A pair who both join holds together; nobody keeps attacking their own realm.
    assert_eq!(
        live(&world, "b2").unwrap().pair.as_ref().map(|p| p.partner_id.as_str()),
        Some("b3")
    );
    assert_eq!(live(&world, "a2").unwrap().order, None);
    // The Leader is never captured: they stay in their realm, homeless.
    let leader = live(&world, "b1").unwrap();
    assert_eq!((leader.owner.as_deref(), leader.city_id.as_deref()), (Some("r2"), None));
    // A resident of the realm living elsewhere stays, even standing in the city.
    assert_eq!(live(&world, "b4").unwrap().owner.as_deref(), Some("r2"));
    assert_eq!(
        world.horses.iter().map(|h| h.realm_id.as_deref()).collect::<Vec<_>>(),
        vec![Some("r1"), Some("r2")]
    );
    assert_eq!(
        world.carriages.iter().map(|k| k.realm_id.as_deref()).collect::<Vec<_>>(),
        vec![Some("r1"), Some("r2")]
    );
    let logs: Vec<_> = world
        .events
        .iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::CityCaptured { other, captor, residents, .. } => {
                Some((e.user_id, other.clone(), *captor, *residents))
            }
            _ => None,
        })
        .collect();
    assert_eq!(logs, vec![(7, Some("b1".into()), true, 2.0), (8, Some("a1".into()), false, 2.0)]);
}

#[test]
fn a_pair_with_the_leader_ends_when_the_city_is_captured() {
    let mut world = setup();
    add_city(&mut world, "c2", Some("r2"), 40.0, 40.0, None);
    live_mut(&mut world, "b1").city_id = Some("c2".into());
    person(&mut world, "b2", Some("r2"), 41.0, 41.0, Some("c2"));
    live_mut(&mut world, "b1").pair = Some(Pair { partner_id: "b2".into(), since: 0.0 });
    live_mut(&mut world, "b2").pair = Some(Pair { partner_id: "b1".into(), since: 0.0 });
    person(&mut world, "a2", Some("r1"), 40.0, 40.0, None);
    arm(&mut world, "a2");
    held_all_but_one_tick(&mut world, "c2", "r1");
    step_world(&mut world);
    assert_eq!(city(&world, "c2").realm_id.as_deref(), Some("r1"));
    assert_eq!(
        (live(&world, "b1").unwrap().pair.clone(), live(&world, "b2").unwrap().pair.clone()),
        (None, None)
    );
}

/// `worldWithPost()` and its first trading post.
fn world_with_post() -> (WorldState, TerrainMap, String) {
    let (world, land) = crate::test_support::world_with_post();
    let post = crate::trading_posts::trading_posts(&world)[0].id.clone();
    (world, land, post)
}

/// capture.test.ts: takes it out of the Trade Organization: its warehouse a storage, its orders
/// to the HQ.
#[test]
fn capturing_a_trading_post_takes_it_out_of_the_trade_organization() {
    let (mut world, land, post) = world_with_post();
    let realm = world.realms[0].id.clone();
    let home = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(&realm)).unwrap();
    let home = home.id.clone();
    let warehouse = world
        .buildings
        .iter()
        .find(|b| b.city_id.as_deref() == Some(&post) && b.kind == BuildingKind::Warehouse)
        .unwrap()
        .id
        .clone();
    assert!(world.caravans.iter().any(|c| c.post_id == post));
    let goods = route_end(&world, &post, Heading::Hq).warehouse.unwrap();
    let goods = world.buildings[goods].id.clone();
    let delivery = Delivery {
        id: "delivery1".into(),
        kind: DeliveryKind::Delivery,
        realm_id: realm.clone(),
        warehouse_id: warehouse.clone(),
        city_id: home,
        good: Good::Wood,
        units: 5.0,
        fee: 10.0,
        caravan_id: None,
    };
    world.deliveries.push(delivery.clone());
    let people: Vec<String> = world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(&post))
        .map(|r| r.id.clone())
        .collect();
    assert!(!people.is_empty());
    capture_city(&mut world, &post, &realm, land.size);
    assert_eq!(city(&world, &post).realm_id.as_deref(), Some(realm.as_str()));
    assert_eq!(city(&world, &post).trade_org, None);
    for id in &people {
        assert_eq!(live(&world, id).unwrap().owner.as_deref(), Some(realm.as_str()), "{id}");
    }
    let wi = world.buildings.iter().position(|b| b.id == warehouse).unwrap();
    assert_eq!(world.buildings[wi].kind, BuildingKind::Storage);
    assert!(!world.caravans.iter().any(|c| c.post_id == post));
    assert_eq!(world.deliveries, vec![Delivery { warehouse_id: goods, ..delivery }]);
    // No stock floor any more: what it holds runs out like any storage's.
    world.buildings[wi].stock = Some(Stock::default());
    world.tick = TICKS_PER_GAME_DAY as u64 - 1;
    crate::stock_floor::step_stock_floor(&mut world, &mut Default::default());
    assert_eq!(world.buildings[wi].stock, Some(Stock::default()));
    assert_eq!(check_all(&world, &land), vec![]);
}

#[test]
fn occupying_a_posts_town_hall_the_full_time_captures_it_and_it_leaves_the_trade_organization() {
    let (mut world, land, post) = world_with_post();
    let realm = world.realms[0].id.clone();
    let hall = town_hall_of(&world, city(&world, &post)).unwrap();
    let (hx, hy) = (hall.x, hall.y);
    // Its own residents stand clear of the hall.
    for r in &mut world.residents {
        if r.city_id.as_deref() == Some(&post) {
            r.x = hx - 3.0;
        }
    }
    let r = world.residents.iter_mut().find(|x| x.owner.as_deref() == Some(&realm)).unwrap();
    r.x = hx + 1.0;
    r.y = hy + 1.0;
    r.carried.insert(Good::Sword, 1.0);
    assert_eq!(occupier_of(&world, city(&world, &post), land.size), Some(realm.clone()));
    held_all_but_one_tick(&mut world, &post, &realm);
    world.tick += 1;
    let captures = step_captures(&mut world, land.size, None, &mut crate::defence::NoAlarms);
    assert_eq!(captures, vec![capture(&post, &realm)]);
    assert_eq!(city(&world, &post).realm_id.as_deref(), Some(realm.as_str()));
    assert_eq!(occupation(&world, &post), None);
    assert_eq!(city(&world, &post).trade_org, None);
    assert!(!world.caravans.iter().any(|c| c.post_id == post));
}

/// capture.test.ts: ends its caravan’s errands: the crew stop what the caravan had them doing.
#[test]
fn capturing_a_post_ends_its_caravans_errands() {
    let (mut world, land, post) = world_with_post();
    let route = world.caravans.iter().find(|c| c.post_id == post).unwrap().clone();
    let k = world.carriages.iter().find(|k| k.id == route.carriage_id).unwrap();
    let (x, y) = (k.x, k.y);
    let driver = route.driver_id.clone().unwrap();
    let (walker, chaser) = (route.escort_ids[0].clone(), route.escort_ids[1].clone());
    let realm = world.realms[0].id.clone();
    let thief = world.residents.iter().find(|r| r.owner.as_deref() == Some(&realm)).unwrap();
    let thief = thief.id.clone();
    let target = Tile { x: x + 5.0, y };
    live_mut(&mut world, &driver).order = Some(ResidentOrder::Drive(DriveOrder {
        carriage_id: route.carriage_id.clone(),
        target,
        path: None,
        progress: 0.0,
        army: None,
        near: None,
    }));
    live_mut(&mut world, &walker).order =
        Some(ResidentOrder::WalkTo(WalkOrder { target, path: None, progress: 0.0, army: None }));
    live_mut(&mut world, &chaser).order =
        Some(ResidentOrder::Attack(attack_order(&thief, false, true)));

    capture_city(&mut world, &post, &realm, land.size);

    for id in [&driver, &walker, &chaser] {
        assert_eq!(live(&world, id).unwrap().order, None, "{id}");
    }
    // Still the HQ's, which runs them from here, and the carriage stands where it stood.
    let hq = crate::queries::trade_org::trade_org_hq(&world).unwrap().id.clone();
    let d = live(&world, &driver).unwrap();
    assert_eq!((d.owner.as_deref(), d.city_id.as_deref()), (None, Some(hq.as_str())));
    let k = world.carriages.iter().find(|k| k.id == route.carriage_id).unwrap();
    assert_eq!((k.x, k.y), (x, y));
    assert_eq!(check_all(&world, &land), vec![]);
    crate::world::step_world(&mut world, &land, &mut Scratch::default(), None, None);
    assert_eq!(check_all(&world, &land), vec![]);
}
