//! Creative actions (T117.3, `CONTEXT.md`: Creative mode, ADR 0043): goods given and taken, and
//! finish now, which leaves the world as finishing at normal speed would. Every invariant holds
//! after each action; none of them is an order kind or a script call.

// Epic 127: this file still has `_ =>` arms over enums; its tickets name each variant or say
// why the wildcard is right, then remove this line.
#![allow(clippy::wildcard_enum_match_arm)]

mod build_common;

use build_common::*;
use csp_shared::balance::{ADULT_AGE, BUILD_MATERIALS, CARRIAGE_CAPACITY, LIFESPAN_MIN};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{
    Building, BuildingKind, Carriage, Good, HorseStats, RealmEventWhat, ResidentOrder, SkillName,
    Stat, StatRecord, Stock, UpSide, Vessel, VesselKind, WorldState,
};
use csp_sim::creative::{
    add_horse, add_resident, finish_now, give_goods, grow_up, heal, kill, move_residents,
    take_goods, ResidentPick, CREATIVE_ACTIONS,
};
use csp_sim::horses::HORSE_NAMES;
use csp_sim::orders::order_kinds;
use csp_sim::queries::balance::training_gain;
use csp_sim::queries::building::road_at;
use csp_sim::queries::residents::{age_in_years, can_work};
use csp_sim::script_tables::{ARMY_SCRIPT_API, SCRIPT_API};
use csp_sim::survival::go_down;
use serde_json::json;

/// Realm r1 (Player 7) with its city c1 (town hall on (10, 10)) and its resident w1 on (x, y).
fn city_world(x: f64, y: f64) -> (WorldState, TerrainMap, Orders) {
    let terrain = plains(24);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "w1"));
    add_city(&mut world, "c1", Some("r1"), 10.0, 10.0);
    resident(&mut world, "w1", x, y);
    world.residents[0].city_id = Some("c1".into());
    (world, terrain, Orders::default())
}

fn held(stock: Option<&Stock>, good: Good) -> f64 {
    stock.and_then(|s| s.get(&good)).copied().unwrap_or(0.0)
}

/// What of a building the finishing decides: kind, place, site, realm and city.
fn finished_part(b: &Building) -> serde_json::Value {
    json!([b.kind, b.x, b.y, b.site, b.realm_id, b.city_id])
}

#[test]
fn goods_given_and_taken_land_in_a_storage_and_never_go_below_none() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    let mut storage = building("s1", BuildingKind::Storage, 14.0, 10.0);
    storage.city_id = Some("c1".into());
    world.buildings.push(storage);
    let stock = |w: &WorldState| w.buildings.iter().find(|b| b.id == "s1").unwrap().stock.clone();

    assert_eq!(give_goods(&mut world, "s1", Good::Wood, 100.0), Ok(100.0));
    assert_eq!(held(stock(&world).as_ref(), Good::Wood), 100.0);
    assert_sound(&world, &terrain);
    assert_eq!(take_goods(&mut world, "s1", Good::Wood, 30.0), Ok(30.0));
    assert_eq!(held(stock(&world).as_ref(), Good::Wood), 70.0);
    // Never below none: only what is there is taken, and the good is gone.
    assert_eq!(take_goods(&mut world, "s1", Good::Wood, 500.0), Ok(70.0));
    assert_eq!(stock(&world).unwrap().get(&Good::Wood), None);
    assert_eq!(take_goods(&mut world, "s1", Good::Stone, 5.0), Ok(0.0));
    assert_sound(&world, &terrain);

    // Whole units only, and only where goods are kept.
    assert!(give_goods(&mut world, "s1", Good::Wood, 1.5).is_err());
    assert!(give_goods(&mut world, "s1", Good::Wood, 0.0).is_err());
    assert!(give_goods(&mut world, "s1", Good::Wood, -3.0).is_err());
    assert!(give_goods(&mut world, "c1-hall", Good::Wood, 10.0).is_err());
    assert!(give_goods(&mut world, "nowhere", Good::Wood, 10.0).is_err());
    assert_sound(&world, &terrain);
}

#[test]
fn goods_given_and_taken_land_in_a_carriage_up_to_what_it_holds() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    world.carriages.push(Carriage {
        id: "k1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 6.0,
        y: 6.0,
        horse_id: None,
        load: Stock::new(),
    });
    let load = |w: &WorldState| w.carriages[0].load.clone();
    assert_eq!(give_goods(&mut world, "k1", Good::Food, 20.0), Ok(20.0));
    assert_eq!(held(Some(&load(&world)), Good::Food), 20.0);
    assert_sound(&world, &terrain);
    // More than it holds is refused, and nothing changes.
    let too_much = CARRIAGE_CAPACITY; // Stone weighs more than a kilogram a unit.
    assert!(give_goods(&mut world, "k1", Good::Stone, too_much).is_err());
    assert_eq!(held(Some(&load(&world)), Good::Stone), 0.0);
    assert_eq!(take_goods(&mut world, "k1", Good::Food, 25.0), Ok(20.0));
    assert!(load(&world).is_empty());
    assert_sound(&world, &terrain);
}

/// w1 lays out a house on (14, 13), next to the city's town hall, and stands there with its order.
fn house_site() -> (WorldState, TerrainMap, Orders, String) {
    let (mut world, terrain, mut orders) = city_world(14.0, 13.0);
    let o = json!({ "kind": "build", "residentId": "w1", "building": "house" });
    assert_eq!(order(&mut world, &mut orders, &player(7), o, &terrain), Ok(()));
    let id = site_of(&world).expect("the house site").id.clone();
    assert!(matches!(&world.residents[0].order, Some(ResidentOrder::Build(_))));
    (world, terrain, orders, id)
}

#[test]
fn finish_now_leaves_a_house_as_building_it_at_normal_speed_would() {
    let (mut now, terrain, _, id) = house_site();
    let mut normal = now.clone();

    assert!(finish_now(&mut now, &id, Some(&terrain)).is_ok());
    let house = now.buildings.iter().find(|b| b.id == id).unwrap();
    assert!(house.site.is_none(), "the house is built");
    assert!(now.residents[0].order.is_none(), "the builder is freed");
    assert_sound(&now, &terrain);

    // At normal speed: w1 has the materials and works until the house is done.
    let materials: Stock = serde_json::from_value(json!(BUILD_MATERIALS.get("house").unwrap()))
        .expect("the house's materials");
    let site = normal.buildings.iter_mut().find(|b| b.id == id).unwrap();
    site.site.as_mut().unwrap().delivered = materials;
    run_walking(&mut normal, &terrain, 50_000, |w| w.residents[0].order.is_none());
    let built = normal.buildings.iter().find(|b| b.id == id).unwrap();
    assert!(built.site.is_none());
    assert_eq!(finished_part(house), finished_part(built));
    assert_eq!(now.cities, normal.cities);
    // A finished site is nothing left to finish.
    assert!(finish_now(&mut now, &id, Some(&terrain)).is_err());
}

#[test]
fn finish_now_builds_the_rest_of_a_road_line_and_frees_its_builder() {
    let map = plains(10);
    let mut world = empty_world(&map);
    world.realms.push(realm("r1", 7, "w1"));
    resident(&mut world, "w1", 1.0, 1.0);
    let stone = BUILD_MATERIALS.get("road").unwrap().get("stone").unwrap();
    world.residents[0].carried = Stock::from([(Good::Stone, 3.0 * stone)]);
    let mut orders = Orders::default();
    let line = json!({
        "kind": "roadLine", "residentId": "w1", "from": { "x": 2, "y": 1 }, "to": { "x": 5, "y": 1 }
    });
    assert_eq!(orders.receive(&world, &player(7), line, &map), Ok(()));
    orders.apply_all(&mut world, &map);
    // Walk to the first tile and lay out its site.
    run_walking(&mut world, &map, 5_000, |w| site_of(w).is_some());
    let id = site_of(&world).unwrap().id.clone();

    let done = finish_now(&mut world, &id, Some(&map)).unwrap();
    assert!(done.contains("3 more tiles"), "{done}");
    for x in 2..=5 {
        assert!(road_at(&world, x, 1).is_some_and(|b| b.site.is_none()), "road on ({x}, 1)");
    }
    assert!(world.residents[0].order.is_none(), "the line is done");
    assert_sound(&world, &map);
}

#[test]
fn finish_now_trains_every_trainee_as_far_as_their_teacher_takes_them() {
    let terrain = plains(16);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "t1"));
    world.buildings.push(building("g1", BuildingKind::TrainingGround, 3.0, 3.0));
    for (id, x, y) in [("t1", 4.0, 4.0), ("a1", 3.0, 3.0), ("a2", 5.0, 5.0)] {
        let i = resident(&mut world, id, x, y);
        world.residents[i].stats.strength = Stat { base: 10.0, trained: 0.0 };
    }
    world.residents[0].stats.strength = Stat { base: 15.0, trained: 0.0 };
    let mut orders = Orders::default();
    let teach =
        json!({ "kind": "teach", "residentId": "t1", "buildingId": "g1", "subject": "strength" });
    assert_eq!(orders.receive(&world, &player(7), teach, &terrain), Ok(()));
    orders.apply_all(&mut world, &terrain);
    for id in ["a1", "a2"] {
        let train = json!({ "kind": "train", "residentId": id, "buildingId": "g1" });
        assert_eq!(orders.receive(&world, &player(7), train, &terrain), Ok(()));
    }
    orders.apply_all(&mut world, &terrain);

    assert_eq!(
        finish_now(&mut world, "g1", Some(&terrain)),
        Ok("2 trainees finished training.".into())
    );
    let tick = world.tick as f64;
    let teacher = world.residents[0].clone();
    for r in &world.residents[1..] {
        assert!(r.order.is_none(), "{} is freed", r.id);
        assert!(r.stats.strength.trained > 0.0, "{} trained", r.id);
        // A tick more would teach them nothing.
        let more = training_gain(r, &teacher, csp_shared::world::TrainingSubject::Strength, tick);
        assert!(more <= 1e-9, "{} could still gain {more}", r.id);
    }
    // The teacher goes on teaching, as at normal speed.
    assert!(matches!(world.residents[0].order, Some(ResidentOrder::Teach(_))));
    assert_sound(&world, &terrain);
    assert_eq!(finish_now(&mut world, "g1", Some(&terrain)), Err("Nobody trains here.".into()));
}

#[test]
fn finish_now_refuses_what_has_nothing_to_finish() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    assert!(finish_now(&mut world, "c1-hall", Some(&terrain)).is_err());
    assert!(finish_now(&mut world, "nowhere", Some(&terrain)).is_err());
    assert_sound(&world, &terrain);
}

#[test]
fn no_creative_action_is_an_order_kind_or_a_script_call() {
    let kinds = order_kinds();
    for name in CREATIVE_ACTIONS {
        assert!(!kinds.contains(name), "{name} is an order kind");
        assert!(SCRIPT_API.iter().all(|b| b.name != name), "{name} is in the script API");
        assert!(ARMY_SCRIPT_API.iter().all(|b| b.name != name), "{name} is in the army API");
    }
}

#[test]
fn an_added_resident_joins_the_picked_city_with_the_picked_age_stats_and_skills() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    world.tick = 5_000;
    let pick = ResidentPick {
        age: Some(20.0),
        stats: Some(StatRecord { strength: 25.0, endurance: 3.0, agility: 12.0, intellect: 1.0 }),
        skills: [(SkillName::Mining, 2.5), (SkillName::Farming, 0.0)].into_iter().collect(),
    };
    let id = add_resident(&mut world, &terrain, "c1", (7.0, 8.0), &pick).unwrap();
    let r = world.residents.iter().find(|r| r.id == id).unwrap();
    assert_eq!((r.owner.as_deref(), r.city_id.as_deref()), (Some("r1"), Some("c1")));
    assert_eq!((r.x, r.y), (7.0, 8.0));
    close(age_in_years(r.born_at, world.tick as f64), 20.0);
    assert_eq!(r.stats.strength, Stat { base: 25.0, trained: 0.0 });
    assert_eq!(r.stats.intellect.base, 1.0);
    // A skill picked at none is no skill at all.
    assert_eq!(r.skills.iter().collect::<Vec<_>>(), vec![(&SkillName::Mining, &2.5)]);
    assert!(r.order.is_none() && r.carried.is_empty() && r.health == 100.0);
    assert_eq!(r.game_name, Some(true));
    let first = r.name.clone();
    assert_sound(&world, &terrain);

    // Nothing picked: drawn as a starting city's resident, and named apart from the first.
    let other = add_resident(&mut world, &terrain, "c1", (7.0, 8.0), &ResidentPick::default());
    let other = world.residents.iter().find(|r| r.id == other.clone().unwrap()).unwrap();
    assert!(can_work(other.born_at, world.tick as f64));
    assert_ne!(other.name, first);
    assert_sound(&world, &terrain);
}

#[test]
fn an_added_resident_or_horse_joins_an_npc_city_as_its_own() {
    let terrain = plains(24);
    let mut world = empty_world(&terrain);
    add_city(&mut world, "n1", None, 18.0, 18.0);
    let id = add_resident(&mut world, &terrain, "n1", (16.0, 16.0), &ResidentPick::default());
    let r = world.residents.iter().find(|r| Some(&r.id) == id.as_ref().ok()).unwrap();
    assert_eq!((r.owner.as_deref(), r.city_id.as_deref()), (None, Some("n1")));
    let horse = add_horse(&mut world, &terrain, "n1", (16.0, 17.0), None, None).unwrap();
    let h = world.horses.iter().find(|h| h.id == horse).unwrap();
    assert_eq!((h.realm_id.as_deref(), h.city_id.as_deref()), (None, Some("n1")));
    assert_sound(&world, &terrain);
}

#[test]
fn an_added_horse_has_the_picked_age_and_stats() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    world.tick = 9_000;
    let stats = HorseStats { speed: 20.0, strength: 2.0, endurance: 11.0 };
    let id = add_horse(&mut world, &terrain, "c1", (6.0, 6.0), Some(4.0), Some(stats.clone()));
    let h = world.horses.iter().find(|h| Some(&h.id) == id.as_ref().ok()).unwrap();
    assert_eq!(h.stats, stats);
    assert_eq!((h.realm_id.as_deref(), h.city_id.as_deref()), (Some("r1"), None));
    close((world.tick as f64 - h.born_at) / TICKS_PER_GAME_YEAR, 4.0);
    assert_eq!((h.x, h.y, h.health, h.hunger), (6.0, 6.0, 100.0, 100.0));
    assert!(HORSE_NAMES.contains(&h.name.as_str()));
    assert_sound(&world, &terrain);
}

#[test]
fn what_cannot_be_added_is_refused_and_changes_nothing() {
    let (mut world, mut terrain, _) = city_world(4.0, 4.0);
    terrain.tiles[(3 * terrain.size + 3) as usize] = Terrain::Sea as u8;
    let before = world.clone();
    let bad_stats = StatRecord { strength: 1.5, endurance: 3.0, agility: 3.0, intellect: 3.0 };
    let too_much = [(SkillName::Mining, 1e9)].into_iter().collect();
    let picks = [
        ResidentPick { age: Some(-1.0), ..Default::default() },
        ResidentPick { age: Some(LIFESPAN_MIN), ..Default::default() },
        ResidentPick { stats: Some(bad_stats), ..Default::default() },
        ResidentPick { skills: too_much, ..Default::default() },
    ];
    for pick in &picks {
        assert!(add_resident(&mut world, &terrain, "c1", (5.0, 5.0), pick).is_err(), "{pick:?}");
    }
    let none = ResidentPick::default();
    assert!(add_resident(&mut world, &terrain, "nowhere", (5.0, 5.0), &none).is_err());
    assert!(add_resident(&mut world, &terrain, "c1", (3.0, 3.0), &none).is_err(), "on the sea");
    assert!(add_resident(&mut world, &terrain, "c1", (-1.0, 3.0), &none).is_err());
    let lame = HorseStats { speed: 0.0, strength: 5.0, endurance: 5.0 };
    assert!(add_horse(&mut world, &terrain, "c1", (5.0, 5.0), None, Some(lame)).is_err());
    assert!(add_horse(&mut world, &terrain, "c1", (5.0, 5.0), Some(99.0), None).is_err());
    assert!(add_horse(&mut world, &terrain, "c1", (3.0, 3.0), None, None).is_err());
    assert_eq!(world, before);
}

#[test]
fn heal_ends_down_and_wounds() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    resident(&mut world, "w2", 5.0, 5.0);
    at(&mut world, "w1").health = 35.0;
    assert_eq!(heal(&mut world, "w1"), Ok("Name w1 is healed.".into()));
    assert_eq!(at(&mut world, "w1").health, 100.0);
    assert!(heal(&mut world, "w1").is_err(), "a well resident is not hurt");

    go_down(&mut world, 1);
    assert!(at(&mut world, "w2").down_until.is_some());
    heal(&mut world, "w2").unwrap();
    let r = at(&mut world, "w2");
    assert_eq!((r.health, r.down_until), (100.0, None));
    assert_sound(&world, &terrain);
    assert!(heal(&mut world, "nobody").is_err());
}

#[test]
fn grow_up_makes_a_child_an_adult_as_if_the_years_had_passed() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    world.tick = 100_000;
    let pick = ResidentPick { age: Some(3.0), ..Default::default() };
    let child = add_resident(&mut world, &terrain, "c1", (5.0, 5.0), &pick).unwrap();
    let tick = world.tick as f64;
    assert!(!can_work(at(&mut world, &child).born_at, tick));
    grow_up(&mut world, &child).unwrap();
    let r = at(&mut world, &child);
    assert!(can_work(r.born_at, tick));
    close(age_in_years(r.born_at, tick), ADULT_AGE);
    assert!(grow_up(&mut world, &child).is_err(), "grown already");
    let grown = world.events.iter().any(
        |e| matches!(&e.what, RealmEventWhat::GrownUp { resident_id, .. } if *resident_id == child),
    );
    assert!(grown, "the realm log says the child has grown up");
    assert_sound(&world, &terrain);
}

#[test]
fn kill_is_a_normal_death_and_a_killed_leader_follows_the_leader_death_rules() {
    // A resident: gone, what they carried on the ground.
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    resident(&mut world, "w2", 5.0, 5.0);
    world.residents[1].city_id = Some("c1".into());
    world.residents[1].carried.insert(Good::Wood, 3.0);
    kill(&mut world, "w2", terrain.size).unwrap();
    assert!(world.residents.iter().all(|r| r.id != "w2"));
    assert!(world.piles.iter().any(|p| p.x == 5.0 && p.y == 5.0));
    assert_eq!(world.realms.len(), 1);
    assert_sound(&world, &terrain);

    // The Leader with an heir: the heir takes over and the realm goes on.
    resident(&mut world, "w3", 6.0, 6.0);
    world.residents[1].city_id = Some("c1".into());
    world.realms[0].heir_id = Some("w3".into());
    kill(&mut world, "w1", terrain.size).unwrap();
    assert_eq!(world.realms[0].leader_id, "w3");
    assert_sound(&world, &terrain);

    // The Leader without one: the realm ends and its city is self-managed.
    let said = kill(&mut world, "w3", terrain.size).unwrap();
    assert!(said.contains("realm has ended"), "{said}");
    assert!(world.realms.is_empty());
    assert!(world.cities[0].realm_id.is_none());
    assert_sound(&world, &terrain);
    assert!(kill(&mut world, "w3", terrain.size).is_err());
}

// ------------------------------------------------------------------------------------- move

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn a_moved_resident_stands_on_the_tile_with_no_way_and_keeps_what_they_carry() {
    let (mut world, terrain, mut orders) = city_world(4.0, 4.0);
    let walk = json!({ "kind": "walkTo", "residentId": "w1", "x": 20, "y": 4 });
    let _ = order(&mut world, &mut orders, &player(7), walk, &terrain);
    assert!(world.residents[0].order.is_some(), "on their way");
    world.residents[0].carried.insert(Good::Wood, 3.0);
    world.residents[0].up = Some(UpSide::Inside);

    let said = move_residents(&mut world, &terrain, &ids(&["w1"]), (15.4, 18.9)).unwrap();
    let r = &world.residents[0];
    assert_eq!((r.x, r.y), (15.0, 18.0));
    assert_eq!(r.order, None, "their way is dropped");
    assert_eq!(r.up, None, "on the ground");
    assert_eq!(r.carried.get(&Good::Wood), Some(&3.0));
    assert!(said.contains("(15, 18)"), "{said}");
    assert_sound(&world, &terrain);
}

#[test]
fn a_group_moves_all_at_once_and_a_riders_horse_comes_along() {
    let (mut world, terrain, _) = city_world(4.0, 4.0);
    resident(&mut world, "w2", 6.0, 6.0);
    let mut rand = csp_sim::random::Mulberry32::new(1.0);
    let fields = csp_sim::horses::NewHorse {
        id: "h1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 6.0,
        y: 6.0,
        tick: 0.0,
    };
    world.horses.push(csp_sim::horses::new_horse(&mut || rand.next(), fields));
    at(&mut world, "w2").riding = Some("h1".into());

    let said = move_residents(&mut world, &terrain, &ids(&["w1", "w2"]), (12.0, 3.0)).unwrap();
    assert_eq!(said, "2 residents stand on (12, 3).");
    for r in &world.residents {
        assert_eq!((r.x, r.y), (12.0, 3.0), "{}", r.id);
    }
    assert_eq!((world.horses[0].x, world.horses[0].y), (12.0, 3.0));
    assert_eq!(at(&mut world, "w2").riding.as_deref(), Some("h1"));
    assert_sound(&world, &terrain);
}

#[test]
fn a_move_refuses_water_without_a_vessel_a_wall_and_off_the_map_and_moves_nobody() {
    let (mut world, mut terrain, _) = city_world(4.0, 4.0);
    let lake = (terrain.size * 8 + 8) as usize;
    terrain.tiles[lake] = Terrain::Lake as u8;
    let mut wall = building("wl", BuildingKind::Wall, 14.0, 14.0);
    wall.city_id = Some("c1".into());
    world.buildings.push(wall);
    resident(&mut world, "w2", 6.0, 6.0);
    let both = ids(&["w1", "w2"]);

    for (to, why) in [
        ((8.0, 8.0), "water without a vessel"),
        ((14.0, 14.0), "wall"),
        ((-1.0, 3.0), "off the map"),
    ] {
        let refused = move_residents(&mut world, &terrain, &both, to).unwrap_err();
        assert!(refused.contains(why), "{refused}");
    }
    assert_eq!(
        move_residents(&mut world, &terrain, &ids(&["w1", "nobody"]), (3.0, 3.0)),
        Err("No such resident.".into())
    );
    assert_eq!((world.residents[0].x, world.residents[1].x), (4.0, 6.0), "nobody moved");
}

#[test]
fn a_move_onto_water_with_a_vessel_of_their_realm_takes_them_aboard() {
    let (mut world, mut terrain, _) = city_world(4.0, 4.0);
    let lake = (terrain.size * 8 + 8) as usize;
    terrain.tiles[lake] = Terrain::Lake as u8;
    let boat = |realm: Option<&str>| Vessel {
        id: "b1".into(),
        kind: VesselKind::Boat,
        realm_id: realm.map(str::to_string),
        x: 8.0,
        y: 8.0,
        load: Stock::new(),
        rower_id: None,
        crew_ids: Vec::new(),
    };
    world.vessels.push(boat(Some("r2")));
    let refused = move_residents(&mut world, &terrain, &ids(&["w1"]), (8.0, 8.0)).unwrap_err();
    assert!(refused.contains("not of the vessel's realm"), "{refused}");

    world.vessels[0] = boat(Some("r1"));
    move_residents(&mut world, &terrain, &ids(&["w1"]), (8.0, 8.0)).unwrap();
    assert_eq!(world.residents[0].aboard.as_deref(), Some("b1"));
    assert_sound(&world, &terrain);
    // And off it again onto land.
    move_residents(&mut world, &terrain, &ids(&["w1"]), (3.0, 3.0)).unwrap();
    assert_eq!(world.residents[0].aboard, None);
    assert_sound(&world, &terrain);
}

// ----------------------------------------------------------------------------------- reveal

#[test]
fn a_reveal_shows_the_whole_world_and_inside_it_and_leaves_the_players_sight_as_it_is() {
    use csp_shared::protocol::SeenEntity;
    use csp_sim::sight::{entities_in_sight, entities_revealed, SightCache};
    use csp_sim::world_index::WorldIndex;

    let terrain = plains(128);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "w1"));
    resident(&mut world, "w1", 4.0, 4.0);
    // Another realm's resident and storage, across the (wrapping) map out of sight.
    world.residents.push(new_resident("far", Some("r2"), 66.0, 66.0));
    let mut storage = building("s2", BuildingKind::Storage, 64.0, 64.0);
    storage.realm_id = Some("r2".into());
    storage.stock = Some(Stock::from([(Good::Wood, 5.0)]));
    world.buildings.push(storage);
    let index = WorldIndex::new(&world, terrain.size);
    let ids = |seen: &[SeenEntity]| seen.iter().map(|e| e.id().to_string()).collect::<Vec<_>>();

    let mut cache = SightCache::open(terrain.size);
    let before = entities_in_sight(&world, &index, Some("r1"), Some(&mut cache));
    assert_eq!(ids(&before), ["w1"]);

    let revealed = entities_revealed(&world, &index, "r1");
    assert_eq!(ids(&revealed), ["w1", "far", "s2"]);
    let inside = revealed.iter().find_map(|e| match e {
        SeenEntity::Building(b) => b.building.stock.clone(),
        _ => None,
    });
    assert_eq!(inside, Some(Stock::from([(Good::Wood, 5.0)])), "inside storages too");
    let fares = revealed.iter().find_map(|e| match e {
        SeenEntity::Resident(r) if r.id == "far" => r.health,
        _ => None,
    });
    assert!(fares.is_some(), "and how everyone fares");

    // The Player's sight, and so what their scripts see, is as it was, cached or not.
    let after = entities_in_sight(&world, &index, Some("r1"), Some(&mut cache));
    assert_eq!(ids(&after), ["w1"]);
    assert_eq!(ids(&entities_in_sight(&world, &index, Some("r1"), None)), ["w1"]);
}
