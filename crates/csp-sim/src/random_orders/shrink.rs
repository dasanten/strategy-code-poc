//! Cutting a failure of the random run down: orders, then ticks, are dropped while the same
//! invariant still breaks, until nothing more can go. What is left is written as a replay file.

use std::fmt::Write as _;

use csp_shared::world::WorldState;

use super::{replay, Broke, Broken, Failure, Replay, Step};

/// The shortest replay of `failure` this finds: a run from the world `world` of `size` tiles (a
/// [`Replay::start`] name) with as few orders and ticks as still break the same way, `rule` run
/// before every tick as in the run that failed. When even every order given does not break it
/// again, the replay of them all.
pub fn shrink(
    failure: &Failure,
    world: &str,
    size: i32,
    rule: &mut dyn FnMut(&mut WorldState),
) -> Replay {
    let broke = Broken::of(failure);
    let mut whole = Replay {
        note: None,
        world: world.into(),
        size,
        seed: failure.seed,
        ticks: 0,
        broke: broke.clone(),
        orders: Vec::new(),
    };
    let start = whole.start().0.tick;
    whole.ticks = failure.tick - start;
    let steps = |accepted_only: bool| -> Vec<Step> {
        failure
            .given
            .iter()
            .filter(|g| !accepted_only || g.refused.is_none())
            .map(|g| Step { tick: g.tick - start, user_id: g.user_id, order: g.order.clone() })
            .collect()
    };
    // The ticks run until it breaks the same way, if it does.
    let mut breaks = |r: &Replay| -> Option<u64> {
        match replay(r, rule) {
            Err(f) if broke.is_broken_by(&f) => Some(f.tick - start),
            _ => None,
        }
    };
    whole.orders = steps(true);
    if breaks(&whole).is_none() {
        // A refused order may matter after all.
        whole.orders = steps(false);
        if breaks(&whole).is_none() {
            return whole;
        }
    }
    let with_orders = |orders: &[Step]| Replay { orders: orders.to_vec(), ..whole.clone() };
    let orders = smallest(whole.orders.clone(), &mut |o| breaks(&with_orders(o)).is_some());
    let mut shrunk = with_orders(&orders);
    shrunk.ticks = breaks(&shrunk).expect("the shrunk orders still break it");
    shrunk.orders.retain(|s| s.tick < shrunk.ticks);

    // Then the ticks no order is given before.
    let mut needed: Vec<u64> = shrunk.orders.iter().map(|s| s.tick).collect();
    needed.dedup();
    let idle: Vec<u64> = (0..shrunk.ticks).filter(|t| !needed.contains(t)).collect();
    let keeping = |idle: &[u64]| -> Replay {
        let mut kept: Vec<u64> = needed.iter().chain(idle).copied().collect();
        kept.sort_unstable();
        let at = |t: u64| kept.iter().position(|&k| k == t).expect("a kept tick") as u64;
        let orders = shrunk.orders.iter().map(|s| Step { tick: at(s.tick), ..s.clone() }).collect();
        Replay { ticks: kept.len() as u64, orders, ..shrunk.clone() }
    };
    let idle = smallest(idle, &mut |i| breaks(&keeping(i)).is_some());
    let mut shortest = keeping(&idle);
    shortest.ticks = breaks(&shortest).expect("the shrunk ticks still break it");
    // The invariant it was shrunk for, with the shrunk run's message of it.
    if let (Some(f), Broken::Invariant { name, message }) =
        (replay(&shortest, rule).err(), &mut shortest.broke)
    {
        if let Broke::Invariants(vs) = &f.broke {
            if let Some(v) = vs.iter().find(|v| &v.invariant == name) {
                message.clone_from(&v.message);
            }
        }
    }
    shortest
}

/// The fewest of `items` for which `breaks` still holds, found by dropping ever smaller runs of
/// them (delta debugging): no single item of the result can go.
fn smallest<T: Clone>(mut items: Vec<T>, breaks: &mut dyn FnMut(&[T]) -> bool) -> Vec<T> {
    let mut parts = 2;
    while !items.is_empty() {
        let len = items.len();
        let chunk = len.div_ceil(parts);
        let mut dropped = false;
        for from in (0..len).step_by(chunk) {
            let rest: Vec<T> =
                items[..from].iter().chain(&items[(from + chunk).min(len)..]).cloned().collect();
            if breaks(&rest) {
                items = rest;
                parts = (parts - 1).max(2);
                dropped = true;
                break;
            }
        }
        if !dropped {
            if parts >= len {
                break;
            }
            parts = (parts * 2).min(len);
        }
    }
    items
}

/// What a test prints for `failure`: what broke, the shrunk order list and the replay file it is
/// written to (see [`shrink`] for `world`, `size` and `rule`).
pub fn report(
    failure: &Failure,
    world: &str,
    size: i32,
    rule: &mut dyn FnMut(&mut WorldState),
) -> String {
    let shrunk = shrink(failure, world, size, rule);
    let path = shrunk.write();
    let mut s = String::new();
    let _ =
        writeln!(s, "random-order run of seed {} broke at tick {}:", failure.seed, failure.tick);
    match &failure.broke {
        Broke::Invariants(vs) => {
            for v in vs {
                let _ = writeln!(s, "  {}: {} {:?}", v.invariant, v.message, v.entity_ids);
            }
        }
        Broke::Panic(m) => {
            let _ = writeln!(s, "  panicked: {m}");
        }
    }
    let accepted = failure.given.iter().filter(|g| g.refused.is_none()).count();
    let _ = writeln!(
        s,
        "shrunk from {accepted} accepted orders to {} over {} ticks of the world {} ({} tiles):",
        shrunk.orders.len(),
        shrunk.ticks,
        shrunk.world,
        shrunk.size
    );
    for o in &shrunk.orders {
        let _ = writeln!(s, "  tick {} player {}: {}", o.tick, o.user_id, o.order);
    }
    let _ = writeln!(s, "replay file: {}", path.display());
    let _ = writeln!(
        s,
        "as a regression test: copy it to crates/csp-sim/src/random_orders/replays/ (docs/recipes.md)"
    );
    s
}

#[cfg(test)]
mod tests;
