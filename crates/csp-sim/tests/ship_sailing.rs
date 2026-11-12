//! Sailing (`CONTEXT.md`: Sailing, Crew, Seafaring, Fighting at a vessel, T91.3): one of a ship's
//! crew, its captain, sails it with at least the minimum crew aboard to a Sea tile or a haven,
//! docking there, a Step at a time over Sea only; the crew's Seafaring sets the pace and sailing
//! teaches it to all of them. Sailing off another realm's ship with a crew of one's own steals it.

mod build_common;

use build_common::{
    add_city, assert_sound, building, new_resident, order, player, realm, run_walking, Orders,
};
use csp_shared::balance::{OWN_FOOD, SHIP_MIN_CREW};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{Good, ResidentOrder, SkillName, Stock, Vessel, VesselKind, WorldState};
use csp_sim::queries::pace::sail_speed;
use csp_sim::queries::vessels::{docked_at, sail_target};
use serde_json::{json, Value};

const SIZE: i32 = 48;

/// Plains, with the Sea in columns 20 to 29 and a Lake in columns 20 to 29 from row 30 to 34, cut
/// off from the Sea by a land strip on row 29.
fn terrain() -> TerrainMap {
    let mut tiles = vec![Terrain::Plains as u8; (SIZE * SIZE) as usize];
    for y in 0..SIZE {
        for x in 20..=29 {
            let t = match y {
                29 => Terrain::Plains,
                30..=34 => Terrain::Lake,
                _ => Terrain::Sea,
            };
            tiles[tile_index(SIZE, x, y)] = t as u8;
        }
    }
    TerrainMap { size: SIZE, tiles }
}

/// Realms r1 (Player 7, city c1) and r2 (Player 8); haven h1 on the west shore covering
/// (17, 5)–(19, 7) and haven h2 on the east shore covering (30, 12)–(32, 14), both of c1. Ship s1
/// of r1 docked at h1 on (20, 7), with w1–w4 of r1 aboard as its crew and p1 as a passenger;
/// b1–b4 of r2 stand on h1.
fn setup() -> WorldState {
    let mut world = build_common::empty_world(&terrain());
    world.realms.push(realm("r1", 7, "w1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 2.0, 2.0);
    for (id, x, y) in [("h1", 17.0, 5.0), ("h2", 30.0, 12.0)] {
        let mut haven = building(id, BuildingKind::Haven, x, y);
        haven.city_id = Some("c1".into());
        haven.stock = Some(Stock::new());
        world.buildings.push(haven);
    }
    world.vessels.push(Vessel {
        id: "s1".into(),
        kind: VesselKind::Ship,
        realm_id: Some("r1".into()),
        x: 20.0,
        y: 7.0,
        load: Stock::new(),
        rower_id: None,
        crew_ids: ["w1", "w2", "w3", "w4"].map(String::from).to_vec(),
    });
    for id in ["w1", "w2", "w3", "w4", "p1"] {
        let mut r = new_resident(id, Some("r1"), 20.0, 7.0);
        r.city_id = Some("c1".into());
        r.aboard = Some("s1".into());
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        world.residents.push(r);
    }
    for id in ["b1", "b2", "b3", "b4"] {
        let mut r = new_resident(id, Some("r2"), 17.0, 6.0);
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        world.residents.push(r);
    }
    world
}

use csp_shared::world::BuildingKind;

fn give(world: &mut WorldState, user: u64, o: Value) -> Result<(), String> {
    let mut orders = Orders::default();
    order(world, &mut orders, &player(user), o, &terrain())
}

fn sail(world: &mut WorldState, who: &str, x: i32, y: i32) -> Result<(), String> {
    give(world, 7, json!({ "kind": "sail", "residentId": who, "vesselId": "s1", "x": x, "y": y }))
}

fn s1(world: &WorldState) -> &Vessel {
    &world.vessels[0]
}

fn sailing(world: &WorldState) -> bool {
    world.residents.iter().any(|r| matches!(r.order, Some(ResidentOrder::Sail(_))))
}

#[test]
fn sails_to_a_haven_across_the_sea_and_docks_there_with_everyone_aboard() {
    let t = terrain();
    let mut world = setup();
    assert_eq!(sail(&mut world, "w1", 31, 13), Ok(()));
    run_walking(&mut world, &t, 3000, |w| !sailing(w));
    let v = s1(&world);
    assert_eq!(docked_at(&world, v).map(|h| h.id.as_str()), Some("h2"));
    // The nearest free Sea tile beside h2 from where it set out.
    assert_eq!((v.x, v.y), (29.0, 11.0));
    for id in ["w1", "w2", "w3", "w4", "p1"] {
        let r = world.residents.iter().find(|r| r.id == id).unwrap();
        assert_eq!((r.x, r.y, r.aboard.as_deref()), (29.0, 11.0, Some("s1")), "{id}");
    }
    // Every one of the crew learned Seafaring; the passenger did not.
    for id in ["w1", "w2", "w3", "w4"] {
        let r = world.residents.iter().find(|r| r.id == id).unwrap();
        assert!(r.skills.get(&SkillName::Seafaring).copied().unwrap_or(0.0) > 0.0, "{id}");
    }
    let p1 = world.residents.iter().find(|r| r.id == "p1").unwrap();
    assert!(p1.skills.get(&SkillName::Seafaring).is_none());
    // Docked there, they get off onto h2.
    assert_eq!(give(&mut world, 7, json!({ "kind": "getOff", "residentId": "p1" })), Ok(()));
    let p1 = world.residents.iter().find(|r| r.id == "p1").unwrap();
    assert!((30.0..=32.0).contains(&p1.x) && (12.0..=14.0).contains(&p1.y));
    assert_sound(&world, &t);
}

#[test]
fn sails_to_a_sea_tile_and_lets_nobody_off_out_there() {
    let t = terrain();
    let mut world = setup();
    assert_eq!(sail(&mut world, "w2", 25, 20), Ok(()));
    run_walking(&mut world, &t, 3000, |w| !sailing(w));
    assert_eq!((s1(&world).x, s1(&world).y), (25.0, 20.0));
    assert!(docked_at(&world, s1(&world)).is_none());
    assert_eq!(
        give(&mut world, 7, json!({ "kind": "getOff", "residentId": "p1" })),
        Err("the ship is not docked at a haven".into())
    );
}

#[test]
fn needs_the_minimum_crew_and_a_captain_among_them() {
    let mut world = setup();
    assert_eq!(
        sail(&mut world, "p1", 25, 20),
        Err("only one of its crew aboard sails a ship".into())
    );
    world.vessels[0].crew_ids.pop();
    assert_eq!(
        sail(&mut world, "w1", 25, 20),
        Err(format!("the ship needs {} more crew to sail", 1))
    );
    assert_eq!(SHIP_MIN_CREW, 4.0);
}

#[test]
fn goes_over_sea_only_never_onto_a_lake_or_land() {
    let t = terrain();
    let world = setup();
    let v = s1(&world);
    assert_eq!(
        sail_target(&world, &t, v, 25, 32),
        Err("a ship sails only on the Sea, never onto a Lake")
    );
    assert_eq!(sail_target(&world, &t, v, 10, 10), Err("a ship sails to a haven or a Sea tile"));
    let mut world = setup();
    assert!(sail(&mut world, "w1", 25, 32).is_err());
    // Every step it takes is a Sea step: the invariants say so tick by tick.
    assert_eq!(sail(&mut world, "w1", 21, 40), Ok(()));
    run_walking(&mut world, &t, 4000, |w| !sailing(w));
    assert_eq!((s1(&world).x, s1(&world).y), (21.0, 40.0));
}

#[test]
fn a_skilled_crew_sails_faster() {
    let world = setup();
    let crew: Vec<_> = world.residents.iter().take(4).collect();
    let green = sail_speed(&crew);
    let mut skilled = world.clone();
    for r in skilled.residents.iter_mut().take(4) {
        r.skills.insert(SkillName::Seafaring, 10.0);
    }
    let crew: Vec<_> = skilled.residents.iter().take(4).collect();
    assert!(sail_speed(&crew) > green);
}

#[test]
fn stops_where_it_is_once_too_few_crew_are_aboard() {
    let t = terrain();
    let mut world = setup();
    assert_eq!(sail(&mut world, "w1", 25, 40), Ok(()));
    run_walking(&mut world, &t, 60, |_| false);
    // One of the crew is lost at sea.
    let w4 = world.residents.iter().position(|r| r.id == "w4").unwrap();
    world.residents.remove(w4);
    run_walking(&mut world, &t, 200, |w| !sailing(w));
    assert!(!sailing(&world));
    assert_ne!((s1(&world).x, s1(&world).y), (25.0, 40.0));
}

mod stealing {
    use super::*;

    /// s1 docked at h1 with nobody aboard; b1–b4 of r2 on h1, r1's Leader at home.
    fn empty_ship() -> WorldState {
        let mut world = setup();
        // r1's Leader w1 stays home, off the ship and its haven.
        world.residents.retain(|r| r.owner.as_deref() == Some("r2") || r.id == "w1");
        let w1 = world.residents.iter_mut().find(|r| r.id == "w1").unwrap();
        (w1.x, w1.y, w1.aboard) = (3.0, 3.0, None);
        world.vessels[0].crew_ids.clear();
        world
    }

    fn crew_board(world: &mut WorldState, who: &str) -> Result<(), String> {
        give(
            world,
            8,
            json!({ "kind": "board", "residentId": who, "vesselId": "s1", "asCrew": true }),
        )
    }

    #[test]
    fn a_crew_of_another_realm_boards_it_and_sailing_it_off_steals_it() {
        let t = terrain();
        let mut world = empty_ship();
        for b in ["b1", "b2", "b3", "b4"] {
            assert_eq!(crew_board(&mut world, b), Ok(()));
        }
        // As passengers they don't board it.
        let o = json!({ "kind": "board", "residentId": "b1", "vesselId": "s1" });
        assert!(give(&mut world, 8, o).is_err());
        let o = json!({ "kind": "sail", "residentId": "b1", "vesselId": "s1", "x": 25, "y": 20 });
        assert_eq!(give(&mut world, 8, o), Ok(()));
        assert_eq!(s1(&world).realm_id.as_deref(), Some("r2"));
        assert!(world.crimes.iter().any(|c| c.victim_org == "r1"), "{:?}", world.crimes);
        // Known as a ship, not a boat, in the crime and the realm logs.
        let theft = world.crimes.iter().find(|c| c.victim_org == "r1").unwrap();
        assert_eq!((theft.boat, theft.ship), (Some(true), Some(true)));
        assert!(world.events.iter().any(|e| matches!(
            e.what,
            csp_shared::world::RealmEventWhat::TransportGone { ship: Some(true), .. }
        )));
        run_walking(&mut world, &t, 3000, |w| !sailing(w));
        assert_eq!((s1(&world).x, s1(&world).y), (25.0, 20.0));
        assert_sound(&world, &t);
    }

    #[test]
    fn not_while_an_armed_resident_of_its_owner_guards_it_on_its_haven() {
        let mut world = empty_ship();
        let mut guard = new_resident("g1", Some("r1"), 18.0, 6.0);
        guard.carried.insert(Good::Spear, 1.0);
        world.residents.push(guard);
        assert_eq!(crew_board(&mut world, "b1"), Err("an armed resident guards that ship".into()));
    }

    #[test]
    fn not_while_anyone_of_another_realm_is_aboard() {
        let mut world = setup();
        assert_eq!(
            give(
                &mut world,
                8,
                json!({ "kind": "board", "residentId": "b1", "vesselId": "s1", "asCrew": true })
            ),
            Err("someone of another realm is aboard that ship".into())
        );
    }
}

#[test]
fn those_aboard_a_docked_ship_are_fought_from_anywhere_on_its_haven() {
    let t = terrain();
    let mut world = setup();
    // b1 armed on (17, 5), three tiles from the ship's water: not in contact, but on its haven.
    let b1 = world.residents.iter().position(|r| r.id == "b1").unwrap();
    world.residents[b1].x = 17.0;
    world.residents[b1].y = 5.0;
    world.residents[b1].carried.insert(Good::Sword, 1.0);
    let o = json!({ "kind": "attack", "residentId": "b1", "targetId": "p1" });
    assert_eq!(give(&mut world, 8, o), Ok(()));
    let health = |w: &WorldState| w.residents.iter().find(|r| r.id == "p1").unwrap().health;
    let start = health(&world);
    run_walking(&mut world, &t, 40, |w| health(w) < start);
    assert!(health(&world) < start);
    let b1 = world.residents.iter().find(|r| r.id == "b1").unwrap();
    assert!((17.0..=19.0).contains(&b1.x) && (5.0..=7.0).contains(&b1.y));
}
