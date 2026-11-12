//! Crew and docking (`CONTEXT.md`: Docked, Crew, Beside a vessel, T91.2): a ship touching a
//! haven's footprint is docked there, and only then, and only from that haven, do residents board
//! it (as crew or as passengers), get off it and load it; those at the haven move goods straight
//! between the haven's storage and the ship. Crew don't count against what it holds.

mod build_common;

use build_common::{
    add_city, assert_sound, building, new_resident, order, player, realm, run, run_walking, Orders,
};
use csp_shared::balance::{OWN_FOOD, PASSENGER_WEIGHT, SHIP_CAPACITY, SHIP_MIN_CREW};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, ConstructionSite, Good, Stock, Vessel, VesselKind, WorldState,
};
use csp_sim::invariants::check_all;
use csp_sim::queries::vessels::{
    crew_short, docked_at, vessel_crew, vessel_passengers, vessel_room,
};
use serde_json::{json, Value};

const SIZE: i32 = 32;

/// Plains with the Sea in columns 20 to 25.
fn terrain() -> TerrainMap {
    let mut tiles = vec![Terrain::Plains as u8; (SIZE * SIZE) as usize];
    for y in 0..SIZE {
        for x in 20..=25 {
            tiles[tile_index(SIZE, x, y)] = Terrain::Sea as u8;
        }
    }
    TerrainMap { size: SIZE, tiles }
}

/// Realm r1 (Player 7) with city c1 and realm r2 (Player 8); a finished haven h1 of c1 covering
/// (17, 5)–(19, 7) on the Sea's shore, its storage holding 50 Iron ore and 20 Food; ship s1 of r1
/// docked at it on (20, 7). Residents w1–w5 of r1 (w5 a child) stand on the haven's inland tile
/// (17, 5), b1 of r2 too.
fn setup() -> WorldState {
    let mut world = build_common::empty_world(&terrain());
    world.realms.push(realm("r1", 7, "w1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 2.0, 2.0);
    let mut haven = building("h1", BuildingKind::Haven, 17.0, 5.0);
    haven.city_id = Some("c1".into());
    haven.stock = Some([(Good::IronOre, 50.0), (Good::Food, 20.0)].into_iter().collect());
    world.buildings.push(haven);
    world.vessels.push(ship("s1", 20.0, 7.0));
    for (id, owner) in
        [("w1", "r1"), ("w2", "r1"), ("w3", "r1"), ("w4", "r1"), ("w5", "r1"), ("b1", "r2")]
    {
        let mut r = new_resident(id, Some(owner), 17.0, 5.0);
        r.city_id = (owner == "r1").then(|| "c1".into());
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        world.residents.push(r);
    }
    world.residents[4].born_at = world.tick as f64;
    world
}

fn ship(id: &str, x: f64, y: f64) -> Vessel {
    Vessel {
        id: id.into(),
        kind: VesselKind::Ship,
        realm_id: Some("r1".into()),
        x,
        y,
        load: Stock::new(),
        rower_id: None,
        crew_ids: Vec::new(),
    }
}

fn give(world: &mut WorldState, user: u64, o: Value) -> Result<(), String> {
    let mut orders = Orders::default();
    order(world, &mut orders, &player(user), o, &terrain())
}

fn board(world: &mut WorldState, who: &str, crew: bool) -> Result<(), String> {
    give(world, 7, json!({ "kind": "board", "residentId": who, "vesselId": "s1", "asCrew": crew }))
}

fn s1(world: &WorldState) -> &Vessel {
    &world.vessels[0]
}

fn haven_stock(world: &WorldState, good: Good) -> f64 {
    world.buildings[1].stock.as_ref().and_then(|s| s.get(&good)).copied().unwrap_or(0.0)
}

#[test]
fn a_ship_touching_a_havens_footprint_is_docked_there_and_nowhere_else() {
    let mut world = setup();
    assert_eq!(docked_at(&world, s1(&world)).map(|h| h.id.as_str()), Some("h1"));
    // Out at sea, two tiles off the haven.
    world.vessels[0].x = 21.0;
    assert!(docked_at(&world, s1(&world)).is_none());
    // Touching it diagonally.
    world.vessels[0] = ship("s1", 20.0, 8.0);
    assert!(docked_at(&world, s1(&world)).is_some());
    // An unfinished haven docks nothing.
    world.buildings[1].site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    assert!(docked_at(&world, s1(&world)).is_none());
}

#[test]
fn residents_board_a_docked_ship_from_any_tile_of_its_haven() {
    let t = terrain();
    let mut world = setup();
    // (17, 5) touches no water, but it is the haven's.
    assert_eq!(board(&mut world, "w1", false), Ok(()));
    let w1 = &world.residents[0];
    assert_eq!((w1.aboard.as_deref(), w1.x, w1.y), (Some("s1"), 20.0, 7.0));
    assert_eq!(vessel_passengers(&world, "s1").len(), 1);
    run(&mut world, &t, 1);
    assert_eq!(world.residents[0].aboard.as_deref(), Some("s1"));
    assert_sound(&world, &t);
}

#[test]
fn nothing_boards_an_undocked_ship_nor_from_off_its_haven() {
    let mut world = setup();
    // Off the haven, though the tile touches the ship's water.
    world.residents[0].y = 8.0;
    world.residents[0].x = 19.0;
    assert_eq!(
        board(&mut world, "w1", false),
        Err("not at the haven the ship is docked at".into())
    );
    world.residents[0].x = 17.0;
    world.residents[0].y = 5.0;
    world.vessels[0].x = 22.0;
    assert_eq!(board(&mut world, "w1", false), Err("the ship is not docked at a haven".into()));
    assert_eq!(board(&mut world, "w1", true), Err("the ship is not docked at a haven".into()));
    assert!(world.residents[0].aboard.is_none());
}

#[test]
fn crew_are_no_passengers_and_weigh_nothing_against_the_load() {
    let t = terrain();
    let mut world = setup();
    assert_eq!(crew_short(&world, s1(&world)), SHIP_MIN_CREW as usize);
    for w in ["w1", "w2", "w3"] {
        assert_eq!(board(&mut world, w, true), Ok(()));
    }
    assert_eq!(board(&mut world, "w4", false), Ok(()));
    let v = s1(&world);
    let crew: Vec<_> = vessel_crew(&world, v).iter().map(|r| r.id.clone()).collect();
    assert_eq!(crew, ["w1", "w2", "w3"]);
    let passengers: Vec<_> = vessel_passengers(&world, "s1").iter().map(|r| r.id.clone()).collect();
    assert_eq!(passengers, ["w4"]);
    assert_eq!(vessel_room(&world, v), SHIP_CAPACITY - PASSENGER_WEIGHT);
    assert_eq!(crew_short(&world, v), SHIP_MIN_CREW as usize - 3);
    run(&mut world, &t, 1);
    assert_eq!(s1(&world).crew_ids, ["w1", "w2", "w3"]);
    assert_sound(&world, &t);
}

#[test]
fn only_grown_residents_crew_and_only_a_ship() {
    let mut world = setup();
    assert_eq!(board(&mut world, "w5", true), Err("children can’t crew a ship".into()));
    // A child boards as a passenger all the same.
    assert_eq!(board(&mut world, "w5", false), Ok(()));
    // A boat takes no crew.
    world.vessels.push(Vessel { kind: VesselKind::Boat, ..ship("v2", 20.0, 2.0) });
    world.residents[0].x = 19.0;
    world.residents[0].y = 2.0;
    let o = json!({ "kind": "board", "residentId": "w1", "vesselId": "v2", "asCrew": true });
    assert_eq!(give(&mut world, 7, o), Err("only a ship takes a crew".into()));
    // Another realm's ship takes neither.
    assert_eq!(
        give(&mut world, 8, json!({ "kind": "board", "residentId": "b1", "vesselId": "s1" })),
        Err("not a ship of your realm".into())
    );
}

#[test]
fn getting_off_lands_on_the_haven_and_ends_being_crew() {
    let t = terrain();
    let mut world = setup();
    assert_eq!(board(&mut world, "w1", true), Ok(()));
    assert_eq!(give(&mut world, 7, json!({ "kind": "getOff", "residentId": "w1" })), Ok(()));
    let w1 = &world.residents[0];
    assert!(w1.aboard.is_none());
    assert!(world.buildings[1].kind == BuildingKind::Haven);
    assert!((17.0..=19.0).contains(&w1.x) && (5.0..=7.0).contains(&w1.y), "{} {}", w1.x, w1.y);
    assert!(s1(&world).crew_ids.is_empty());
    // Not onto a tile off the haven, though it touches the ship's water.
    assert_eq!(board(&mut world, "w1", true), Ok(()));
    let off = json!({ "kind": "getOff", "residentId": "w1", "x": 19, "y": 8 });
    assert_eq!(
        give(&mut world, 7, off),
        Err("that tile is not on the haven the ship is docked at".into())
    );
    // At sea nobody gets off.
    world.vessels[0].x = 22.0;
    world.residents[0].x = 22.0;
    assert_eq!(
        give(&mut world, 7, json!({ "kind": "getOff", "residentId": "w1" })),
        Err("the ship is not docked at a haven".into())
    );
    world.vessels[0].x = 20.0;
    world.residents[0].x = 20.0;
    run(&mut world, &t, 1);
    assert_sound(&world, &t);
}

#[test]
fn those_at_the_haven_move_goods_straight_between_its_storage_and_the_ship() {
    let t = terrain();
    let mut world = setup();
    let load = |goods: Value, unload: bool| {
        json!({ "kind": "load", "residentId": "w1", "vesselId": "s1", "goods": goods,
            "unload": unload })
    };
    // More than one resident carries, at once.
    assert_eq!(give(&mut world, 7, load(json!({ "ironOre": 40 }), false)), Ok(()));
    assert_eq!(s1(&world).load.get(&Good::IronOre).copied(), Some(40.0));
    assert_eq!(haven_stock(&world, Good::IronOre), 10.0);
    // As many as there are.
    assert_eq!(give(&mut world, 7, load(json!({ "ironOre": 40 }), false)), Ok(()));
    assert_eq!(s1(&world).load.get(&Good::IronOre).copied(), Some(50.0));
    // And back.
    assert_eq!(give(&mut world, 7, load(json!({ "ironOre": 15 }), true)), Ok(()));
    assert_eq!(haven_stock(&world, Good::IronOre), 15.0);
    assert_eq!(s1(&world).load.get(&Good::IronOre).copied(), Some(35.0));
    // Their own food stays theirs.
    assert_eq!(world.residents[0].carried.get(&Good::Food).copied(), Some(OWN_FOOD));
    assert_eq!(
        give(&mut world, 7, load(json!({ "stone": 1 }), false)),
        Err("none of those goods in the haven".into())
    );
    run(&mut world, &t, 1);
    assert_sound(&world, &t);
}

#[test]
fn loading_stops_at_what_the_ship_holds_and_the_rest_stays_in_the_haven() {
    let mut world = setup();
    let iron = (SHIP_CAPACITY / csp_shared::balance::GOOD_WEIGHT.get("ironOre").unwrap()).floor();
    world.buildings[1].stock = Some([(Good::IronOre, iron + 30.0)].into_iter().collect());
    let o = json!({ "kind": "load", "residentId": "w1", "vesselId": "s1",
        "goods": { "ironOre": iron + 30.0 } });
    assert_eq!(give(&mut world, 7, o), Ok(()));
    assert_eq!(s1(&world).load.get(&Good::IronOre).copied(), Some(iron));
    assert_eq!(haven_stock(&world, Good::IronOre), 30.0);
    assert_eq!(world.residents[0].carried.get(&Good::IronOre), None);
}

#[test]
fn nobody_loads_an_undocked_ship_nor_from_off_its_haven() {
    let mut world = setup();
    let o = || {
        json!({ "kind": "load", "residentId": "w1", "vesselId": "s1",
        "goods": { "ironOre": 5 } })
    };
    world.residents[0].x = 19.0;
    world.residents[0].y = 8.0;
    assert_eq!(give(&mut world, 7, o()), Err("not at the haven the ship is docked at".into()));
    world.residents[0].x = 17.0;
    world.residents[0].y = 5.0;
    world.vessels[0].x = 22.0;
    assert_eq!(give(&mut world, 7, o()), Err("the ship is not docked at a haven".into()));
    // By hand neither: a drop onto it finds no ship beside them.
    world.residents[0].carried.insert(Good::IronOre, 5.0);
    let drop = json!({ "kind": "drop", "residentId": "w1",
        "spot": { "kind": "vessel", "vesselId": "s1" }, "goods": { "ironOre": 5 } });
    assert!(give(&mut world, 7, drop).is_err());
}

#[test]
fn docked_its_load_is_also_handled_by_hand_from_the_haven() {
    let t = terrain();
    let mut world = setup();
    world.residents[0].carried.insert(Good::Stone, 5.0);
    let drop = json!({ "kind": "drop", "residentId": "w1",
        "spot": { "kind": "vessel", "vesselId": "s1" }, "goods": { "stone": 5 } });
    assert_eq!(give(&mut world, 7, drop), Ok(()));
    run(&mut world, &t, 1);
    assert_eq!(s1(&world).load.get(&Good::Stone).copied(), Some(5.0));
}

#[test]
fn loading_from_another_citys_haven_is_judged_as_taking_from_its_storage() {
    let mut world = setup();
    add_city(&mut world, "c2", Some("r2"), 2.0, 20.0);
    world.buildings[1].city_id = Some("c2".into());
    let o = json!({ "kind": "load", "residentId": "w1", "vesselId": "s1",
        "goods": { "ironOre": 10 } });
    assert_eq!(give(&mut world, 7, o), Ok(()));
    assert_eq!(s1(&world).load.get(&Good::IronOre).copied(), Some(10.0));
    assert!(world.crimes.iter().any(|c| c.victim_org == "r2"), "{:?}", world.crimes);
}

#[test]
fn a_store_to_a_docked_ship_walks_onto_its_haven() {
    let t = terrain();
    let mut world = setup();
    world.residents[0].x = 12.0;
    world.residents[0].carried.insert(Good::Stone, 5.0);
    let o = json!({ "kind": "store", "residentId": "w1", "to": "s1", "goods": { "stone": 5 } });
    assert_eq!(give(&mut world, 7, o), Ok(()));
    run_walking(&mut world, &t, 2000, |w| w.vessels[0].load.contains_key(&Good::Stone));
    assert_eq!(s1(&world).load.get(&Good::Stone).copied(), Some(5.0));
    let w1 = &world.residents[0];
    assert!((17.0..=19.0).contains(&w1.x) && (5.0..=7.0).contains(&w1.y), "{} {}", w1.x, w1.y);
    assert_sound(&world, &t);
}

mod invariants {
    use super::*;

    fn broken(world: &WorldState) -> Vec<String> {
        check_all(world, &terrain()).into_iter().map(|v| v.message).collect()
    }

    #[test]
    fn crew_are_grown_residents_of_its_realm_aboard_it() {
        let mut world = setup();
        assert_eq!(board(&mut world, "w2", true), Ok(()));
        assert!(broken(&world).is_empty(), "{:?}", broken(&world));
        world.vessels[0].crew_ids.push("w3".into());
        assert_eq!(broken(&world), ["crew w3 of ship s1 is not aboard it"]);
        world.vessels[0].crew_ids.pop();
        world.residents[1].born_at = world.tick as f64;
        assert_eq!(broken(&world), ["child w2 crews ship s1"]);
    }

    #[test]
    fn a_boat_has_no_crew() {
        let mut world = setup();
        world.vessels.push(Vessel {
            kind: VesselKind::Boat,
            crew_ids: vec!["w9".into()],
            ..ship("v2", 22.0, 2.0)
        });
        let b = broken(&world);
        assert!(b.contains(&"boat v2 has a crew".to_string()), "{b:?}");
    }
}
