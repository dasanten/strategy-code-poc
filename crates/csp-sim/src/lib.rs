//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod building;
pub mod explored;
pub mod goods_made;
pub mod node_gen;
pub mod pathfinding;
pub mod queries;
pub mod random;
pub mod road_line;
pub mod sight;
pub mod stand_ins;
pub mod teaching;
pub mod teardown;
pub mod terrain_gen;
pub mod tick;
pub mod training;
pub mod walls;
pub mod work;
pub mod world;
pub mod world_index;
