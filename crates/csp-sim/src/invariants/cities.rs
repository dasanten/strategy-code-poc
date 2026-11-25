//! Cities: their area, residents, workplaces, occupation and territory.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{CITY_AREA_MARGIN, OCCUPATION_GAME_DAYS};
use csp_shared::footprint::{is_at, near_footprint};
use csp_shared::terrain::{wrap_delta, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, ResidentOrder, WorldState};

use super::shared::{npc_cities, Out};
use super::{invariant, js_number, violation, Invariant, InvariantViolation};
use crate::caravans::caravan_crew;
use crate::queries::alliance::allied_realms;
use crate::queries::building::max_workers;
use crate::queries::city_area::{city_membership, is_city_building};
use crate::queries::command::commander_of_resident;
use crate::queries::names::{kind_name, placed};
use crate::queries::residents::is_armed;
use crate::queries::standing::TRADE_ORG;
use crate::queries::territory::{
    city_organization, compute_territory, control_at, control_sources,
};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("city-names-well-formed", |w, _| crate::renaming::city_names_well_formed(w)),
    invariant("city-game-names-unique", |w, _| crate::names::city_game_names_unique(w)),
    invariant("cities-from-buildings", cities_from_buildings),
    invariant("outpost-storage-realms", outpost_storage_realms),
    invariant("residents-in-cities", residents_in_cities),
    invariant("npc-city-residents-unowned", npc_city_residents_unowned),
    invariant("city-residents-in-its-realm", city_residents_in_its_realm),
    invariant("relocate-orders-sound", relocate_orders_sound),
    invariant("occupations-sound", occupations_sound),
    invariant("city-workplaces-sound", city_workplaces_sound),
    invariant("territory-sound", territory_sound),
    invariant("outsiders-sound", outsiders_sound),
];

/// Every city has exactly one town hall, a finished one that belongs to it; every town hall makes
/// a city; and every finished city building belongs to the city its chain gives it
/// (`citiesFromBuildings`).
pub fn cities_from_buildings(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "cities-from-buildings";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    let mut halls: HashMap<&str, &str> = HashMap::new();
    for c in &world.cities {
        let hall = world.buildings.iter().find(|b| b.id == c.town_hall_id);
        match hall {
            Some(h) if h.kind == BuildingKind::TownHall && h.site.is_none() => {
                if halls.contains_key(h.id.as_str()) {
                    fail(&c.id, format!("shares town hall {} with another city", h.id));
                } else {
                    halls.insert(&h.id, &c.id);
                }
            }
            _ => fail(&c.id, "has no town hall".into()),
        }
    }
    let members = city_membership(world, terrain.size);
    for b in &world.buildings {
        if b.kind == BuildingKind::TownHall
            && b.site.is_none()
            && !halls.contains_key(b.id.as_str())
        {
            fail(&b.id, "makes no city".into());
        }
        if !is_city_building(b) {
            continue;
        }
        let city = members.get(&b.id);
        if b.city_id.as_ref() != city {
            let say = |c: Option<&String>| c.map_or("null".to_string(), |c| c.clone());
            fail(
                &b.id,
                format!("belongs to city {}, but stands in {}", say(b.city_id.as_ref()), say(city)),
            );
        }
    }
    out
}

/// Only an outpost storage or a construction site has a realm of its own, and only one that
/// exists (`outpostStorageRealms`).
pub fn outpost_storage_realms(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "outpost-storage-realms";
    let realms: HashSet<&str> = world.realms.iter().map(|r| r.id.as_str()).collect();
    let mut out = Vec::new();
    for b in &world.buildings {
        let Some(realm) = &b.realm_id else { continue };
        let outpost = b.kind == BuildingKind::Storage && b.site.is_none() && b.city_id.is_none();
        let why = if !outpost && b.site.is_none() {
            let of = b.city_id.as_ref().map(|c| format!(" of city {c}")).unwrap_or_default();
            Some(format!("is a {}{of} with realm {realm}", kind_name(b.kind)))
        } else if !realms.contains(realm.as_str()) {
            Some(format!("belongs to realm {realm}, which doesn't exist"))
        } else {
            None
        };
        if let Some(why) = why {
            out.push(violation(name, format!("{} {why}", b.id), &[&b.id]));
        }
    }
    out
}

/// How many of a territory's tiles `territory_sound` passes over for each it works out again
/// (`TERRITORY_CHECK_STRIDE`).
const TERRITORY_CHECK_STRIDE: usize = 37;

/// Territory is derived soundly (`territorySound`, `CONTEXT.md`: Territory): every tile in it
/// belongs to an Organization that exists (a realm, or a city of no realm) and lies within reach
/// of one of that Organization's cities or guarded workplaces, and no other Organization projects
/// as much control onto it. The control on a tile is worked out apart from the territory,
/// straight from each source's tiles, for every `TERRITORY_CHECK_STRIDE`th tile of it.
pub fn territory_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "territory-sound";
    let size = terrain.size;
    let organizations: HashSet<&str> = world
        .realms
        .iter()
        .map(|r| r.id.as_str())
        .chain(world.cities.iter().filter(|c| c.realm_id.is_none()).map(city_organization))
        .collect();
    let sources = control_sources(world, size);
    // Each source's tiles as a box round its first one, to pass over the sources out of reach.
    struct Box {
        o: (i32, i32),
        x0: i32,
        x1: i32,
        y0: i32,
        y1: i32,
    }
    let boxes: Vec<Box> = sources
        .iter()
        .map(|s| {
            let o = s.tiles[0];
            let dxs = s.tiles.iter().map(|t| wrap_delta(o.0, t.0, size));
            let dys = s.tiles.iter().map(|t| wrap_delta(o.1, t.1, size));
            let (x0, x1) = dxs.fold((i32::MAX, i32::MIN), |(lo, hi), v| (lo.min(v), hi.max(v)));
            let (y0, y1) = dys.fold((i32::MAX, i32::MIN), |(lo, hi), v| (lo.min(v), hi.max(v)));
            Box { o, x0, x1, y0, y1 }
        })
        .collect();
    // Each Organization's control on a tile, worked out apart from the territory.
    let control_at_tile = |x: i32, y: i32| -> indexmap::IndexMap<&str, f64> {
        let mut control: indexmap::IndexMap<&str, f64> = indexmap::IndexMap::new();
        for (k, s) in sources.iter().enumerate() {
            let b = &boxes[k];
            let dx = wrap_delta(b.o.0, x, size);
            let dy = wrap_delta(b.o.1, y, size);
            // Measured the short way round from its first tile, the box holds only while it and
            // the reach take up less than half the map.
            let small = f64::from((b.x1 - b.x0).max(b.y1 - b.y0)) + s.reach < f64::from(size) / 2.0;
            let gap = f64::from((b.x0 - dx).max(0).max(dx - b.x1))
                .hypot(f64::from((b.y0 - dy).max(0).max(dy - b.y1)));
            if small && gap > s.reach {
                continue;
            }
            // The nearest of its tiles, by squared distance, passing over those too far along a
            // side.
            let mut d2 = f64::INFINITY;
            for t in &s.tiles {
                let tx = f64::from(wrap_delta(t.0, x, size));
                if tx * tx >= d2 {
                    continue;
                }
                let ty = f64::from(wrap_delta(t.1, y, size));
                d2 = d2.min(tx * tx + ty * ty);
            }
            let c = control_at(s.strength, s.reach, d2.sqrt());
            if c > control.get(s.owner.as_str()).copied().unwrap_or(0.0) {
                control.insert(s.owner.as_str(), c);
            }
        }
        control
    };
    let mut out = Vec::new();
    let mut fail = |key: &str, owner: &str, message: String| {
        out.push(violation(name, format!("tile ({key}) {message}"), &[owner]));
    };
    for (i, (&index, owner)) in compute_territory(world, size).owners.iter().enumerate() {
        let (x, y) = ((index % size as usize) as i32, (index / size as usize) as i32);
        let key = format!("{x},{y}");
        if !organizations.contains(owner.as_str()) {
            fail(&key, owner, format!("belongs to {owner}, which is no Organization"));
        }
        if i % TERRITORY_CHECK_STRIDE != 0 {
            continue;
        }
        let control = control_at_tile(x, y);
        let own = control.get(owner.as_str()).copied().unwrap_or(0.0);
        if own <= 0.0 {
            fail(&key, owner, format!("belongs to {owner}, which projects no control there"));
        }
        for (other, c) in &control {
            if *other != owner.as_str() && *c >= own {
                fail(&key, owner, format!("belongs to {owner}, but {other} is as strong there"));
            }
        }
    }
    out
}

/// Every resident lives in a city that exists, or in none (`residentsInCities`).
pub fn residents_in_cities(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "residents-in-cities";
    let cities: HashSet<&str> = world.cities.iter().map(|c| c.id.as_str()).collect();
    world
        .residents
        .iter()
        .filter_map(|r| r.city_id.as_deref().filter(|c| !cities.contains(c)).map(|c| (r, c)))
        .map(|(r, c)| {
            violation(
                name,
                format!("resident {} lives in city {c}, which doesn't exist", r.id),
                &[&r.id],
            )
        })
        .collect()
}

/// An NPC city's residents belong to no realm (`npcCityResidentsUnowned`).
pub fn npc_city_residents_unowned(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "npc-city-residents-unowned";
    let npc = npc_cities(world);
    let mut out = Vec::new();
    for r in &world.residents {
        if let (Some(c), Some(owner)) = (&r.city_id, &r.owner) {
            if npc.contains(c.as_str()) {
                let msg = format!("resident {} of NPC city {c} belongs to realm {owner}", r.id);
                out.push(violation(name, msg, &[&r.id]));
            }
        }
    }
    out
}

/// A realm's city's residents belong to that realm (`cityResidentsInItsRealm`).
pub fn city_residents_in_its_realm(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "city-residents-in-its-realm";
    let realm_of: HashMap<&str, Option<&str>> =
        world.cities.iter().map(|c| (c.id.as_str(), c.realm_id.as_deref())).collect();
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(city) = &r.city_id else { continue };
        let Some(Some(realm)) = realm_of.get(city.as_str()) else { continue };
        if r.owner.as_deref() == Some(*realm) {
            continue;
        }
        let msg = format!(
            "resident {} of city {city} (realm {realm}) belongs to {}",
            r.id,
            r.owner.as_deref().unwrap_or("no realm")
        );
        out.push(violation(name, msg, &[&r.id, city]));
    }
    out
}

/// Relocate orders hold (`relocateOrdersSound`, `CONTEXT.md`: Relocate).
pub fn relocate_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "relocate-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Relocate(o)) = &r.order else { continue };
        let mut fail =
            |m: String| out.push(violation(name, format!("resident {} {m}", r.id), &[&r.id]));
        if r.owner.is_none() {
            fail("of no realm is relocating".into());
        }
        if r.carrying.is_some() {
            fail("is relocating while carrying a child".into());
        }
        if r.city_id.as_deref() == Some(o.city_id.as_str()) {
            fail(format!("is relocating to {}, where they live", o.city_id));
        }
    }
    out
}

/// The soldiers of the Trade Organization's army come to take `city` (`cityTakers`).
fn city_takers(world: &WorldState, city: &csp_shared::world::City) -> HashSet<String> {
    let org = city.realm_id.as_deref().unwrap_or(&city.id);
    let mut takers = HashSet::new();
    for p in &world.punishments {
        let out = serde_json::to_value(p.heading).ok().and_then(|v| v.as_str().map(str::to_owned));
        if p.takes != Some(true)
            || out.as_deref() != Some("out")
            || p.city_id != city.id
            || p.culprit_org != org
        {
            continue;
        }
        if !world.debts.iter().any(|d| d.org == org) {
            continue;
        }
        takers.extend(p.members.iter().map(|m| m.resident_id.clone()));
    }
    takers
}

/// Occupations of town halls hold (`occupationsSound`).
pub fn occupations_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "occupations-sound";
    let occupation_ticks = OCCUPATION_GAME_DAYS * TICKS_PER_GAME_DAY;
    let mut out = Vec::new();
    for c in &world.cities {
        let Some(o) = &c.occupation else { continue };
        let mut fail =
            |m: String| out.push(violation(name, format!("city {}: {m}", c.id), &[&c.id]));
        let ran = world.tick as f64 - o.since;
        if ran < 0.0 || ran >= occupation_ticks {
            fail(format!(
                "occupied by {} for {} ticks without being captured",
                o.realm_id,
                js_number(ran)
            ));
        }
        let hall = world.buildings.iter().find(|b| b.id == c.town_hall_id);
        let takers = city_takers(world, c);
        let holds = world.residents.iter().any(|r| {
            let theirs = if o.realm_id == TRADE_ORG {
                takers.contains(&r.id)
            } else {
                r.owner.as_deref() == Some(o.realm_id.as_str())
            };
            theirs
                && is_armed(r)
                && hall.is_some_and(|h| is_at((r.x as i32, r.y as i32), placed(h), terrain.size))
        });
        if !holds {
            fail(format!(
                "occupied by {} with none of its armed residents on the hall",
                o.realm_id
            ));
        }
        if let Some(realm) = &c.realm_id {
            if realm == &o.realm_id || allied_realms(world, realm).contains(&o.realm_id) {
                fail(format!("occupied by {}, its own realm or an ally", o.realm_id));
            }
        }
    }
    out
}

/// A city's own workplaces are workplaces other than farms, of no city
/// (`cityWorkplacesSound`).
pub fn city_workplaces_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "city-workplaces-sound";
    let mut out = Vec::new();
    for c in &world.cities {
        for id in c.workplace_ids.iter().flatten() {
            // `new Map(...)`: the last building with the id.
            let Some(b) = world.buildings.iter().rev().find(|b| &b.id == id) else { continue };
            if max_workers(b.kind).is_none() || b.kind == BuildingKind::Farm || b.city_id.is_some()
            {
                let msg = format!(
                    "{} works {}, a {} of city {}",
                    c.id,
                    b.id,
                    kind_name(b.kind),
                    b.city_id.as_deref().unwrap_or("null")
                );
                out.push(violation(name, msg, &[&c.id, &b.id]));
            }
        }
    }
    out
}

/// Whether the city keeps track of outsiders: trading posts and the HQ keep their own rules
/// (`watches` of `outsiders.ts`).
fn watches(city: &csp_shared::world::City) -> bool {
    city.trade_org.is_none()
}

/// Whether `r` counts as an outsider for `city`, wherever they stand (`outsiderTo` of
/// `outsiders.ts`, `CONTEXT.md`: Alarm): of another realm, or of another NPC city, and not allied;
/// someone hired by the city's realm or an ally of it is on its side.
// Written here, beside the invariant that reads it, because the module that ports
// `outsiders.ts` keeps its own.
fn outsider_to(
    world: &WorldState,
    city: &csp_shared::world::City,
    r: &csp_shared::world::Resident,
) -> bool {
    let Some(theirs) = r.owner.as_deref().or(r.city_id.as_deref()) else { return false };
    let side = city.realm_id.as_deref().unwrap_or(&city.id);
    if allied_ids(world, side, theirs) {
        return false;
    }
    match commander_of_resident(world, r) {
        None => true,
        Some(by) => by == theirs || !allied_ids(world, side, &by),
    }
}

fn allied_ids(world: &WorldState, a: &str, b: &str) -> bool {
    crate::queries::alliance::allied(world, a, b)
}

/// A city's outsiders are there as of the tick that just ended: each one once, alive, of no side
/// of the city's and standing in its area. A list is never left empty, and trading posts and the
/// HQ keep none (`outsidersSound`, ADR 0004; `CONTEXT.md`: Alarm).
pub fn outsiders_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "outsiders-sound";
    let crew = caravan_crew(world);
    let mut out = Vec::new();
    for city in &world.cities {
        let Some(list) = &city.outsiders else { continue };
        let mut problem = |message: String, ids: &[&str]| {
            let mut entity_ids = vec![city.id.clone()];
            entity_ids.extend(ids.iter().map(|s| s.to_string()));
            out.push(InvariantViolation {
                invariant: name.into(),
                message: format!("{} {message}", city.id),
                entity_ids,
            });
        };
        if list.is_empty() {
            problem("keeps an empty list of outsiders".into(), &[]);
        }
        if !watches(city) {
            problem("keeps outsiders, but keeps its own rules".into(), &[]);
        }
        if list.iter().collect::<HashSet<_>>().len() != list.len() {
            problem("lists an outsider twice".into(), &[]);
        }
        let area: Vec<&csp_shared::world::Building> = world
            .buildings
            .iter()
            .filter(|b| b.city_id.as_ref() == Some(&city.id) && is_city_building(b))
            .collect();
        for id in list {
            let Some(r) = world.residents.iter().rev().find(|r| &r.id == id) else {
                problem(format!("lists {id}, who is gone"), &[id]);
                continue;
            };
            if !outsider_to(world, city, r) || crew.contains(id) {
                problem(format!("lists {id}, who is no outsider"), &[id]);
            } else if !area.iter().any(|b| {
                near_footprint(
                    placed(b),
                    (r.x as i32, r.y as i32),
                    CITY_AREA_MARGIN as i32,
                    terrain.size,
                )
            }) {
                problem(format!("lists {id}, who stands outside its area"), &[id]);
            }
        }
    }
    out
}
