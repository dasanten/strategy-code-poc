//! The Trade Org HQ (`apps/server/src/trade-org.ts`, `CONTEXT.md`: Trade Org HQ): its round
//! layout, where it may stand, and laying it out.

use std::cell::RefCell;
use std::collections::HashMap;
use std::f64::consts::PI;

use csp_shared::balance::TRADE_ORG_HQ;
use csp_shared::footprint::FOOTPRINT;

use crate::queries::warehouse::HQ_COIN_WAREHOUSE as HQ_COINS;

/// A tile as `(x, y)`.
pub type Tile = (i32, i32);

/// Whether an offset from the middle lies within `radius`, as a round shape on the grid
/// (`within`).
pub fn within(dx: i32, dy: i32, radius: f64) -> bool {
    f64::from(dx).hypot(f64::from(dy)) <= radius + 0.5
}

/// A round ring of tiles `radius` out from (cx, cy) (`roundRing`): the tiles within it that
/// touch a tile outside it, along a side or a corner, row by row.
pub fn round_ring(cx: i32, cy: i32, radius: f64) -> Vec<Tile> {
    let mut out = Vec::new();
    let r = radius.ceil() as i32 + 1;
    for dy in -r..=r {
        for dx in -r..=r {
            if !within(dx, dy, radius) {
                continue;
            }
            let edge = (-1..=1).any(|ny| (-1..=1).any(|nx| !within(dx + nx, dy + ny, radius)));
            if edge {
                out.push((cx + dx, cy + dy));
            }
        }
    }
    out
}

/// The angle of a tile seen from (cx, cy), clockwise from due north, in [0, 2π) (`angleOf`).
pub fn angle_of(cx: i32, cy: i32, (x, y): Tile) -> f64 {
    (f64::from(x - cx).atan2(f64::from(cy - y)) + 2.0 * PI) % (2.0 * PI)
}

/// The `n` gate angles of a ring, evenly round it, the first due north (`gateAngles`).
pub fn gate_angles(n: usize) -> Vec<f64> {
    (0..n).map(|i| (i as f64 * 2.0 * PI) / n as f64).collect()
}

/// How far apart two angles are, the short way round (`angleApart`).
pub fn angle_apart(a: f64, b: f64) -> f64 {
    let d = (a - b).abs() % (2.0 * PI);
    d.min(2.0 * PI - d)
}

/// The tile of `ring` nearest each gate angle (`gatesOf`): the first of the nearest.
pub fn gates_of(cx: i32, cy: i32, ring: &[Tile]) -> Vec<Tile> {
    gate_angles(TRADE_ORG_HQ.gates as usize)
        .into_iter()
        .map(|a| {
            *ring
                .iter()
                .min_by(|p, q| {
                    let dp = angle_apart(angle_of(cx, cy, **p), a);
                    let dq = angle_apart(angle_of(cx, cy, **q), a);
                    dp.partial_cmp(&dq).expect("angles are numbers")
                })
                .expect("a ring has tiles")
        })
        .collect()
}

/// Where the HQ's buildings stand around the middle tile of its town hall (`HqLayout`), each by
/// the north-west tile of its footprint.
#[derive(Debug, Clone, PartialEq)]
pub struct HqLayout {
    pub hall: Tile,
    pub storage: Tile,
    pub coin_warehouse: Tile,
    pub goods_warehouse: Tile,
    pub inner_ring: Vec<Tile>,
    pub inner_gates: Vec<Tile>,
    pub outer_ring: Vec<Tile>,
    pub outer_gates: Vec<Tile>,
    pub houses: Vec<Tile>,
    pub smelter: Tile,
    pub mint: Tile,
}

thread_local! {
    /// Layouts worked out so far (`layouts`), by their middle tile.
    static LAYOUTS: RefCell<HashMap<Tile, HqLayout>> = RefCell::new(HashMap::new());
}

/// The HQ's shape around the middle tile (cx, cy) of its town hall (`hqLayout`), worked out once
/// for each tile.
pub fn hq_layout(cx: i32, cy: i32) -> HqLayout {
    LAYOUTS
        .with(|l| l.borrow_mut().entry((cx, cy)).or_insert_with(|| work_out_layout(cx, cy)).clone())
}

fn side(kind: &str) -> i32 {
    FOOTPRINT.get(kind).expect("a footprint")
}

fn work_out_layout(cx: i32, cy: i32) -> HqLayout {
    let (inner, outer) = (TRADE_ORG_HQ.inner_radius, TRADE_ORG_HQ.outer_radius);
    let inner_ring = round_ring(cx, cy, inner);
    let outer_ring = round_ring(cx, cy, outer);
    let between = crate::queries::js_round((inner + outer) / 2.0);
    // Keep a tile and a half clear on either side of each way in, beside the houses' footprints.
    let clear = ((1.5 + f64::from(side("house"))) / between).asin();
    let gates = gate_angles(TRADE_ORG_HQ.gates as usize);
    let mut slots: Vec<Tile> = round_ring(cx, cy, between)
        .into_iter()
        .filter(|t| gates.iter().all(|a| angle_apart(angle_of(cx, cy, *t), *a) > clear))
        .collect();
    slots.sort_by(|p, q| angle_of(cx, cy, *p).partial_cmp(&angle_of(cx, cy, *q)).expect("angles"));
    let houses = TRADE_ORG_HQ.houses as usize;
    let wanted = houses + 2;
    assert!(
        slots.len() >= wanted * (side("house") as usize + 1),
        "the Trade Org HQ has no room for its houses"
    );
    let spread: Vec<Tile> = (0..wanted).map(|i| slots[(i * slots.len()) / wanted]).collect();
    let hall = (cx - 1, cy - 1);
    let storage = side("storage");
    let (dx, dy) = (HQ_COINS.0 as i32, HQ_COINS.1 as i32);
    HqLayout {
        hall,
        storage: (hall.0 - storage - 1, hall.1 - storage - 1),
        coin_warehouse: (hall.0 + dx, hall.1 + dy),
        goods_warehouse: (hall.0 + dx, hall.1 - dy),
        inner_gates: gates_of(cx, cy, &inner_ring),
        inner_ring,
        outer_gates: gates_of(cx, cy, &outer_ring),
        outer_ring,
        houses: spread[..houses].to_vec(),
        smelter: spread[houses],
        mint: spread[houses + 1],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ring_holds_together_and_the_gates_lie_on_it() {
        let ring = round_ring(0, 0, 16.0);
        assert!(ring.contains(&(0, -16)));
        let l = hq_layout(320, 320);
        for g in &l.outer_gates {
            assert!(l.outer_ring.contains(g));
        }
        assert_eq!(l.outer_gates[0].0, 320, "the first gate due north");
        assert_eq!(l.houses.len(), TRADE_ORG_HQ.houses as usize);
    }
}
