//! Last seen (`apps/server/src/last-seen.ts`, `CONTEXT.md`: Last seen): what each Player
//! remembers of buildings and cities once out of their sight, brought up to date for each realm
//! once every `LAST_SEEN_EVERY_TICKS`, staggered by its id (T49.9).

use std::collections::{HashMap, HashSet};

use csp_shared::balance::LAST_SEEN_EVERY_TICKS;
use csp_shared::footprint::Placed;
use csp_shared::protocol::SeenEntity;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Remembered, WorldState};
use serde_json::Value;

use crate::queries::names::kind_name;
use crate::random::hash_str;
use crate::sight::{buildings_by_square, places_in_sight, InvariantViolation, SightCache};
use crate::world_index::{world_index, WorldIndex};

/// When each realm's Last seen was last brought up to date, whether it had anyone to see through
/// then, and the realms whose Player just connected (`refreshes`, `soon`). Scratch like the sight
/// cache's, never saved (ADR 0006): after a restart every realm refreshes on the first tick.
#[derive(Debug, Default, Clone)]
pub struct LastSeenState {
    refreshes: HashMap<String, Refresh>,
    soon: HashSet<String>,
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
        let before = world.last_seen.get(&user_id).cloned().unwrap_or_default();
        if places.seen.is_empty() && before.is_empty() {
            continue;
        }
        // `new Map(before.map(...))`, keeping the order things were first remembered in.
        let mut memory: Vec<Remembered> = before;
        let in_sight: HashSet<String> = places.seen.iter().filter_map(seen_id).collect();
        // Its spot is in sight again and it is not there any more.
        memory.retain(|e| match placed_of(e) {
            Some(p) => in_sight.contains(id_of(e)) || !places.sees(p),
            None => true,
        });
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
            let was = memory.iter().position(|e| id_of(e) == id);
            if let Some(i) = was.filter(|&i| json_of(&memory[i]) == v) {
                *seen_at_mut(&mut memory[i]) = world.tick as f64;
                continue;
            }
            v.as_object_mut().expect("an object").insert("seenAt".into(), Value::from(world.tick));
            let Ok(copy) = serde_json::from_value::<Remembered>(v) else { continue };
            match was {
                Some(i) => memory[i] = copy,
                None => memory.push(copy),
            }
        }
        let cities: HashSet<String> = memory
            .iter()
            .filter_map(|e| match e {
                Remembered::Building(b) => b.city_id.clone(),
                Remembered::City(_) => None,
            })
            .collect();
        memory.retain(|e| match e {
            Remembered::City(c) => cities.contains(&c.id),
            Remembered::Building(_) => true,
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
