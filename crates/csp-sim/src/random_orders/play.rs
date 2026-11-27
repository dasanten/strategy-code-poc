//! Giving orders to a world and running its ticks, a Player's way: what the random run and a
//! replay share, so a replay is the run it came from.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

use csp_shared::balance::MAX_HUNGER;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;
use serde_json::{json, Value};

use super::{Broke, Failure, Given};
use crate::invariants::InvariantViolation;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::tick::{run_tick, Scratch, ScriptErrorWhere, TickHealth, TickOptions, TickReporter};
use crate::walking::Walking;

/// What the tick reports, kept to be looked at once it is over.
#[derive(Default)]
struct Kept {
    violations: Vec<InvariantViolation>,
    errors: Vec<String>,
}

impl TickReporter for Kept {
    fn invariant_violations(&mut self, _: &WorldState, violations: &[InvariantViolation]) {
        self.violations.extend_from_slice(violations);
    }
    fn tick_health(&mut self, _: &WorldState, _: &TickHealth) {}
    fn tick_error(&mut self, _: &WorldState, error: &str) {
        self.errors.push(format!("tick panicked: {error}"));
    }
    fn script_error(&mut self, _: &WorldState, error: &str, _: &ScriptErrorWhere) {
        self.errors.push(format!("script error: {error}"));
    }
}

/// Plays `ticks` ticks on `world`. Before each, the residents are fed, `requests` is asked for
/// the orders of this tick of the run (counted from 0), each as `(the Player's user id, the
/// request)`, and they are given; `rule` runs on the world; then the tick, with every world
/// invariant checked. The first tick that breaks one, or panics, ends the play as a [`Failure`]
/// of `seed`. Returns every order given, and how it was answered.
pub fn play(
    world: &mut WorldState,
    terrain: TerrainMap,
    seed: u64,
    ticks: u64,
    requests: &mut dyn FnMut(&WorldState, u64) -> Vec<(u64, Value)>,
    rule: &mut dyn FnMut(&mut WorldState),
) -> Result<Vec<Given>, Box<Failure>> {
    let terrain = Arc::new(terrain);
    let mut queue = OrderQueue::new(order_kinds(), Some(terrain.clone()));
    let mut walking = Walking::without_budget(terrain.clone());
    let mut scratch = Scratch::default();
    let mut given: Vec<Given> = Vec::new();
    let fail = |tick, broke, given: &Vec<Given>| {
        Box::new(Failure { seed, tick, broke, given: given.clone() })
    };
    for at in 0..ticks {
        // Kept fed, so the run is about orders, not hunger.
        for r in &mut world.residents {
            r.hunger = MAX_HUNGER;
        }
        for (user_id, order) in requests(world, at) {
            let sender = OrderSender::player(user_id, &format!("Player {user_id}"));
            let reply = catch_unwind(AssertUnwindSafe(|| {
                queue.receive(world, &sender, &json!("random"), &order)
            }));
            let refused = match reply {
                Ok(OrderReply::Ack { .. }) => None,
                Ok(OrderReply::Rejected { reason, .. }) => Some(reason),
                Err(p) => {
                    given.push(Given { tick: world.tick, user_id, order, refused: None });
                    return Err(fail(world.tick, Broke::Panic(panic_text(p.as_ref())), &given));
                }
            };
            given.push(Given { tick: world.tick, user_id, order, refused });
        }
        rule(world);
        let mut kept = Kept::default();
        let mut every_tick = || 0.0;
        let mut opts = TickOptions::new(&mut kept, 1.0, f64::INFINITY);
        opts.walking = Some(&mut walking);
        opts.orders = Some(&mut queue);
        opts.now = Some(Box::new(|| 0.0));
        opts.rand = Some(&mut every_tick);
        run_tick(world, &terrain, &mut scratch, opts);
        if let Some(e) = kept.errors.first() {
            return Err(fail(world.tick, Broke::Panic(e.clone()), &given));
        }
        if !kept.violations.is_empty() {
            return Err(fail(world.tick, Broke::Invariants(kept.violations), &given));
        }
    }
    Ok(given)
}

fn panic_text(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic".into())
}
