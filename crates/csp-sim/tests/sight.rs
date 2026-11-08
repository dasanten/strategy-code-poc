//! `apps/server/src/sight.test.ts`, ported one to one. The worlds it starts from
//! (`worldWithCity`, two and three Players' starting cities on `cityTerrain()`) come from
//! `fixtures/sight/`, written by `scripts/dump-fixtures.mts`; sight needs only the map's size.

mod common;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use common::load_world;
use csp_shared::balance::{SIGHT_RANGE, START_HORSES};
use csp_shared::chunks::{chunks_across, CHUNK_SIZE};
use csp_shared::footprint::footprint_tiles;
use csp_shared::protocol::{SeenEntity, SeenScript};
use csp_shared::terrain::{tile_index, wrap, wrap_distance};
use csp_shared::world::{
    Alliance, AllianceMember, BuildingKind, Good, Leaving, Realm, RunningScript, Stock, WorldState,
};
use csp_sim::queries::city::town_hall_of;
use csp_sim::queries::names::placed;
use csp_sim::sight::{
    entities_in_sight, places_in_sight, seen_script, sent_inside_unseen, sent_out_of_sight,
    sight_of, with_sight, Explore, SightCache, SightTracker, Spot,
};
use csp_sim::world_index::WorldIndex;
use serde_json::json;

/// `worldWithCity()`: Player 1's starting city on `cityTerrain()`.
fn world_with_city() -> (WorldState, i32) {
    let (world, size, _) = load_world("sight/city.json");
    (world, size)
}

/// `createWorld(cityTerrain())` and `foundStartingCity` for Players 1 to `players`.
fn starting_cities(players: usize) -> (WorldState, i32) {
    let file = match players {
        2 => "sight/two-realms.json",
        3 => "sight/three-realms.json",
        _ => panic!("no fixture for {players} Players"),
    };
    let (world, size, _) = load_world(file);
    assert_eq!(world.realms.len(), players);
    (world, size)
}

fn seen(world: &WorldState, size: i32, realm: &str) -> Arc<Vec<SeenEntity>> {
    entities_in_sight(world, &WorldIndex::new(world, size), Some(realm), None)
}

fn count(seen: &[SeenEntity], is: &str) -> usize {
    seen.iter().filter(|e| e.is() == is).count()
}

fn ids(seen: &[SeenEntity]) -> HashSet<String> {
    seen.iter().map(|e| e.id().to_string()).collect()
}

fn walk_off(world: &mut WorldState, size: i32) {
    for r in &mut world.residents {
        r.x = f64::from(wrap(r.x as i32 + 150, size));
    }
}

mod entities_in_sight {
    use super::*;

    #[test]
    fn shows_a_player_their_city_through_their_residents_and_nothing_for_no_realm() {
        let (world, size) = world_with_city();
        let realm = world.realms[0].id.clone();
        let seen = seen(&world, size, &realm);
        assert_eq!(count(&seen, "resident"), world.residents.len());
        assert_eq!(count(&seen, "building"), world.buildings.len());
        assert_eq!(count(&seen, "city"), 1);
        assert_eq!(count(&seen, "horse") as f64, START_HORSES);
        assert_eq!(count(&seen, "carriage"), 1);
        let index = WorldIndex::new(&world, size);
        assert!(entities_in_sight(&world, &index, None, None).is_empty());
    }

    #[test]
    fn shows_only_what_is_within_sight_range_the_player_own_things_included() {
        let (mut world, size) = world_with_city();
        let realm = world.realms[0].id.clone();
        // Everyone walks off, far from the city: the city and its buildings drop out of sight.
        walk_off(&mut world, size);
        let seen = seen(&world, size, &realm);
        assert!(seen.iter().all(|e| e.is() == "resident"));
        assert_eq!(seen.len(), world.residents.len());
        // One comes back to the edge of sight of the storage.
        let storage = world.buildings.iter().find(|b| b.kind == BuildingKind::Storage).unwrap();
        let (sx, sy, id) = (storage.x, storage.y, storage.id.clone());
        world.residents[0].x = sx + SIGHT_RANGE;
        world.residents[0].y = sy;
        assert!(ids(&super::seen(&world, size, &realm)).contains(&id));
    }

    #[test]
    fn shows_piles_on_the_ground_within_sight_range() {
        let (mut world, size) = world_with_city();
        let realm = world.realms[0].id.clone();
        let (x, y) = (world.residents[0].x, world.residents[0].y);
        let goods: Stock = [(Good::Wood, 2.0)].into_iter().collect();
        for (id, px) in [("near", x), ("far", f64::from(wrap(x as i32 + 150, size)))] {
            world.piles.push(
                serde_json::from_value(json!({ "id": id, "x": px, "y": y, "goods": goods }))
                    .unwrap(),
            );
        }
        let piles: Vec<String> = seen(&world, size, &realm)
            .iter()
            .filter(|e| e.is() == "pile")
            .map(|e| e.id().to_string())
            .collect();
        assert_eq!(piles, ["near"]);
    }

    #[test]
    fn lets_two_players_far_apart_see_nothing_of_each_other() {
        let (world, size) = starting_cities(2);
        let (a, b) = (world.realms[0].id.clone(), world.realms[1].id.clone());
        let hall = |i: usize| {
            let h = town_hall_of(&world, &world.cities[i]).unwrap();
            (h.x as i32, h.y as i32)
        };
        assert!(wrap_distance(size, hall(0), hall(1)) > SIGHT_RANGE * 3.0);
        let owned_by = |realm: &str| -> HashSet<String> {
            let mine = |r: &Option<String>| r.as_deref() == Some(realm);
            let mut out = HashSet::new();
            out.extend(world.residents.iter().filter(|r| mine(&r.owner)).map(|r| r.id.clone()));
            out.extend(world.cities.iter().filter(|c| mine(&c.realm_id)).map(|c| c.id.clone()));
            out.extend(world.horses.iter().filter(|h| mine(&h.realm_id)).map(|h| h.id.clone()));
            out.extend(world.carriages.iter().filter(|k| mine(&k.realm_id)).map(|k| k.id.clone()));
            out.extend(
                world
                    .buildings
                    .iter()
                    .filter(|x| {
                        world
                            .cities
                            .iter()
                            .find(|c| Some(&c.id) == x.city_id.as_ref())
                            .is_some_and(|c| mine(&c.realm_id))
                    })
                    .map(|x| x.id.clone()),
            );
            out
        };
        for (me, them) in [(&a, &b), (&b, &a)] {
            let theirs = owned_by(them);
            let seen = seen(&world, size, me);
            assert!(!seen.is_empty());
            assert!(seen.iter().all(|e| !theirs.contains(e.id())));
        }
    }

    #[test]
    fn sees_across_a_join_of_the_map() {
        let (mut world, size) = world_with_city();
        let realm = world.realms[0].id.clone();
        world.residents[0].x = 1.0;
        world.residents[0].y = 100.0;
        let walker = &mut world.residents[1];
        walker.x = f64::from(size - 3);
        walker.y = 100.0;
        walker.owner = Some("someone-else".into());
        let walker = walker.id.clone();
        assert!(ids(&seen(&world, size, &realm)).contains(&walker));
    }
}

mod sight_cache {
    use super::*;

    #[test]
    fn works_out_what_a_side_sees_once_per_phase_shares_it_and_sees_afresh_in_the_next() {
        let (mut world, size) = world_with_city();
        let realm = world.realms[0].id.clone();
        let index = WorldIndex::new(&world, size);
        let uncached = entities_in_sight(&world, &index, Some(&realm), None);
        // Without a cache, each caller gets their own.
        assert!(!Arc::ptr_eq(&entities_in_sight(&world, &index, Some(&realm), None), &uncached));

        let mut cache = SightCache::open(size);
        let seen = entities_in_sight(&world, &index, Some(&realm), Some(&mut cache));
        assert_eq!(seen, uncached);
        // Sync, scripts and Last seen share one list, and one working out of who sees what.
        assert!(Arc::ptr_eq(
            &entities_in_sight(&world, &index, Some(&realm), Some(&mut cache)),
            &seen
        ));
        let r = &world.residents[0];
        assert!(sight_of(&world, &index, &realm, Some(&mut cache)).sees(Spot { x: r.x, y: r.y }));
        let places = places_in_sight(&world, &index, &realm, None, Some(&mut cache)).seen;
        let want: Vec<SeenEntity> =
            seen.iter().filter(|e| matches!(e.is(), "building" | "city")).cloned().collect();
        assert_eq!(*places, want);
        assert_eq!(cache.builds, 1);
        // Nobody can change what the next caller gets: it is shared behind an `Arc`, read only
        // (the TypeScript freezes it).
        // An invariant works its own out.
        assert!(!Arc::ptr_eq(&places_in_sight(&world, &index, &realm, None, None).seen, &places));
        assert_eq!(cache.builds, 1);

        // Everyone walks off: the next phase sees that, the last one never would.
        walk_off(&mut world, size);
        assert!(Arc::ptr_eq(
            &entities_in_sight(&world, &index, Some(&realm), Some(&mut cache)),
            &seen
        ));
        cache.new_phase();
        let away = entities_in_sight(&world, &index, Some(&realm), Some(&mut cache));
        assert!(away.iter().all(|e| e.is() == "resident"));
        assert_eq!(away.len(), world.residents.len());
        assert_eq!(cache.builds, 2);
        cache.close();
        assert!(!Arc::ptr_eq(
            &entities_in_sight(&world, &index, Some(&realm), None),
            &entities_in_sight(&world, &index, Some(&realm), None),
        ));
    }

    #[test]
    fn is_opened_for_the_call_alone_by_with_sight_unless_one_is_open() {
        let (world, size) = world_with_city();
        let realm = world.realms[0].id.clone();
        let index = WorldIndex::new(&world, size);
        let twice = with_sight(None, size, |cache| {
            [
                entities_in_sight(&world, &index, Some(&realm), Some(cache)),
                entities_in_sight(&world, &index, Some(&realm), Some(cache)),
            ]
        });
        assert!(Arc::ptr_eq(&twice[0], &twice[1]));
        let mut cache = SightCache::open(size);
        with_sight(Some(&mut cache), size, |c| {
            entities_in_sight(&world, &index, Some(&realm), Some(c))
        });
        let outside = entities_in_sight(&world, &index, Some(&realm), Some(&mut cache));
        let inside = with_sight(Some(&mut cache), size, |c| {
            entities_in_sight(&world, &index, Some(&realm), Some(c))
        });
        assert!(Arc::ptr_eq(&outside, &inside));
        assert_eq!(cache.builds, 1);
        cache.close();
    }

    #[test]
    fn hands_out_one_json_string_per_thing_while_open() {
        let (world, size) = world_with_city();
        let realm = world.realms[0].id.clone();
        let index = WorldIndex::new(&world, size);
        let mut cache = SightCache::open(size);
        let seen = entities_in_sight(&world, &index, Some(&realm), Some(&mut cache));
        let a = csp_sim::sight::seen_json(Some(&mut cache), &seen[0]);
        let b = csp_sim::sight::seen_json(Some(&mut cache), &seen[0]);
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(*a, *serde_json::to_string(&seen[0]).unwrap());
        assert!(!Arc::ptr_eq(&a, &csp_sim::sight::seen_json(None, &seen[0])));
    }
}

/// Explored terrain as `ExploredTerrain.explore` grows it, for the tracker's tests: the disc of
/// tiles within `radius`, and the chunks with a tile newly explored.
#[derive(Default)]
struct Explored {
    size: i32,
    tiles: HashMap<u64, HashSet<usize>>,
}

impl Explored {
    fn new(size: i32) -> Self {
        Explored { size, tiles: HashMap::new() }
    }

    fn is_explored(&self, user: u64, x: f64, y: f64) -> bool {
        self.tiles
            .get(&user)
            .is_some_and(|t| t.contains(&tile_index(self.size, x as i32, y as i32)))
    }
}

impl Explore for Explored {
    fn explore(&mut self, user_id: u64, x: i32, y: i32, radius: i32) -> HashSet<usize> {
        let size = self.size;
        let n = chunks_across(size);
        let tiles = self.tiles.entry(user_id).or_default();
        let mut grown = HashSet::new();
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                if dx * dx + dy * dy > radius * radius {
                    continue;
                }
                let (col, row) = (wrap(x + dx, size), wrap(y + dy, size));
                if tiles.insert(tile_index(size, col, row)) {
                    grown.insert(((row / CHUNK_SIZE) * n + col / CHUNK_SIZE) as usize);
                }
            }
        }
        grown
    }
}

mod sight_tracker {
    use super::*;
    use csp_shared::terrain::TerrainMap;
    use csp_sim::explored::ExploredTerrain;

    #[test]
    fn explores_the_games_explored_terrain_as_the_test_double_does() {
        let (world, size) = world_with_city();
        let terrain = TerrainMap { size, tiles: vec![0; (size * size) as usize] };
        let mut explored = ExploredTerrain::new(terrain, &[]);
        let mut double = Explored::new(size);
        let index = WorldIndex::new(&world, size);
        let grown = SightTracker::new().update(&world, &index, &mut explored);
        assert_eq!(grown, SightTracker::new().update(&world, &index, &mut double));
        let user = world.realms[0].user_id;
        let r = &world.residents[0];
        assert!(explored.is_explored(user, r.x as i32 + SIGHT_RANGE as i32, r.y as i32));
    }

    #[test]
    fn explores_around_residents_again_only_when_they_reach_a_new_tile() {
        let (mut world, size) = world_with_city();
        let mut explored = Explored::new(size);
        let mut sight = SightTracker::new();
        let user = world.realms[0].user_id;
        let first = sight.update(&world, &WorldIndex::new(&world, size), &mut explored);
        assert!(!first[&user].is_empty());
        let (x, y) = (world.residents[0].x, world.residents[0].y);
        assert!(explored.is_explored(user, x + SIGHT_RANGE, y));
        assert!(!explored.is_explored(user, x + SIGHT_RANGE * 4.0, y));

        // Nobody moved: nothing new.
        assert!(sight.update(&world, &WorldIndex::new(&world, size), &mut explored).is_empty());

        // One walks far off: the chunks around them are newly explored.
        world.residents[0].x = f64::from(wrap(x as i32 + 100, size));
        let r = &world.residents[0];
        let grown =
            sight.update(&world, &WorldIndex::new(&world, size), &mut explored)[&user].clone();
        let n = chunks_across(size);
        let chunk = ((r.y as i32 / CHUNK_SIZE) * n + r.x as i32 / CHUNK_SIZE) as usize;
        assert!(grown.contains(&chunk));
        assert!(explored.is_explored(user, r.x, r.y));
    }
}

mod shared_sight {
    use super::*;

    /// Three Players far apart; Mara and Tobin are in an alliance, Wren is not.
    fn allied() -> (WorldState, i32, [Realm; 3]) {
        let (mut world, size) = starting_cities(3);
        let realms: [Realm; 3] = world.realms.clone().try_into().unwrap();
        world.alliances.push(Alliance {
            id: "alliance-1".into(),
            name: "North".into(),
            leader_id: realms[0].id.clone(),
            members: realms[..2]
                .iter()
                .map(|r| AllianceMember { realm_id: r.id.clone(), joined_at: 0.0, leaving: None })
                .collect(),
            invites: vec![],
            army: vec![],
        });
        (world, size, realms)
    }

    fn residents_of(world: &WorldState, realm: &Realm) -> Vec<String> {
        world
            .residents
            .iter()
            .filter(|r| r.owner.as_deref() == Some(&realm.id))
            .map(|r| r.id.clone())
            .collect()
    }

    #[test]
    fn lets_members_see_what_any_members_residents_see_and_nobody_else() {
        let (mut world, size, [mara, tobin, wren]) = allied();
        let tobin_city =
            world.cities.iter().find(|c| c.realm_id.as_deref() == Some(&tobin.id)).unwrap().clone();
        for viewer in [&mara, &tobin] {
            let seen = ids(&seen(&world, size, &viewer.id));
            for r in residents_of(&world, &mara).iter().chain(&residents_of(&world, &tobin)) {
                assert!(seen.contains(r));
            }
            assert!(seen.contains(&tobin_city.id));
            for r in residents_of(&world, &wren) {
                assert!(!seen.contains(&r));
            }
        }
        let wren_sees = ids(&seen(&world, size, &wren.id));
        for r in residents_of(&world, &mara).iter().chain(&residents_of(&world, &tobin)) {
            assert!(!wren_sees.contains(r));
        }
        // A stranger near Tobin's city is seen by Mara through Tobin's residents.
        let stranger = residents_of(&world, &wren)[0].clone();
        let hall = town_hall_of(&world, &tobin_city).unwrap();
        let (hx, hy) = (hall.x, hall.y);
        let s = world.residents.iter_mut().find(|r| r.id == stranger).unwrap();
        (s.x, s.y) = (hx, hy);
        assert!(ids(&seen(&world, size, &mara.id)).contains(&stranger));
        // `diplomacyFor` not passing them on as one who could be invited is the diplomacy
        // port's to test, not sight's.
    }

    #[test]
    fn ends_shared_sight_with_the_leave_delay_not_before() {
        // `stepAlliances` removes a leaving member once the delay is over; until then the member
        // is listed and shares sight, after that it is gone and doesn't.
        let (mut world, size, [mara, tobin, _]) = allied();
        world.alliances[0].members[1].leaving = Some(Leaving { at: 1.0, removed: false });
        assert!(ids(&seen(&world, size, &mara.id)).contains(&residents_of(&world, &tobin)[0]));
        world.alliances[0].members.pop();
        let members: Vec<&str> =
            world.alliances[0].members.iter().map(|m| m.realm_id.as_str()).collect();
        assert_eq!(members, [mara.id.as_str()]);
        assert!(!ids(&seen(&world, size, &mara.id)).contains(&residents_of(&world, &tobin)[0]));
        assert!(!ids(&seen(&world, size, &tobin.id)).contains(&residents_of(&world, &mara)[0]));
    }

    #[test]
    fn explores_for_every_member_around_any_members_residents_a_new_member_at_once() {
        let (mut world, size, [mara, tobin, wren]) = allied();
        let mut explored = Explored::new(size);
        let mut sight = SightTracker::new();
        sight.update(&world, &WorldIndex::new(&world, size), &mut explored);
        let at = |world: &WorldState, realm: &Realm| {
            let id = &residents_of(world, realm)[0];
            let r = world.residents.iter().find(|r| &r.id == id).unwrap();
            (r.x, r.y)
        };
        let (tx, ty) = at(&world, &tobin);
        let (mx, my) = at(&world, &mara);
        let (wx, wy) = at(&world, &wren);
        assert!(explored.is_explored(mara.user_id, tx, ty));
        assert!(explored.is_explored(tobin.user_id, mx, my));
        assert!(!explored.is_explored(mara.user_id, wx, wy));
        // Wren joins: without anyone moving, they explore around Mara's and Tobin's residents,
        // and they around Wren's.
        world.alliances[0].members.push(AllianceMember {
            realm_id: wren.id.clone(),
            joined_at: world.tick as f64,
            leaving: None,
        });
        let grown = sight.update(&world, &WorldIndex::new(&world, size), &mut explored);
        assert!(!grown[&wren.user_id].is_empty());
        assert!(explored.is_explored(wren.user_id, mx, my));
        assert!(explored.is_explored(mara.user_id, wx, wy));
        // Nobody moved since: nothing new.
        assert!(sight.update(&world, &WorldIndex::new(&world, size), &mut explored).is_empty());
    }

    #[test]
    fn reports_anything_sent_to_a_player_outside_their_own_or_their_alliances_sight() {
        let (mut world, size, [mara, tobin, wren]) = allied();
        let index = WorldIndex::new(&world, size);
        for realm in [&mara, &tobin, &wren] {
            let sent = seen(&world, size, &realm.id);
            assert_eq!(sent_out_of_sight(&world, &index, &realm.id, &sent), []);
        }
        // What Tobin sees, sent to Wren, is all outside Wren's sight; the cities included.
        let tobins = seen(&world, size, &tobin.id);
        let out = sent_out_of_sight(&world, &index, &wren.id, &tobins);
        let flagged: Vec<&str> = out.iter().map(|v| v.entity_ids[0].as_str()).collect();
        let all: Vec<&str> = tobins.iter().map(SeenEntity::id).collect();
        assert_eq!(flagged, all);
        assert_eq!(out[0].invariant, "sent-only-in-sight");
        // Once Tobin's residents leave the alliance, what they see is outside Mara's sight.
        world.alliances[0].members.pop();
        let index = WorldIndex::new(&world, size);
        assert!(!sent_out_of_sight(&world, &index, &mara.id, &tobins).is_empty());
    }
}

mod seeing_inside {
    use super::*;

    /// Two Players far apart, and a scout of Tobin's standing in Mara's city near its storage.
    struct TwoRealms {
        world: WorldState,
        size: i32,
        mara: String,
        tobin: String,
        storage: String,
        carriage: String,
        scout: String,
    }

    fn two_realms() -> TwoRealms {
        let (mut world, size) = starting_cities(2);
        let (mara, tobin) = (world.realms[0].id.clone(), world.realms[1].id.clone());
        let city =
            world.cities.iter().find(|c| c.realm_id.as_deref() == Some(&mara)).unwrap().id.clone();
        let storage = world
            .buildings
            .iter()
            .find(|b| b.city_id.as_deref() == Some(&city) && b.kind == BuildingKind::Storage)
            .unwrap()
            .clone();
        let k = world.carriages.iter_mut().find(|k| k.realm_id.as_deref() == Some(&mara)).unwrap();
        (k.x, k.y) = (storage.x + 6.0, storage.y);
        k.load = [(Good::Food, 40.0)].into_iter().collect();
        let carriage = k.id.clone();
        let s = world.residents.iter_mut().find(|r| r.owner.as_deref() == Some(&tobin)).unwrap();
        (s.x, s.y, s.order) = (storage.x + 3.0, storage.y + 3.0, None);
        let scout = s.id.clone();
        TwoRealms { world, size, mara, tobin, storage: storage.id, carriage, scout }
    }

    impl TwoRealms {
        fn seen_by(&self, realm: &str) -> Arc<Vec<SeenEntity>> {
            seen(&self.world, self.size, realm)
        }

        fn index(&self) -> WorldIndex {
            WorldIndex::new(&self.world, self.size)
        }

        fn move_scout(&mut self, x: f64, y: f64) {
            let s = self.world.residents.iter_mut().find(|r| r.id == self.scout).unwrap();
            (s.x, s.y) = (x, y);
        }

        fn storage_stock(&self) -> Option<Stock> {
            self.world.buildings.iter().find(|b| b.id == self.storage).unwrap().stock.clone()
        }
    }

    fn find<'a>(seen: &'a [SeenEntity], id: &str) -> Option<&'a SeenEntity> {
        seen.iter().find(|e| e.id() == id)
    }

    fn stock(e: Option<&SeenEntity>) -> Option<Stock> {
        match e {
            Some(SeenEntity::Building(b)) => b.building.stock.clone(),
            other => panic!("not a building: {other:?}"),
        }
    }

    fn carriage(e: Option<&SeenEntity>) -> &csp_shared::protocol::SeenCarriage {
        match e {
            Some(SeenEntity::Carriage(k)) => k,
            other => panic!("not a carriage: {other:?}"),
        }
    }

    fn food(units: f64) -> Stock {
        [(Good::Food, units)].into_iter().collect()
    }

    #[test]
    fn shows_its_own_organization_what_is_inside_and_how_its_people_fare() {
        let t = two_realms();
        let seen = t.seen_by(&t.mara);
        assert_eq!(stock(find(&seen, &t.storage)), t.storage_stock());
        let k = carriage(find(&seen, &t.carriage));
        assert_eq!(k.load, Some(food(40.0)));
        assert_eq!(k.load_level, csp_shared::protocol::LoadLevel::Light);
        for e in seen.iter() {
            match e {
                SeenEntity::Resident(r) if r.owner.as_deref() == Some(&t.mara) => {
                    assert!(r.hunger.is_some() && r.health.is_some());
                }
                SeenEntity::Horse(h) => assert!(h.hunger.is_some() && h.health.is_some()),
                _ => {}
            }
        }
        assert_eq!(sent_inside_unseen(&t.world, &t.index(), &t.mara, &seen), []);
    }

    #[test]
    fn shows_a_stranger_in_sight_only_the_building_how_heavily_a_carriage_is_loaded_and_no_ones_hunger_or_health(
    ) {
        let t = two_realms();
        let seen = t.seen_by(&t.tobin);
        assert!(find(&seen, &t.storage).is_some());
        assert_eq!(stock(find(&seen, &t.storage)), None);
        let k = carriage(find(&seen, &t.carriage));
        assert_eq!(k.load_level, csp_shared::protocol::LoadLevel::Light);
        assert_eq!(k.load, None);
        let mut theirs = 0;
        for e in seen.iter() {
            match e {
                SeenEntity::Resident(r) if r.owner.as_deref() == Some(&t.mara) => {
                    theirs += 1;
                    assert!(r.hunger.is_none() && r.health.is_none());
                }
                SeenEntity::Horse(h) if h.realm_id.as_deref() == Some(&t.mara) => {
                    theirs += 1;
                    assert!(h.hunger.is_none() && h.health.is_none());
                }
                _ => {}
            }
        }
        assert!(theirs > 0);
        assert_eq!(sent_inside_unseen(&t.world, &t.index(), &t.tobin, &seen), []);
    }

    #[test]
    fn shows_a_stranger_with_a_resident_at_the_storage_or_on_the_carriages_tile_what_is_inside() {
        let mut t = two_realms();
        // On the far tile of the storage's footprint: any tile of it counts (`CONTEXT.md`: At a
        // building).
        let storage = t.world.buildings.iter().find(|b| b.id == t.storage).unwrap();
        let (fx, fy) = *footprint_tiles(placed(storage), t.size).last().unwrap();
        t.move_scout(f64::from(fx), f64::from(fy));
        let seen = t.seen_by(&t.tobin);
        assert_eq!(stock(find(&seen, &t.storage)), t.storage_stock());
        assert_eq!(carriage(find(&seen, &t.carriage)).load, None);
        let k = t.world.carriages.iter().find(|k| k.id == t.carriage).unwrap();
        let (kx, ky) = (k.x, k.y);
        t.move_scout(kx, ky);
        let seen = t.seen_by(&t.tobin);
        assert_eq!(carriage(find(&seen, &t.carriage)).load, Some(food(40.0)));
        assert_eq!(stock(find(&seen, &t.storage)), None);
        // Standing there tells nothing of how Mara's people fare.
        for e in seen.iter() {
            if let SeenEntity::Resident(r) = e {
                if r.owner.as_deref() == Some(&t.mara) {
                    assert!(r.hunger.is_none());
                }
            }
        }
    }

    #[test]
    fn shows_an_ally_what_is_inside_and_how_their_people_fare() {
        let mut t = two_realms();
        t.world.alliances.push(Alliance {
            id: "alliance-1".into(),
            name: "North".into(),
            leader_id: t.mara.clone(),
            members: [&t.mara, &t.tobin]
                .iter()
                .map(|r| AllianceMember { realm_id: r.to_string(), joined_at: 0.0, leaving: None })
                .collect(),
            invites: vec![],
            army: vec![],
        });
        let seen = t.seen_by(&t.tobin);
        assert_eq!(stock(find(&seen, &t.storage)), t.storage_stock());
        assert_eq!(carriage(find(&seen, &t.carriage)).load, Some(food(40.0)));
        let theirs: Vec<_> = seen
            .iter()
            .filter_map(|e| match e {
                SeenEntity::Resident(r) if r.owner.as_deref() == Some(&t.mara) => Some(r),
                _ => None,
            })
            .collect();
        assert!(!theirs.is_empty());
        assert!(theirs.iter().all(|r| r.hunger.is_some()));
    }

    #[test]
    fn flags_as_an_invariant_anything_inside_sent_to_a_stranger() {
        let t = two_realms();
        // What Mara sees, sent to Tobin by mistake: everything of hers he has in sight.
        let in_his_sight = ids(&t.seen_by(&t.tobin));
        let leaked: Vec<SeenEntity> =
            t.seen_by(&t.mara).iter().filter(|e| in_his_sight.contains(e.id())).cloned().collect();
        let flagged: HashSet<String> = sent_inside_unseen(&t.world, &t.index(), &t.tobin, &leaked)
            .into_iter()
            .flat_map(|v| v.entity_ids)
            .collect();
        assert!(flagged.contains(&t.storage));
        assert!(flagged.contains(&t.carriage));
        let hers = t
            .world
            .residents
            .iter()
            .find(|r| r.owner.as_deref() == Some(&t.mara) && in_his_sight.contains(&r.id))
            .unwrap();
        assert!(flagged.contains(&hers.id));
    }
}

mod seen_script {
    use super::*;

    fn script(v: serde_json::Value) -> RunningScript {
        serde_json::from_value(v).unwrap()
    }

    fn of(v: serde_json::Value) -> SeenScript {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn shows_only_the_owning_player_what_goes_into_the_doing_line() {
        let (mut world, size) = world_with_city();
        let realm = world.realms[0].id.clone();
        let farm = world
            .buildings
            .iter()
            .find(|b| b.kind == BuildingKind::Farm)
            .unwrap_or(&world.buildings[0])
            .clone();
        world.residents[0].script = Some(script(
            json!({ "scriptId": 3, "memory": { "workplaceId": farm.id, "doing": "Sowing" } }),
        ));
        world.residents[1].script = Some(script(json!({
            "scriptId": 0, "task": "build", "memory": { "building": "house", "at": { "x": 1, "y": 2 } }
        })));
        world.residents[2].script = Some(script(
            json!({ "scriptId": 4, "memory": { "building": "nonsense", "doing": "Secret" } }),
        ));
        world.residents[2].owner = Some("someone else".into());
        let [worker, builder, stranger] = [0, 1, 2].map(|i| world.residents[i].id.clone());
        let scripts: HashMap<String, SeenScript> = seen(&world, size, &realm)
            .iter()
            .filter_map(|e| match e {
                SeenEntity::Resident(r) => r.script.clone().map(|s| (r.id.clone(), s)),
                _ => None,
            })
            .collect();
        assert_eq!(
            scripts[&worker],
            of(json!({ "scriptId": 3, "building": farm.kind, "doing": "Sowing" }))
        );
        assert_eq!(
            scripts[&builder],
            of(json!({ "scriptId": 0, "task": "build", "building": "house" }))
        );
        assert_eq!(scripts[&stranger], of(json!({ "scriptId": 4 })));
        let s = world.residents[2].script.as_ref().unwrap();
        assert_eq!(seen_script(&world, s, true), of(json!({ "scriptId": 4, "doing": "Secret" })));
    }

    #[test]
    fn shows_the_owning_player_the_line_a_build_line_task_builds_for_the_maps_ghosts() {
        let (world, _) = world_with_city();
        let line =
            json!({ "building": "wall", "from": { "x": 3, "y": 4 }, "to": { "x": 6, "y": 4 } });
        let s = script(json!({ "scriptId": 0, "task": "buildLine", "memory": { "line": line } }));
        assert_eq!(
            seen_script(&world, &s, true),
            of(json!({ "scriptId": 0, "task": "buildLine", "building": "wall", "line": line }))
        );
        assert_eq!(seen_script(&world, &s, false), of(json!({ "scriptId": 0 })));
        let broken = script(json!({
            "scriptId": 0, "task": "buildLine", "memory": { "line": { "building": "house", "from": line["from"] } }
        }));
        assert_eq!(seen_script(&world, &broken, true).line, None);
    }
}
