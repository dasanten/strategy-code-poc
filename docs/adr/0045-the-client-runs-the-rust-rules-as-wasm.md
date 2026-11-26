# The client runs the Rust rules as WebAssembly

Status: decided (2026-11-25, Daniel: Epic 122). Built from T122.1; measurements in
`docs/wasm-rules.md`.

## Context

The client carries a hand-written TypeScript copy of the game rules in `apps/web/src/shared/`
(49 files, about 11,000 lines): what a building needs, why an order would be refused, where a city's
area ends. The server's rules are Rust (ADR 0030). Every rule change is written twice and the two
copies drift; the parity tests catch some of it, not all.

`csp-sim` already compiles to wasm32: the script editor's checker (`csp-lang-wasm`, ADR 0030,
T88.3) links it for the game's script tables, and loads lazily in the browser and at once in Node.

## Decision

- **The client calls the Rust rules, compiled to WebAssembly,** instead of a TypeScript copy of
  them. The copy is deleted rule by rule through Epic 122.
- **One module: `csp-lang-wasm` grows** to hold the rules beside the checker, rather than a new
  `csp-rules-wasm` crate. Both need `csp-sim`; two modules would ship it twice. Measured: the
  rules' first slice adds 39 KB gzipped to the checker's module.
- **The module keeps a mirror of what the client sees in its own memory,** fed once from the
  server's `welcome` message and then once a tick from each `tick` message, as the JSON text the
  socket brought. Rules are called with ids and coordinates, never with the world. The mirror
  deserializes only the types its rules read: deserializing a whole `WorldState` costs about
  300 KB gzipped of code.
- **The module ships without its name section** (`wasm-bindgen --remove-name-section`): the names
  were half its bytes (1.2 MB of 2.3 MB) and only name the frames of a stack trace.
- **What the browser lacks fails the build.** On `wasm32-unknown-unknown` the standard library
  builds `Instant::now()`, `SystemTime::now()` and threads as calls that fail only when they run.
  `scripts/wasm-build.mjs` fails when the module holds one of their messages, which only code the
  rules can reach puts there.
- **Limits** for a world of the live game's size, checked in T122.1 and again in the epic's last
  ticket: 550 kB added to what the browser downloads, compressed (500 kB at first; raised on
  2026-11-26 once `wasm-opt` had taken the module to 537 kB, #1637); 150 ms to load the module and
  mirror the first world; 4 ms to update the mirror a tick; 1 ms for one rule call.
  `scripts/wasm-rules-bench.mjs` measures them on messages `bench-broadcast` dumps from a save.

## Alternatives

- **Generate data only, keep the TypeScript rules.** Constants, specs and types are already
  generated (Epic 121); the rules themselves would still be written twice and drift.
- **Keep the TypeScript copy with more parity tests.** Every rule still written twice; a test only
  covers the cases someone thought of.
- **A separate rules module.** Ships `csp-sim` twice: the checker's module is about 390 KB gzipped,
  most of it `csp-sim`.

## Consequences

- The module loads before the first rule call, so the client loads it at start once rules move,
  not only when the script editor opens. With the name section gone it is smaller than the
  checker alone was before (388 KB gzipped as served, from 464 KB).
- A rule that runs per frame or per tile (`wrap`, `isDown`, `patchLeft`) does not cross into wasm
  once per call: those are generated or stay a few lines of TypeScript with a parity test.
- Code the rules reach must not time itself or start threads; the build says so.
- A stack trace from a panic in the module names no Rust functions.
