# The rules as WebAssembly

The client calls the game's Rust rules, compiled to WebAssembly, instead of a TypeScript copy
(ADR 0045, Epic 122). They live in `crates/csp-lang-wasm` beside the script checker, and the client
reaches them through `@csp/lang-wasm` (`packages/lang-wasm/src/index.ts`).

## How it fits together

- `crates/csp-lang-wasm/src/value_rules.rs` (T122.5): the rules that take only values (costs,
  recipes, prices, fees, loads, names, checks of what a Player sends), all behind one entry,
  `rule(name, args)`: the arguments go in as a JSON array, the answer comes back as JSON. A rule is
  one arm there, calling `csp-sim`'s own function, and one function in
  `packages/lang-wasm/src/rules.ts`, which the client imports. A call that doesn't fit its Rust
  function throws: that is a bug in `rules.ts`.
- `crates/csp-lang-wasm/src/rules.rs`: the world mirror and the rules that read it.
- **The world mirror** (`WorldMirror`) holds what the client sees in the module's memory. The client
  hands it the server's `welcome` message once and each `tick` message after it, as the JSON text
  the socket brought. Rules that read the world are its methods, called with ids and coordinates.
  T122.1's mirror is throwaway and keeps only the buildings in sight; T122.4 brings the real one.
- `pnpm wasm:build` (`scripts/wasm-build.mjs`) builds the module into
  `packages/lang-wasm/generated/`. The client awaits `loadLang()` before its first render
  (`apps/web/src/main.tsx`), since the rules are called as it renders; in Node and Vitest it loads
  as `@csp/lang-wasm` is imported.

## What the browser lacks

On `wasm32-unknown-unknown` the standard library builds `Instant::now()`, `SystemTime::now()`,
threads and files as calls that only fail when they run. `pnpm wasm:build` fails when the module
holds one of their messages ("time not implemented on this platform", "operation not supported on
this platform", "failed to spawn thread"). The linker drops code nothing calls, so a message there
is one the rules can reach. In `csp-sim` the tick timers, the pathfinder's budget, the NPC planner's
timers, world generation and `npc_slow` use them: keep the rules the client calls off those paths,
or pass the clock in.

## Size

What costs bytes in the module:

- **Deserializing a type costs its code.** Deserializing a whole `WorldState` (from JSON, even an
  empty one) adds about 300 KB gzipped; build a world with `WorldState::default()` and deserialize
  only the parts a rule reads. The throwaway mirror reads entities through a small tagged enum
  that keeps buildings and skips everything else (`#[serde(other)]`).
- **The name section** was half the module's bytes. The build removes it
  (`--remove-name-section`, also in the `Dockerfile`).
- `wasm-opt` is not installed here nor in the image; with it, the module would be smaller still.

## Measurements (T122.1)

On a copy of the live world (save format 148, 5760 × 5760 map), with the messages one Player's
socket got over 30 ticks: `bench-broadcast` wrote them (`BENCH_DUMP=<folder> DB_PATH=<copy>
cargo run --release -p csp-server --bin bench-broadcast -- save 1 30`), and
`node scripts/wasm-rules-bench.mjs <folder>` measured them, in Node 22 on the Ryzen 9 7900X. The
`welcome` message is 4.4 MB with 4,949 things in sight (4,450 buildings) and 38,905 remembered;
a `tick` message is about 277 KB, with 416 things changed on average.

| What                                              |  Limit |                                                                                    Measured |
| :------------------------------------------------ | -----: | ------------------------------------------------------------------------------------------: |
| Added to what the browser downloads, compressed   | 500 kB |            388 KB gzipped as served for the whole module (today's checker alone was 464 KB) |
| Start: load the module and mirror the first world | 150 ms |                        47 ms (module 2.4 ms, first mirror 45 ms); 73 ms in the browser pane |
| Mirror update per tick                            |   4 ms |                       2.8 ms mean, 3.4 ms p95; 3.45 ms mean, 3.9 ms p95 in the browser pane |
| One rule call (`buildingAt`)                      |   1 ms | 0.002 ms mean; 0.2 ms the first call after an update, which builds the lookup by tile again |

How each was taken:

- **Download:** the module the browser fetches (`csp_lang_wasm_bg.wasm`), gzipped at level 6 as
  `tower-http` serves it (`app.rs`). It is 1,072 KB raw. Counted whole, since once rules move the
  client loads it at start, where today only the script editor loads it. Removing the TypeScript
  copy will take its share off the client's bundle.
- **Start:** compiling and instantiating the module, then the first mirror of the `welcome`.
  Mirroring Last seen too (43,304 buildings, 7.1 MB) would take about 120 ms.
- **Update:** `WorldMirror::tick` with each message's text. Most of it is reading the JSON: the
  client parses the same text for itself, so there is room in giving the mirror less to read.
- **Rule call:** `buildingAt` on and around every building in sight.

The update is the tightest of the four: T122.4's mirror reads more than buildings, so it should
keep a tick's cost to what the tick changed, as this one does, and measure again.

## Size after T122.5

The value rules add about 15 KB gzipped: the module is 402 KB gzipped (1,139 KB raw), from 388 KB.
