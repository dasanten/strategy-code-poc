//! Last seen (`apps/server/src/last-seen.ts`, `CONTEXT.md`: Last seen): what each Player
//! remembers of buildings and cities once out of their sight, brought up to date for each realm
//! once every `LAST_SEEN_EVERY_TICKS`, staggered by its id (T49.9).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use csp_shared::balance::LAST_SEEN_EVERY_TICKS;
use csp_shared::footprint::Placed;
use csp_shared::protocol::SeenEntity;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Remembered, WorldState};
use serde_json::Value;

use crate::queries::names::kind_name;
use crate::random::hash_str;
use crate::sight::{buildings_by_square, places_in_sight, InvariantViolation, SightCache, Squares};
use crate::world_index::{world_index, WorldIndex};

/// When each realm's Last seen was last brought up to date, whether it had anyone to see through
/// then, and the realms whose Player just connected (`refreshes`, `soon`). Scratch like the sight
/// cache's, never saved (ADR 0006): after a restart every realm refreshes on the first tick.
#[derive(Debug, Default, Clone)]
pub struct LastSeenState {
    refreshes: HashMap<String, Refresh>,
    soon: HashSet<String>,
    /// What the refreshes changed in each Player's memory since [`LastSeenState::take_changes`]
    /// last took it, by user id (T99.7).
    changes: HashMap<u64, MemoryChanges>,
}

/// What refreshes changed in a Player's memory (T99.7): the ids remembered anew, again or as they
/// are now, and the ids forgotten. Only a refresh changes what a Player remembers, so this is all
/// that can have changed in it.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct MemoryChanges {
    pub touched: HashSet<String>,
    pub removed: HashSet<String>,
}

impl MemoryChanges {
    pub fn is_empty(&self) -> bool {
        self.touched.is_empty() && self.removed.is_empty()
    }
}

#[derive(Debug, Clone, Copy)]
struct Refresh {
    tick: u64,
    looking: bool,
}

/// Whether a realm's turn on the `LAST_SEEN_EVERY_TICKS` cycle is this tick, staggered by id
/// (`lastSeenTurn`).
pub fn last_seen_turn(world: &WorldState, realm_id: &str) -> bool {
    (world.tick as f64 + hash_str(realm_id) as f64) % LAST_SEEN_EVERY_TICKS == 0.0
}

impl LastSeenState {
    /// Whether a realm's Last seen is brought up to date this tick (`due`): on its turn, and at
    /// once when never refreshed, nobody looked at its last refresh, or its Player just
    /// connected.
    fn due(&self, world: &WorldState, realm_id: &str) -> bool {
        match self.refreshes.get(realm_id) {
            None => true,
            Some(last) => {
                !last.looking || self.soon.contains(realm_id) || last_seen_turn(world, realm_id)
            }
        }
    }

    /// Has a realm's Last seen brought up to date on the next tick, as a Player connects
    /// (`refreshLastSeenSoon`).
    pub fn refresh_soon(&mut self, realm_id: &str) {
        self.soon.insert(realm_id.to_string());
    }

    /// The tick a realm's Last seen was last brought up to date (`lastSeenRefreshedAt`).
    pub fn refreshed_at(&self, realm_id: &str) -> Option<u64> {
        self.refreshes.get(realm_id).map(|r| r.tick)
    }

    /// What the refreshes changed in each Player's memory since this was last called, by user id
    /// (T99.7). The broadcast takes it every tick and keeps each realm's Last seen out of sight
    /// with it ([`OutOfSight`]).
    pub fn take_changes(&mut self) -> HashMap<u64, MemoryChanges> {
        std::mem::take(&mut self.changes)
    }
}

/// Brings Last seen up to date for the realms whose turn it is (`stepLastSeen`). Returns how many
/// realms refreshed.
pub fn step_last_seen(
    world: &mut WorldState,
    size: i32,
    state: &mut LastSeenState,
    index: &mut Option<WorldIndex>,
    cache: Option<&mut SightCache>,
) -> usize {
    let realms: Vec<String> =
        world.realms.iter().filter(|r| state.due(world, &r.id)).map(|r| r.id.clone()).collect();
    state.soon.clear();
    refresh_last_seen(world, size, &realms, state, index, cache);
    realms.len()
}

/// A footprint as remembered (`sees(e)` of a remembered building).
fn placed_of(e: &Remembered) -> Option<Placed<'static>> {
    match e {
        Remembered::Building(b) => {
            Some(Placed { kind: kind_name(b.kind), x: b.x as i32, y: b.y as i32 })
        }
        Remembered::City(_) => None,
    }
}

fn id_of(e: &Remembered) -> &str {
    match e {
        Remembered::Building(b) => &b.id,
        Remembered::City(c) => &c.id,
    }
}

fn seen_at_mut(e: &mut Remembered) -> &mut f64 {
    match e {
        Remembered::Building(b) => &mut b.seen_at,
        Remembered::City(c) => &mut c.seen_at,
    }
}

/// The `id` of something in sight as its plain data gives it: a building's or a city's own, which
/// their plain data holds flattened, read without making that data each tick (T89.6).
fn seen_id(e: &SeenEntity) -> Option<String> {
    match e {
        SeenEntity::Building(b) => Some(b.building.id.clone()),
        SeenEntity::City(c) => Some(c.city.id.clone()),
        _ => serde_json::to_value(e).ok()?.get("id")?.as_str().map(str::to_owned),
    }
}

/// A remembered building or city as JSON, `seenAt` aside (`jsonOf`).
fn json_of(e: &Remembered) -> Value {
    let mut v = serde_json::to_value(e).unwrap_or(Value::Null);
    if let Some(o) = v.as_object_mut() {
        o.remove("seenAt");
    }
    v
}

/// Brings the Players' Last seen up to date with their sight, for the realms given
/// (`refreshLastSeen`): each building and city in sight is remembered as they see it now, and a
/// remembered building with any tile of its footprint back in sight that is no longer there is
/// forgotten. A city stays while any building of it is remembered.
pub fn refresh_last_seen(
    world: &mut WorldState,
    size: i32,
    realms: &[String],
    state: &mut LastSeenState,
    index: &mut Option<WorldIndex>,
    mut cache: Option<&mut SightCache>,
) {
    let by_square = (!realms.is_empty()).then(|| buildings_by_square(world, size));
    for realm_id in realms {
        let Some(user_id) = world.realms.iter().find(|r| &r.id == realm_id).map(|r| r.user_id)
        else {
            continue;
        };
        let index = world_index(index, world, size);
        let places =
            places_in_sight(world, index, realm_id, by_square.as_ref(), cache.as_deref_mut());
        state
            .refreshes
            .insert(realm_id.clone(), Refresh { tick: world.tick, looking: places.looking });
        let remembers = world.last_seen.get(&user_id).is_some_and(|m| !m.is_empty());
        if places.seen.is_empty() && !remembers {
            continue;
        }
        // `new Map(before.map(...))`, keeping the order things were first remembered in. Taken
        // out and put back, not copied (T99.7).
        let mut memory: Vec<Remembered> = world.last_seen.remove(&user_id).unwrap_or_default();
        let changes = state.changes.entry(user_id).or_default();
        let in_sight: HashSet<String> = places.seen.iter().filter_map(seen_id).collect();
        // Its spot is in sight again and it is not there any more.
        memory.retain(|e| {
            let keep = match placed_of(e) {
                Some(p) => in_sight.contains(id_of(e)) || !places.sees(p),
                None => true,
            };
            if !keep {
                changes.removed.insert(id_of(e).to_owned());
            }
            keep
        });
        // Where each id is remembered, the first with it, as a scan of the memory finds it (T89.6).
        let mut at: HashMap<String, usize> = HashMap::new();
        for (i, e) in memory.iter().enumerate() {
            at.entry(id_of(e).to_string()).or_insert(i);
        }
        for seen_now in places.seen.iter() {
            let Ok(mut v) = serde_json::to_value(seen_now) else { continue };
            // Who occupies a town hall is seen only while it is in sight, never remembered, and
            // so are the horses a city's stable lists.
            if v.get("is").and_then(|i| i.as_str()) == Some("city") {
                let o = v.as_object_mut().expect("a seen city is an object");
                let shows = o.get("occupation").is_some_and(|x| !x.is_null())
                    || o.get("horses").is_some_and(|x| !x.is_null())
                    || o.get("horsesToSell").is_some_and(|x| !x.is_null());
                if shows {
                    o.insert("occupation".into(), Value::Null);
                    o.remove("horses");
                    o.remove("horsesToSell");
                }
            }
            let id = v.get("id").and_then(|i| i.as_str()).unwrap_or_default().to_string();
            let was = at.get(&id).copied();
            if let Some(i) = was.filter(|&i| json_of(&memory[i]) == v) {
                *seen_at_mut(&mut memory[i]) = world.tick as f64;
                changes.touched.insert(id);
                continue;
            }
            v.as_object_mut().expect("an object").insert("seenAt".into(), Value::from(world.tick));
            let Ok(copy) = serde_json::from_value::<Remembered>(v) else { continue };
            changes.touched.insert(id.clone());
            match was {
                Some(i) => memory[i] = copy,
                None => {
                    at.entry(id).or_insert(memory.len());
                    memory.push(copy);
                }
            }
        }
        let keep: Vec<bool> = {
            let cities: HashSet<&str> = memory
                .iter()
                .filter_map(|e| match e {
                    Remembered::Building(b) => b.city_id.as_deref(),
                    Remembered::City(_) => None,
                })
                .collect();
            memory
                .iter()
                .map(|e| match e {
                    Remembered::City(c) => cities.contains(c.id.as_str()),
                    Remembered::Building(_) => true,
                })
                .collect()
        };
        let mut keep = keep.into_iter();
        memory.retain(|e| {
            let kept = keep.next().unwrap_or(true);
            if !kept {
                changes.removed.insert(id_of(e).to_owned());
            }
            kept
        });
        world.last_seen.insert(user_id, memory);
    }
}

/// What a Player remembers that is out of their sight now (`lastSeenOutOfSight`): their sight
/// now decides it, not when Last seen was refreshed.
pub fn last_seen_out_of_sight(
    world: &WorldState,
    index: &WorldIndex,
    user_id: u64,
) -> Vec<Remembered> {
    let memory = world.last_seen.get(&user_id).cloned().unwrap_or_default();
    let Some(realm) = world.realms.iter().find(|r| r.user_id == user_id) else { return memory };
    if memory.is_empty() {
        return memory;
    }
    let places = places_in_sight(world, index, &realm.id, None, None);
    if !places.looking {
        return memory;
    }
    let in_sight: HashSet<String> = places.seen.iter().filter_map(seen_id).collect();
    memory
        .into_iter()
        .filter(|e| !in_sight.contains(id_of(e)) && !placed_of(e).is_some_and(|p| places.sees(p)))
        .collect()
}

/// What changed in what a Player remembers out of their sight since the last tick: as
/// [`last_seen_out_of_sight`] lists it, the entries that are new or changed in its order, and the
/// ids that left it in the order they stood in it.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct OutOfSightDiff {
    pub changed: Vec<Remembered>,
    pub gone: Vec<String>,
}

impl OutOfSightDiff {
    pub fn is_empty(&self) -> bool {
        self.changed.is_empty() && self.gone.is_empty()
    }
}

/// A Player's Last seen out of their sight, kept from tick to tick from what changed (T99.7,
/// ADR 0034), for the broadcast. What a Player remembers changes only at their realm's refresh,
/// which logs it ([`LastSeenState::take_changes`]); what is hidden because it is in sight now
/// changes only near the residents they see through. So a tick looks only at what the refresh
/// touched, at the remembered buildings in the squares their sight reaches, and at what was hidden
/// last tick: never the whole memory, and it turns into JSON only what it may send.
///
/// Its diffs are those of [`last_seen_out_of_sight`] tick to tick, as the sockets' `ClientView`
/// worked them out over the whole list before.
#[derive(Debug)]
pub struct OutOfSight {
    user_id: u64,
    squares: Squares,
    /// Each remembered id: where it stands in the memory, and the square of its corner (none for
    /// a city).
    at: HashMap<String, (usize, Option<i32>)>,
    /// How long the memory was at the last update.
    len: usize,
    /// The remembered buildings by the square of their corner.
    by_square: HashMap<i32, Vec<String>>,
    /// What was hidden at the last update, as in sight then.
    hidden: HashSet<String>,
    /// What is out of sight as last sent: its JSON by id.
    sent: HashMap<String, Arc<str>>,
    /// How many remembered entries it turned into JSON and how many it copied, since it was made:
    /// for the tests that count them.
    pub made_json: usize,
    pub copied: usize,
}

/// The id of a building or city in sight, without copying it.
fn seen_id_ref(e: &SeenEntity) -> Option<&str> {
    match e {
        SeenEntity::Building(b) => Some(&b.building.id),
        SeenEntity::City(c) => Some(&c.city.id),
        _ => None,
    }
}

impl OutOfSight {
    /// What the Player remembers out of sight now, as the welcome sends it: the start to keep it
    /// from. Turns the whole of it into JSON, once.
    pub fn new(
        world: &WorldState,
        index: &WorldIndex,
        cache: Option<&mut SightCache>,
        user_id: u64,
    ) -> Self {
        let mut out = OutOfSight {
            user_id,
            squares: Squares::of(index.size()),
            at: HashMap::new(),
            len: 0,
            by_square: HashMap::new(),
            hidden: HashSet::new(),
            sent: HashMap::new(),
            made_json: 0,
            copied: 0,
        };
        let memory = out.memory(world);
        out.reindex(memory);
        out.hidden = out.hidden_now(world, index, cache, memory);
        for (id, &(i, _)) in &out.at {
            if !out.hidden.contains(id) {
                out.sent.insert(id.clone(), Arc::from(json_string(&memory[i])));
                out.made_json += 1;
            }
        }
        out
    }

    fn memory<'w>(&self, world: &'w WorldState) -> &'w [Remembered] {
        world.last_seen.get(&self.user_id).map_or(&[], Vec::as_slice)
    }

    fn square_of(&self, e: &Remembered) -> Option<i32> {
        match e {
            Remembered::Building(b) => Some(self.squares.key(b.x, b.y)),
            Remembered::City(_) => None,
        }
    }

    /// Where every id stands in the memory, afresh: the first with an id, as a refresh finds it.
    fn reindex(&mut self, memory: &[Remembered]) {
        self.at.clear();
        self.by_square.clear();
        for (i, e) in memory.iter().enumerate() {
            let id = id_of(e);
            if self.at.contains_key(id) {
                continue;
            }
            let square = self.square_of(e);
            if let Some(k) = square {
                self.by_square.entry(k).or_default().push(id.to_owned());
            }
            self.at.insert(id.to_owned(), (i, square));
        }
        self.len = memory.len();
    }

    /// Takes in the entries a refresh appended and the ones it changed in place, where it only
    /// appended. False when the memory does not match what it knew: then it reindexes.
    fn appended(&mut self, memory: &[Remembered], touched: &HashSet<String>) -> bool {
        if memory.len() < self.len {
            return false;
        }
        for (i, e) in memory.iter().enumerate().skip(self.len) {
            let id = id_of(e);
            if self.at.contains_key(id) {
                return false;
            }
            let square = self.square_of(e);
            if let Some(k) = square {
                self.by_square.entry(k).or_default().push(id.to_owned());
            }
            self.at.insert(id.to_owned(), (i, square));
        }
        self.len = memory.len();
        for id in touched {
            let Some(&(i, was)) = self.at.get(id) else { return false };
            if id_of(&memory[i]) != id {
                return false;
            }
            let square = self.square_of(&memory[i]);
            if square != was {
                if let Some(list) = was.and_then(|k| self.by_square.get_mut(&k)) {
                    list.retain(|x| x != id);
                }
                if let Some(k) = square {
                    self.by_square.entry(k).or_default().push(id.clone());
                }
                self.at.insert(id.clone(), (i, square));
            }
        }
        true
    }

    /// The remembered ids hidden now because they are in sight (`last_seen_out_of_sight`'s
    /// filter): those in sight by id, and the remembered buildings with a tile of their
    /// footprint in sight, looked for only in the squares the sight reaches.
    fn hidden_now(
        &self,
        world: &WorldState,
        index: &WorldIndex,
        cache: Option<&mut SightCache>,
        memory: &[Remembered],
    ) -> HashSet<String> {
        let mut hidden = HashSet::new();
        let Some(realm) = world.realms.iter().find(|r| r.user_id == self.user_id) else {
            return hidden;
        };
        if memory.is_empty() {
            return hidden;
        }
        let places = places_in_sight(world, index, &realm.id, None, cache);
        if !places.looking {
            return hidden;
        }
        for e in places.seen.iter() {
            let id = match seen_id_ref(e) {
                Some(id) => std::borrow::Cow::Borrowed(id),
                None => match seen_id(e) {
                    Some(id) => std::borrow::Cow::Owned(id),
                    None => continue,
                },
            };
            if self.at.contains_key(id.as_ref()) {
                hidden.insert(id.into_owned());
            }
        }
        for k in places.eyes.watched() {
            for id in self.by_square.get(k).into_iter().flatten() {
                if hidden.contains(id) {
                    continue;
                }
                let e = &memory[self.at[id].0];
                if placed_of(e).is_some_and(|p| places.sees(p)) {
                    hidden.insert(id.clone());
                }
            }
        }
        hidden
    }

    /// What changed out of sight since the last update, `changes` being what the refreshes
    /// changed in the memory meanwhile. A memory changed otherwise (a test writing it) is noticed
    /// only when its length changed; then everything is looked at again.
    pub fn update(
        &mut self,
        world: &WorldState,
        index: &WorldIndex,
        cache: Option<&mut SightCache>,
        changes: Option<&MemoryChanges>,
    ) -> OutOfSightDiff {
        let memory = self.memory(world);
        let none = MemoryChanges::default();
        let changes = changes.unwrap_or(&none);
        let mut candidates: HashSet<String> = HashSet::new();
        // Where each id stood before, for the order of what left: kept only when it moved.
        let mut before: Option<HashMap<String, (usize, Option<i32>)>> = None;
        let known = self.len;
        let mut lost = changes.is_empty() && memory.len() != known;
        if !changes.is_empty() {
            if changes.removed.is_empty() {
                if self.appended(memory, &changes.touched) {
                    candidates.extend(memory[known..].iter().map(|e| id_of(e).to_owned()));
                } else {
                    lost = true;
                }
            } else {
                // Something was forgotten: what stands after it moved up.
                before = Some(self.at.clone());
                self.reindex(memory);
                let was = before.as_ref().expect("just kept");
                candidates.extend(self.at.keys().filter(|id| !was.contains_key(*id)).cloned());
            }
            candidates.extend(changes.touched.iter().cloned());
            candidates.extend(changes.removed.iter().cloned());
        }
        if lost {
            // The memory is not what the log says: look at all of it again.
            before = Some(before.unwrap_or_else(|| self.at.clone()));
            self.reindex(memory);
            candidates.extend(self.at.keys().cloned());
            candidates.extend(self.sent.keys().cloned());
        }
        let hidden = self.hidden_now(world, index, cache, memory);
        candidates.extend(self.hidden.symmetric_difference(&hidden).cloned());
        self.hidden = hidden;
        let mut changed: Vec<(usize, Remembered)> = Vec::new();
        let mut gone: Vec<(usize, String)> = Vec::new();
        for id in candidates {
            let now = self.at.get(&id).map(|&(i, _)| i).filter(|_| !self.hidden.contains(&id));
            match now {
                Some(i) => {
                    let json: Arc<str> = Arc::from(json_string(&memory[i]));
                    self.made_json += 1;
                    if self.sent.get(&id) != Some(&json) {
                        changed.push((i, memory[i].clone()));
                        self.copied += 1;
                        self.sent.insert(id, json);
                    }
                }
                None => {
                    if self.sent.remove(&id).is_some() {
                        let was = before.as_ref().unwrap_or(&self.at);
                        gone.push((was.get(&id).map_or(usize::MAX, |&(i, _)| i), id));
                    }
                }
            }
        }
        changed.sort_by_key(|(i, _)| *i);
        gone.sort();
        OutOfSightDiff {
            changed: changed.into_iter().map(|(_, e)| e).collect(),
            gone: gone.into_iter().map(|(_, id)| id).collect(),
        }
    }
}

/// A remembered entry as the tick message sends it.
fn json_string(e: &Remembered) -> String {
    serde_json::to_string(e).expect("serialisable")
}

/// Invariant (ADR 0004): a realm's Last seen keeps to its cadence (`lastSeenOnCadence`).
pub fn last_seen_on_cadence(
    world: &WorldState,
    state: &LastSeenState,
    realm_id: &str,
) -> Vec<InvariantViolation> {
    let name = "last-seen-on-cadence";
    let realm = world.realms.iter().find(|r| r.id == realm_id);
    let (Some(realm), Some(at)) = (realm, state.refreshed_at(realm_id)) else { return Vec::new() };
    let mut out = Vec::new();
    if (world.tick - at) as f64 >= LAST_SEEN_EVERY_TICKS {
        out.push(InvariantViolation {
            invariant: name.into(),
            message: format!(
                "realm {realm_id}'s last seen was refreshed at tick {at}, {} ticks ago",
                world.tick - at
            ),
            entity_ids: vec![realm_id.into()],
        });
    }
    for e in world.last_seen.get(&realm.user_id).into_iter().flatten() {
        let (is, seen_at) = match e {
            Remembered::Building(b) => ("building", b.seen_at),
            Remembered::City(c) => ("city", c.seen_at),
        };
        if seen_at <= at as f64 {
            continue;
        }
        out.push(InvariantViolation {
            invariant: name.into(),
            message: format!(
                "{is} {} is remembered by realm {realm_id} as of tick {}, after its last refresh at {at}",
                id_of(e),
                crate::invariants::js_number(seen_at)
            ),
            entity_ids: vec![id_of(e).into(), realm_id.into()],
        });
    }
    out
}

/// Invariant (ADR 0004): what goes to a Player as Last seen is out of their sight
/// (`lastSeenInSight`), checked afresh.
pub fn last_seen_in_sight(
    world: &WorldState,
    terrain: &TerrainMap,
    realm_id: &str,
    sent: &[Remembered],
) -> Vec<InvariantViolation> {
    let index = WorldIndex::new(world, terrain.size);
    let places = places_in_sight(world, &index, realm_id, None, None);
    let in_sight: HashSet<String> = places.seen.iter().filter_map(seen_id).collect();
    sent.iter()
        .filter(|e| in_sight.contains(id_of(e)) || placed_of(e).is_some_and(|p| places.sees(p)))
        .map(|e| {
            let is = if matches!(e, Remembered::Building(_)) { "building" } else { "city" };
            InvariantViolation {
                invariant: "last-seen-out-of-sight".into(),
                message: format!(
                    "{is} {} was sent to realm {realm_id} as last seen while in its sight",
                    id_of(e)
                ),
                entity_ids: vec![id_of(e).into(), realm_id.into()],
            }
        })
        .collect()
}
