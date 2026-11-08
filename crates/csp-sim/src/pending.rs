//! Minimal stand-ins for helpers other rule tickets own, so the conflict rules (T86.7) can call
//! them before those land. Each says whose it is; the ticket that ports the real one replaces the
//! call sites and deletes the stand-in here.

use std::collections::HashSet;

use csp_shared::balance::{MAP_SIZE, REALM_LOG_LENGTH};
use csp_shared::world::{
    DeathCause, Good, Pile, Realm, RealmEvent, RealmEventWhat, Stock, WorldState,
};

use crate::queries::building::building_at;

/// `recordEvent` (TODO(T86.13), `events.ts`): writes down something that happened in a realm, in
/// its Player's log; an event for no realm is not kept. Each Player keeps their latest
/// `REALM_LOG_LENGTH` events.
pub(crate) fn record_event(world: &mut WorldState, realm_id: Option<&str>, what: RealmEventWhat) {
    let Some(user_id) = realm_id.and_then(|id| world.realms.iter().find(|r| r.id == id)).map(|r| r.user_id)
    else {
        return;
    };
    let seq = world.next_id;
    world.next_id += 1;
    world.events.push(RealmEvent { seq, tick: world.tick, user_id, what });
    let mine = world.events.iter().filter(|e| e.user_id == user_id).count();
    let keep = REALM_LOG_LENGTH as usize;
    if mine > keep {
        let mut drop = mine - keep;
        world.events.retain(|e| {
            if drop > 0 && e.user_id == user_id {
                drop -= 1;
                return false;
            }
            true
        });
    }
}

/// `pileTile` (TODO(T86.6), shared `building.ts`): on a building's footprint its north-west
/// tile, elsewhere the tile itself.
fn pile_tile(world: &WorldState, x: f64, y: f64, size: i32) -> (f64, f64) {
    building_at(world, x as i32, y as i32, size).map_or((x, y), |b| (b.x, b.y))
}

/// `dropGoods` (TODO(T86.3), `survival.ts`): puts goods in the pile reached from a tile,
/// starting one if there is none and there is anything to drop. The TypeScript callers here leave
/// the size out, so it is `MAP_SIZE`.
pub(crate) fn drop_goods(world: &mut WorldState, x: f64, y: f64, stock: &Stock) {
    let goods: Vec<(Good, f64)> = stock.iter().filter(|(_, n)| **n > 0.0).map(|(g, n)| (*g, *n)).collect();
    if goods.is_empty() {
        return;
    }
    let (px, py) = pile_tile(world, x, y, MAP_SIZE);
    let i = match world.piles.iter().position(|p| p.x == px && p.y == py) {
        Some(i) => i,
        None => {
            let id = format!("pile{}", world.next_id);
            world.next_id += 1;
            world.piles.push(Pile { id, x: px, y: py, goods: Stock::new() });
            world.piles.len() - 1
        }
    };
    let pile = &mut world.piles[i];
    for (g, n) in goods {
        *pile.goods.entry(g).or_insert(0.0) += n;
    }
}

/// `noteMade` (TODO(T86.1), `goods-made.ts`): goods that came from nothing this tick, for the
/// goods tally. The tally lives with the tick runner; until it lands nothing is noted.
pub(crate) fn note_made(_world: &mut WorldState, _goods: &Stock) {}

/// `dieAll` (TODO(T86.3), `survival.ts`): residents die of `cause`, each death in their
/// Player's log, then each is removed and drops what they carried, their pair ending with them.
/// Not yet here: soldiers counted killed, leaving caravans, and a Leader's death ending the realm
/// (`endRealm`); the realms whose Leader died are returned as the TypeScript returns them.
pub(crate) fn die_all(
    world: &mut WorldState,
    died: &[String],
    cause: DeathCause,
    _size: i32,
    killers: &[(String, String)],
) -> Vec<Realm> {
    for id in died {
        let Some(r) = world.residents.iter().find(|r| r.id == *id) else { continue };
        let leader = world.realms.iter().any(|x| x.leader_id == r.id);
        let by = killers.iter().find(|(k, _)| k == id).map(|(_, by)| by.clone());
        let (owner, what) = (
            r.owner.clone(),
            RealmEventWhat::Died { resident_id: r.id.clone(), name: r.name.clone(), cause, leader, by },
        );
        record_event(world, owner.as_deref(), what);
    }
    let mut ended = Vec::new();
    for id in died {
        let Some(i) = world.residents.iter().position(|r| r.id == *id) else { continue };
        let r = world.residents.remove(i);
        drop_goods(world, r.x, r.y, &r.carried);
        if let Some(p) = &r.pair {
            if let Some(partner) = world.residents.iter_mut().find(|x| x.id == p.partner_id) {
                if partner.pair.as_ref().is_some_and(|q| q.partner_id == r.id) {
                    partner.pair = None;
                }
            }
        }
        if let Some(realm) = world.realms.iter().find(|x| x.leader_id == r.id) {
            ended.push(realm.clone());
        }
    }
    ended
}

/// A city the Trade Organization took (`CityTaken` of `trade-org-takes.ts`, TODO(T86.9)).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CityTaken {
    pub city_id: String,
    pub org: String,
    pub trips: f64,
    pub enough_trips: bool,
}

/// `noteCityTaken` (TODO(T86.9), `trade-org-takes.ts`): the ledger lives beside the world there.
pub(crate) fn note_city_taken(_world: &mut WorldState, _taken: CityTaken) {}

/// `workplacesOfCity` (TODO(T86.9), `trade-org-wrecks.ts`): building ids. None until it lands.
pub(crate) fn workplaces_of_city(_world: &WorldState, _city_id: &str, _size: i32) -> Vec<String> {
    Vec::new()
}

/// `joinTradeOrg` (TODO(T86.9), `caravans.ts`).
pub(crate) fn join_trade_org(_world: &mut WorldState, _city_id: &str, _size: i32) {}

/// `leaveTradeOrg` (TODO(T86.9), `caravans.ts`): a post stops being one. Only a post does
/// anything there, and none of this ticket's tests has one.
pub(crate) fn leave_trade_org(_world: &mut WorldState, _city_id: &str) {}

/// `rejoinTradeOrg` (TODO(T86.9), `caravans.ts`).
pub(crate) fn rejoin_trade_org(_world: &mut WorldState, _city_id: &str, _size: i32) {}

/// `hqFalls` (TODO(T86.9), `hq-fall.ts`).
pub(crate) fn hq_falls(_world: &mut WorldState, _city_id: &str) {}

const ROMAN: [(u32, &str); 13] = [
    (1000, "M"),
    (900, "CM"),
    (500, "D"),
    (400, "CD"),
    (100, "C"),
    (90, "XC"),
    (50, "L"),
    (40, "XL"),
    (10, "X"),
    (9, "IX"),
    (5, "V"),
    (4, "IV"),
    (1, "I"),
];

/// `numeral` (TODO(T86.3), `names.ts`): `n` in Roman numerals.
fn numeral(mut n: u32) -> String {
    let mut out = String::new();
    for (value, letters) in ROMAN {
        while n >= value {
            out.push_str(letters);
            n -= value;
        }
    }
    out
}

/// `baseName` (TODO(T86.3), `names.ts`): a name without the numeral the game may have added.
fn base_name(name: &str) -> &str {
    match name.rfind(' ') {
        Some(i) if i + 1 < name.len() && name[i + 1..].chars().all(|c| "IVXLCDM".contains(c)) => &name[..i],
        _ => name,
    }
}

/// `uniqueName` (TODO(T86.3), `names.ts`): `drawn` if free, else the next free name of `pool`
/// after it, else `drawn` with the lowest free numeral.
pub(crate) fn unique_name(drawn: &str, taken: &HashSet<String>, pool: &[&str]) -> String {
    if !taken.contains(drawn) {
        return drawn.to_string();
    }
    let len = pool.len() as i64;
    let start = pool.iter().position(|p| *p == drawn).map_or(-1, |i| i as i64);
    for i in 1..=len {
        let name = pool[((start + i) % len) as usize];
        if !taken.contains(name) {
            return name.to_string();
        }
    }
    let base = base_name(drawn);
    (2..).map(|n| format!("{base} {}", numeral(n))).find(|n| !taken.contains(n)).expect("names never run out")
}

/// `residentNamesTaken` (TODO(T86.3), `names.ts`): the names of the living residents of the realm
/// a resident of `owner` living in `city_id` belongs to, an NPC city counting as one.
pub(crate) fn resident_names_taken(world: &WorldState, owner: Option<&str>, city_id: Option<&str>) -> HashSet<String> {
    if owner.is_none() && city_id.is_none() {
        return HashSet::new();
    }
    world
        .residents
        .iter()
        .filter(|r| {
            r.health > 0.0
                && match owner {
                    Some(o) => r.owner.as_deref() == Some(o),
                    None => r.owner.is_none() && r.city_id.as_deref() == city_id,
                }
        })
        .map(|r| r.name.clone())
        .collect()
}

/// Who sent an order (`OrderSender`, TODO(T86.2), `orders.ts`): a Player's account, or an NPC
/// city running the game's default scripts for its residents (`user_id` 0 then).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sender {
    pub user_id: u64,
    pub npc_city_id: Option<String>,
}

/// `orderedResident` (TODO(T86.2), `order-sender.ts`): the index of the resident an order names,
/// if its sender may order them.
pub(crate) fn ordered_resident(world: &WorldState, sender: &Sender, resident_id: Option<&str>) -> Option<usize> {
    let i = world.residents.iter().position(|x| Some(x.id.as_str()) == resident_id);
    if let Some(npc) = &sender.npc_city_id {
        let r = &world.residents[i?];
        let runs = r.owner.is_none()
            && r.city_id.as_ref() == Some(npc)
            && crate::queries::alliance::contract_of(world, &r.id).is_none();
        return if runs { i } else { None };
    }
    let realm = world.realms.iter().find(|r| r.user_id == sender.user_id)?;
    let r = i.map(|i| &world.residents[i]);
    if crate::queries::alliance::commands(world, &realm.id, r) { i } else { None }
}
