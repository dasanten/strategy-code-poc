//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod aging;
pub mod armies;
pub mod capture;
pub mod cities;
pub mod combat;
pub mod crimes;
pub mod defence;
pub mod directive;
pub mod events;
pub mod explored;
pub mod goods_made;
pub mod names;
pub mod node_gen;
pub mod order_sender;
pub mod orders;
pub mod pathfinding;
mod pending;
pub mod persuasion;
pub mod queries;
pub mod queue;
pub mod queues;
pub mod random;
pub mod residents;
pub mod sight;
pub mod spoilage;
pub mod standing;
pub mod stock_floor;
pub mod survival;
pub mod terrain_gen;
#[cfg(test)]
pub mod test_support;
#[cfg(test)]
mod test_world;
pub mod tick;
pub mod walls;
pub mod world;
pub mod world_index;
