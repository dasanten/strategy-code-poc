//! The Horse grant and the Horse offer (`apps/server/src/horse-grant.ts`, `CONTEXT.md`: Horse
//! grant, Horse offer): new horses for a Player realm, in its stable or by its storage or Leader.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{HORSE_GRANT_FOOD, HORSE_GRANT_HORSES};
use csp_shared::footprint::{footprint_keys, middle_of, FOOTPRINT};
use csp_shared::terrain::{wrap, wrap_distance, TerrainMap};
use csp_shared::world::{
    BuildingKind, Good, HorsesWhere, OrderRequest, Pile, Realm, RealmEventWhat, WorldState,
};

use crate::horses::{new_horse, NewHorse};
use crate::movement_pending::{realm_of, record_event, OrderKind, OrderSender};
use crate::queries::names::placed;
use crate::random::{new_id, Mulberry32};
use crate::sight::InvariantViolation;
use crate::world::is_walkable;

/// How far out from the storage or the Leader the grant looks for free tiles, in rings.
const GRANT_REACH: i32 = 6;

/// Where new horses went (`horsesGranted` / `horsesClaimed` without the kind).
#[derive(Debug, Clone, PartialEq)]
pub struct Granted {
    pub horse_ids: Vec<String>,
    pub r#where: HorsesWhere,
    pub city: Option<String>,
    pub x: f64,
    pub y: f64,
}

/// The one-time Horse grant (`grantHorses`), run by a world migration: every Player realm with a
/// living Leader and no horse at all gets `HORSE_GRANT_HORSES` new horses (`place_new_horses`),
/// and its realm log says where.
pub fn grant_horses(world: &mut WorldState, terrain: &TerrainMap) {
    let realms = world.realms.clone();
    for realm in &realms {
        if world.horses.iter().any(|h| h.realm_id.as_deref() == Some(realm.id.as_str())) {
            continue;
        }
        let seed = world.seed as f64 * 7919.0 + realm.user_id as f64 + 2.0;
        if let Some(g) = place_new_horses(world, terrain, realm, seed) {
            let what = RealmEventWhat::HorsesGranted {
                horse_ids: g.horse_ids,
                r#where: g.r#where,
                city: g.city,
                x: g.x,
                y: g.y,
            };
            record_event(world, Some(&realm.id), what);
        }
    }
}

/// Gives a realm with a living Leader `HORSE_GRANT_HORSES` new horses drawn from `seed`
/// (`placeNewHorses`): in its finished stable nearest the Leader's city; with none, on free tiles
/// next to the storage of the Leader's city (or the realm's oldest city; with no city, next to the
/// Leader), each with `HORSE_GRANT_FOOD` on the ground by it. Nothing when the Leader is dead or
/// there is no room.
fn place_new_horses(
    world: &mut WorldState,
    terrain: &TerrainMap,
    realm: &Realm,
    seed: f64,
) -> Option<Granted> {
    let size = terrain.size;
    let leader = world.residents.iter().find(|r| r.id == realm.leader_id)?;
    let (leader_at, leader_city) = ((leader.x, leader.y), leader.city_id.clone());
    // `world.cities` keeps the order cities were founded or taken in: the first is the oldest.
    let cities: Vec<_> =
        world.cities.iter().filter(|c| c.realm_id.as_deref() == Some(realm.id.as_str())).collect();
    let city = cities
        .iter()
        .find(|c| Some(&c.id) == leader_city.as_ref())
        .or(cities.first())
        .map(|c| (*c).clone());
    let hall = city.as_ref().and_then(|c| world.buildings.iter().find(|b| b.id == c.town_hall_id));
    let from =
        hall.map_or((leader_at.0 as i32, leader_at.1 as i32), |h| middle_of(placed(h), size));
    let ids: HashSet<&str> = cities.iter().map(|c| c.id.as_str()).collect();
    let away =
        |b: &csp_shared::world::Building| wrap_distance(size, from, middle_of(placed(b), size));
    let stable = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Stable
                && b.site.is_none()
                && b.city_id.as_deref().is_some_and(|c| ids.contains(c))
        })
        .min_by(|a, b| away(a).total_cmp(&away(b)))
        .cloned();
    let mut rand = Mulberry32::new(seed);
    let mut add = |world: &mut WorldState, x: f64, y: f64| {
        let id = new_id("horse", &mut world.next_id);
        let mut next = || rand.next();
        let fields = NewHorse {
            id: id.clone(),
            realm_id: Some(realm.id.clone()),
            city_id: None,
            x,
            y,
            tick: world.tick as f64,
        };
        let h = new_horse(&mut next, fields);
        world.horses.push(h);
        id
    };
    if let Some(stable) = stable {
        let horse_ids =
            (0..HORSE_GRANT_HORSES as usize).map(|_| add(world, stable.x, stable.y)).collect();
        let name = world
            .cities
            .iter()
            .find(|c| Some(&c.id) == stable.city_id.as_ref())
            .map(|c| c.name.clone());
        return Some(Granted {
            horse_ids,
            r#where: HorsesWhere::Stable,
            city: name,
            x: stable.x,
            y: stable.y,
        });
    }
    let storage = city.as_ref().and_then(|c| {
        world.buildings.iter().find(|b| {
            b.kind == BuildingKind::Storage && b.site.is_none() && b.city_id.as_ref() == Some(&c.id)
        })
    });
    let at = match storage {
        Some(s) => (s.x as i32, s.y as i32, FOOTPRINT.get("storage").expect("a footprint")),
        None => (leader_at.0 as i32, leader_at.1 as i32, 1),
    };
    let has_storage = storage.is_some();
    let tiles = free_tiles_around(world, terrain, at);
    if tiles.is_empty() {
        return None;
    }
    let mut horse_ids = Vec::new();
    for &(x, y) in &tiles {
        let id = new_id("pile", &mut world.next_id);
        let goods = [(Good::Food, HORSE_GRANT_FOOD)].into_iter().collect();
        world.piles.push(Pile { id, x: f64::from(x), y: f64::from(y), goods });
        horse_ids.push(add(world, f64::from(x), f64::from(y)));
    }
    let (x, y) = (f64::from(tiles[0].0), f64::from(tiles[0].1));
    Some(if has_storage {
        Granted { horse_ids, r#where: HorsesWhere::Storage, city: city.map(|c| c.name), x, y }
    } else {
        Granted { horse_ids, r#where: HorsesWhere::Leader, city: None, x, y }
    })
}

/// Why a Player can't claim their Horse offer now (`horseOfferProblem`).
pub fn horse_offer_problem(world: &WorldState, user_id: u64) -> Option<String> {
    if world.horse_offers_claimed.contains(&user_id) {
        return Some("you have claimed your horses already".into());
    }
    let alive = realm_of(world, user_id)
        .is_some_and(|realm| world.residents.iter().any(|r| r.id == realm.leader_id));
    (!alive).then(|| "you have no living Leader".into())
}

/// The claim order (`claimHorses`): the Player's realm gets two new horses placed as the Horse
/// grant places them, and the offer is claimed until an admin re-opens it. With no room for them
/// the offer stays open.
pub struct ClaimHorses;

impl OrderKind for ClaimHorses {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        _order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        if terrain.is_none() {
            return Some("no map to place horses on".into());
        }
        horse_offer_problem(world, sender.user_id)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        _order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Some(terrain) = terrain else { return };
        if horse_offer_problem(world, sender.user_id).is_some() {
            return;
        }
        let realm = realm_of(world, sender.user_id).expect("a realm with a living Leader").clone();
        // Seeded by the tick too, so the claimed horses are drawn apart from any granted ones.
        let seed =
            world.seed as f64 * 7919.0 + realm.user_id as f64 * 31.0 + world.tick as f64 + 3.0;
        let Some(g) = place_new_horses(world, terrain, &realm, seed) else { return };
        world.horse_offers_claimed.push(sender.user_id);
        let what = RealmEventWhat::HorsesClaimed {
            horse_ids: g.horse_ids,
            r#where: g.r#where,
            city: g.city,
            x: g.x,
            y: g.y,
        };
        record_event(world, Some(&realm.id), what);
    }
}

/// The invariant `horse-offers-once` (`horseOffersOnce`): no account id is in
/// `horseOffersClaimed` twice.
pub fn horse_offers_once(world: &WorldState) -> Vec<InvariantViolation> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for &user_id in &world.horse_offers_claimed {
        if !seen.insert(user_id) {
            out.push(InvariantViolation {
                invariant: "horse-offers-once".into(),
                message: format!("Player {user_id} claimed their Horse offer more than once"),
                entity_ids: Vec::new(),
            });
        }
    }
    out
}

/// Up to `HORSE_GRANT_HORSES` walkable tiles around a footprint of `side` with its north-west
/// tile at (x, y), nearest ring first, that no building covers (roads aside), with no node and
/// nothing standing or lying on them (`freeTilesAround`).
fn free_tiles_around(
    world: &WorldState,
    terrain: &TerrainMap,
    (ax, ay, side): (i32, i32, i32),
) -> Vec<(i32, i32)> {
    // TODO(T86.5): `placing::Ground` (`free`, `node_at`); TODO(T86.8): `starting_city::resident_tiles`.
    let mut taken: HashSet<String> = HashSet::new();
    for b in &world.buildings {
        if b.kind != BuildingKind::Road {
            taken.extend(footprint_keys(placed(b), terrain.size));
        }
    }
    let nodes: HashMap<String, ()> =
        world.nodes.iter().map(|n| (format!("{},{}", n.x, n.y), ())).collect();
    let at = |x: f64, y: f64| format!("{x},{y}");
    taken.extend(world.residents.iter().map(|e| at(e.x, e.y)));
    taken.extend(world.horses.iter().map(|e| at(e.x, e.y)));
    taken.extend(world.carriages.iter().map(|e| at(e.x, e.y)));
    taken.extend(world.piles.iter().map(|e| at(e.x, e.y)));
    let mut out = Vec::new();
    for ring in 1..=GRANT_REACH {
        for dy in -ring..side + ring {
            for dx in -ring..side + ring {
                let edge =
                    dx == -ring || dy == -ring || dx == side + ring - 1 || dy == side + ring - 1;
                if !edge {
                    continue;
                }
                let (x, y) = (wrap(ax + dx, terrain.size), wrap(ay + dy, terrain.size));
                let key = format!("{x},{y}");
                if !is_walkable(terrain, x, y) || taken.contains(&key) || nodes.contains_key(&key) {
                    continue;
                }
                out.push((x, y));
                if out.len() == HORSE_GRANT_HORSES as usize {
                    return out;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement_test_world::{building, plains, resident, world_with_realm};

    #[test]
    fn grants_a_realm_without_horses_two_by_its_leader_with_food_and_logs_where() {
        let map = plains(16);
        let mut world = world_with_realm(&map);
        world.residents.push(resident("w1", Some("r1"), 5.0, 5.0));
        grant_horses(&mut world, &map);
        assert_eq!(world.horses.len(), HORSE_GRANT_HORSES as usize);
        assert!(world.horses.iter().all(|h| h.realm_id.as_deref() == Some("r1")));
        assert_eq!(world.piles.len(), HORSE_GRANT_HORSES as usize);
        // Nearest ring first, north-west corner first.
        assert_eq!((world.horses[0].x, world.horses[0].y), (4.0, 4.0));
        let events: Vec<_> = world.events.iter().map(|e| &e.what).collect();
        assert!(matches!(
            events[..],
            [RealmEventWhat::HorsesGranted { r#where: HorsesWhere::Leader, .. }]
        ));
        // Once it has horses, a second grant gives none.
        grant_horses(&mut world, &map);
        assert_eq!(world.horses.len(), HORSE_GRANT_HORSES as usize);
    }

    #[test]
    fn a_claim_needs_a_living_leader_and_counts_once() {
        let map = plains(16);
        let mut world = world_with_realm(&map);
        let me = OrderSender { user_id: 7, npc_city_id: None };
        let claim: OrderRequest =
            serde_json::from_value(serde_json::json!({"kind": "claimHorses"})).expect("an order");
        assert_eq!(
            ClaimHorses.validate(&world, &me, &claim, Some(&map)).as_deref(),
            Some("you have no living Leader")
        );
        world.residents.push(resident("w1", Some("r1"), 5.0, 5.0));
        world.buildings.push(building("s1", BuildingKind::Stable, 9.0, 9.0));
        assert_eq!(ClaimHorses.validate(&world, &me, &claim, Some(&map)), None);
        ClaimHorses.apply(&mut world, &me, &claim, Some(&map));
        assert_eq!(world.horses.len(), HORSE_GRANT_HORSES as usize);
        assert_eq!(
            ClaimHorses.validate(&world, &me, &claim, Some(&map)).as_deref(),
            Some("you have claimed your horses already")
        );
        assert!(horse_offers_once(&world).is_empty());
        world.horse_offers_claimed.push(7);
        assert_eq!(horse_offers_once(&world).len(), 1);
    }
}
