//! `apps/server/src/relocating.test.ts`, ported one to one. Walking is T86.4's, so "walks there"
//! is the resident set down on the order's target before `step_relocating` runs, as the walk
//! would bring them; `untilDone` is then one step. The invariants are T86.13's.

use csp_shared::balance::HOUSING_ROOM;
use csp_shared::terrain::{terrain_at, wrap_distance, Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, Carrying, Pair, RealmEventWhat, ResidentOrder, WorldState};

use super::*;
use crate::cities::dissolve_city;
use crate::order_sender::{Account, OrderSender};
use crate::placing::Ground;
use crate::queries::city_area::{city_area_tiles, free_housing, in_city_area};
use crate::queries::people::{relocate_problem, relocate_room, CARRYING_A_CHILD};
use crate::random::Mulberry32;
use crate::residents::{base_stats, new_resident, NewResident};
use crate::test_world::{add_city, building, city_terrain, live, live_mut, world_with_city};

const ME: OrderSender = OrderSender {
    user_id: 1,
    account: Account { name: String::new(), is_admin: false },
    npc_city_id: None,
};
const STRANGER: OrderSender = OrderSender {
    user_id: 2,
    account: Account { name: String::new(), is_admin: false },
    npc_city_id: None,
};

/// A free Plains tile at least `far` tiles from every building, near home (`freePlains`).
fn free_plains(world: &WorldState, terrain: &TerrainMap, far: f64) -> (f64, f64) {
    let size = terrain.size;
    let home = world.buildings.iter().find(|b| b.kind == BuildingKind::TownHall).unwrap();
    let (hx, hy) = (home.x as i32, home.y as i32);
    let mut taken: std::collections::HashSet<(i32, i32)> =
        world.buildings.iter().map(|b| (b.x as i32, b.y as i32)).collect();
    taken.extend(world.nodes.iter().map(|n| (n.x as i32, n.y as i32)));
    let mut best: Option<(i32, i32)> = None;
    for y in hy - 80..hy + 80 {
        for x in hx - 80..hx + 80 {
            let t = ((x + size) % size, (y + size) % size);
            if taken.contains(&t) {
                continue;
            }
            let plains = (0..3).all(|dy| {
                (0..3).all(|dx| terrain_at(terrain, t.0 + dx, t.1 + dy) == Terrain::Plains as u8)
            });
            if !plains
                || !world
                    .buildings
                    .iter()
                    .all(|b| wrap_distance(size, (b.x as i32, b.y as i32), t) >= far)
            {
                continue;
            }
            if best
                .is_none_or(|b| wrap_distance(size, (hx, hy), t) < wrap_distance(size, (hx, hy), b))
            {
                best = Some(t);
            }
        }
    }
    let b = best.expect("free Plains");
    (f64::from(b.0), f64::from(b.1))
}

/// Adds `n` finished houses to a city where they fit in its area (`addHouses`).
fn add_houses(world: &mut WorldState, city: &str, n: usize) {
    let terrain = city_terrain();
    for _ in 0..n {
        let free = city_area_tiles(world, city, terrain.size)
            .into_iter()
            .find(|&(x, y)| Ground::new(world, terrain, []).fits(BuildingKind::House, x, y, None))
            .expect("a free tile in the city");
        building(
            world,
            &format!("h{},{}", free.0, free.1),
            BuildingKind::House,
            Some(city),
            f64::from(free.0),
            f64::from(free.1),
        );
    }
}

/// Player 1's starting city and a second city of their realm, Redbank, with `houses` houses and
/// nobody living there; Ana is a resident of the first who isn't the Leader.
struct Setup {
    world: WorldState,
    first: String,
    second: String,
    ana: String,
}

fn setup(houses: usize) -> Setup {
    let mut world = world_with_city();
    let realm = world.realms[0].clone();
    let first = world.cities[0].id.clone();
    let at = free_plains(&world, city_terrain(), 16.0);
    add_city(&mut world, "city-second", Some(&realm.id), at.0, at.1, None);
    world.cities.last_mut().unwrap().name = "Redbank".into();
    add_houses(&mut world, "city-second", houses);
    let ana = world
        .residents
        .iter_mut()
        .find(|r| r.id != realm.leader_id && r.city_id.as_deref() == Some(first.as_str()))
        .unwrap();
    ana.name = "Ana".into();
    let ana = ana.id.clone();
    Setup { world, first, second: "city-second".into(), ana }
}

fn relocate_by(
    world: &mut WorldState,
    r: &str,
    city: &str,
    sender: &OrderSender,
) -> Option<String> {
    let o =
        RelocateRequest { resident_id: Some(r.into()), city_id: Some(city.into()), group: None };
    let reason = validate_relocate(world, sender, &o);
    if reason.is_none() {
        apply_relocate(world, &o, Some(city_terrain()));
    }
    reason
}

fn relocate(world: &mut WorldState, r: &str, city: &str) -> Option<String> {
    relocate_by(world, r, city, &ME)
}

/// The resident's walk brings them to their order's target, and the tick's relocating runs.
fn until_done(world: &mut WorldState, r: &str) {
    if let Some(ResidentOrder::Relocate(o)) = live(world, r).unwrap().order.clone() {
        let me = live_mut(world, r);
        me.x = o.target.x;
        me.y = o.target.y;
    }
    step_relocating(world, city_terrain());
    assert!(
        !matches!(live(world, r).unwrap().order, Some(ResidentOrder::Relocate(_))),
        "{r} still relocating"
    );
}

fn carry_child(world: &mut WorldState, r: &str, partner: &str) {
    let p = live(world, partner).unwrap();
    let carrying = Carrying {
        since: 0.0,
        partner_id: p.id.clone(),
        partner_name: p.name.clone(),
        partner_base: base_stats(p),
    };
    live_mut(world, r).carrying = Some(carrying);
}

/// Another resident of the realm, living in `city` (or homeless), standing at (x, y).
fn add_resident(world: &mut WorldState, id: &str, city: Option<&str>, x: f64, y: f64) {
    let realm = world.realms[0].id.clone();
    let place = NewResident { id, owner: Some(&realm), city_id: city, x, y, tick: 0.0 };
    let mut m = Mulberry32::new(id.len() as f64);
    let r = new_resident(&mut || m.next(), &place, None);
    world.residents.push(r);
}

fn hall_of(world: &WorldState, city: &str) -> (f64, f64) {
    let c = world.cities.iter().find(|c| c.id == city).unwrap();
    let h = crate::queries::city::town_hall_of(world, c).unwrap();
    (h.x, h.y)
}

fn other_of_first(world: &WorldState, ana: &str, first: &str) -> String {
    world
        .residents
        .iter()
        .find(|r| r.id != ana && r.city_id.as_deref() == Some(first))
        .unwrap()
        .id
        .clone()
}

#[test]
fn heads_for_the_nearest_tile_of_the_citys_area() {
    let Setup { mut world, second, ana, .. } = setup(1);
    let terrain = city_terrain();
    assert_eq!(relocate(&mut world, &ana, &second), None);
    let Some(ResidentOrder::Relocate(o)) = live(&world, &ana).unwrap().order.clone() else {
        panic!("relocating")
    };
    assert_eq!(o.city_id, second);
    assert!(in_city_area(&world, &second, o.target.x, o.target.y, terrain.size));
    let a = live(&world, &ana).unwrap();
    let from = (a.x as i32, a.y as i32);
    let d = wrap_distance(terrain.size, from, (o.target.x as i32, o.target.y as i32));
    for (x, y) in city_area_tiles(&world, &second, terrain.size) {
        let t = terrain_at(terrain, x, y);
        if t == Terrain::Lake as u8 || t == Terrain::Sea as u8 {
            continue;
        }
        assert!(wrap_distance(terrain.size, from, (x, y)) >= d - 1e-9);
    }
}

#[test]
fn turns_it_down_for_someone_elses_resident_or_an_npc_citys() {
    let Setup { mut world, second, ana, .. } = setup(1);
    let before = live(&world, &ana).unwrap().order.clone();
    assert_eq!(
        relocate_by(&mut world, &ana, &second, &STRANGER).as_deref(),
        Some("not one of your residents")
    );
    add_city(&mut world, "npc", None, 0.0, 0.0, None);
    let npc = OrderSender {
        user_id: 0,
        account: Account { name: String::new(), is_admin: false },
        npc_city_id: Some("npc".into()),
    };
    assert_eq!(
        relocate_by(&mut world, &ana, &second, &npc).as_deref(),
        Some("not one of your residents")
    );
    assert_eq!(live(&world, &ana).unwrap().order, before);
}

#[test]
fn turns_it_down_for_a_city_that_isnt_the_realms_or_their_own() {
    let Setup { mut world, first, second, ana } = setup(1);
    add_city(&mut world, "npc", None, 0.0, 0.0, None);
    assert_eq!(relocate(&mut world, &ana, "npc").as_deref(), Some("not a city of your realm"));
    world.cities.iter_mut().find(|c| c.id == second).unwrap().realm_id =
        Some("someone-else".into());
    assert_eq!(relocate(&mut world, &ana, &second).as_deref(), Some("not a city of your realm"));
    let first_name = world.cities.iter().find(|c| c.id == first).unwrap().name.clone();
    assert_eq!(
        relocate(&mut world, &ana, &first),
        Some(format!("Ana already lives in {first_name}"))
    );
    let o = RelocateRequest { resident_id: Some(ana.clone()), city_id: None, group: None };
    assert_eq!(validate_relocate(&world, &ME, &o).as_deref(), Some("not a city of your realm"));
}

#[test]
fn turns_it_down_for_a_city_with_no_free_housing() {
    let Setup { mut world, second, ana, .. } = setup(0);
    assert_eq!(free_housing(&world, &second), 0.0);
    assert_eq!(relocate(&mut world, &ana, &second).as_deref(), Some("no free housing"));
}

#[test]
fn counts_the_residents_already_relocating_there_against_its_free_housing() {
    let Setup { mut world, first, second, ana } = setup(1);
    let room = HOUSING_ROOM.get("house").unwrap() as usize;
    let hall = hall_of(&world, &first);
    let others: Vec<String> = (0..room).map(|i| format!("mover{i}")).collect();
    for id in &others {
        add_resident(&mut world, id, Some(&first), hall.0, hall.1);
    }
    for id in &others {
        assert_eq!(relocate(&mut world, id, &second), None);
    }
    assert_eq!(relocate_room(&world, &second, &Default::default()), 0.0);
    assert_eq!(relocate(&mut world, &ana, &second).as_deref(), Some("no free housing"));
    // One of them told again counts once.
    assert_eq!(relocate(&mut world, &others[0], &second), None);
    // A group needs room for all.
    live_mut(&mut world, &others[0]).order = None;
    let realm = world.realms[0].id.clone();
    let pair = [live(&world, &others[0]).unwrap(), live(&world, &ana).unwrap()];
    assert_eq!(
        relocate_problem(&world, &realm, &pair, Some(&second)).as_deref(),
        Some("free housing for 1 only")
    );
}

#[test]
fn turns_it_down_for_a_partner_carrying_a_child() {
    let Setup { mut world, first, second, ana } = setup(1);
    let partner = other_of_first(&world, &ana, &first);
    carry_child(&mut world, &ana, &partner);
    assert_eq!(relocate(&mut world, &ana, &second), Some(format!("Ana is {CARRYING_A_CHILD}")));
}

#[test]
fn walks_there_and_moves_in_on_stepping_into_its_area_free_housing_changing_in_both_cities() {
    let Setup { mut world, first, second, ana } = setup(1);
    let (free_first, free_second) = (free_housing(&world, &first), free_housing(&world, &second));
    relocate(&mut world, &ana, &second);
    until_done(&mut world, &ana);
    let a = live(&world, &ana).unwrap();
    assert_eq!(a.city_id.as_deref(), Some(second.as_str()));
    assert_eq!(a.order, None);
    assert!(in_city_area(&world, &second, a.x, a.y, city_terrain().size));
    assert_eq!(free_housing(&world, &first), free_first + 1.0);
    assert_eq!(free_housing(&world, &second), free_second - 1.0);
}

#[test]
fn moves_in_at_once_when_already_in_its_area() {
    let Setup { mut world, second, ana, .. } = setup(1);
    let hall = hall_of(&world, &second);
    let a = live_mut(&mut world, &ana);
    a.x = hall.0 - 1.0;
    a.y = hall.1;
    relocate(&mut world, &ana, &second);
    step_relocating(&mut world, city_terrain());
    assert_eq!(live(&world, &ana).unwrap().city_id.as_deref(), Some(second.as_str()));
}

#[test]
fn gives_a_homeless_resident_a_home() {
    let Setup { mut world, first, second, .. } = setup(1);
    let hall = hall_of(&world, &first);
    add_resident(&mut world, "homeless", None, hall.0, hall.1);
    relocate(&mut world, "homeless", &second);
    until_done(&mut world, "homeless");
    assert_eq!(live(&world, "homeless").unwrap().city_id.as_deref(), Some(second.as_str()));
}

#[test]
fn ends_a_pair_on_both_partners() {
    let Setup { mut world, first, second, ana } = setup(1);
    let partner = other_of_first(&world, &ana, &first);
    let since = world.tick as f64;
    live_mut(&mut world, &ana).pair = Some(Pair { partner_id: partner.clone(), since });
    live_mut(&mut world, &partner).pair = Some(Pair { partner_id: ana.clone(), since });
    relocate(&mut world, &ana, &second);
    until_done(&mut world, &ana);
    assert_eq!(live(&world, &ana).unwrap().city_id.as_deref(), Some(second.as_str()));
    assert_eq!(
        (live(&world, &ana).unwrap().pair.clone(), live(&world, &partner).unwrap().pair.clone()),
        (None, None)
    );
}

#[test]
fn ends_a_pair_whose_other_partner_carries_the_child_who_goes_on_carrying_it() {
    let Setup { mut world, first, second, ana } = setup(1);
    let carrier = other_of_first(&world, &ana, &first);
    let since = world.tick as f64;
    live_mut(&mut world, &ana).pair = Some(Pair { partner_id: carrier.clone(), since });
    live_mut(&mut world, &carrier).pair = Some(Pair { partner_id: ana.clone(), since });
    carry_child(&mut world, &carrier, &ana);
    // The carrier can't be told to relocate; Ana can.
    assert!(relocate(&mut world, &carrier, &second).is_some());
    assert_eq!(relocate(&mut world, &ana, &second), None);
    until_done(&mut world, &ana);
    let (a, c) = (live(&world, &ana).unwrap(), live(&world, &carrier).unwrap());
    assert_eq!(a.city_id.as_deref(), Some(second.as_str()));
    assert_eq!(c.city_id.as_deref(), Some(first.as_str()));
    assert_eq!((a.pair.clone(), c.pair.clone()), (None, None));
    assert_eq!(c.carrying.as_ref().map(|x| x.partner_id.as_str()), Some(ana.as_str()));
}

/// Each of `group` told to relocate to `city` as one group; the answers.
fn relocate_group(world: &mut WorldState, group: &[String], city: &str) -> Vec<Option<String>> {
    group
        .iter()
        .map(|id| {
            let o = RelocateRequest {
                resident_id: Some(id.clone()),
                city_id: Some(city.into()),
                group: Some(Some(group.to_vec())),
            };
            validate_relocate(world, &ME, &o)
        })
        .collect()
}

fn apply_group(world: &mut WorldState, group: &[String], city: &str) {
    for id in group {
        let o = RelocateRequest {
            resident_id: Some(id.clone()),
            city_id: Some(city.into()),
            group: Some(Some(group.to_vec())),
        };
        apply_relocate(world, &o, Some(city_terrain()));
    }
}

/// Ana and two more of the first city, all standing at `at`.
fn three_of(world: &mut WorldState, ana: &str, at: (f64, f64)) -> Vec<String> {
    let city = live(world, ana).unwrap().city_id.clone();
    add_resident(world, "bo", city.as_deref(), at.0, at.1);
    add_resident(world, "cy", city.as_deref(), at.0, at.1);
    let a = live_mut(world, ana);
    a.x = at.0;
    a.y = at.1;
    vec![ana.to_string(), "bo".into(), "cy".into()]
}

#[test]
fn turns_all_of_them_down_when_the_city_has_no_room_for_the_whole_group() {
    let Setup { mut world, first, second, ana } = setup(1);
    let at = hall_of(&world, &first);
    let group = three_of(&mut world, &ana, at);
    // Room for two of the three.
    let hall = hall_of(&world, &second);
    for i in 0..HOUSING_ROOM.get("house").unwrap() as usize - 2 {
        add_resident(&mut world, &format!("settler{i}"), Some(&second), hall.0, hall.1);
    }
    assert_eq!(relocate_room(&world, &second, &Default::default()), 2.0);
    assert_eq!(
        relocate_group(&mut world, &group, &second),
        vec![Some("free housing for 2 only".to_string()); 3]
    );
    assert!(group
        .iter()
        .all(|id| !matches!(live(&world, id).unwrap().order, Some(ResidentOrder::Relocate(_)))));
}

#[test]
fn turns_all_of_them_down_when_one_of_them_carries_a_child_or_lives_there() {
    let Setup { mut world, first, second, ana } = setup(1);
    let at = hall_of(&world, &first);
    let group = three_of(&mut world, &ana, at);
    carry_child(&mut world, &group[1], &ana);
    assert!(relocate_group(&mut world, &group, &second).iter().all(Option::is_some));
    live_mut(&mut world, &group[1]).carrying = None;
    live_mut(&mut world, &group[2]).city_id = Some(second.clone());
    let name = live(&world, &group[2]).unwrap().name.clone();
    assert_eq!(
        relocate_group(&mut world, &group, &second),
        vec![Some(format!("{name} already lives in Redbank")); 3]
    );
}

#[test]
fn turns_it_down_for_a_group_naming_someone_the_sender_may_not_order_or_not_naming_them() {
    let Setup { mut world, first, second, ana } = setup(1);
    let hall = hall_of(&world, &first);
    add_resident(&mut world, "bo", Some(&first), hall.0, hall.1);
    let send = |world: &WorldState, group: Option<Vec<String>>| {
        let o = RelocateRequest {
            resident_id: Some(ana.clone()),
            city_id: Some(second.clone()),
            group: Some(group),
        };
        validate_relocate(world, &ME, &o)
    };
    let owner = live(&world, &ana).unwrap().owner.clone();
    live_mut(&mut world, "bo").owner = Some("realm-other".into());
    let not_yours = Some("not one of your residents".to_string());
    assert_eq!(send(&world, Some(vec![ana.clone(), "bo".into()])), not_yours);
    live_mut(&mut world, "bo").owner = owner;
    assert_eq!(send(&world, Some(vec!["bo".into()])), not_yours);
    assert_eq!(send(&world, Some(vec![ana.clone(), ana.clone()])), not_yours);
    assert_eq!(send(&world, None), not_yours);
    assert_eq!(send(&world, Some(vec![ana.clone(), "bo".into()])), None);
}

#[test]
fn moves_them_in_while_room_lasts_on_arrival_the_rest_keep_their_city_with_a_log_line() {
    let Setup { mut world, first, second, ana } = setup(1);
    // All three in its area already, so they arrive on the same tick.
    let hall = hall_of(&world, &second);
    let group = three_of(&mut world, &ana, (hall.0 - 1.0, hall.1));
    assert!(relocate_group(&mut world, &group, &second).iter().all(Option::is_none));
    apply_group(&mut world, &group, &second);
    // Housing taken since: room for one of them is left.
    for i in 0..HOUSING_ROOM.get("house").unwrap() as usize - 1 {
        add_resident(&mut world, &format!("settler{i}"), Some(&second), hall.0, hall.1);
    }
    step_relocating(&mut world, city_terrain());
    let cities: Vec<Option<String>> =
        group.iter().map(|id| live(&world, id).unwrap().city_id.clone()).collect();
    assert_eq!(cities, vec![Some(second.clone()), Some(first.clone()), Some(first.clone())]);
    assert!(group.iter().all(|id| live(&world, id).unwrap().order.is_none()));
    let failed: Vec<(String, Option<String>, String)> = world
        .events
        .iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::RelocateFailed { name, city, reason, .. } => {
                Some((name.clone(), city.clone(), reason.clone()))
            }
            _ => None,
        })
        .collect();
    let expected: Vec<_> = group[1..]
        .iter()
        .map(|id| {
            (
                live(&world, id).unwrap().name.clone(),
                Some("Redbank".to_string()),
                "no free housing".to_string(),
            )
        })
        .collect();
    assert_eq!(failed, expected);
    assert_eq!(free_housing(&world, &second), 0.0);
}

fn failed(world: &WorldState) -> Vec<&RealmEventWhat> {
    world
        .events
        .iter()
        .map(|e| &e.what)
        .filter(|w| matches!(w, RealmEventWhat::RelocateFailed { .. }))
        .collect()
}

#[test]
fn stops_when_the_free_housing_is_gone_on_arrival_keeping_their_old_city() {
    let Setup { mut world, first, second, ana } = setup(1);
    relocate(&mut world, &ana, &second);
    // Someone moves in first and fills the house.
    let hall = hall_of(&world, &second);
    for i in 0..HOUSING_ROOM.get("house").unwrap() as usize {
        add_resident(&mut world, &format!("settler{i}"), Some(&second), hall.0, hall.1);
    }
    until_done(&mut world, &ana);
    assert_eq!(live(&world, &ana).unwrap().city_id.as_deref(), Some(first.as_str()));
    assert_eq!(live(&world, &ana).unwrap().order, None);
    assert!(
        matches!(failed(&world).as_slice(), [RealmEventWhat::RelocateFailed { name, city: Some(c), city_id, reason, .. }]
        if name == "Ana" && c == "Redbank" && *city_id == second && reason == "no free housing")
    );
}

#[test]
fn stops_when_the_city_changed_hands_on_the_way() {
    let Setup { mut world, first, second, ana } = setup(1);
    relocate(&mut world, &ana, &second);
    let mut other = world.realms[0].clone();
    other.id = "realm-other".into();
    other.user_id = 2;
    other.leader_id = "nobody".into();
    world.realms.push(other);
    world.cities.iter_mut().find(|c| c.id == second).unwrap().realm_id = Some("realm-other".into());
    until_done(&mut world, &ana);
    assert_eq!(live(&world, &ana).unwrap().city_id.as_deref(), Some(first.as_str()));
    assert!(
        matches!(failed(&world).as_slice(), [RealmEventWhat::RelocateFailed { name, city: Some(c), reason, .. }]
        if name == "Ana" && c == "Redbank" && reason == "it is no longer your realm’s")
    );
}

#[test]
fn stops_when_the_city_is_gone() {
    let Setup { mut world, first, second, ana } = setup(1);
    relocate(&mut world, &ana, &second);
    dissolve_city(&mut world, &second);
    step_relocating(&mut world, city_terrain());
    assert_eq!(live(&world, &ana).unwrap().city_id.as_deref(), Some(first.as_str()));
    assert!(
        matches!(failed(&world).as_slice(), [RealmEventWhat::RelocateFailed { name, city: None, reason, .. }]
        if name == "Ana" && reason == "the city is gone")
    );
}

// `relocating invariants` (`residentsInCities`, `npcCityResidentsUnowned`,
// `cityResidentsInItsRealm`, `relocateOrdersSound`) are `invariants.ts`'s: T86.13.
