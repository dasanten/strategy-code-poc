//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod directive;
pub mod explored;
pub mod goods_made;
pub mod node_gen;
pub mod order_sender;
pub mod orders;
pub mod pathfinding;
pub mod queries;
pub mod queue;
pub mod queues;
pub mod random;
pub mod sight;
pub mod terrain_gen;
pub mod tick;
pub mod walls;
pub mod world;
pub mod world_index;
