//! The stable hand (`CONTEXT.md`: Starting city): one grown resident of a new starting city, never
//! the Leader, starts on the looped queue "Farm and feed", which keeps the stable fed while the
//! storage has Food and works the farm in between, with no order of the Player's.

mod goods_support;
mod tasks_support;

use std::sync::Arc;

use csp_shared::balance::{HORSE_FOOD_PER_DAY, STABLE_HAND_FEED_DAYS, START_HORSES};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, ResidentOrder, WorldState};
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::queues::{QueueHost, QueueRunner};
use csp_sim::starting_city::{found_starting_city, FARM_AND_FEED};
use goods_support::open;
use tasks_support::Game;

const PLAYER: u64 = 1;

fn me() -> OrderSender {
    OrderSender::player(PLAYER, "Mara")
}

struct Senders;
impl QueueHost for Senders {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        (user_id == PLAYER).then(me)
    }
}

fn stable_food(world: &WorldState) -> f64 {
    let stable = world.buildings.iter().find(|b| b.kind == BuildingKind::Stable).unwrap();
    stable.stock.as_ref().and_then(|s| s.get(&Good::Food).copied()).unwrap_or(0.0)
}

fn set_stable_food(world: &mut WorldState, food: f64) {
    let stable = world.buildings.iter_mut().find(|b| b.kind == BuildingKind::Stable).unwrap();
    stable.stock.as_mut().unwrap().insert(Good::Food, food);
}

fn storage_food(world: &WorldState) -> f64 {
    let storage = world.buildings.iter().find(|b| b.kind == BuildingKind::Storage).unwrap();
    storage.stock.as_ref().and_then(|s| s.get(&Good::Food).copied()).unwrap_or(0.0)
}

#[test]
fn keeps_the_stable_fed_and_works_the_farm_with_no_orders() {
    csp_npc::install(); // T1719
    let terrain = open(96);
    let mut world = csp_sim::world::create_world(&terrain, 1);
    found_starting_city(&mut world, &terrain, PLAYER, None);
    let hand = world.residents.iter().find(|r| r.queue.is_some()).unwrap().id.clone();
    let farm = world.buildings.iter().find(|b| b.kind == BuildingKind::Farm).unwrap().id.clone();
    // Just above where the stable hand feeds it, so it runs out within the days run without them.
    let feed_below = (STABLE_HAND_FEED_DAYS * START_HORSES * HORSE_FOOD_PER_DAY).ceil();
    set_stable_food(&mut world, feed_below + 1.0);
    let mut g = Game::new(world, terrain.clone(), vec![me()]);
    let mut queues =
        QueueRunner::new(Box::new(Senders), g.tasks.kinds.clone(), Some(Arc::new(terrain)));
    let (mut worked, mut fed) = (0, false);
    let days = 4.0;
    for _ in 0..(days * TICKS_PER_GAME_DAY) as usize {
        let before = stable_food(&g.world);
        g.queue.apply_all(&mut g.world);
        queues.run_all(&mut g.world, &mut g.scratch);
        assert_eq!(g.run_scripts(), []);
        g.step();
        fed |= stable_food(&g.world) > before;
        let r = g.world.residents.iter().find(|r| r.id == hand).unwrap();
        if matches!(&r.order, Some(ResidentOrder::WorkAt(w)) if w.building_id == farm) {
            worked += 1;
        }
        assert_eq!(r.queue.as_ref().and_then(|q| q.name.as_deref()), Some(FARM_AND_FEED));
        if storage_food(&g.world) > 0.0 {
            assert!(stable_food(&g.world) > 0.0, "the stable ran out at tick {}", g.world.tick);
        }
        assert!(g.world.horses.iter().all(|h| h.hunger > 0.0 && h.down_until.is_none()));
    }
    assert!(fed, "the stable hand fed the stable");
    // Most of the days on the farm: the stable takes a round now and then.
    assert!(worked as f64 > days * TICKS_PER_GAME_DAY / 2.0, "worked {worked} ticks");
    assert!(stable_food(&g.world) > feed_below);
    assert_eq!(check_all(&g.world, &g.terrain), []);
}
