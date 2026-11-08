//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod armies;
pub mod capture;
pub mod cities;
pub mod combat;
pub mod crimes;
pub mod defence;
pub mod explored;
pub mod goods_made;
pub mod node_gen;
pub mod pathfinding;
mod pending;
pub mod persuasion;
pub mod queries;
pub mod random;
pub mod sight;
pub mod standing;
pub mod terrain_gen;
#[cfg(test)]
mod test_world;
pub mod tick;
pub mod walls;
pub mod world;
pub mod world_index;

pub use pending::Sender;
