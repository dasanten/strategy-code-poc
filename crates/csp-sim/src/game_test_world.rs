//! A running game for the tests that step the whole world as the TypeScript tests' `stepWorld`
//! did, with the order queue, walking and the default scripts (`test-default-scripts.ts`): the
//! tests ported late (T89.1) from cases first stubbed while those were missing. Test-only.

use std::sync::Arc;

use csp_shared::balance::MAX_HUNGER;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Resident, WorldState};
use serde_json::Value;

use crate::invariants::{check_invariants, world_invariants, Invariant};
use crate::order_sender::OrderSender;
use crate::orders::{OrderQueue, OrderReply};
use crate::script_runner::default_host::DefaultScripts;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::step_world;

/// The Players the tests send orders as: Mara (7) and Tobin (8), as the TypeScript tests name them.
pub fn player(user_id: u64) -> OrderSender {
    let name = match user_id {
        7 => "Mara".to_string(),
        8 => "Tobin".to_string(),
        n => format!("Player {n}"),
    };
    OrderSender::player(user_id, &name)
}

/// A world with its terrain, orders, walking and scripts, stepped a tick at a time.
pub struct Game {
    pub world: WorldState,
    pub terrain: Arc<TerrainMap>,
    pub scratch: Scratch,
    scripts: DefaultScripts,
    orders: OrderQueue,
    walking: Walking,
    /// Residents are kept fed each tick (the tests' `run`).
    pub fed: bool,
    /// The default scripts run before the world steps, as the game runs them.
    pub scripts_run: bool,
    /// Residents walk; without it, `stepWorld` with no walking.
    pub walks: bool,
    /// The invariants checked after each tick; all of them unless a test narrows them.
    pub invariants: Vec<Invariant>,
}

impl Game {
    /// `world` on `terrain`, Players 7 and 8 and every realm's Player sending orders, residents
    /// fed and walking, scripts running and every invariant checked.
    pub fn new(world: WorldState, terrain: TerrainMap) -> Self {
        let terrain = Arc::new(terrain);
        let mut users: Vec<u64> = vec![7, 8];
        users.extend(world.realms.iter().map(|r| r.user_id));
        users.sort_unstable();
        users.dedup();
        let senders: Vec<OrderSender> = users.into_iter().map(player).collect();
        let scripts = DefaultScripts::new(terrain.clone(), &senders);
        let orders = OrderQueue::new(scripts.kinds.clone(), Some(terrain.clone()));
        // A clock that never runs out, so how far a way is found doesn't hang on the machine.
        let walking = Walking::with_clock(terrain.clone(), Box::new(|| 0.0));
        Game {
            world,
            terrain,
            scratch: Scratch::default(),
            scripts,
            orders,
            walking,
            fed: true,
            scripts_run: true,
            walks: true,
            invariants: world_invariants(),
        }
    }

    /// Only these invariants, by name, are checked after each tick.
    pub fn checking(mut self, names: &[&str]) -> Self {
        self.invariants.retain(|i| names.contains(&i.name));
        assert_eq!(self.invariants.len(), names.len(), "an invariant named {names:?}");
        self
    }

    /// Sends an order from Player `user_id` and applies it, as the tests' `order` does: "ack", or
    /// the reason it was rejected.
    pub fn order(&mut self, user_id: u64, order: Value) -> String {
        let answer = self.receive(user_id, order);
        self.orders.apply_all(&mut self.world);
        answer
    }

    /// Sends an order from Player `user_id`; it waits for the next tick.
    pub fn receive(&mut self, user_id: u64, order: Value) -> String {
        match self.orders.receive(&self.world, &player(user_id), &"q".into(), &order) {
            OrderReply::Ack { .. } => "ack".into(),
            OrderReply::Rejected { reason, .. } => reason,
        }
    }

    /// One tick: waiting orders applied, scripts run, the world stepped, the invariants checked.
    pub fn tick(&mut self) {
        if self.fed {
            for r in &mut self.world.residents {
                r.hunger = MAX_HUNGER;
            }
        }
        self.orders.apply_all(&mut self.world);
        if self.scripts_run {
            assert_eq!(self.scripts.run_all(&mut self.world, &mut self.scratch), vec![]);
        }
        let walking: Option<&mut dyn crate::tick::Walk> =
            if self.walks { Some(&mut self.walking) } else { None };
        step_world(&mut self.world, &self.terrain, &mut self.scratch, walking, None);
        assert_eq!(check_invariants(&self.world, &self.terrain, &self.invariants), vec![]);
    }

    /// `ticks` ticks.
    pub fn run(&mut self, ticks: usize) {
        for _ in 0..ticks {
            self.tick();
        }
    }

    /// Ticks until resident `id`'s health falls or they are gone, at most `limit` ticks
    /// (`untilHit`); the ticks taken.
    pub fn until_hit(&mut self, id: &str, limit: usize) -> Option<usize> {
        let before = self.r(id).health;
        for t in 1..=limit {
            self.tick();
            match self.world.residents.iter().find(|r| r.id == id) {
                None => return Some(t),
                Some(r) if r.health < before - 0.5 => return Some(t),
                _ => {}
            }
        }
        None
    }

    /// The living resident of an id.
    pub fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).expect("a resident of that id")
    }

    /// The living resident of an id, to change.
    pub fn r_mut(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).expect("a resident of that id")
    }
}

/// Runs `source` once as resident `resident_id`'s script, sent by `sender`, as the TypeScript
/// tests' `bindScript` and `run` do: what it left in `memory.answer` (`None` for nothing there)
/// and the orders it requested.
pub fn run_script(
    world: &WorldState,
    terrain: &TerrainMap,
    sender: &OrderSender,
    resident_id: &str,
    source: &str,
) -> (Option<Value>, Vec<csp_shared::world::OrderRequest>) {
    use csp_lang::interpreter::{run, RunOptions, RunResult, ValueLimits};
    use csp_shared::balance::{SCRIPT_MAX_CALL_DEPTH, SCRIPT_VALUE_LIMITS};

    let index = crate::world_index::WorldIndex::new(world, terrain.size);
    let realm = crate::starting_city::realm_of(world, sender.user_id)
        .map(|i| world.realms[i].id.clone())
        .expect("the sender's realm");
    let seen = || crate::sight::entities_in_sight(world, &index, Some(&realm), None);
    let eyes = || crate::sight::sight_of(world, &index, &realm, None);
    let explored = |_: i32, _: i32| true;
    let kinds = crate::orders::order_kinds();
    let memory = csp_lang::Object::new();
    let ctx = crate::script_bindings::ScriptContext {
        world,
        terrain,
        index: &index,
        sender,
        resident_id: Some(resident_id),
        army_id: None,
        memory: memory.clone(),
        seen: &seen,
        eyes: &eyes,
        explored: &explored,
        kinds: &kinds,
        edge: None,
        params: None,
    };
    let mut bound = crate::script_bindings::bind_script(ctx).expect("a script bound");
    let program = csp_lang::parse(source).expect("a script that parses");
    let limits = ValueLimits {
        max_string_length: SCRIPT_VALUE_LIMITS.max_string_length as usize,
        max_list_length: SCRIPT_VALUE_LIMITS.max_list_length as usize,
        max_object_keys: SCRIPT_VALUE_LIMITS.max_object_keys as usize,
    };
    let options =
        RunOptions { steps: 10_000, max_call_depth: SCRIPT_MAX_CALL_DEPTH as u32, limits };
    let result = run(&program, &mut bound, &options).expect("the script runs");
    assert!(matches!(result, RunResult::Done { .. }), "{result:?}");
    let answer = memory.borrow().get("answer").cloned();
    let answer = answer.map(|a| csp_lang::plain_value(&a, usize::MAX).expect("plain").value);
    (answer, std::mem::take(&mut bound.requests))
}
