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
mod pending;
pub mod persuasion;
pub mod queries;
pub mod random;
pub mod sight;
pub mod standing;
pub mod world_index;

pub use pending::Sender;
