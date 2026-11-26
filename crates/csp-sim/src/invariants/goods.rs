//! Goods: what is carried, worn and stored, and the orders that move it.

// `!(x >= 0)` as the TypeScript writes it: true for NaN too, which a plain `x < 0` is not.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

use std::collections::HashSet;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{ResidentOrder, Stock, WorldState};

use super::shared::{kind_of, Out};
use super::{invariant, js_json, js_number, violation, Invariant};
use crate::queries::balance::carry_capacity;
use crate::queries::building::{building_at, KEEPS_GOODS};
use crate::queries::names::kind_name;
use crate::queries::residents::stock_weight;

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("carried-within-capacity", carried_within_capacity),
    invariant("equipment-sound", equipment_sound),
    invariant("wear-sound", |w, _| crate::wear::wear_problems(w)),
    invariant("goods-in-place", goods_in_place),
    invariant("goods-in-whole-units", goods_in_whole_units),
    invariant("carry-orders-done", carry_orders_done),
    invariant("store-fetch-orders-sound", store_fetch_orders_sound),
    invariant("gather-orders-sound", crate::gathering::gather_order_problems),
];

/// Nobody carries more than their carry capacity.
pub fn carried_within_capacity(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "carried-within-capacity";
    let tick = world.tick as f64;
    world
        .residents
        .iter()
        .filter(|r| stock_weight(&r.carried) > carry_capacity(r, tick) + 1e-9)
        .map(|r| {
            let msg = format!(
                "resident {} carries {} kg of {} kg",
                r.id,
                js_number(stock_weight(&r.carried)),
                js_number(carry_capacity(r, tick))
            );
            violation(name, msg, &[&r.id])
        })
        .collect()
}

/// Every equipped item is among what its resident carries, and each slot holds only its kind
/// (`CONTEXT.md`: Equipment).
pub fn equipment_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "equipment-sound";
    world
        .residents
        .iter()
        .filter_map(|r| {
            crate::equipment::equipment_problem(r)
                .map(|p| violation(name, format!("resident {}: {p}", r.id), &[&r.id]))
        })
        .collect()
}

fn negative(stock: &Stock) -> bool {
    stock.values().any(|n| !(*n >= 0.0))
}

/// Goods are never negative, only storages and stables among buildings hold any, a pile is never
/// empty; one pile per tile, and a pile on a building's footprint is its one pile
/// (`goodsInPlace`).
pub fn goods_in_place(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "goods-in-place";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    for r in &world.residents {
        if negative(&r.carried) {
            fail(&r.id, "carries negative goods".into());
        }
    }
    for b in &world.buildings {
        let holds = b.stock.as_ref().is_some_and(|s| s.values().any(|&n| n > 0.0));
        if holds && (!KEEPS_GOODS.contains(&b.kind) || b.site.is_some()) {
            fail(&b.id, format!("is a {} holding goods", kind_name(b.kind)));
        }
        if b.site.as_ref().is_some_and(|s| negative(&s.delivered)) {
            fail(&b.id, "has negative materials delivered".into());
        }
    }
    let mut tiles = HashSet::new();
    for p in &world.piles {
        if negative(&p.goods) {
            fail(&p.id, "holds negative goods".into());
        }
        if !p.goods.values().any(|&n| n > 0.0) {
            fail(&p.id, "is an empty pile".into());
        }
        let key = format!("{},{}", js_number(p.x), js_number(p.y));
        if tiles.contains(&key) {
            fail(&p.id, format!("is a second pile on tile ({key})"));
        }
        tiles.insert(key);
        if let Some(on) = building_at(world, p.x as i32, p.y as i32, terrain.size) {
            if on.x != p.x || on.y != p.y {
                fail(
                    &p.id,
                    format!("lies on {} but is not its pile (on its north-west tile)", on.id),
                );
            }
        }
    }
    out
}

/// Goods are counted in whole units wherever they are (`goodsInWholeUnits`).
pub fn goods_in_whole_units(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "goods-in-whole-units";
    let mut holders: Vec<(&str, Option<&Stock>)> = Vec::new();
    holders.extend(world.residents.iter().map(|r| (r.id.as_str(), Some(&r.carried))));
    holders.extend(world.buildings.iter().map(|b| (b.id.as_str(), b.stock.as_ref())));
    holders.extend(
        world
            .buildings
            .iter()
            .filter_map(|b| b.site.as_ref().map(|s| (b.id.as_str(), Some(&s.delivered)))),
    );
    holders.extend(world.carriages.iter().map(|k| (k.id.as_str(), Some(&k.load))));
    holders.extend(world.vessels.iter().map(|v| (v.id.as_str(), Some(&v.load))));
    holders.extend(world.piles.iter().map(|p| (p.id.as_str(), Some(&p.goods))));
    holders
        .into_iter()
        .filter(|(_, s)| s.is_some_and(|s| s.values().any(|n| n.fract() != 0.0 || !n.is_finite())))
        .map(|(id, s)| {
            violation(name, format!("{id} holds part of a unit: {}", js_json(&s)), &[id])
        })
        .collect()
}

/// Pick-up and drop orders are done within the tick they start (`carryOrdersDone`).
pub fn carry_orders_done(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "carry-orders-done";
    world
        .residents
        .iter()
        .filter_map(|r| match &r.order {
            Some(o @ (ResidentOrder::PickUp(_) | ResidentOrder::Drop(_))) => Some((r, kind_of(o))),
            _ => None,
        })
        .map(|(r, kind)| {
            violation(
                name,
                format!("resident {} still holds a {kind} order after the tick", r.id),
                &[&r.id],
            )
        })
        .collect()
}

/// Store and fetch orders ask for goods in whole units or as many as there are, and are done
/// putting or taking within the tick; how one ended never lies in the future
/// (`storeFetchOrdersSound`).
pub fn store_fetch_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "store-fetch-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let mut fail =
            |m: String| out.push(violation(name, format!("resident {} {m}", r.id), &[&r.id]));
        let (kind, goods, phase) = match &r.order {
            Some(o @ ResidentOrder::Store(s)) => {
                (kind_of(o), Some(&s.goods), kind_of_phase(&s.phase))
            }
            Some(o @ ResidentOrder::Fetch(f)) => {
                (kind_of(o), Some(&f.goods), kind_of_phase(&f.phase))
            }
            _ => ("", None, String::new()),
        };
        if let Some(goods) = goods {
            // `readWanted`: known goods (the type keeps to them), each `null` or a whole number
            // above 0, and at least one.
            let fine = !goods.is_empty()
                && goods.values().all(|u| u.is_none_or(|n| n.fract() == 0.0 && n > 0.0));
            if !fine {
                fail(format!("{kind}s malformed goods {}", js_json(goods)));
            }
            if phase == "putting" || phase == "taking" {
                fail(format!("is still {phase} for a {kind} order after the tick"));
            }
        }
        if let Some(ended) = &r.order_ended {
            if ended.tick > world.tick as f64 {
                let ended_kind = serde_json::to_value(ended.kind).ok();
                let ended_kind = ended_kind.as_ref().and_then(|v| v.as_str()).unwrap_or_default();
                fail(format!(
                    "has a {ended_kind} order that ended at tick {}",
                    js_number(ended.tick)
                ));
            }
        }
    }
    out
}

/// A store or fetch phase's TypeScript name.
fn kind_of_phase(phase: &impl serde::Serialize) -> String {
    serde_json::to_value(phase).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default()
}
