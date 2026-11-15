use std::sync::OnceLock;

use csp_shared::world::{Building, RealmEventWhat};

use super::*;
use crate::starting_city::{found_starting_city_in, realm_of};
use crate::starting_sites::SiteRules;
use crate::test_support::new_land;

/// A generated world on `new_land` with nobody in it yet, and its regions: made once, cloned.
fn fresh() -> (WorldState, &'static TerrainMap, &'static Regions) {
    static WORLD: OnceLock<(WorldState, Regions)> = OnceLock::new();
    let terrain = new_land();
    let (world, regions) =
        WORLD.get_or_init(|| (crate::world::generate_world(terrain, 1), Regions::of(1, terrain)));
    (world.clone(), terrain, regions)
}

fn found(world: &mut WorldState, terrain: &TerrainMap, regions: &Regions, user: u64) -> StartPlace {
    let (_, place) = found_starting_city_in(world, terrain, regions, user, None);
    let place = place.expect("a world with starting sites says where the city went");
    assert_eq!(starting_sites_sound(world), [], "after Player {user} founded");
    place
}

fn site_of(place: StartPlace) -> (usize, u32) {
    match place {
        StartPlace::Site { site, heartland } => (site, heartland),
        StartPlace::WorldFull { .. } => panic!("a site was free"),
    }
}

/// The town hall of the Player's starting city.
fn hall(world: &WorldState, user: u64) -> (f64, f64) {
    let realm = &world.realms[realm_of(world, user).expect("founded")];
    let city = world.cities.iter().find(|c| c.realm_id.as_ref() == Some(&realm.id)).unwrap();
    let h = town_hall_of(world, city).unwrap();
    (h.x, h.y)
}

/// A building of nobody's city standing on (x, y).
fn put(world: &mut WorldState, kind: BuildingKind, (x, y): (i32, i32)) {
    let id = format!("b-test-{}", world.buildings.len());
    world.buildings.push(Building {
        id,
        kind,
        city_id: None,
        realm_id: None,
        x: f64::from(x),
        y: f64::from(y),
        stock: None,
        site: None,
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
    });
}

/// Takes the site by laying a road on its middle.
fn block(world: &mut WorldState, site: usize) {
    let middle = site_middle(&world.starting_sites[site]);
    put(world, BuildingKind::Road, middle);
}

fn middle_f(s: &StartingSite) -> (f64, f64) {
    let (x, y) = site_middle(s);
    (f64::from(x), f64::from(y))
}

#[test]
fn the_second_player_starts_in_the_first_players_heartland_on_the_site_nearest_them() {
    let (mut world, terrain, regions) = fresh();
    let (first, heartland) = site_of(found(&mut world, terrain, regions, 1));
    assert_eq!(world.opened_heartlands, [heartland]);
    assert_eq!(world.starting_sites[first].region, heartland);
    let one = hall(&world, 1);
    // The site nearest Player 1's city, of the heartland's free ones.
    let free = free_sites(&world, terrain);
    let nearest = (0..world.starting_sites.len())
        .filter(|&i| free[i] && world.starting_sites[i].region == heartland)
        .min_by(|&a, &b| {
            let d =
                |i: usize| wrap_distance_f(terrain.size, one, middle_f(&world.starting_sites[i]));
            d(a).total_cmp(&d(b))
        })
        .unwrap();
    let (second, h2) = site_of(found(&mut world, terrain, regions, 2));
    assert_eq!((second, h2), (nearest, heartland));
    assert_eq!(regions.id_at(hall(&world, 2).0 as i32, hall(&world, 2).1 as i32), Some(heartland));
    // A neighbour: no farther than the sites' walk apart.
    let rules = SiteRules::for_size(terrain.size);
    let apart = wrap_distance_f(
        terrain.size,
        middle_f(&world.starting_sites[first]),
        middle_f(&world.starting_sites[second]),
    );
    assert!(apart <= rules.max_tiles, "{apart} tiles apart");
    // One's resident walks to the other's city in 20 to 40 real minutes (scaled to this map).
    let walk = crate::starting_sites::walk_seconds(
        terrain,
        site_middle(&world.starting_sites[first]),
        &[site_middle(&world.starting_sites[second])],
        rules.max_seconds,
    )
    .expect("a walk within the sites' rules");
    assert!(walk >= rules.min_seconds, "{walk} s");
    // Each site names the city founded on it, and the log says the heartland.
    let city_of = |user: u64| {
        let realm = &world.realms[realm_of(&world, user).unwrap()].id;
        world.cities.iter().find(|c| c.realm_id.as_ref() == Some(realm)).unwrap().id.clone()
    };
    assert_eq!(world.starting_sites[first].city_id, Some(city_of(1)));
    assert_eq!(world.starting_sites[second].city_id, Some(city_of(2)));
    let name = regions.region(heartland).unwrap().name.clone();
    let told = world.events.iter().any(
        |e| matches!(&e.what, RealmEventWhat::Founded { heartland: Some(h), .. } if *h == name),
    );
    assert!(told, "the log names the heartland {name}");
}

#[test]
fn with_its_heartland_full_the_next_player_opens_the_nearest_heartland() {
    let (mut world, terrain, regions) = fresh();
    let (_, first) = site_of(found(&mut world, terrain, regions, 1));
    for i in 0..world.starting_sites.len() {
        if world.starting_sites[i].region == first && world.starting_sites[i].city_id.is_none() {
            block(&mut world, i);
        }
    }
    let (site, opened) = site_of(found(&mut world, terrain, regions, 2));
    assert_ne!(opened, first);
    assert_eq!(world.opened_heartlands, [first, opened]);
    assert_eq!(world.starting_sites[site].region, opened);
    // The nearest of the other heartlands with sites, middle to middle.
    let at = |id: u32| {
        let r = regions.region(id).unwrap();
        (r.x, r.y)
    };
    let mut others: Vec<u32> = world.starting_sites.iter().map(|s| s.region).collect();
    others.sort_unstable();
    others.dedup();
    others.retain(|&h| h != first);
    let nearest = others
        .into_iter()
        .min_by(|&a, &b| {
            let d = |h: u32| wrap_distance(terrain.size, at(first), at(h));
            d(a).total_cmp(&d(b))
        })
        .unwrap();
    assert_eq!(opened, nearest);
}

#[test]
fn with_two_heartlands_open_the_one_with_more_players_cities_wins_and_on_a_tie_the_first() {
    let (mut world, terrain, regions) = fresh();
    let (_, first) = site_of(found(&mut world, terrain, regions, 1));
    let mut ids: Vec<u32> = world.starting_sites.iter().map(|s| s.region).collect();
    ids.dedup();
    let second = *ids.iter().find(|&&h| h != first).unwrap();
    world.opened_heartlands.push(second);
    // One Player each in both: a tie, the first opened wins.
    let mut picked = pick_start(&mut world, terrain, regions);
    assert!(matches!(picked, Some(StartPlace::Site { heartland, .. }) if heartland == first));
    // Two Players' cities in the second: it wins.
    for user in [2, 3] {
        // Found them there by closing the first heartland's free sites for a moment.
        let mut closed = world.clone();
        closed.opened_heartlands = vec![second];
        let (_, place) = found_starting_city_in(&mut closed, terrain, regions, user, None);
        assert!(matches!(place, Some(StartPlace::Site { heartland, .. }) if heartland == second));
        closed.opened_heartlands = world.opened_heartlands.clone();
        world = closed;
    }
    picked = pick_start(&mut world, terrain, regions);
    assert!(matches!(picked, Some(StartPlace::Site { heartland, .. }) if heartland == second));
}

#[test]
fn a_leader_who_died_with_nothing_left_on_their_site_gets_a_site_by_the_same_rule() {
    let (mut world, terrain, regions) = fresh();
    let (first, heartland) = site_of(found(&mut world, terrain, regions, 1));
    // The Leader died with no heir, and nothing of the city is left.
    let realm = world.realms[realm_of(&world, 1).unwrap()].id.clone();
    let city = world.starting_sites[first].city_id.clone().unwrap();
    world.realms.retain(|r| r.id != realm);
    world.residents.retain(|r| r.owner.as_deref() != Some(realm.as_str()));
    world.horses.retain(|h| h.realm_id.as_deref() != Some(realm.as_str()));
    world.carriages.retain(|c| c.realm_id.as_deref() != Some(realm.as_str()));
    world.buildings.retain(|b| b.city_id.as_deref() != Some(city.as_str()));
    world.cities.retain(|c| c.id != city);
    assert!(free_sites(&world, terrain)[first], "free again");
    // With no other Player anywhere, the rule gives the heartland's first site: the one freed.
    assert_eq!(site_of(found(&mut world, terrain, regions, 1)), (first, heartland));
    assert_ne!(world.starting_sites[first].city_id, Some(city));
}

#[test]
fn a_site_with_someones_building_on_it_is_never_handed_out() {
    let (mut world, terrain, regions) = fresh();
    let (first, heartland) = site_of(found(&mut world, terrain, regions, 1));
    // The site Player 2 would get, with a road over its farm ring.
    let mut probe = world.clone();
    let (next, _) = site_of(pick_start(&mut probe, terrain, regions).unwrap());
    let (sx, sy) = (world.starting_sites[next].x, world.starting_sites[next].y);
    put(&mut world, BuildingKind::Road, (sx - FARM_RING, sy - FARM_RING));
    assert!(!free_sites(&world, terrain)[next]);
    let (second, h) = site_of(found(&mut world, terrain, regions, 2));
    assert_eq!(h, heartland);
    assert!(second != next && second != first);
    // A taken site stays taken while a building of its city stands there, the realm gone or not.
    let realm = world.realms[realm_of(&world, 1).unwrap()].id.clone();
    world.realms.retain(|r| r.id != realm);
    world.residents.retain(|r| r.owner.as_deref() != Some(realm.as_str()));
    assert!(!free_sites(&world, terrain)[first]);
    let (third, _) = site_of(found(&mut world, terrain, regions, 1));
    assert!(![first, next, second].contains(&third));
}

#[test]
fn with_every_site_taken_a_starting_city_is_still_founded_near_an_open_heartland() {
    let (mut world, terrain, regions) = fresh();
    let (_, heartland) = site_of(found(&mut world, terrain, regions, 1));
    for i in 0..world.starting_sites.len() {
        if world.starting_sites[i].city_id.is_none() {
            block(&mut world, i);
        }
    }
    let place = found(&mut world, terrain, regions, 2);
    let StartPlace::WorldFull { x, y } = place else { panic!("every site is taken: {place:?}") };
    assert!(realm_of(&world, 2).is_some());
    // The nearest place to the open heartland's middle: well within the heartland's reach.
    let middle = regions.region(heartland).map(|r| (r.x, r.y)).unwrap();
    let d = wrap_distance(terrain.size, middle, (x + START_SIZE / 2, y + START_SIZE / 2));
    assert!(d < 200.0, "{d} tiles from the heartland's middle");
    let violations: Vec<_> = crate::invariants::world_invariants()
        .iter()
        .flat_map(|i| (i.check)(&world, terrain))
        .collect();
    assert_eq!(violations, []);
}

#[test]
fn starting_sites_sound_finds_a_site_given_twice_and_a_heartland_opened_twice() {
    let (mut world, terrain, regions) = fresh();
    let (first, heartland) = site_of(found(&mut world, terrain, regions, 1));
    let other = (world.starting_sites.iter())
        .position(|s| s.city_id.is_none() && s.region == heartland)
        .unwrap();
    world.starting_sites[other].city_id = world.starting_sites[first].city_id.clone();
    world.opened_heartlands.push(heartland);
    let broken: Vec<String> = starting_sites_sound(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(broken.len(), 2, "{broken:?}");
}

#[test]
fn a_world_without_starting_sites_is_left_to_find_city_site() {
    let (mut world, terrain, regions) = fresh();
    world.starting_sites.clear();
    assert_eq!(pick_start(&mut world, terrain, regions), None);
}
