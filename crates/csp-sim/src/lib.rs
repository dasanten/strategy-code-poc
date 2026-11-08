//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod aging;
pub mod buying;
pub mod carrying;
pub mod deliveries;
pub mod directive;
pub mod events;
pub mod explored;
pub mod goods_deps;
pub mod goods_made;
pub mod hauling;
pub mod holders;
pub mod names;
pub mod node_gen;
pub mod order_sender;
pub mod orders;
pub mod pathfinding;
pub mod placing;
pub mod queries;
pub mod queue;
pub mod queues;
pub mod random;
pub mod residents;
pub mod sight;
pub mod spoilage;
pub mod stock_floor;
pub mod storing;
pub mod survival;
pub mod terrain_gen;
#[cfg(test)]
pub mod test_support;
pub mod tick;
pub mod trade_org;
pub mod trading;
pub mod transfers;
pub mod walls;
pub mod world;
pub mod world_index;
