//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod climbing;
pub mod driving;
pub mod explored;
pub mod gates;
pub mod goods_made;
pub mod horse_grant;
pub mod horses;
pub mod movement_pending;
#[cfg(test)]
mod movement_test_world;
pub mod node_gen;
pub mod passengers;
pub mod pathfinding;
pub mod queries;
pub mod random;
pub mod riding;
pub mod sight;
pub mod terrain_gen;
pub mod tick;
pub mod walk_time;
pub mod walking;
pub mod walls;
pub mod world;
pub mod world_index;
