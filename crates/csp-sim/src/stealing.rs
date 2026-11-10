//! Stealing a carriage or horse (`apps/server/src/stealing.ts`, `CONTEXT.md`: Stealing a carriage
//! or horse): taking it over for the thief's realm, once the shared check allows it.

use csp_shared::world::{CrimeKind, RealmEventWhat, Stock, WorldState};

/// What stealing takes over (`Taken`).
pub struct Taken {
    pub carriage: Option<usize>,
    pub horse: Option<usize>,
}

/// `thief` takes a carriage or horse of another organization for the realm `realm_id`, on a map
/// of `size` tiles (`takeOver`, `stealing.ts`; `CONTEXT.md`: Stealing a carriage or horse), once
/// the shared check allows it. It joins that realm at once, a carriage with its load and hitched
/// horse, and leaves any alliance army. One theft, known through a witness; none when it belonged
/// to nobody. A theft raises the alarm for those at home who see it (`raise_theft`). The owner's
/// log says at once that it is gone and where it was last, without the thief, and the thief's
/// realm's log says what they took. A caravan's carriage robs the caravan and is replaced, a
/// trader's likewise; a supply wagon's is gone for its army.
pub fn take_over(world: &mut WorldState, thief: &str, realm_id: &str, taken: Taken, size: i32) {
    let (victim_org, x, y) = match (taken.carriage, taken.horse) {
        (Some(i), _) => {
            let k = &world.carriages[i];
            (k.realm_id.clone().or_else(|| k.city_id.clone()), k.x, k.y)
        }
        (None, Some(i)) => {
            let h = &world.horses[i];
            (h.realm_id.clone().or_else(|| h.city_id.clone()), h.x, h.y)
        }
        (None, None) => return,
    };
    let carriage = taken.carriage.is_some().then_some(true);
    let horse = taken.horse.map(|i| world.horses[i].name.clone());
    // What of a load there is (`goodsOf`); none for none.
    let goods = taken.carriage.and_then(|i| {
        let there: Stock = world.carriages[i]
            .load
            .iter()
            .filter(|(_, &n)| n > 0.0)
            .map(|(&g, &n)| (g, n))
            .collect();
        (!there.is_empty()).then_some(there)
    });
    let from = victim_org.as_deref().map(|o| crate::crimes::organization_name(world, o));
    let mut ids = Vec::new();
    if let Some(i) = taken.carriage {
        let k = &mut world.carriages[i];
        k.realm_id = Some(realm_id.to_string());
        k.city_id = None;
        ids.push(k.id.clone());
    }
    if let Some(i) = taken.horse {
        let h = &mut world.horses[i];
        h.realm_id = Some(realm_id.to_string());
        h.city_id = None;
        ids.push(h.id.clone());
    }
    for a in &mut world.alliances {
        a.army.retain(|p| !ids.contains(&p.id));
    }
    crate::crimes::commit_crime(
        world,
        size,
        CrimeKind::Theft,
        thief,
        crate::crimes::CrimeAgainst {
            victim_org: victim_org.clone(),
            goods: goods.clone(),
            carriage: carriage.is_some(),
            horse: horse.clone(),
            ..Default::default()
        },
    );
    if let Some(org) = &victim_org {
        crate::alarms::raise_theft(world, thief, org, size);
    }
    crate::events::record_event(
        world,
        victim_org.as_deref(),
        RealmEventWhat::TransportGone { x, y, carriage, horse: horse.clone() },
    );
    if let Some(t) = world.residents.iter().find(|r| r.id == thief) {
        let (resident_id, name) = (t.id.clone(), t.name.clone());
        crate::events::record_event(
            world,
            Some(realm_id),
            RealmEventWhat::TransportTaken {
                resident_id,
                name,
                x,
                y,
                from,
                carriage,
                horse,
                goods,
            },
        );
    }
    if let Some(i) = taken.carriage {
        // A caravan's or trader's is replaced, a supply wagon's gone for its army
        // (`caravanCarriageStolen`, `traderCarriageStolen`, `wagonStolen`).
        let id = world.carriages[i].id.clone();
        if let Some(ti) = world.residents.iter().position(|r| r.id == thief) {
            crate::caravans::caravan_carriage_stolen(world, ti, &id);
            crate::traders::trader_carriage_stolen(world, ti, &id);
        }
        crate::supply_wagons::wagon_stolen(world, &id, size);
    }
}
