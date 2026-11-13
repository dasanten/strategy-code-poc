//! `apps/server/src/last-seen.test.ts`, ported (T86.13). Its `twoRealms()` is the fixture
//! `sight/two-realms.json` (`foundStartingCity` for Players 1 and 2 on `cityTerrain()`); Last
//! seen needs only the map's size. Left out: "keeps a Trade Org warehouse with its prices", which
//! founds a Trade Org HQ (T86.9). Where the TypeScript compares a remembered thing with the
//! Player's sight now, these compare the JSON.

mod common;

use std::collections::HashMap;

use csp_shared::balance::LAST_SEEN_EVERY_TICKS;
use csp_shared::footprint::Placed;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, Good, Remembered, WorldState};
use csp_sim::last_seen::{
    last_seen_in_sight, last_seen_on_cadence, last_seen_out_of_sight, last_seen_turn,
    refresh_last_seen, step_last_seen, LastSeenState, MemoryChanges, OutOfSight, OutOfSightDiff,
};
use csp_sim::sight::{entities_in_sight, sight_of};
use csp_sim::world_index::{world_index, WorldIndex};
use indexmap::IndexMap;
use serde_json::{json, Value};

const EVERY: u64 = LAST_SEEN_EVERY_TICKS as u64;

struct Two {
    world: WorldState,
    size: i32,
    state: LastSeenState,
    index: Option<WorldIndex>,
    mara: String,
    tobin: String,
    city: String,
    storage: String,
    scout: usize,
    back: (f64, f64),
    home: (f64, f64),
}

/// Mara (Player 1) and Tobin (Player 2) far apart; Tobin's scout stands near Mara's storage
/// (`twoRealms`).
fn two_realms() -> Two {
    let (mut world, size, _) = common::load_world("sight/two-realms.json");
    let mara = world.realms[0].id.clone();
    let tobin = world.realms[1].id.clone();
    let city =
        world.cities.iter().find(|c| c.realm_id.as_deref() == Some(&mara)).unwrap().id.clone();
    let storage = world
        .buildings
        .iter()
        .find(|b| b.city_id.as_deref() == Some(&city) && b.kind == BuildingKind::Storage)
        .unwrap()
        .clone();
    let scout = world.residents.iter().position(|r| r.owner.as_deref() == Some(&tobin)).unwrap();
    let r = &mut world.residents[scout];
    (r.x, r.y, r.order) = (storage.x + 3.0, storage.y + 3.0, None);
    let back = (r.x, r.y);
    let home = world
        .residents
        .iter()
        .enumerate()
        .find(|(i, r)| r.owner.as_deref() == Some(&tobin) && *i != scout)
        .map(|(_, r)| (r.x, r.y))
        .unwrap();
    Two {
        world,
        size,
        state: LastSeenState::default(),
        index: None,
        mara,
        tobin,
        city,
        storage: storage.id,
        scout,
        back,
        home,
    }
}

impl Two {
    /// Ticks on and brings every realm's Last seen up to date (`step`).
    fn step(&mut self) {
        self.world.tick += 1;
        let realms: Vec<String> = self.world.realms.iter().map(|r| r.id.clone()).collect();
        refresh_last_seen(
            &mut self.world,
            self.size,
            &realms,
            &mut self.state,
            &mut self.index,
            None,
        );
    }

    /// Ticks on and runs `stepLastSeen`.
    fn tick(&mut self) -> usize {
        self.world.tick += 1;
        self.step_last_seen()
    }

    fn step_last_seen(&mut self) -> usize {
        step_last_seen(&mut self.world, self.size, &mut self.state, &mut self.index, None)
    }

    /// Ticks on to the realm's next turn (`untilTurn`).
    fn until_turn(&mut self, realm: &str) {
        loop {
            self.tick();
            if last_seen_turn(&self.world, realm) {
                break;
            }
        }
    }

    fn scout_to(&mut self, (x, y): (f64, f64)) {
        let r = &mut self.world.residents[self.scout];
        (r.x, r.y) = (x, y);
    }

    fn go_home(&mut self) {
        self.scout_to(self.home);
    }

    fn out_of_sight(&mut self, user: u64) -> Vec<Value> {
        let index = world_index(&mut self.index, &self.world, self.size);
        last_seen_out_of_sight(&self.world, index, user)
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect()
    }

    fn out_of_sight_ids(&mut self, user: u64) -> Vec<String> {
        self.out_of_sight(user).iter().map(|e| e["id"].as_str().unwrap().to_string()).collect()
    }

    /// What the realm sees of `id` now, as JSON.
    fn seen(&mut self, realm: &str, id: &str) -> Option<Value> {
        let index = world_index(&mut self.index, &self.world, self.size);
        entities_in_sight(&self.world, index, Some(realm), None)
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .find(|e| e["id"] == id)
    }

    fn remembered(&self, user: u64) -> Vec<Value> {
        self.world
            .last_seen
            .get(&user)
            .into_iter()
            .flatten()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect()
    }

    fn hers(&self) -> Vec<String> {
        self.world
            .buildings
            .iter()
            .filter(|b| b.city_id.as_deref() == Some(&self.city))
            .map(|b| b.id.clone())
            .collect()
    }

    fn map(&self) -> TerrainMap {
        TerrainMap { size: self.size, tiles: Vec::new() }
    }

    /// Everyone of Mara's walks far off: her own city leaves her sight.
    fn mara_walks_off(&mut self) {
        let size = self.size as f64;
        let mara = self.mara.clone();
        for r in self.world.residents.iter_mut().filter(|x| x.owner.as_deref() == Some(&mara)) {
            r.x = (r.x + 400.0) % size;
        }
    }
}

fn with_seen_at(mut v: Value, tick: u64) -> Value {
    v.as_object_mut().unwrap().insert("seenAt".into(), json!(tick));
    common::normalised(&v)
}

fn find<'a>(list: &'a [Value], id: &str) -> Option<&'a Value> {
    list.iter().find(|e| e["id"] == id)
}

#[test]
fn keeps_a_strangers_city_as_it_was_seen_without_what_is_inside_once_it_leaves_sight() {
    let mut t = two_realms();
    t.step();
    let (tobin, storage, city) = (t.tobin.clone(), t.storage.clone(), t.city.clone());
    let seen_then = t.seen(&tobin, &storage).unwrap();
    let seen_at = t.world.tick;
    t.go_home();
    t.step();
    let remembered = t.out_of_sight(2);
    let s = find(&remembered, &storage).unwrap();
    assert_eq!(common::normalised(s), with_seen_at(seen_then, seen_at));
    assert!(s.get("stock").is_none());
    let c = find(&remembered, &city).unwrap();
    assert_eq!((c["is"].as_str(), c["seenAt"].as_f64()), (Some("city"), Some(seen_at as f64)));
    // Everything of hers he saw is remembered, and only buildings and the city.
    let ids = t.out_of_sight_ids(2);
    assert!(t.hers().iter().all(|id| ids.contains(id)));
    let mut kinds: Vec<&str> = remembered.iter().map(|e| e["is"].as_str().unwrap()).collect();
    kinds.sort();
    kinds.dedup();
    assert_eq!(kinds, ["building", "city"]);
}

#[test]
fn keeps_what_is_inside_when_it_was_seen_at_the_storage_and_for_the_players_own() {
    let mut t = two_realms();
    // Tobin's scout on a tile of the storage sees inside it.
    let s = t.world.buildings.iter().find(|b| b.id == t.storage).unwrap();
    let corner = (s.x, s.y);
    t.scout_to(corner);
    t.step();
    t.go_home();
    t.mara_walks_off();
    t.step();
    let stock =
        serde_json::to_value(&t.world.buildings.iter().find(|b| b.id == t.storage).unwrap().stock)
            .unwrap();
    let storage = t.storage.clone();
    for user in [1, 2] {
        let remembered = t.out_of_sight(user);
        assert_eq!(
            common::normalised(&find(&remembered, &storage).unwrap()["stock"]),
            common::normalised(&stock)
        );
    }
}

#[test]
fn stays_as_it_was_while_out_of_sight_then_shows_what_is_there_now_or_forgets_it() {
    let mut t = two_realms();
    t.step();
    t.go_home();
    t.step();
    let before = t.out_of_sight(2);
    // Out of his sight her storage fills and a house of hers is torn down.
    let si = t.world.buildings.iter().position(|b| b.id == t.storage).unwrap();
    *t.world.buildings[si]
        .stock
        .get_or_insert_with(Default::default)
        .entry(Good::Wood)
        .or_insert(0.0) += 50.0;
    let hers = t.hers();
    let house = t
        .world
        .buildings
        .iter()
        .find(|b| hers.contains(&b.id) && b.kind == BuildingKind::House)
        .unwrap()
        .id
        .clone();
    t.world.buildings.retain(|b| b.id != house);
    t.step();
    assert_eq!(t.out_of_sight(2), before);
    // His scout comes back: what is there now, and the house is forgotten.
    t.scout_to(t.back);
    t.step();
    let now = t.remembered(2);
    assert!(find(&now, &house).is_none());
    assert_eq!(find(&now, &t.storage).unwrap()["seenAt"].as_f64(), Some(t.world.tick as f64));
    let storage = t.storage.clone();
    assert!(!t.out_of_sight_ids(2).contains(&storage));
}

#[test]
fn keeps_what_was_inside_as_it_was_while_the_world_changes_it_in_place() {
    let mut t = two_realms();
    t.step();
    t.mara_walks_off();
    t.step();
    let before = t.out_of_sight(1);
    assert!(find(&before, &t.storage).unwrap().get("stock").is_some());
    let si = t.world.buildings.iter().position(|b| b.id == t.storage).unwrap();
    *t.world.buildings[si].stock.as_mut().unwrap().entry(Good::Wood).or_insert(0.0) += 50.0;
    t.step();
    assert_eq!(t.out_of_sight(1), before);
}

#[test]
fn forgets_a_city_once_none_of_its_buildings_is_remembered() {
    let mut t = two_realms();
    t.step();
    t.go_home();
    t.step();
    let city = t.city.clone();
    assert!(t.out_of_sight_ids(2).contains(&city));
    let gone = t.hers();
    t.world.buildings.retain(|b| !gone.contains(&b.id));
    t.world.cities.retain(|c| c.id != city);
    t.scout_to(t.back);
    t.step();
    let ids: Vec<String> =
        t.remembered(2).iter().map(|e| e["id"].as_str().unwrap().to_string()).collect();
    assert!(gone.iter().chain([&city]).all(|id| !ids.contains(id)));
}

#[test]
fn grows_only_from_sight_joining_an_alliance_hands_nothing_over_leaving_keeps_it() {
    let mut t = two_realms();
    t.go_home();
    let mara = t.mara.clone();
    let homes: Vec<(usize, f64, f64)> = t
        .world
        .residents
        .iter()
        .enumerate()
        .filter(|(_, r)| r.owner.as_deref() == Some(&mara))
        .map(|(i, r)| (i, r.x, r.y))
        .collect();
    t.step();
    t.mara_walks_off();
    t.step();
    let city = t.city.clone();
    assert!(t.out_of_sight_ids(1).contains(&city));
    t.world.alliances.push(
        serde_json::from_value(json!({
            "id": "alliance-1", "name": "North", "leaderId": t.mara, "invites": [], "army": [],
            "members": [
                { "realmId": t.mara, "joinedAt": 0, "leaving": null },
                { "realmId": t.tobin, "joinedAt": 0, "leaving": null }
            ]
        }))
        .unwrap(),
    );
    t.step();
    let tobins: Vec<String> =
        t.remembered(2).iter().map(|e| e["id"].as_str().unwrap().to_string()).collect();
    assert!(t.hers().iter().chain([&city]).all(|id| !tobins.contains(id)));
    // Back home, Mara's people let Tobin see her city through the alliance; then it ends.
    for (i, x, y) in homes {
        (t.world.residents[i].x, t.world.residents[i].y) = (x, y);
    }
    t.step();
    t.world.alliances.clear();
    t.step();
    assert!(t.out_of_sight_ids(2).contains(&city));
}

#[test]
fn records_only_what_the_player_is_allowed_to_see_at_that_moment() {
    let mut t = two_realms();
    let walk = [t.back, (t.back.0 - 2.0, t.back.1 - 2.0)];
    let tobin = t.tobin.clone();
    for at in walk {
        t.scout_to(at);
        t.step();
        for e in t.remembered(2) {
            if e["seenAt"].as_f64() != Some(t.world.tick as f64) {
                continue;
            }
            let mut e = e.clone();
            e.as_object_mut().unwrap().remove("seenAt");
            let id = e["id"].as_str().unwrap().to_string();
            assert_eq!(
                Some(common::normalised(&e)),
                t.seen(&tobin, &id).map(|v| common::normalised(&v))
            );
        }
    }
    t.go_home();
    t.step();
    assert!(!t.out_of_sight(2).is_empty());
}

#[test]
fn flags_as_an_invariant_last_seen_sent_while_it_is_in_sight() {
    let mut t = two_realms();
    t.step();
    let in_sight = t.world.last_seen[&2].clone();
    let flagged: Vec<String> = last_seen_in_sight(&t.world, &t.map(), &t.tobin, &in_sight)
        .into_iter()
        .map(|v| v.entity_ids[0].clone())
        .collect();
    assert!(flagged.contains(&t.storage));
    t.go_home();
    t.step();
    let index = world_index(&mut t.index, &t.world, t.size);
    let sent = last_seen_out_of_sight(&t.world, index, 2);
    assert_eq!(last_seen_in_sight(&t.world, &t.map(), &t.tobin, &sent), []);
}

#[test]
fn comes_round_once_every_last_seen_every_ticks_for_each_realm_staggered_by_id() {
    let mut world = two_realms().world;
    let mut offsets = std::collections::HashSet::new();
    for i in 0..20 {
        let id = format!("realm-{i}");
        let mut turns = Vec::new();
        for t in 0..3 * EVERY {
            world.tick = t;
            if last_seen_turn(&world, &id) {
                turns.push(t);
            }
        }
        assert_eq!(turns.len(), 3);
        assert_eq!(turns[1] - turns[0], EVERY);
        offsets.insert(turns[0]);
    }
    assert!(offsets.len() > 1);
}

#[test]
fn updates_a_realms_last_seen_on_its_turn_only() {
    let mut t = two_realms();
    let (tobin, city) = (t.tobin.clone(), t.city.clone());
    t.until_turn(&tobin);
    let refreshed = t.world.tick;
    assert_eq!(t.state.refreshed_at(&tobin), Some(refreshed));
    let seen_at = |t: &Two| find(&t.remembered(2), &city).and_then(|e| e["seenAt"].as_f64());
    for _ in 1..EVERY {
        t.tick();
        assert_eq!(t.state.refreshed_at(&tobin), Some(refreshed));
        assert_eq!(seen_at(&t), Some(refreshed as f64));
    }
    t.tick();
    assert_eq!(t.state.refreshed_at(&tobin), Some(refreshed + EVERY));
    assert_eq!(seen_at(&t), Some(t.world.tick as f64));
}

#[test]
fn remembers_a_building_that_leaves_sight_between_two_refreshes_as_it_was_at_the_last_one() {
    let mut t = two_realms();
    let (tobin, city, storage) = (t.tobin.clone(), t.city.clone(), t.storage.clone());
    t.until_turn(&tobin);
    let at_refresh = t.seen(&tobin, &city).unwrap();
    let refreshed = t.world.tick;
    // In his sight her city is renamed, then his scout leaves before his next turn.
    t.world.cities.iter_mut().find(|c| c.id == city).unwrap().name = "Ironhold".into();
    t.tick();
    t.go_home();
    t.tick();
    assert!(!last_seen_turn(&t.world, &tobin));
    let remembered = t.out_of_sight(2);
    assert_eq!(
        common::normalised(find(&remembered, &city).unwrap()),
        with_seen_at(at_refresh, refreshed)
    );
    assert_eq!(find(&remembered, &storage).unwrap()["seenAt"].as_f64(), Some(refreshed as f64));
}

#[test]
fn never_sends_what_is_in_sight_now_as_last_seen_refreshed_or_not() {
    let mut t = two_realms();
    let (tobin, storage) = (t.tobin.clone(), t.storage.clone());
    t.go_home();
    t.until_turn(&tobin);
    t.scout_to(t.back);
    t.until_turn(&tobin);
    t.go_home();
    t.until_turn(&tobin);
    assert!(t.out_of_sight_ids(2).contains(&storage));
    // Back in sight before his next turn: it is in sight, not last seen.
    t.scout_to(t.back);
    t.tick();
    assert!(!last_seen_turn(&t.world, &tobin));
    assert!(!t.out_of_sight_ids(2).contains(&storage));
    let index = world_index(&mut t.index, &t.world, t.size);
    let sent = last_seen_out_of_sight(&t.world, index, 2);
    assert_eq!(last_seen_in_sight(&t.world, &t.map(), &tobin, &sent), []);
}

#[test]
fn refreshes_a_fresh_realm_at_once_one_with_nobody_looking_every_tick_and_on_connecting() {
    let mut t = two_realms();
    let (mara, tobin) = (t.mara.clone(), t.tobin.clone());
    let off_turn = |t: &mut Two| {
        while last_seen_turn(&t.world, &mara) || last_seen_turn(&t.world, &tobin) {
            t.world.tick += 1;
        }
    };
    off_turn(&mut t);
    // Never refreshed since the start: both refresh off their turn.
    assert_eq!(t.step_last_seen(), 2);
    assert_eq!(t.state.refreshed_at(&mara), Some(t.world.tick));
    // Off their turn nobody refreshes, until a Player connects.
    t.world.tick += 1;
    off_turn(&mut t);
    assert_eq!(t.step_last_seen(), 0);
    t.state.refresh_soon(&mara);
    t.world.tick += 1;
    off_turn(&mut t);
    assert_eq!(t.step_last_seen(), 1);
    assert_eq!(t.state.refreshed_at(&mara), Some(t.world.tick));
    // Mara has nobody left to see through: she refreshes every tick until she has again.
    let hers: Vec<_> =
        t.world.residents.iter().filter(|r| r.owner.as_deref() == Some(&mara)).cloned().collect();
    t.world.residents.retain(|r| r.owner.as_deref() != Some(&mara));
    t.tick();
    for _ in 0..3 {
        t.tick();
        assert_eq!(t.state.refreshed_at(&mara), Some(t.world.tick));
    }
    t.world.residents.extend(hers);
    t.tick();
    assert_eq!(t.state.refreshed_at(&mara), Some(t.world.tick));
    let tick = t.world.tick as f64;
    assert!(t.remembered(1).iter().any(|e| e["seenAt"].as_f64() == Some(tick)));
}

#[test]
fn costs_about_one_refresh_in_last_seen_every_ticks_per_realm() {
    let mut t = two_realms();
    t.step_last_seen();
    let mut refreshes = 0;
    for _ in 0..4 * EVERY {
        refreshes += t.tick();
    }
    assert_eq!(refreshes, 4 * t.world.realms.len());
}

#[test]
fn flags_as_an_invariant_a_realm_off_its_cadence_or_remembering_past_its_last_refresh() {
    let mut t = two_realms();
    let (mara, tobin) = (t.mara.clone(), t.tobin.clone());
    for _ in 0..3 * EVERY {
        t.tick();
        for realm in [&mara, &tobin] {
            assert_eq!(last_seen_on_cadence(&t.world, &t.state, realm), []);
        }
    }
    // Its refreshes stop.
    t.world.tick += EVERY;
    let ids: Vec<Vec<String>> = last_seen_on_cadence(&t.world, &t.state, &tobin)
        .into_iter()
        .map(|v| v.entity_ids)
        .collect();
    assert_eq!(ids, [vec![tobin.clone()]]);
    // Something is remembered as of after its last refresh.
    t.until_turn(&tobin);
    let tick = t.world.tick;
    let first = t.world.last_seen.get_mut(&2).unwrap().first_mut().unwrap();
    let id = match first {
        csp_shared::world::Remembered::Building(b) => {
            b.seen_at = (tick + 1) as f64;
            b.id.clone()
        }
        csp_shared::world::Remembered::City(c) => {
            c.seen_at = (tick + 1) as f64;
            c.id.clone()
        }
    };
    let ids: Vec<Vec<String>> = last_seen_on_cadence(&t.world, &t.state, &tobin)
        .into_iter()
        .map(|v| v.entity_ids)
        .collect();
    assert_eq!(ids, [vec![id, tobin]]);
}

// ------------------------------------------------------------------ kept from what changed (T99.7)

fn id_of(e: &Remembered) -> &str {
    match e {
        Remembered::Building(b) => &b.id,
        Remembered::City(c) => &c.id,
    }
}

/// The whole-list way, the reference: what `ClientView::diff_alone` sent over
/// `last_seen_out_of_sight` each tick before T99.7, every entry turned into JSON and compared.
#[derive(Default)]
struct WholeList {
    sent: IndexMap<String, String>,
}

impl WholeList {
    fn diff(&mut self, list: &[Remembered]) -> OutOfSightDiff {
        let after: IndexMap<String, String> =
            list.iter().map(|e| (id_of(e).to_owned(), serde_json::to_string(e).unwrap())).collect();
        let changed = list
            .iter()
            .filter(|e| self.sent.get(id_of(e)) != after.get(id_of(e)))
            .cloned()
            .collect();
        let gone = self.sent.keys().filter(|id| !after.contains_key(*id)).cloned().collect();
        self.sent = after;
        OutOfSightDiff { changed, gone }
    }
}

/// A Player's Last seen out of sight, kept both ways.
struct Both {
    whole: WholeList,
    kept: Option<OutOfSight>,
}

impl Two {
    /// This tick's diffs for `user`, the whole-list way and kept, after the refreshes' `changes`;
    /// none on the first, which starts the kept one.
    fn diffs(
        &mut self,
        user: u64,
        both: &mut Both,
        changes: &HashMap<u64, MemoryChanges>,
    ) -> Option<(OutOfSightDiff, OutOfSightDiff)> {
        let index = world_index(&mut self.index, &self.world, self.size);
        let whole = both.whole.diff(&last_seen_out_of_sight(&self.world, index, user));
        match &mut both.kept {
            None => {
                both.kept = Some(OutOfSight::new(&self.world, index, None, user));
                None
            }
            Some(kept) => Some((whole, kept.update(&self.world, index, None, changes.get(&user)))),
        }
    }

    /// A house of hers built anew next to her storage, as `id`.
    fn build_house(&mut self, id: &str) {
        let s = self.world.buildings.iter().find(|b| b.id == self.storage).unwrap();
        let (x, y) = (s.x + 3.0, s.y);
        let mut house = self
            .world
            .buildings
            .iter()
            .find(|b| b.city_id.as_deref() == Some(&self.city) && b.kind == BuildingKind::House)
            .unwrap()
            .clone();
        (house.id, house.x, house.y) = (id.into(), x, y);
        self.world.buildings.push(house);
    }
}

#[test]
fn keeps_last_seen_out_of_sight_from_what_changed_as_the_whole_list_sends_it_tick_for_tick() {
    let mut t = two_realms();
    let mara = t.mara.clone();
    let homes: Vec<(usize, f64, f64)> = t
        .world
        .residents
        .iter()
        .enumerate()
        .filter(|(_, r)| r.owner.as_deref() == Some(&mara))
        .map(|(i, r)| (i, r.x, r.y))
        .collect();
    let mut both: Vec<(u64, Both)> =
        [1, 2].map(|u| (u, Both { whole: WholeList::default(), kept: None })).into();
    let mut sent = 0;
    for k in 0..12 * EVERY {
        match k {
            // Her storage leaves his sight, then fills while out of it.
            k if k == EVERY => t.go_home(),
            k if k == 2 * EVERY + 1 => {
                let si = t.world.buildings.iter().position(|b| b.id == t.storage).unwrap();
                *t.world.buildings[si]
                    .stock
                    .get_or_insert_with(Default::default)
                    .entry(Good::Wood)
                    .or_insert(0.0) += 50.0;
            }
            // A house of hers is torn down out of his sight.
            k if k == 3 * EVERY => {
                let hers = t.hers();
                let house = t
                    .world
                    .buildings
                    .iter()
                    .rev()
                    .find(|b| hers.contains(&b.id) && b.kind == BuildingKind::House)
                    .unwrap()
                    .id
                    .clone();
                t.world.buildings.retain(|b| b.id != house);
            }
            // His scout comes back between two of his refreshes; she builds in his sight.
            k if k == 4 * EVERY + 2 => t.scout_to(t.back),
            k if k == 5 * EVERY + 2 => t.build_house("house-new"),
            k if k == 6 * EVERY => t.go_home(),
            k if k == 7 * EVERY + 1 => t.scout_to(t.back),
            // The new house is torn down in his sight.
            k if k == 8 * EVERY + 3 => t.world.buildings.retain(|b| b.id != "house-new"),
            // Her people walk off, so her own city leaves her sight, and come back.
            k if k == 9 * EVERY => t.mara_walks_off(),
            k if k == 10 * EVERY + 4 => {
                for &(i, x, y) in &homes {
                    (t.world.residents[i].x, t.world.residents[i].y) = (x, y);
                }
            }
            _ => {}
        }
        t.tick();
        let changes = t.state.take_changes();
        for (user, b) in &mut both {
            let Some((whole, kept)) = t.diffs(*user, b, &changes) else { continue };
            assert_eq!(
                serde_json::to_value(&kept.changed).unwrap(),
                serde_json::to_value(&whole.changed).unwrap(),
                "changed, tick {} for user {user}",
                t.world.tick
            );
            assert_eq!(kept.gone, whole.gone, "gone, tick {} for user {user}", t.world.tick);
            sent += usize::from(!whole.is_empty());
        }
    }
    assert!(sent >= 6, "only {sent} ticks changed anything");
}

#[test]
fn copies_nothing_and_makes_no_json_on_a_quiet_tick_however_much_is_remembered() {
    let mut t = two_realms();
    let tobin = t.tobin.clone();
    // Tobin remembers 5,000 houses all over the map, out of his sight; his scout still sees her
    // storage, so his refreshes go on.
    let mut houses = Vec::new();
    {
        let index = world_index(&mut t.index, &t.world, t.size);
        let eyes = sight_of(&t.world, index, &tobin, None);
        let mut i = 0;
        while houses.len() < 5_000 {
            i += 1;
            let (x, y) = ((i * 37) % t.size, (i * 101) % t.size);
            if eyes.building_seen(Placed { kind: "house", x, y }) {
                continue;
            }
            houses.push(
                serde_json::from_value::<Remembered>(json!({
                    "is": "building", "id": format!("seen-{i}"), "kind": "house",
                    "cityId": null, "x": x, "y": y, "seenAt": 0
                }))
                .unwrap(),
            );
        }
    }
    t.world.last_seen.insert(2, houses);
    for _ in 0..2 * EVERY {
        t.tick();
    }
    t.state.take_changes();
    let index = world_index(&mut t.index, &t.world, t.size);
    let mut kept = OutOfSight::new(&t.world, index, None, 2);
    let made = (kept.made_json, kept.copied);
    let mut refreshed = 0;
    for _ in 0..3 * EVERY {
        t.tick();
        let changes = t.state.take_changes();
        refreshed += usize::from(changes.get(&2).is_some_and(|c| !c.is_empty()));
        let index = world_index(&mut t.index, &t.world, t.size);
        assert!(kept.update(&t.world, index, None, changes.get(&2)).is_empty());
    }
    assert_eq!(refreshed, 3);
    assert!(t.world.last_seen[&2].len() > 5_000);
    assert_eq!((kept.made_json, kept.copied), made);
}
