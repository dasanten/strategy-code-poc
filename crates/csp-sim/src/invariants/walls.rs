//! Walls, gates and towers: their state, and who stands on or climbs them.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, ResidentOrder, WallMaterial, WorldState};

use super::shared::Out;
use super::{invariant, js_number, violation, Invariant};
use crate::queries::names::kind_name;
use crate::walls::{is_wall_or_gate, wall_strength};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("up-only-on-walls", crate::wall_walk::up_only_on_walls),
    invariant("up-only-on-own-walls", crate::wall_walk::up_only_on_own_walls),
    invariant("tower-room", crate::wall_walk::tower_room),
    invariant("none-attack-up-from-below", crate::wall_walk::none_attack_up_from_below),
    invariant("gates-sound", gates_sound),
    invariant("wall-damage-sound", wall_damage_sound),
    invariant("wall-materials-sound", wall_materials_sound),
    invariant("climb-orders-sound", climb_orders_sound),
];

/// Only gates close, and a gate is either closed or open (`gatesSound`).
pub fn gates_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "gates-sound";
    world
        .buildings
        .iter()
        .filter(|b| {
            b.closed.is_some()
                && (b.kind != BuildingKind::Gate || b.site.is_some() || b.closed != Some(true))
        })
        .map(|b| {
            let site = if b.site.is_some() { "site of a " } else { "" };
            let msg = format!(
                "{site}{} {} is marked closed: {}",
                kind_name(b.kind),
                b.id,
                b.closed.unwrap_or_default()
            );
            violation(name, msg, &[&b.id])
        })
        .collect()
}

/// Only a finished wall or gate takes damage, and stands only while short of its strength
/// (`wallDamageSound`).
pub fn wall_damage_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "wall-damage-sound";
    world
        .buildings
        .iter()
        .filter(|b| {
            b.damage.is_some_and(|d| !is_wall_or_gate(b) || !(d >= 0.0 && d < wall_strength(b)))
        })
        .map(|b| {
            let site = if b.site.is_some() { "site of a " } else { "" };
            let msg = format!(
                "{site}{} {} stands with damage {}",
                kind_name(b.kind),
                b.id,
                js_number(b.damage.unwrap_or_default())
            );
            violation(name, msg, &[&b.id])
        })
        .collect()
}

/// A climber stands where they started climbing, between 0 and 1 of the way over
/// (`climbOrdersSound`).
pub fn climb_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "climb-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Climb(o)) = &r.order else { continue };
        let problem = if r.x != o.at.x || r.y != o.at.y {
            Some(format!(
                "climbs from ({}, {}) but stands on ({}, {})",
                js_number(o.at.x),
                js_number(o.at.y),
                js_number(r.x),
                js_number(r.y)
            ))
        } else if !(o.progress >= 0.0 && o.progress < 1.0) {
            Some(format!("is {} of the way over a wall", js_number(o.progress)))
        } else {
            None
        };
        if let Some(p) = problem {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id]));
        }
    }
    out
}

/// Only a wall, gate or tower, or its site, is of stone, and only stone is written down: none is wood
/// (`CONTEXT.md`: Wall / Gate, Wood or stone).
pub fn wall_materials_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "wall-materials-sound";
    world
        .buildings
        .iter()
        .filter(|b| {
            b.material.is_some_and(|m| {
                m != WallMaterial::Stone
                    || !matches!(
                        b.kind,
                        BuildingKind::Wall | BuildingKind::Gate | BuildingKind::Tower
                    )
            })
        })
        .map(|b| {
            let msg = format!("{} {} is of {:?}", kind_name(b.kind), b.id, b.material);
            violation(name, msg, &[&b.id])
        })
        .collect()
}
