//! Read-only world queries of `packages/shared` that sight calls (ADR 0002: the game API orders,
//! scripts and the UI share), ported with their rules unchanged (ADR 0030). Nothing here changes
//! the world. Each module is named after its TypeScript file; each function keeps its TypeScript
//! name in Rust spelling, so the rule tickets find them here instead of porting them again.
//!
//! Where the TypeScript leaves a map size out (`covers(b, x, y)`, `isAt(p, b)`), it is
//! `MAP_SIZE`; these do the same, which only matters for a footprint across a smaller map's join.

pub mod alliance;
pub mod army;
pub mod building;
pub mod carriages;
pub mod city;
pub mod city_area;
pub mod combat;
pub mod crew;
pub mod goods;
pub mod horse_market;
pub mod horses;
pub mod leader;
pub mod names;
pub mod npc_trade;
pub mod offers;
pub mod persuasion;
pub mod residents;
pub mod standing;
pub mod territory;
pub mod trade_org;
pub mod trader_trade;
pub mod walls;
pub mod warehouse;

/// `Math.round`: halves round up, toward +∞ (`Math.round(-2.5)` is -2), unlike `f64::round`.
pub fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

#[cfg(test)]
mod tests {
    use super::js_round;

    #[test]
    fn rounds_halves_up_as_javascript_does() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-2.6), -3.0);
        assert_eq!(js_round(0.49999999999999994), 0.0);
        assert_eq!(js_round(7.0), 7.0);
    }
}
