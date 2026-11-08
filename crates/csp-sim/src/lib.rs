//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod admin_map;
pub mod aging;
pub mod alliances;
pub mod contracts;
pub mod directive;
pub mod directives;
pub mod events;
pub mod explored;
pub mod goods_made;
pub mod names;
pub mod node_gen;
pub mod order_sender;
pub mod orders;
pub mod pathfinding;
pub mod queries;
pub mod queue;
pub mod queues;
pub mod random;
pub mod realm_pending;
#[cfg(test)]
mod realm_test_world;
pub mod region_map;
pub mod residents;
pub mod sight;
pub mod spoilage;
pub mod stock_floor;
pub mod survival;
pub mod terrain_gen;
pub mod territory;
#[cfg(test)]
pub mod test_support;
pub mod tick;
pub mod walls;
pub mod world;
pub mod world_index;
