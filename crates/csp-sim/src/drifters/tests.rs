//! Drifters (`CONTEXT.md`: Drifter): a small Player realm draws one after the wait, out of
//! sight; they walk in and join, or turn away and are gone once unseen.

use csp_shared::balance::{DRIFTER_FOOD, DRIFTER_REALM_CAP, MAX_HEALTH};
use csp_shared::protocol::{DrifterLine, NoDrifterWhy};
use csp_shared::world::{BuildingKind, Good, RealmEventWhat, WorldState};
use serde_json::json;

use super::*;
use crate::game_test_world::Game;
use crate::realm_test_world::plains;
use crate::starting_city::found_starting_city;
use crate::world::create_world;

const USER: u64 = 7;

/// A starting city of Player 7 on a plains map, stepped with walking but without scripts, and
/// only the drifter invariants checked (the rest are the other rules' tests).
fn game() -> Game {
    let terrain = plains(256);
    let mut world = create_world(&terrain, 1);
    found_starting_city(&mut world, &terrain, USER, None);
    let mut game =
        Game::new(world, terrain).checking(&["drifters-sound", "drifters-join-with-room"]);
    game.scripts_run = false;
    game
}

fn realm_id(world: &WorldState) -> String {
    world.realms[0].id.clone()
}

fn city_id(world: &WorldState) -> String {
    world.cities[0].id.clone()
}

/// The realm's wait is one tick from over.
fn wait_almost_over(game: &mut Game) {
    let realm = realm_id(&game.world);
    game.world.drifter_waits.insert(realm, DRIFTER_WAIT_TICKS - 1.0);
}

/// Ticks until a drifter is on the way; their resident id.
fn drifter_sets_out(game: &mut Game) -> String {
    wait_almost_over(game);
    game.tick();
    let d = game.world.drifters.first().expect("a drifter set out").clone();
    d.resident_id
}

/// Whether any Player sees the spot now.
fn in_sight(world: &WorldState, size: i32, x: f64, y: f64) -> bool {
    let index = WorldIndex::new(world, size);
    seen(&players_eyes(world, &index), x, y)
}

/// Ticks until `done` holds, at most `limit` ticks; whether it did.
fn until(game: &mut Game, limit: usize, done: impl Fn(&WorldState) -> bool) -> bool {
    for _ in 0..limit {
        if done(&game.world) {
            return true;
        }
        game.tick();
    }
    done(&game.world)
}

/// Fills the city's housing with grown residents of the realm (leaving them below the cap).
fn fill_housing(game: &mut Game) {
    let (realm, city) = (realm_id(&game.world), city_id(&game.world));
    let template = game.world.residents[0].clone();
    let mut n = 0;
    while free_housing(&game.world, &city) > 0.0 {
        let mut r = template.clone();
        r.id = format!("extra{n}");
        r.name = format!("Extra {n}");
        r.game_name = None;
        r.owner = Some(realm.clone());
        r.city_id = Some(city.clone());
        game.world.residents.push(r);
        n += 1;
    }
    assert!(realm_residents(&game.world, &realm) < DRIFTER_REALM_CAP as usize);
}

#[test]
fn a_drifter_appears_out_of_sight_after_the_wait_walks_in_and_joins() {
    let mut game = game();
    let size = game.terrain.size;
    let realm = realm_id(&game.world);
    // The wait counts a tick at a time while a drifter may come.
    assert!(
        matches!(drifter_outlook(&game.world, &game.world.realms[0]), DrifterOutlook::Next { ticks } if ticks == DRIFTER_WAIT_TICKS)
    );
    game.tick();
    assert_eq!(game.world.drifter_waits.get(&realm), Some(&1.0));
    assert!(game.world.drifters.is_empty());

    let id = drifter_sets_out(&mut game);
    let r = game.r(&id).clone();
    assert_eq!((r.owner.as_deref(), r.city_id.as_deref()), (None, None));
    assert_eq!(
        r.carried,
        [(Good::Food, DRIFTER_FOOD)].into_iter().collect::<csp_shared::world::Stock>()
    );
    assert_eq!(r.game_name, Some(true));
    assert!(r.equipped.is_empty());
    assert!(!in_sight(&game.world, size, r.x, r.y), "came into being in sight");
    let hall = town_hall_of(&game.world, &game.world.cities[0]).unwrap();
    let far = wrap_distance(size, (hall.x as i32, hall.y as i32), (r.x as i32, r.y as i32));
    assert!((DRIFTER_DISTANCE_MIN..=DRIFTER_DISTANCE_MAX).contains(&far), "{far} tiles off");
    // One at a time: the next wait begins only once they are there.
    assert_eq!(drifter_outlook(&game.world, &game.world.realms[0]), DrifterOutlook::OnTheWay);
    assert!(!game.world.drifter_waits.contains_key(&realm));

    let city = city_id(&game.world);
    assert!(until(&mut game, 3000, |w| w
        .residents
        .iter()
        .any(|r| r.id == id && r.owner.is_some())));
    let r = game.r(&id);
    assert_eq!(
        (r.owner.as_deref(), r.city_id.as_deref()),
        (Some(realm.as_str()), Some(city.as_str()))
    );
    assert!(r.order.is_none(), "stands idle");
    assert!(game.world.drifters.is_empty());
    let named = game.world.events.iter().any(|e| {
        matches!(&e.what, RealmEventWhat::DrifterJoined { resident_id, name, .. } if *resident_id == id && *name == r.name)
            && e.user_id == USER
    });
    assert!(named, "the realm log names them");
    // The next wait began on the tick they joined.
    assert_eq!(game.world.drifter_waits.get(&realm), Some(&1.0));
}

#[test]
fn a_drifter_gets_a_name_no_resident_of_the_realm_has() {
    let mut game = game();
    let id = drifter_sets_out(&mut game);
    let realm = realm_id(&game.world);
    let name = game.r(&id).name.clone();
    assert!(!game
        .world
        .residents
        .iter()
        .any(|r| r.id != id && r.owner.as_deref() == Some(realm.as_str()) && r.name == name));
}

#[test]
fn none_comes_without_free_housing_a_food_surplus_a_living_leader_or_below_the_cap() {
    let realm_of = |g: &Game| g.world.realms[0].clone();
    let outlook = |g: &Game| drifter_outlook(&g.world, &realm_of(g));

    // No free housing.
    let mut g = game();
    fill_housing(&mut g);
    assert_eq!(outlook(&g), DrifterOutlook::None(NoDrifter::NoFreeHousing));

    // No food surplus.
    let mut g = game();
    for b in g.world.buildings.iter_mut().filter(|b| b.kind == BuildingKind::Storage) {
        b.stock = None;
    }
    assert_eq!(outlook(&g), DrifterOutlook::None(NoDrifter::NoFoodSurplus));

    // At the cap.
    let mut g = game();
    let template = g.world.residents[0].clone();
    for n in 0..(DRIFTER_REALM_CAP as usize - realm_residents(&g.world, &realm_id(&g.world))) {
        let mut r = template.clone();
        r.id = format!("extra{n}");
        r.name = format!("Extra {n}");
        r.game_name = None;
        r.city_id = None;
        g.world.residents.push(r);
    }
    assert_eq!(outlook(&g), DrifterOutlook::None(NoDrifter::RealmTooBig));

    // Without a living Leader.
    let mut g = game();
    let leader = realm_of(&g).leader_id;
    g.world.residents.retain(|r| r.id != leader);
    assert_eq!(outlook(&g), DrifterOutlook::None(NoDrifter::NoLeaderCity));

    // None of them waits or draws one, however long: the wait counts only while one may come.
    for setup in [0, 1] {
        let mut g = game();
        if setup == 0 {
            fill_housing(&mut g);
        } else {
            for b in g.world.buildings.iter_mut().filter(|b| b.kind == BuildingKind::Storage) {
                b.stock = None;
            }
        }
        wait_almost_over(&mut g);
        g.run(3);
        assert!(g.world.drifters.is_empty());
        assert_eq!(
            g.world.drifter_waits.get(&realm_id(&g.world)),
            Some(&(DRIFTER_WAIT_TICKS - 1.0))
        );
    }
}

#[test]
fn an_npc_city_or_a_second_city_draws_none() {
    // A city of no realm (an NPC city, a self-managed one) has no Leader to draw one.
    let mut g = game();
    g.world.cities[0].realm_id = None;
    let realm = realm_of_world(&g.world);
    g.world.realms.clear();
    g.world.drifter_waits.insert(realm, DRIFTER_WAIT_TICKS - 1.0);
    g.run(2);
    assert!(g.world.drifters.is_empty());
    assert!(g.world.drifter_waits.is_empty(), "a realm that is gone waits no more");

    // The Leader living in no city of the realm: their city is the only one that draws.
    let mut g = game();
    let leader = g.world.realms[0].leader_id.clone();
    g.world.residents.iter_mut().find(|r| r.id == leader).unwrap().city_id = None;
    assert_eq!(
        drifter_outlook(&g.world, &g.world.realms[0]),
        DrifterOutlook::None(NoDrifter::NoLeaderCity)
    );
}

fn realm_of_world(world: &WorldState) -> String {
    realm_id(world)
}

#[test]
fn one_who_arrives_too_late_turns_away_and_is_gone_once_unseen() {
    let mut g = game();
    let size = g.terrain.size;
    let id = drifter_sets_out(&mut g);
    // The houses fill while they walk.
    fill_housing(&mut g);
    assert!(until(&mut g, 3000, |w| w.drifters.first().is_some_and(|d| d.turned_away)));
    let r = g.r(&id);
    assert!(r.owner.is_none() && r.city_id.is_none(), "joins nobody");
    assert!(in_sight(&g.world, size, r.x, r.y), "turns at the city, in sight");
    assert!(!g.world.events.iter().any(|e| matches!(e.what, RealmEventWhat::DrifterJoined { .. })));
    // They walk off, kept after each tick only while someone sees them, and are gone once nobody
    // does.
    for _ in 0..3000 {
        let Some(r) = g.world.residents.iter().find(|r| r.id == id) else { break };
        assert!(in_sight(&g.world, size, r.x, r.y), "kept out of sight at {}, {}", r.x, r.y);
        g.tick();
    }
    assert!(g.world.residents.iter().all(|r| r.id != id), "gone");
    assert!(g.world.drifters.is_empty());
}

#[test]
fn a_drifter_killed_on_the_way_is_no_crime_and_the_next_comes_after_the_wait() {
    let mut g = game();
    let id = drifter_sets_out(&mut g);
    let realm = realm_id(&g.world);
    // A resident of the realm stands next to them and strikes.
    let (x, y) = (g.r(&id).x, g.r(&id).y);
    let killer =
        g.world.residents.iter().find(|r| r.carried.contains_key(&Good::Spear)).unwrap().id.clone();
    {
        let k = g.r_mut(&killer);
        k.x = x;
        k.y = y;
        k.order = None;
    }
    g.r_mut(&id).health = 1.0;
    g.r_mut(&id).order = None;
    assert_eq!(
        g.order(USER, json!({ "kind": "attack", "residentId": killer, "targetId": id })),
        "ack"
    );
    assert!(until(&mut g, 300, |w| w.residents.iter().all(|r| r.id != id)), "killed");
    assert!(g.world.crimes.is_empty(), "no crime");
    assert!(g.world.drifters.is_empty());
    assert!(g.r(&killer).health == MAX_HEALTH || g.r(&killer).health > 0.0);
    // The next wait began when they set out; it counts again now and runs its full length.
    assert_eq!(g.world.drifter_waits.get(&realm), Some(&1.0));
    assert!(
        matches!(drifter_outlook(&g.world, &g.world.realms[0]), DrifterOutlook::Next { ticks } if ticks == DRIFTER_WAIT_TICKS - 1.0)
    );
    wait_almost_over(&mut g);
    g.tick();
    assert_eq!(g.world.drifters.len(), 1, "the next one sets out after the wait");
}

#[test]
fn the_invariants_catch_two_drifters_for_a_realm_and_one_who_belongs_to_someone() {
    let mut g = game();
    let id = drifter_sets_out(&mut g);
    let mut d = g.world.drifters[0].clone();
    assert_eq!(drifters_sound(&g.world, &g.terrain), vec![]);
    d.resident_id = g.world.residents[0].id.clone();
    g.world.drifters.push(d);
    let names: Vec<String> =
        drifters_sound(&g.world, &g.terrain).into_iter().map(|v| v.message).collect();
    assert!(names.iter().any(|m| m.contains("two drifters")), "{names:?}");
    assert!(names.iter().any(|m| m.contains("belongs to an Organization")), "{names:?}");
    let _ = id;
}

#[test]
fn the_invariant_catches_a_drifter_who_joined_a_full_city() {
    let mut g = game();
    fill_housing(&mut g);
    let city = city_id(&g.world);
    let realm = realm_id(&g.world);
    let mut r = g.world.residents[0].clone();
    r.id = "late".into();
    r.owner = Some(realm.clone());
    r.city_id = Some(city);
    g.world.residents.push(r);
    let what = RealmEventWhat::DrifterJoined {
        resident_id: "late".into(),
        name: "Late".into(),
        city: "c".into(),
        x: 0.0,
        y: 0.0,
    };
    crate::events::record_event(&mut g.world, Some(&realm), what);
    let found = drifters_join_with_room(&g.world, &g.terrain);
    assert_eq!(found.len(), 1, "{found:?}");
}

/// The drifter line `side` sees on the realm's city, if it sees one there at all.
fn line_seen_by(world: &WorldState, size: i32, side: &str) -> Option<DrifterLine> {
    let index = WorldIndex::new(world, size);
    let city = world.cities[0].id.clone();
    crate::sight::entities_in_sight(world, &index, Some(side), None).iter().find_map(|e| match e {
        csp_shared::protocol::SeenEntity::City(c) if c.city.id == city => c.drifters,
        _ => None,
    })
}

#[test]
fn the_leaders_city_shows_its_player_whether_drifters_come_and_nobody_else() {
    let mut g = game();
    let size = g.terrain.size;
    let realm = realm_id(&g.world);
    assert_eq!(
        line_seen_by(&g.world, size, &realm),
        Some(DrifterLine::Coming { ticks: DRIFTER_WAIT_TICKS })
    );
    g.tick();
    assert_eq!(
        line_seen_by(&g.world, size, &realm),
        Some(DrifterLine::Coming { ticks: DRIFTER_WAIT_TICKS - 1.0 })
    );
    drifter_sets_out(&mut g);
    assert_eq!(line_seen_by(&g.world, size, &realm), Some(DrifterLine::OnTheWay));

    // Each reason none comes.
    let mut g = game();
    fill_housing(&mut g);
    let why = |why| Some(DrifterLine::None { why });
    assert_eq!(line_seen_by(&g.world, size, &realm), why(NoDrifterWhy::NoFreeHousing));
    let mut g = game();
    for b in g.world.buildings.iter_mut().filter(|b| b.kind == BuildingKind::Storage) {
        b.stock = None;
    }
    assert_eq!(line_seen_by(&g.world, size, &realm), why(NoDrifterWhy::NoFoodSurplus));
    let mut g = game();
    let template = g.world.residents[0].clone();
    for n in 0..DRIFTER_REALM_CAP as usize {
        let mut r = template.clone();
        r.id = format!("extra{n}");
        r.city_id = None;
        g.world.residents.push(r);
    }
    assert_eq!(line_seen_by(&g.world, size, &realm), why(NoDrifterWhy::RealmTooBig));

    // Another Player standing in the city sees no line; nor does the realm on a city its Leader
    // doesn't live in.
    let mut g = game();
    found_starting_city(&mut g.world, &g.terrain, 8, None);
    let other = g.world.realms.iter().find(|r| r.user_id == 8).unwrap().id.clone();
    let hall = town_hall_of(&g.world, &g.world.cities[0]).unwrap().clone();
    let theirs =
        g.world.residents.iter().position(|r| r.owner.as_deref() == Some(other.as_str())).unwrap();
    g.world.residents[theirs].x = hall.x;
    g.world.residents[theirs].y = hall.y;
    let index = WorldIndex::new(&g.world, size);
    let sees_city = crate::sight::entities_in_sight(&g.world, &index, Some(&other), None)
        .iter()
        .any(|e| matches!(e, csp_shared::protocol::SeenEntity::City(c) if c.city.id == g.world.cities[0].id));
    assert!(sees_city);
    assert_eq!(line_seen_by(&g.world, size, &other), None);
    let leader = g.world.realms[0].leader_id.clone();
    g.world.residents.iter_mut().find(|r| r.id == leader).unwrap().city_id = None;
    assert_eq!(line_seen_by(&g.world, size, &realm), None);
}
