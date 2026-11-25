//! Residents: stats, skills, names, pairs, teaching and training, and what children may do.

use std::collections::HashMap;

use csp_shared::balance::{
    trained_cap, CARRYING_TICKS, CONSTRUCTION_SKILL_MAX, TRAINING_GROUND_MAX_TRAINEES,
    WORK_SKILL_MAX,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, ResidentOrder, SkillName, WorldState};

use super::shared::{kind_of, Out};
use super::{invariant, js_number, violation, Invariant};
use crate::pairing::carrying_blocks;
use crate::queries::names::{good_name, placed};
use crate::queries::residents::can_work;

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("trained-within-cap", trained_within_cap),
    invariant("skills-within-cap", skills_within_cap),
    invariant("resident-names-well-formed", |w, _| crate::renaming::resident_names_well_formed(w)),
    invariant("game-names-unique", |w, _| crate::names::game_names_unique(w)),
    invariant("pairs-hold-together", pairs_hold_together),
    invariant("carrying-doesnt-work", carrying_doesnt_work),
    invariant("children-dont-work", children_dont_work),
    invariant("children-carry-only-food", children_carry_only_food),
    invariant("drifters-sound", crate::drifters::drifters_sound),
    invariant("drifters-join-with-room", crate::drifters::drifters_join_with_room),
    invariant("teachers-sound", teachers_sound),
    invariant("trainees-sound", trainees_sound),
    invariant("zeal-within-cap", |w, _| crate::zeal::zeal_within_cap(w)),
];

/// Every stat has a positive base and a trained bonus between 0 and its cap.
pub fn trained_within_cap(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "trained-within-cap";
    let mut out = Vec::new();
    for r in &world.residents {
        let s = &r.stats;
        for (stat, v) in [
            ("strength", &s.strength),
            ("endurance", &s.endurance),
            ("agility", &s.agility),
            ("intellect", &s.intellect),
        ] {
            if !(v.base > 0.0 && v.trained >= 0.0 && v.trained <= trained_cap(v.base)) {
                let msg = format!(
                    "resident {} has {stat} {} + {} trained (cap {})",
                    r.id,
                    js_number(v.base),
                    js_number(v.trained),
                    js_number(trained_cap(v.base))
                );
                out.push(violation(name, msg, &[&r.id]));
            }
        }
    }
    out
}

/// No work or Construction skill is below 0 or above its most (`skillsWithinCap`).
pub fn skills_within_cap(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "skills-within-cap";
    // `CAPPED_SKILLS`: the work skills in `WORKPLACE_SKILL`'s order, then Construction.
    let capped = [
        (SkillName::Farming, "farming", WORK_SKILL_MAX),
        (SkillName::Woodcutting, "woodcutting", WORK_SKILL_MAX),
        (SkillName::Mining, "mining", WORK_SKILL_MAX),
        (SkillName::Smelting, "smelting", WORK_SKILL_MAX),
        (SkillName::Smithing, "smithing", WORK_SKILL_MAX),
        (SkillName::Construction, "construction", CONSTRUCTION_SKILL_MAX),
    ];
    let mut out = Vec::new();
    for r in &world.residents {
        for (skill, label, max) in capped {
            let v = r.skills.get(&skill).copied();
            let n = v.unwrap_or(0.0);
            if !(n >= 0.0 && n <= max + 1e-9) {
                let has = v.map_or("undefined".into(), js_number);
                let msg = format!("resident {} has {label} {has} (most {})", r.id, js_number(max));
                out.push(violation(name, msg, &[&r.id]));
            }
        }
    }
    out
}

/// Pairs hold together (`pairsHoldTogether`, `CONTEXT.md`: Pairing).
pub fn pairs_hold_together(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "pairs-hold-together";
    let mut out = Vec::new();
    for (i, r) in world.residents.iter().enumerate() {
        let Some(o) = &r.pair else { continue };
        // `new Map(...)`: the last resident with the id.
        let pi = world.residents.iter().rposition(|x| x.id == o.partner_id);
        let partner = pi.map(|p| &world.residents[p]);
        let back = partner.and_then(|p| p.pair.as_ref());
        let mut problems = Vec::new();
        match (partner, back) {
            (Some(p), Some(b)) if b.partner_id == r.id => {
                if b.since != o.since {
                    problems.push(format!(
                        "pairs since {}, {} since {}",
                        js_number(o.since),
                        p.id,
                        js_number(b.since)
                    ));
                }
                if p.city_id != r.city_id {
                    problems.push(format!("pairs with {} of another city", p.id));
                }
                if pi == Some(i) {
                    problems.push("pairs with themselves".into());
                }
            }
            _ => problems.push(format!("pairs with {}, who doesn't pair back", o.partner_id)),
        }
        if r.city_id.is_none() {
            problems.push("pairs but lives in no city".into());
        }
        if !can_work(r.born_at, world.tick as f64) {
            problems.push("pairs as a child".into());
        }
        if o.since > world.tick as f64 {
            problems.push(format!("pairs since {}, after now", js_number(o.since)));
        }
        for p in problems {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id, &o.partner_id]));
        }
    }
    out
}

/// A resident carrying a child holds no order to work, build, tear down or haul, is grown, and
/// gives birth in time (`carryingDoesntWork`).
pub fn carrying_doesnt_work(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "carrying-doesnt-work";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(c) = &r.carrying else { continue };
        let mut problems = Vec::new();
        if let Some(o) = &r.order {
            let kind = kind_of(o);
            if carrying_blocks(o) {
                problems.push(format!("holds a {kind} order while carrying a child"));
            }
        }
        if !can_work(r.born_at, world.tick as f64) {
            problems.push("carries a child as a child".into());
        }
        if c.since > world.tick as f64 {
            problems.push(format!("carries since {}, after now", js_number(c.since)));
        }
        if world.tick as f64 - c.since > CARRYING_TICKS {
            problems.push("carries a child past its time".into());
        }
        for p in problems {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id]));
        }
    }
    out
}

/// Orders only a grown resident can hold (`ADULT_ORDERS`).
const ADULT_ORDERS: [&str; 16] = [
    "build", "roadLine", "wallLine", "tearDown", "repair", "workAt", "teach", "train", "breed",
    "drive", "feed", "crew", "push", "ram", "throw", "gather",
];

/// Children don't work until they are grown (`childrenDontWork`).
pub fn children_dont_work(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "children-dont-work";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(o) = &r.order else { continue };
        let kind = kind_of(o);
        if ADULT_ORDERS.contains(&kind.as_str()) && !can_work(r.born_at, world.tick as f64) {
            out.push(violation(
                name,
                format!("resident {} holds a {kind} order as a child", r.id),
                &[&r.id],
            ));
        }
    }
    out
}

/// Children handle only Food (`childrenCarryOnlyFood`, `canHandle`).
pub fn children_carry_only_food(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "children-carry-only-food";
    let mut out = Vec::new();
    for r in &world.residents {
        if can_work(r.born_at, world.tick as f64) {
            continue;
        }
        let mut goods: Vec<&str> =
            r.carried.iter().filter(|(_, n)| **n > 0.0).map(|(g, _)| good_name(*g)).collect();
        match &r.order {
            Some(ResidentOrder::PickUp(o)) => goods.extend(o.goods.keys().map(|g| good_name(*g))),
            Some(ResidentOrder::Drop(o)) => goods.extend(o.goods.keys().map(|g| good_name(*g))),
            Some(ResidentOrder::Store(o)) => goods.extend(o.goods.keys().map(|g| good_name(*g))),
            Some(ResidentOrder::Fetch(o)) => goods.extend(o.goods.keys().map(|g| good_name(*g))),
            _ => {}
        }
        if goods.iter().all(|g| *g == "food") {
            continue;
        }
        out.push(violation(name, format!("child {} handles {}", r.id, goods.join(", ")), &[&r.id]));
    }
    out
}

/// A teacher stands on a finished training ground, and a ground has at most one teacher
/// (`teachersSound`).
pub fn teachers_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "teachers-sound";
    let mut out = Vec::new();
    let mut teachers: HashMap<&str, &str> = HashMap::new();
    for r in &world.residents {
        let Some(ResidentOrder::Teach(o)) = &r.order else { continue };
        let ground = world.buildings.iter().find(|b| b.id == o.building_id);
        let other = teachers.get(o.building_id.as_str()).copied();
        let problem = match ground {
            Some(g) if g.kind == BuildingKind::TrainingGround && g.site.is_none() => {
                if !is_at((r.x as i32, r.y as i32), placed(g), terrain.size) {
                    Some(format!(
                        "teaches at {} but stands off it, on ({}, {})",
                        g.id,
                        js_number(r.x),
                        js_number(r.y)
                    ))
                } else {
                    other.map(|o| format!("teaches at {}, where {o} teaches already", g.id))
                }
            }
            _ => Some(format!("teaches at {}, no finished training ground", o.building_id)),
        };
        match problem {
            Some(p) => {
                let ids: Vec<&str> = match other {
                    Some(o) => vec![&r.id, o],
                    None => vec![&r.id],
                };
                out.push(violation(name, format!("resident {} {p}", r.id), &ids));
            }
            None => {
                teachers.insert(&o.building_id, &r.id);
            }
        }
    }
    out
}

/// A trainee stands on a finished training ground, and a ground has no more than its room
/// (`traineesSound`).
pub fn trainees_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "trainees-sound";
    let mut out = Vec::new();
    let mut trainees: Vec<(&str, Vec<&str>)> = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Train(o)) = &r.order else { continue };
        let ground = world.buildings.iter().find(|b| b.id == o.building_id);
        let problem = match ground {
            Some(g) if g.kind == BuildingKind::TrainingGround && g.site.is_none() => {
                (!is_at((r.x as i32, r.y as i32), placed(g), terrain.size)).then(|| {
                    format!(
                        "trains at {} but stands off it, on ({}, {})",
                        g.id,
                        js_number(r.x),
                        js_number(r.y)
                    )
                })
            }
            _ => Some(format!("trains at {}, no finished training ground", o.building_id)),
        };
        match problem {
            Some(p) => out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id])),
            None => match trainees.iter_mut().find(|(g, _)| *g == o.building_id) {
                Some((_, ids)) => ids.push(&r.id),
                None => trainees.push((&o.building_id, vec![&r.id])),
            },
        }
    }
    for (ground, ids) in trainees {
        if ids.len() as f64 <= TRAINING_GROUND_MAX_TRAINEES {
            continue;
        }
        let msg = format!(
            "{} train at {ground}, room for {}",
            ids.len(),
            js_number(TRAINING_GROUND_MAX_TRAINEES)
        );
        out.push(violation(name, msg, &ids));
    }
    out
}
