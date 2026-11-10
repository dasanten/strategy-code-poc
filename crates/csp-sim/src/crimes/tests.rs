//! `apps/server/src/crimes.test.ts`, ported one to one where the conflict phases run it
//! (`test_world::step` in place of `stepWorld`).

use csp_shared::balance::{CRIME_MEMORY_DAYS, CRIME_STANDING_LOSS, SIGHT_RANGE};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, CrimeKind, Good, GoodsSpot, Pile, RealmEvent, RealmEventWhat, ResidentOrder,
    Stock, TearDownOrder, Tile, WorldState,
};

use super::*;
use crate::carrying::{resolve_carrying, CarryAction, CarryKind};
use crate::combat::{apply_attack, attack_order, resolve_strikes, AttackRequest, StrikeAction};
use crate::defence::NoAlarms;
use crate::queries::standing::standing_of;
use crate::teardown::{resolve_tearing_down, TearDownAction};
use crate::test_world::{add_city, building, empty_world, live, live_mut, realm, resident, run};
use crate::tick::Scratch;

const SIZE: i32 = 256;

/// Realm r1 (Player 7, Leader a1, city c1 at (5, 5)) and realm r2 (Player 8, Leader b1, city c2 at
/// (40, 40)). Both Leaders stand far from home.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    add_city(&mut world, "c1", Some("r1"), 5.0, 5.0, None);
    add_city(&mut world, "c2", Some("r2"), 40.0, 40.0, None);
    world.cities[1].name = "Brook".into();
    citizen(&mut world, "a1", Some("r1"), Some("c1"), 20.0, 20.0);
    citizen(&mut world, "b1", Some("r2"), Some("c2"), 21.0, 20.0);
    world
}

fn citizen(
    world: &mut WorldState,
    id: &str,
    owner: Option<&str>,
    city: Option<&str>,
    x: f64,
    y: f64,
) {
    let i = resident(world, id, owner, x, y);
    world.residents[i].city_id = city.map(str::to_string);
}

fn crime_log(world: &WorldState, user_id: u64) -> Vec<&RealmEvent> {
    world
        .events
        .iter()
        .filter(|e| e.user_id == user_id && matches!(e.what, RealmEventWhat::CrimeKnown { .. }))
        .collect()
}

fn strike(world: &mut WorldState, a: &str, t: &str) {
    let strike = [StrikeAction { attacker_id: a.into(), target_id: t.into() }];
    resolve_strikes(world, &strike, SIZE, &mut NoAlarms, &mut Default::default());
}

fn against(victim_org: &str, victim: &str) -> CrimeAgainst {
    CrimeAgainst {
        victim_org: Some(victim_org.into()),
        victim: Some(victim.into()),
        ..CrimeAgainst::default()
    }
}

#[test]
fn an_attack_with_no_witness_getting_home_has_no_consequence() {
    let mut world = setup();
    let mut o = attack_order("b1", false, false);
    o.strike = 0.99;
    live_mut(&mut world, "a1").order = Some(ResidentOrder::Attack(o));
    strike(&mut world, "a1", "b1");
    assert_eq!(world.crimes.len(), 1);
    let c = &world.crimes[0];
    assert_eq!(c.kind, CrimeKind::Attack);
    assert_eq!(c.victim_org, "r2");
    assert_eq!(
        (c.culprit.resident_id.as_str(), c.culprit.org.as_str(), c.culprit.name.as_str()),
        ("a1", "r1", "a1")
    );
    assert_eq!(c.witnesses, vec!["b1".to_string()]);
    // The victim dies before getting home: the news dies with them.
    world.residents.retain(|r| r.id != "b1");
    live_mut(&mut world, "a1").order = None;
    run(&mut world, SIZE, 1);
    assert!(world.crimes.is_empty());
    assert!(crime_log(&world, 8).is_empty());
}

#[test]
fn a_surviving_victim_who_gets_home_makes_the_attack_known_logged_with_who_did_it() {
    let mut world = setup();
    live_mut(&mut world, "a1").order =
        Some(ResidentOrder::Attack(attack_order("b1", false, false)));
    strike(&mut world, "a1", "b1");
    live_mut(&mut world, "a1").order = None;
    live_mut(&mut world, "b1").order = None;
    run(&mut world, SIZE, 1);
    assert!(world.crimes[0].known_by.is_empty());
    assert!(crime_log(&world, 8).is_empty());
    // Home, in their city's area.
    let b = live_mut(&mut world, "b1");
    b.x = 40.0;
    b.y = 41.0;
    run(&mut world, SIZE, 1);
    assert_eq!(world.crimes[0].known_by, vec!["r2".to_string()]);
    assert!(world.crimes[0].witnesses.is_empty());
    let log = crime_log(&world, 8);
    assert_eq!(log.len(), 1);
    match &log[0].what {
        RealmEventWhat::CrimeKnown { crime, culprit_id, culprit, culprit_org, victim, .. } => {
            assert_eq!(*crime, CrimeKind::Attack);
            assert_eq!(
                (culprit_id.as_str(), culprit.as_str(), culprit_org.as_str()),
                ("a1", "a1", "the realm of a1")
            );
            assert_eq!(victim.as_deref(), Some("b1"));
        }
        _ => unreachable!(),
    }
    // The culprit's Player hears nothing of it.
    assert!(crime_log(&world, 7).is_empty());
    // The victim's realm now regards the culprit's worse; not the other way round.
    assert!((standing_of(&world, "r2", "r1") + CRIME_STANDING_LOSS.attack).abs() < 0.01);
    assert_eq!(standing_of(&world, "r1", "r2"), 0.0);
    // Known once: staying home logs nothing more, and costs no more standing.
    run(&mut world, SIZE, 3);
    assert_eq!(crime_log(&world, 8).len(), 1);
    assert!((standing_of(&world, "r2", "r1") + CRIME_STANDING_LOSS.attack).abs() < 0.01);
}

#[test]
fn a_known_crime_is_forgotten_after_the_crime_memory_runs_out() {
    let mut world = setup();
    commit_crime(&mut world, SIZE, CrimeKind::Attack, "a1", against("r2", "b1"));
    let b = live_mut(&mut world, "b1");
    b.x = 40.0;
    b.y = 40.0;
    run(&mut world, SIZE, 1);
    assert_eq!(world.crimes.len(), 1);
    world.tick = (CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY) as u64 + 1;
    run(&mut world, SIZE, 1);
    assert!(world.crimes.is_empty());
}

#[test]
fn a_bystander_of_a_third_organization_makes_it_known_to_their_own() {
    let mut world = setup();
    realm(&mut world, "r3", 9, "c");
    add_city(&mut world, "c3", Some("r3"), 30.0, 5.0, None);
    citizen(&mut world, "v", Some("r2"), Some("c2"), 21.0, 20.0);
    citizen(&mut world, "w", Some("r3"), Some("c3"), 20.0 + SIGHT_RANGE, 20.0);
    citizen(&mut world, "far", Some("r2"), Some("c2"), 21.0 + SIGHT_RANGE, 20.0);
    commit_crime(&mut world, SIZE, CrimeKind::Killing, "a1", against("r2", "v"));
    let witnesses = &world.crimes.last().unwrap().witnesses;
    for id in ["b1", "v", "w"] {
        assert!(witnesses.iter().any(|w| w == id), "{id} witnessed");
    }
    assert!(!witnesses.iter().any(|w| w == "far"));
    let w = live_mut(&mut world, "w");
    w.x = 30.0;
    w.y = 6.0;
    run(&mut world, SIZE, 1);
    assert_eq!(world.crimes.last().unwrap().known_by, vec!["r3".to_string()]);
    // Only the victim's realm logs it, and it does not know yet.
    assert!(crime_log(&world, 8).is_empty());
    assert!(crime_log(&world, 9).is_empty());
    // Standing is the victim's affair.
    assert!(world.standings.is_empty());
}

#[test]
fn fighting_back_is_no_crime() {
    let mut world = setup();
    live_mut(&mut world, "b1").carried.insert(Good::Spear, 1.0);
    live_mut(&mut world, "a1").order =
        Some(ResidentOrder::Attack(attack_order("b1", false, false)));
    strike(&mut world, "a1", "b1");
    // Their defence script, Defend, goes after who struck them.
    assert_eq!(
        live(&world, "b1").unwrap().script.as_ref().and_then(|s| s.task),
        Some(csp_shared::world::Task::Defend)
    );
    apply_attack(
        &mut world,
        &AttackRequest { resident_id: Some("b1".into()), target_id: Some("a1".into()) },
        Some(SIZE),
    );
    assert!(matches!(&live(&world, "b1").unwrap().order,
        Some(ResidentOrder::Attack(o)) if o.target_id == "a1" && o.defending == Some(true)));
    strike(&mut world, "b1", "a1");
    assert_eq!(
        world.crimes.iter().map(|c| c.culprit.resident_id.as_str()).collect::<Vec<_>>(),
        vec!["a1"]
    );
}

#[test]
fn a_killing_is_a_crime_the_dead_victim_no_witness() {
    let mut world = setup();
    live_mut(&mut world, "b1").health = 1.0;
    live_mut(&mut world, "a1").order =
        Some(ResidentOrder::Attack(attack_order("b1", false, false)));
    strike(&mut world, "a1", "b1");
    assert_eq!(
        world.crimes.iter().map(|c| c.kind).collect::<Vec<_>>(),
        vec![CrimeKind::Attack, CrimeKind::Killing]
    );
    assert!(world.crimes[1].witnesses.is_empty());
    run(&mut world, SIZE, 1);
    // Nobody saw it and lived: it is gone without consequence.
    assert!(world.crimes.is_empty());
}

/// Steps the conflict phases `ticks` times and checks the crime invariant each tick (`run`).
fn run_checked(world: &mut WorldState, ticks: usize) {
    let terrain = crate::test_support::plains(SIZE);
    for _ in 0..ticks {
        run(world, SIZE, 1);
        assert_eq!(crate::invariants::checks::crimes_sound(world, &terrain), vec![]);
    }
}

/// A storage `id` of `city` on (20, 20) holding 9 Food.
fn storage(world: &mut WorldState, city: &str) {
    building(world, "s", BuildingKind::Storage, Some(city), 20.0, 20.0);
    world.buildings.last_mut().unwrap().stock = Some(Stock::from([(Good::Food, 9.0)]));
}

fn take(spot: GoodsSpot, goods: Stock) -> CarryAction {
    CarryAction { kind: CarryKind::Take, resident_id: "a1".into(), spot, goods }
}

fn from_storage() -> GoodsSpot {
    GoodsSpot::Storage { storage_id: "s".into() }
}

#[test]
fn taking_from_another_organizations_storage_is_theft_thefts_add_up_until_known() {
    let mut world = setup();
    storage(&mut world, "c2");
    resolve_carrying(&mut world, &[take(from_storage(), Stock::from([(Good::Food, 2.0)]))], SIZE);
    resolve_carrying(&mut world, &[take(from_storage(), Stock::from([(Good::Food, 3.0)]))], SIZE);
    assert_eq!(world.crimes.len(), 1);
    let c = &world.crimes[0];
    assert_eq!(c.kind, CrimeKind::Theft);
    assert_eq!(c.goods, Some(Stock::from([(Good::Food, 5.0)])));
    assert_eq!(c.witnesses, vec!["b1".to_string()]);
    let b = live_mut(&mut world, "b1");
    (b.x, b.y) = (40.0, 40.0);
    run_checked(&mut world, 1);
    assert!(matches!(&crime_log(&world, 8)[0].what,
        RealmEventWhat::CrimeKnown { crime: CrimeKind::Theft, goods: Some(g), .. }
            if *g == Stock::from([(Good::Food, 5.0)])));
}

#[test]
fn taking_from_a_pile_or_ones_own_storage_is_no_crime() {
    let mut world = setup();
    storage(&mut world, "c1");
    world.piles.push(Pile {
        id: "p".into(),
        x: 20.0,
        y: 20.0,
        goods: Stock::from([(Good::Wood, 2.0)]),
    });
    let actions = [
        take(from_storage(), Stock::from([(Good::Food, 1.0)])),
        take(GoodsSpot::Ground, Stock::from([(Good::Wood, 1.0)])),
    ];
    resolve_carrying(&mut world, &actions, SIZE);
    assert_eq!(world.crimes, vec![]);
}

#[test]
fn tearing_down_another_organizations_building_is_a_crime() {
    let mut world = setup();
    building(&mut world, "h", BuildingKind::House, Some("c2"), 20.0, 20.0);
    world.buildings.last_mut().unwrap().teardown = Some(1e9);
    live_mut(&mut world, "a1").order = Some(ResidentOrder::TearDown(TearDownOrder {
        building_id: "h".into(),
        at: Tile { x: 20.0, y: 20.0 },
    }));
    let terrain = crate::test_support::plains(SIZE);
    let action = [TearDownAction { resident_id: "a1".into() }];
    resolve_tearing_down(&mut world, &action, Some(&terrain), &mut Scratch::default());
    let c = &world.crimes[0];
    assert_eq!(
        (c.kind, c.building, c.victim_org.as_str()),
        (CrimeKind::TearDown, Some(BuildingKind::House), "r2")
    );
    let b = live_mut(&mut world, "b1");
    (b.x, b.y) = (40.0, 40.0);
    run_checked(&mut world, 1);
    assert!(matches!(
        &crime_log(&world, 8)[0].what,
        RealmEventWhat::CrimeKnown {
            crime: CrimeKind::TearDown,
            building: Some(BuildingKind::House),
            ..
        }
    ));
}

/// Thefts add up while not yet known, the part of the theft test `commit_crime` itself does.
#[test]
fn thefts_by_one_resident_on_one_tile_add_up_into_one_crime() {
    let mut world = setup();
    let theft = |food: f64| CrimeAgainst {
        victim_org: Some("r2".into()),
        goods: Some([(Good::Food, food)].into_iter().collect()),
        ..CrimeAgainst::default()
    };
    commit_crime(&mut world, SIZE, CrimeKind::Theft, "a1", theft(2.0));
    commit_crime(&mut world, SIZE, CrimeKind::Theft, "a1", theft(3.0));
    assert_eq!(world.crimes.len(), 1);
    assert_eq!(world.crimes[0].goods.as_ref().unwrap()[&Good::Food], 5.0);
    assert_eq!(world.crimes[0].witnesses, vec!["b1".to_string()]);
    let b = live_mut(&mut world, "b1");
    b.x = 40.0;
    b.y = 40.0;
    run(&mut world, SIZE, 1);
    assert!(matches!(&crime_log(&world, 8)[0].what,
        RealmEventWhat::CrimeKnown { crime: CrimeKind::Theft, goods: Some(g), .. } if g[&Good::Food] == 5.0));
}

#[test]
fn npc_city_residents_witness_for_their_city() {
    let mut world = setup();
    add_city(&mut world, "n", None, 50.0, 10.0, None);
    citizen(&mut world, "n1", None, Some("n"), 22.0, 20.0);
    commit_crime(&mut world, SIZE, CrimeKind::Attack, "a1", against("n", "n1"));
    assert_eq!(world.crimes[0].victim_org, "n");
    let npc = live_mut(&mut world, "n1");
    npc.x = 50.0;
    npc.y = 11.0;
    run(&mut world, SIZE, 1);
    assert!(world.crimes[0].known_by.iter().any(|k| k == "n"));
}

// `crimes-sound invariant` is `invariants.ts`'s: T86.13.
