//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod buying;
pub mod carrying;
pub mod explored;
pub mod goods_deps;
pub mod goods_made;
pub mod hauling;
pub mod holders;
pub mod node_gen;
pub mod pathfinding;
pub mod placing;
pub mod queries;
pub mod random;
pub mod sight;
pub mod storing;
pub mod terrain_gen;
pub mod tick;
pub mod trading;
pub mod walls;
pub mod world;
pub mod world_index;
