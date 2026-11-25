//! Horses: their stats, names, breeding and riders.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::STABLE_BREED_DAYS;
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, ResidentOrder, WorldState};

use super::shared::{at_building, of_resident, Out};
use super::{invariant, js_number, violation, Invariant};
use crate::queries::building::carriage_can_go_to;

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("horse-stats-sound", horse_stats_sound),
    invariant("horse-names-well-formed", |w, _| crate::renaming::horse_names_well_formed(w)),
    invariant("horse-offers-once", |w, _| crate::horse_grant::horse_offers_once(w)),
    invariant("breed-orders-sound", breed_orders_sound),
    invariant("kept-breedings-sound", kept_breedings_sound),
    invariant("riders-on-horses", riders_on_horses),
    invariant("horses-down-lie-still", |w, _| crate::horses::horses_down_lie_still(w)),
];

/// One foal's worth of breeding (`STABLE_BREED_TICKS`).
const STABLE_BREED_TICKS: f64 = STABLE_BREED_DAYS * TICKS_PER_GAME_DAY;

/// Every horse has its stats, each a whole number of at least 1, and a birth tick no later than
/// now (`horseStatsSound`).
pub fn horse_stats_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "horse-stats-sound";
    let mut out = Vec::new();
    for h in &world.horses {
        let s = &h.stats;
        let bad: Vec<String> =
            [("speed", s.speed), ("strength", s.strength), ("endurance", s.endurance)]
                .into_iter()
                .filter(|(_, v)| !(v.fract() == 0.0 && *v >= 1.0))
                .map(|(n, v)| format!("{n} {}", js_number(v)))
                .collect();
        if !bad.is_empty() {
            out.push(violation(name, format!("horse {} has {}", h.id, bad.join(", ")), &[&h.id]));
        }
        if !(h.born_at.is_finite() && h.born_at <= world.tick as f64) {
            let msg = format!(
                "horse {} was born at tick {}, after tick {}",
                h.id,
                js_number(h.born_at),
                world.tick
            );
            out.push(violation(name, msg, &[&h.id]));
        }
    }
    out
}

/// The breeding progress a stable keeps for these two horses (`keptBreeding`).
fn kept_breeding<'b>(
    stable: &'b csp_shared::world::Building,
    ids: &[String; 2],
) -> Option<&'b csp_shared::world::KeptBreeding> {
    stable
        .breedings
        .as_ref()?
        .iter()
        .find(|k| ids.contains(&k.horse_ids[0]) && ids.contains(&k.horse_ids[1]))
}

/// Breeding goes on only while it makes sense (`breedOrdersSound`, `CONTEXT.md`: Breeding).
pub fn breed_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "breed-orders-sound";
    let mut out = Vec::new();
    let mut bred: HashMap<&str, &str> = HashMap::new();
    for r in &world.residents {
        let Some(ResidentOrder::Breed(o)) = &r.order else { continue };
        let mut fail = |m: String, ids: &[&str]| {
            let mut all = vec![r.id.as_str()];
            all.extend_from_slice(ids);
            out.push(violation(name, format!("resident {} {m}", r.id), &all));
        };
        let stable = world.buildings.iter().find(|b| b.id == o.stable_id);
        let fine = stable.is_some_and(|s| {
            s.kind == BuildingKind::Stable && s.site.is_none() && at_building(r.x, r.y, s)
        });
        if !fine {
            fail(
                format!("breeds at {}, which isn’t a finished stable they stand at", o.stable_id),
                &[&o.stable_id],
            );
        }
        if r.x != o.at.x || r.y != o.at.y {
            fail(
                format!(
                    "breeds from {}, {} but stands elsewhere",
                    js_number(o.at.x),
                    js_number(o.at.y)
                ),
                &[],
            );
        }
        if !(o.progress.fract() == 0.0 && o.progress >= 0.0 && o.progress < STABLE_BREED_TICKS) {
            fail(
                format!(
                    "has breeding progress {} of {}",
                    js_number(o.progress),
                    js_number(STABLE_BREED_TICKS)
                ),
                &[],
            );
        }
        if let Some(s) = stable {
            let kept = kept_breeding(s, &o.horse_ids).map_or(0.0, |k| k.progress);
            if o.progress != kept {
                fail(
                    format!(
                        "has breeding progress {}, the stable {}",
                        js_number(o.progress),
                        js_number(kept)
                    ),
                    &[&s.id],
                );
            }
        }
        if o.horse_ids[0] == o.horse_ids[1] {
            fail(format!("breeds horse {} with itself", o.horse_ids[0]), &[]);
        }
        for id in &o.horse_ids {
            let h = world.horses.iter().find(|x| &x.id == id);
            let inside = match (h, stable) {
                (Some(h), Some(s)) => at_building(h.x, h.y, s),
                _ => false,
            };
            if !inside {
                fail(format!("breeds horse {id}, which isn’t in the stable"), &[id]);
            }
            if let Some(other) = bred.get(id.as_str()).copied() {
                if other != r.id {
                    fail(format!("breeds horse {id}, which {other} breeds too"), &[id, other]);
                }
            }
            bred.insert(id, &r.id);
        }
    }
    out
}

/// Breeding progress belongs to two horses in a stable (`keptBreedingsSound`).
pub fn kept_breedings_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "kept-breedings-sound";
    let mut out = Vec::new();
    for b in &world.buildings {
        let Some(breedings) = &b.breedings else { continue };
        let mut fail = |m: String, ids: &[&str]| {
            let mut all = vec![b.id.as_str()];
            all.extend_from_slice(ids);
            out.push(violation(name, format!("building {} {m}", b.id), &all));
        };
        if b.kind != BuildingKind::Stable || b.site.is_some() {
            fail("keeps breeding progress but isn’t a finished stable".into(), &[]);
        }
        let mut pairs = HashSet::new();
        for k in breedings {
            let [a, c] = &k.horse_ids;
            let mut pair = [a.as_str(), c.as_str()];
            pair.sort();
            let pair = pair.join("+");
            if a == c {
                fail(format!("keeps breeding progress for horse {a} with itself"), &[a]);
            }
            if pairs.contains(&pair) {
                fail(format!("keeps breeding progress for {a} and {c} twice"), &[a, c]);
            }
            pairs.insert(pair);
            let horses: Vec<_> =
                k.horse_ids.iter().map(|id| world.horses.iter().find(|h| &h.id == id)).collect();
            if horses.iter().any(|h| h.is_none_or(|h| !at_building(h.x, h.y, b))) {
                fail(
                    format!("keeps breeding progress for {a} and {c}, not both alive in it"),
                    &[a, c],
                );
            }
            if let (Some(h1), Some(h2)) = (horses[0], horses[1]) {
                if h1.realm_id != h2.realm_id || h1.city_id != h2.city_id {
                    fail(
                        format!("keeps breeding progress for {a} and {c}, of different owners"),
                        &[a, c],
                    );
                }
            }
            if !(k.progress.fract() == 0.0 && k.progress >= 1.0 && k.progress < STABLE_BREED_TICKS)
            {
                fail(
                    format!(
                        "keeps breeding progress {} of {} for {a} and {c}",
                        js_number(k.progress),
                        js_number(STABLE_BREED_TICKS)
                    ),
                    &[],
                );
            }
        }
    }
    out
}

/// A rider's horse exists, stands with them, is of their realm and pulls no carriage, no horse
/// has two riders, and a ridden horse stands where a carriage could (`ridersOnHorses`).
pub fn riders_on_horses(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "riders-on-horses";
    let mut out = Vec::new();
    let mut fail = |ids: &[&str], m: String| out.push(violation(name, m, ids));
    let mut riders: HashMap<&str, &str> = HashMap::new();
    for r in &world.residents {
        let Some(riding) = &r.riding else { continue };
        let Some(h) = world.horses.iter().find(|h| &h.id == riding) else {
            fail(&[&r.id], format!("resident {} rides {riding}, which doesn't exist", r.id));
            continue;
        };
        let (hx, hy) = (js_number(h.x), js_number(h.y));
        if h.x != r.x || h.y != r.y {
            let m = format!(
                "resident {} at ({}, {}) rides horse {} at ({hx}, {hy})",
                r.id,
                js_number(r.x),
                js_number(r.y),
                h.id
            );
            fail(&[&r.id, &h.id], m);
        }
        if !of_resident(h.realm_id.as_deref(), h.city_id.as_deref(), r) {
            let m = format!("resident {} rides horse {} of another realm", r.id, h.id);
            fail(&[&r.id, &h.id], m);
        }
        if let Some(k) = world.carriages.iter().find(|k| k.horse_id.as_ref() == Some(&h.id)) {
            fail(&[&h.id, &k.id], format!("horse {} is ridden and hitched to {}", h.id, k.id));
        }
        if !carriage_can_go_to(world, terrain, h.x as i32, h.y as i32) {
            let m = format!("horse {} is ridden where no horse can go at ({hx}, {hy})", h.id);
            fail(&[&r.id, &h.id], m);
        }
        if let Some(other) = riders.get(h.id.as_str()).copied() {
            let m = format!("horse {} has two riders, {other} and {}", h.id, r.id);
            fail(&[&h.id, &r.id, other], m);
        }
        riders.insert(&h.id, &r.id);
    }
    out
}
