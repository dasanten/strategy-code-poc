//! The simulation (ADR 0030): everything that happens in a tick, from terrain generation to the
//! invariants. Pure over `csp_shared` data; the I/O shell is `csp-server`. Parity with the frozen
//! TypeScript game is checked against the fixtures in `fixtures/`.

pub mod explored;
pub mod node_gen;
pub mod random;
pub mod terrain_gen;
