//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod aging;
pub mod building;
pub mod climbing;
pub mod directive;
pub mod driving;
pub mod events;
pub mod explored;
pub mod gates;
pub mod goods_made;
pub mod horse_grant;
pub mod horses;
pub mod movement_pending;
#[cfg(test)]
mod movement_test_world;
pub mod names;
pub mod node_gen;
pub mod order_sender;
pub mod orders;
pub mod passengers;
pub mod pathfinding;
pub mod queries;
pub mod queue;
pub mod queues;
pub mod random;
pub mod residents;
pub mod riding;
pub mod road_line;
pub mod sight;
pub mod spoilage;
mod stand_ins;
pub mod stock_floor;
pub mod survival;
pub mod teaching;
pub mod teardown;
pub mod terrain_gen;
#[cfg(test)]
pub mod test_support;
pub mod tick;
pub mod training;
pub mod walk_time;
pub mod walking;
pub mod walls;
pub mod work;
pub mod world;
pub mod world_index;
