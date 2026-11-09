//! The planning pass's invariants (`npc-plan.ts`; ADR 0016, ADR 0004).

use std::collections::HashMap;

use csp_shared::balance::{MAP_SIZE, NPC_SURPLUS_CAP, RECIPES};
use csp_shared::world::{
    Building, BuildingKind, CityJobKind, CityProject, Good, Stock, WorldState,
};
use indexmap::IndexMap;

use super::{farmers_wanted, feeders, runners, Places};
use crate::npc_chain::{chain_good, chain_store, own_workplaces, SurplusWork};
use crate::npc_growth::on_node;
use crate::queries::building::{building_at, max_workers, workplace_good};
use crate::queries::city::city_residents;
use crate::queries::names::{good_name, held, kind_name};
use crate::queries::npc_trade::{is_big_npc_city, npc_needs_scale, npc_reserve};
use crate::queries::residents::{can_work, is_armed, is_down};
use crate::sight::InvariantViolation;

pub(crate) fn violation(
    invariant: &str,
    message: String,
    entity_ids: Vec<String>,
) -> InvariantViolation {
    InvariantViolation { invariant: invariant.into(), message, entity_ids }
}

/// Invariant `city-plans-sound`: a plan only for a city the game runs, made no later than now,
/// whose jobs work only finished workplaces of the city's own. A building gone since is stale,
/// not wrong.
pub fn city_plans_sound(world: &WorldState) -> Vec<InvariantViolation> {
    const NAME: &str = "city-plans-sound";
    let mut out = Vec::new();
    let buildings: HashMap<&str, &Building> =
        world.buildings.iter().map(|b| (b.id.as_str(), b)).collect();
    for (city_id, plan) in &world.city_plans {
        let city = world.cities.iter().find(|c| &c.id == city_id);
        let Some(city) = city.filter(|c| c.realm_id.is_none()) else {
            let whose = match city.and_then(|c| c.realm_id.as_deref()) {
                Some(realm) => format!("a city of realm {realm}"),
                None => "no city".into(),
            };
            let message = format!("a plan for {city_id}, {whose}");
            out.push(violation(NAME, message, vec![city_id.clone()]));
            continue;
        };
        if plan.planned_at > world.tick as f64 {
            let message = format!("{city_id} planned at tick {}, after now", plan.planned_at);
            out.push(violation(NAME, message, vec![city_id.clone()]));
        }
        for (resident_id, job) in &plan.jobs {
            let Some(b) = job.building_id.as_deref().and_then(|id| buildings.get(id)) else {
                continue;
            };
            let ids = vec![city_id.clone(), resident_id.clone(), b.id.clone()];
            if max_workers(b.kind).is_none() || b.site.is_some() {
                let site = if b.site.is_some() { "site of a " } else { "" };
                let kind = kind_name(b.kind);
                let message =
                    format!("{city_id} plans {resident_id} to work {}, a {site}{kind}", b.id);
                out.push(violation(NAME, message, ids));
            } else if b.city_id.as_deref() != Some(city_id.as_str())
                && !city.workplace_ids.iter().flatten().any(|w| *w == b.id)
            {
                let message = format!(
                    "{city_id} plans {resident_id} to work {}, not one of its workplaces",
                    b.id
                );
                out.push(violation(NAME, message, ids));
            }
        }
    }
    out
}

/// Invariant `npc-farmers-kept` (`CONTEXT.md`: NPC city): a plan made this tick with fewer
/// farmers than feed the city, and room on its farms, sends nobody who could farm to another
/// workplace or leaves them idle.
pub fn npc_farmers_kept(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let tick = world.tick as f64;
    for (city_id, plan) in &world.city_plans {
        let Some(city) = world.cities.iter().find(|c| &c.id == city_id) else { continue };
        if plan.planned_at != tick {
            continue;
        }
        let born = city_residents(world, &city.id).iter().filter(|r| r.born_at < tick).count();
        let wanted = feeders(born);
        let farmers = plan.jobs.values().filter(|j| j.kind == CityJobKind::Farm).count();
        if farmers as f64 >= wanted {
            continue;
        }
        let planned = |f: &Building| {
            plan.jobs.values().filter(|j| j.building_id.as_deref() == Some(f.id.as_str())).count()
        };
        let room = own_workplaces(world, city).into_iter().any(|f| {
            f.kind == BuildingKind::Farm
                && f.site.is_none()
                && (planned(f) as f64) < max_workers(BuildingKind::Farm).unwrap_or(0.0)
        });
        if !room {
            continue;
        }
        for (resident_id, job) in &plan.jobs {
            let Some(r) = world.residents.iter().find(|r| &r.id == resident_id) else { continue };
            if r.health <= 0.0 || r.carrying.is_some() || is_armed(&r.carried) {
                continue;
            }
            if job.kind != CityJobKind::Work && job.kind != CityJobKind::Idle {
                continue;
            }
            let at = if job.kind == CityJobKind::Idle {
                "idle".to_string()
            } else {
                format!("at {}", job.building_id.as_deref().unwrap_or("undefined"))
            };
            out.push(violation(
                "npc-farmers-kept",
                format!("{city_id} plans {farmers} of {wanted} farmers, and {resident_id} {at}"),
                vec![city_id.clone(), resident_id.clone()],
            ));
        }
    }
    out
}

/// Invariant `npc-surplus-capped` (`CONTEXT.md`: Spare hands' work): a plan made this tick sends
/// nobody to a workplace whose good the city holds twice its surplus cap of past its reserve; a
/// farm keeps the farmers the city wants and one more.
pub fn npc_surplus_capped(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let empty = Stock::new();
    for (city_id, plan) in &world.city_plans {
        let Some(city) = world.cities.iter().find(|c| &c.id == city_id) else { continue };
        if city.trade_org.is_some() || plan.planned_at != world.tick as f64 {
            continue;
        }
        let stock = chain_store(world, city).and_then(|s| s.stock.as_ref()).unwrap_or(&empty);
        let reserve = npc_reserve(world, city);
        let steps = npc_needs_scale(world, city);
        let farmers = plan.jobs.values().filter(|j| j.kind == CityJobKind::Farm).count() as f64;
        for place in own_workplaces(world, city) {
            let Some(good) = chain_good(world, place) else { continue };
            let base = NPC_SURPLUS_CAP.get(good_name(good)).unwrap_or(0.0);
            if base == 0.0 || place.site.is_some() {
                continue;
            }
            let cap = base * steps;
            if held(stock, good) - held(&reserve, good) < 2.0 * cap {
                continue;
            }
            if place.kind == BuildingKind::Farm && farmers <= farmers_wanted(world, city) + 1.0 {
                continue;
            }
            for (resident_id, job) in &plan.jobs {
                if job.building_id.as_deref() != Some(place.id.as_str()) {
                    continue;
                }
                let units = stock.get(&good).map_or("undefined".to_string(), |n| n.to_string());
                let good = good_name(good);
                let message = format!(
                    "{city_id} plans {resident_id} at {}, with {units} {good} past its cap of {cap}",
                    place.id
                );
                let ids = vec![city_id.clone(), resident_id.clone(), place.id.clone()];
                out.push(violation("npc-surplus-capped", message, ids));
            }
        }
    }
    out
}

/// Invariant `npc-spare-hands-work` (`CONTEXT.md`: Spare hands' work): a plan made this tick
/// leaves nobody who could work idle while one of the city's workplaces that makes something from
/// nothing is under half its surplus cap and has room.
pub fn npc_spare_hands_work(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut people: Option<IndexMap<String, Vec<usize>>> = None;
    let tick = world.tick as f64;
    for (city_id, plan) in &world.city_plans {
        if plan.planned_at != tick {
            continue;
        }
        let Some(city) = world.cities.iter().find(|c| &c.id == city_id) else { continue };
        if city.trade_org.is_some() || !plan.jobs.values().any(|j| j.kind == CityJobKind::Idle) {
            continue;
        }
        let people = people.get_or_insert_with(|| runners(world).0);
        let own = people.get(city_id).cloned().unwrap_or_default();
        let idle: Vec<usize> = own
            .iter()
            .copied()
            .filter(|&i| {
                let r = &world.residents[i];
                plan.jobs.get(&r.id).is_some_and(|j| j.kind == CityJobKind::Idle)
                    && can_work(r.born_at, tick)
                    && !is_down(r.down_until)
                    && r.carrying.is_none()
                    && !is_armed(&r.carried)
            })
            .collect();
        if idle.is_empty() {
            continue;
        }
        let places = Places::new(world, &own);
        let planned = |b: &Building| {
            plan.jobs.values().filter(|j| j.building_id.as_deref() == Some(b.id.as_str())).count()
                as i64
        };
        let full = SurplusWork::of(world, city, chain_store(world, city));
        let open = own_workplaces(world, city).into_iter().find(|b| {
            if b.site.is_some() || RECIPES.get(kind_name(b.kind)).is_some() {
                return false;
            }
            let most = max_workers(b.kind).unwrap_or(0.0);
            full.full(world, b).unwrap_or(1.0) < 0.5
                && (planned(b).max(places.taken(b)) as f64) < most
        });
        let Some(open) = open else { continue };
        let message = format!(
            "{city_id} plans {} idle, with room at {}, a {} under half its cap",
            idle.len(),
            open.id,
            kind_name(open.kind)
        );
        let mut ids = vec![city_id.clone(), open.id.clone()];
        ids.extend(idle.iter().map(|&i| world.residents[i].id.clone()));
        out.push(violation("npc-spare-hands-work", message, ids));
    }
    out
}

/// Invariant `npc-workplaces-bounded` (`CONTEXT.md`: NPC city): a plan made this tick builds
/// another farm, lumber camp, quarry or mine only while those standing for its good fall short,
/// or while the city holds less of the good than its reserve and half its surplus cap.
pub fn npc_workplaces_bounded(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for (city_id, plan) in &world.city_plans {
        let Some(CityProject::Build { building, x, y }) = &plan.project else { continue };
        if plan.planned_at != world.tick as f64 {
            continue;
        }
        let farm = *building == BuildingKind::Farm;
        if (!farm && !on_node(*building))
            || building_at(world, *x as i32, *y as i32, MAP_SIZE).is_some()
        {
            continue;
        }
        let Some(city) = world.cities.iter().find(|c| &c.id == city_id) else { continue };
        if city.trade_org.is_some() {
            continue;
        }
        let good = if farm {
            Some(Good::Food)
        } else {
            let b: Building = serde_json::from_value(serde_json::json!({
                "id": "", "kind": kind_name(*building), "cityId": city_id, "x": x, "y": y,
            }))
            .expect("a building");
            workplace_good(world, &b, None)
        };
        let Some(good) = good else { continue };
        let standing = own_workplaces(world, city)
            .into_iter()
            .filter(|b| {
                b.site.is_none() && chain_good(world, b) == Some(good) && (farm || on_node(b.kind))
            })
            .count() as f64;
        let allowed = if farm {
            standing == 0.0
                || farmers_wanted(world, city)
                    > standing * max_workers(BuildingKind::Farm).unwrap_or(0.0)
        } else {
            standing < if is_big_npc_city(world, city) { 2.0 } else { 1.0 }
        };
        if allowed {
            continue;
        }
        let cap = NPC_SURPLUS_CAP.get(good_name(good)).unwrap_or(0.0);
        let slack = cap * npc_needs_scale(world, city) / 2.0;
        let stock = chain_store(world, city).and_then(|s| s.stock.as_ref());
        let held_now = stock.map_or(0.0, |s| held(s, good));
        if held_now < held(&npc_reserve(world, city), good) + slack {
            continue;
        }
        let message = format!(
            "{city_id} plans another {} for {}, with {standing} standing",
            kind_name(*building),
            good_name(good)
        );
        out.push(violation("npc-workplaces-bounded", message, vec![city_id.clone()]));
    }
    out
}
