//! The heir takes over when the Leader dies (`CONTEXT.md`: Leader death with an heir, T103.2):
//! the realm goes on under its name, standing, contracts, alliance, scripts and realm log, with the
//! heir as its Leader and only the city the heir lives in. Every other city becomes self-managed
//! as at a Leader death without an heir (`end_realm`), holding the Player in good standing.

use std::collections::HashSet;

use csp_shared::balance::FORMER_PLAYER_STANDING;
use csp_shared::world::{RealmEventWhat, WorldState};

use crate::city_layout::pick_layout;
use crate::events::record_event;
use crate::queries::carriages::driven_carriage_id;
use crate::queries::city::town_hall_of;
use crate::sight::InvariantViolation;
use crate::standing::change_standing;
use crate::survival::{nearest_city, self_managed_cities, to_self_managed};

/// Where something of the realm goes: `None` stays with the realm, `Some(city)` goes with that
/// city, now self-managed.
type Fate = Option<String>;

/// The Leader of the realm `realm_id` just died and `heir_id`, its living heir, takes over
/// (`heirTakesOver`). Everything of the realm is shared out between the realm's cities as at a
/// Leader death (`end_realm`): residents by the city they live in (a homeless one by the nearest
/// city), horses, carriages and boats by the city nearest them, but a horse ridden or a carriage
/// driven by a resident of the realm goes where they go, and a hitched horse with its carriage.
/// What falls to the heir's city stays the realm's, residents away from it keeping their
/// orders; outpost storages stay the realm's. Every other city becomes self-managed, with what
/// fell to it, holding the realm in good standing (`FORMER_PLAYER_STANDING`); its soldiers lent
/// out or in the alliance army walk home. The realm log says so, and the realm has no heir.
/// `size` is the map's.
pub fn heir_takes_over(world: &mut WorldState, realm_id: &str, heir_id: &str, size: i32) {
    let Some(ri) = world.realms.iter().position(|r| r.id == realm_id) else { return };
    let Some(heir) = world.residents.iter().find(|r| r.id == heir_id) else { return };
    let (heir_name, Some(home)) = (heir.name.clone(), heir.city_id.clone()) else { return };
    let cities: Vec<String> = world
        .cities
        .iter()
        .filter(|c| c.realm_id.as_deref() == Some(realm_id))
        .map(|c| c.id.clone())
        .collect();
    let others: Vec<String> = cities.iter().filter(|c| **c != home).cloned().collect();
    let fate_of = |city: Option<String>| city.filter(|c| *c != home);

    // Everything's fate is decided before anything moves.
    let residents: Vec<(usize, Fate, bool)> = world
        .residents
        .iter()
        .enumerate()
        .filter(|(_, r)| r.owner.as_deref() == Some(realm_id))
        .map(|(i, r)| match &r.city_id {
            Some(c) => (i, fate_of(Some(c.clone())), false),
            None => {
                let at = (r.x as i32, r.y as i32);
                (i, fate_of(nearest_city(world, &cities, at, size)), true)
            }
        })
        .collect();
    let resident_fate = |id: &str| {
        residents.iter().find(|(i, _, _)| world.residents[*i].id == id).map(|(_, f, _)| f.clone())
    };
    let carriages: Vec<(usize, Fate)> = world
        .carriages
        .iter()
        .enumerate()
        .filter(|(_, k)| k.realm_id.as_deref() == Some(realm_id))
        .map(|(i, k)| {
            let driver = world
                .residents
                .iter()
                .find(|r| driven_carriage_id(r) == Some(k.id.as_str()))
                .and_then(|r| resident_fate(&r.id));
            let near = || fate_of(nearest_city(world, &cities, (k.x as i32, k.y as i32), size));
            (i, driver.unwrap_or_else(near))
        })
        .collect();
    let horses: Vec<(usize, Fate)> = world
        .horses
        .iter()
        .enumerate()
        .filter(|(_, h)| h.realm_id.as_deref() == Some(realm_id))
        .map(|(i, h)| {
            let hitched = carriages
                .iter()
                .find(|(k, _)| world.carriages[*k].horse_id.as_deref() == Some(h.id.as_str()))
                .map(|(_, f)| f.clone());
            let rider = || {
                let r = world.residents.iter().find(|r| r.riding.as_deref() == Some(&h.id))?;
                resident_fate(&r.id)
            };
            let near = || fate_of(nearest_city(world, &cities, (h.x as i32, h.y as i32), size));
            (i, hitched.or_else(rider).unwrap_or_else(near))
        })
        .collect();
    let vessels: Vec<usize> = world
        .vessels
        .iter()
        .enumerate()
        .filter(|(_, v)| v.realm_id.as_deref() == Some(realm_id))
        .filter(|(_, v)| {
            fate_of(nearest_city(world, &cities, (v.x as i32, v.y as i32), size)).is_some()
        })
        .map(|(i, _)| i)
        .collect();

    // Those going, while still the realm's, leave its contracts, armies and the alliance army.
    let mut going: HashSet<String> = residents
        .iter()
        .filter(|(_, f, _)| f.is_some())
        .map(|(i, _, _)| world.residents[*i].id.clone())
        .collect();
    crate::contracts::leave_contracts(world, &going);
    going.extend(
        carriages.iter().filter(|(_, f)| f.is_some()).map(|(k, _)| world.carriages[*k].id.clone()),
    );
    crate::alliances::give_back_everywhere(world, &going);

    let seed = world.seed;
    for c in world.cities.iter_mut().filter(|c| others.contains(&c.id)) {
        c.realm_id = None;
        c.layout = Some(pick_layout(seed, &c.id));
    }
    for c in &others {
        change_standing(world, c, realm_id, FORMER_PLAYER_STANDING);
    }
    for (i, fate, homeless) in &residents {
        let Some(city) = fate else { continue };
        if *homeless {
            world.residents[*i].city_id = Some(city.clone());
        }
        to_self_managed(world, *i, &others, size);
    }
    // A pair split between the realm and a city that left it ends.
    let owners: std::collections::HashMap<String, Option<String>> =
        world.residents.iter().map(|r| (r.id.clone(), r.owner.clone())).collect();
    for r in &mut world.residents {
        let partner = r.pair.as_ref().map(|p| p.partner_id.clone());
        if partner.is_some_and(|p| owners.get(&p).is_some_and(|o| *o != r.owner)) {
            r.pair = None;
        }
    }
    for (k, fate) in carriages {
        if let Some(city) = fate {
            (world.carriages[k].realm_id, world.carriages[k].city_id) = (None, Some(city));
        }
    }
    for (h, fate) in horses {
        if let Some(city) = fate {
            (world.horses[h].realm_id, world.horses[h].city_id) = (None, Some(city));
        }
    }
    // NPC cities don't use the water (`CONTEXT.md`: Haven): boats nearest another city belong to
    // nobody.
    for v in vessels {
        world.vessels[v].realm_id = None;
    }

    let realm = &mut world.realms[ri];
    realm.leader_id = heir_id.to_string();
    realm.heir_id = None;
    let became = self_managed_cities(world, &others);
    let Some(city) = world.cities.iter().find(|c| c.id == home) else { return };
    let hall = town_hall_of(world, city).map_or((0.0, 0.0), |h| (h.x, h.y));
    let what = RealmEventWhat::HeirTookOver {
        heir_id: heir_id.to_string(),
        heir: heir_name,
        city_id: city.id.clone(),
        city: city.name.clone(),
        x: hall.0,
        y: hall.1,
        cities: became,
    };
    record_event(world, Some(realm_id), what);
}

/// Invariant (`heirsTookOver`, ADR 0004): a realm whose heir took over in the tick just stepped
/// has that heir as its Leader, holds the heir's city (unless it was captured since)
/// and none of the cities that became self-managed. A realm whose Leader changed again since (a
/// handover, or the heir's own death) is past this.
pub fn heirs_took_over(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for e in &world.events {
        let RealmEventWhat::HeirTookOver { heir_id, city_id, cities, .. } = &e.what else {
            continue;
        };
        if e.tick + 1 < world.tick {
            continue;
        }
        let Some(realm) = world.realms.iter().find(|r| r.user_id == e.user_id) else { continue };
        if realm.leader_id != *heir_id {
            continue;
        }
        let holds = |id: &str| {
            world.cities.iter().any(|c| c.id == id && c.realm_id.as_deref() == Some(&realm.id))
        };
        let captured = world.events.iter().any(|x| {
            x.seq > e.seq
                && x.user_id == e.user_id
                && matches!(&x.what, RealmEventWhat::CityCaptured { city_id: c, .. } if c == city_id)
        });
        let mut problems = Vec::new();
        if !holds(city_id) && !captured {
            problems.push(format!("doesn't hold {city_id}, the heir's city"));
        }
        for c in cities.iter().filter(|c| holds(&c.city_id)) {
            problems.push(format!("still holds {}, which became self-managed", c.city_id));
        }
        for p in problems {
            out.push(InvariantViolation {
                invariant: "heirs-took-over".into(),
                message: format!("realm {} whose heir {heir_id} took over {p}", realm.id),
                entity_ids: vec![realm.id.clone(), heir_id.clone()],
            });
        }
    }
    out
}

#[cfg(test)]
mod tests;
