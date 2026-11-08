//! The edge of a Player's explored terrain (`apps/server/src/explored-edge.ts`, `CONTEXT.md`:
//! Explored terrain, Explore).

use std::f64::consts::FRAC_1_SQRT_2;

use csp_shared::balance::{EXPLORED_EDGE_RANGE, EXPLORE_SKIP_RANGE};
use csp_shared::terrain::{wrap, wrap_distance};

use crate::queries::js_round;

/// The compass directions `explored_edge` looks toward, as a step on the map (y grows south)
/// (`COMPASS`), in the TypeScript's order.
pub const COMPASS: [(&str, (f64, f64)); 8] = [
    ("north", (0.0, -1.0)),
    ("northeast", (FRAC_1_SQRT_2, -FRAC_1_SQRT_2)),
    ("east", (1.0, 0.0)),
    ("southeast", (FRAC_1_SQRT_2, FRAC_1_SQRT_2)),
    ("south", (0.0, 1.0)),
    ("southwest", (-FRAC_1_SQRT_2, FRAC_1_SQRT_2)),
    ("west", (-1.0, 0.0)),
    ("northwest", (-FRAC_1_SQRT_2, -FRAC_1_SQRT_2)),
];

/// A compass direction's step, if `name` is one.
pub fn compass(name: &str) -> Option<(f64, f64)> {
    COMPASS.iter().find(|(n, _)| *n == name).map(|(_, d)| *d)
}

/// What `explored_edge` looks for (`EdgeSearch`).
pub struct EdgeSearch<'a> {
    pub size: i32,
    /// Whether the Player has explored a tile.
    pub explored: &'a dyn Fn(i32, i32) -> bool,
    /// Whether the one looking can go onto an explored tile: on foot, or riding.
    pub can_enter: &'a dyn Fn(i32, i32) -> bool,
    pub from: (i32, i32),
    /// A compass direction (`COMPASS`): only tiles that way, at most 45° off it.
    pub toward: Option<&'a str>,
    /// Tiles to leave out, with those within `EXPLORE_SKIP_RANGE` of them.
    pub skip: &'a [(i32, i32)],
}

/// The nearest tile of the edge of a Player's explored terrain (`exploredEdge`): one they have
/// explored and can go onto, beside one they haven't. Toward a direction, the tiles that way
/// only, the straightest first among those as near to a whole tile. `None` with none within
/// `EXPLORED_EDGE_RANGE`.
pub fn explored_edge(search: &EdgeSearch<'_>) -> Option<(i32, i32)> {
    let size = search.size;
    let explored = search.explored;
    // An unknown direction, as `COMPASS[toward]` finds nothing, looks every way.
    let dir = search.toward.and_then(compass);
    let range = (EXPLORED_EDGE_RANGE as i32).min((size - 1).div_euclid(2));
    let on_edge = |x: i32, y: i32| {
        explored(x, y)
            && (search.can_enter)(x, y)
            && (!explored(x, wrap(y - 1, size))
                || !explored(wrap(x + 1, size), y)
                || !explored(x, wrap(y + 1, size))
                || !explored(wrap(x - 1, size), y))
    };
    let skipped = |x: i32, y: i32| {
        search.skip.iter().any(|s| wrap_distance(size, *s, (x, y)) <= EXPLORE_SKIP_RANGE)
    };
    let mut best: Option<(i32, i32, f64, f64)> = None;
    // Ring by ring outward: a tile on ring r lies at least r away, so once r passes the best
    // found no nearer one is left.
    let mut r = 0;
    while r <= range && !best.is_some_and(|b| f64::from(r) > b.2) {
        for dy in -r..=r {
            let across = if dy.abs() == r { 1 } else { (2 * r).max(1) };
            let mut dx = -r;
            while dx <= r {
                let (fx, fy) = (f64::from(dx), f64::from(dy));
                let distance = fx.hypot(fy);
                // How far off the direction, as 1 less the cosine: 0 straight that way.
                let off = match dir {
                    Some((ux, uy)) if distance > 0.0 => 1.0 - (fx * ux + fy * uy) / distance,
                    _ => 0.0,
                };
                let next = dx + across;
                if off > 1.0 - FRAC_1_SQRT_2 + 1e-9 {
                    dx = next;
                    continue;
                }
                let near = js_round(distance);
                if best.is_some_and(|b| near > b.2 || (near == b.2 && off >= b.3)) {
                    dx = next;
                    continue;
                }
                let x = wrap(search.from.0 + dx, size);
                let y = wrap(search.from.1 + dy, size);
                if on_edge(x, y) && !skipped(x, y) {
                    best = Some((x, y, near, off));
                }
                dx = next;
            }
        }
        r += 1;
    }
    best.map(|b| (b.0, b.1))
}
