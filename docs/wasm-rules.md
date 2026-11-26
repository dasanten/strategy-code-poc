# The rules as WebAssembly

The client calls the game's Rust rules, compiled to WebAssembly, instead of a TypeScript copy
(ADR 0045, Epic 122). They live in `crates/csp-lang-wasm` beside the script checker, and the client
reaches them through `@csp/lang-wasm` (`packages/lang-wasm/src/index.ts`).

## How it fits together

- `crates/csp-lang-wasm/src/rules.rs`: the functions the client calls, each a thin
  `#[wasm_bindgen]` wrapper around `csp-sim`'s own (`csp_sim::queries::...`).
- **The world mirror** (`WorldMirror`, around `csp_sim::mirror::SightMirror`) holds what the
  client sees in the module's memory, as a `WorldState` the rules read as the server's world. The
  client (`apps/web/src/world-mirror.ts`, fed by `useWorld`) hands it the server's `welcome`
  message once and each `tick` message after it, as the JSON text the socket brought; nothing
  crosses back but answers. Rules that read the world are its methods, called with ids and
  coordinates. Everything in sight is kept in place in its list, found by id, in the server's order,
  so a tick costs what it changed.
- `pnpm wasm:build` (`scripts/wasm-build.mjs`) builds the module into
  `packages/lang-wasm/generated/`. In the browser it loads on `loadLang()`; in Node and Vitest it
  loads as `@csp/lang-wasm` is imported.

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
  only the parts a rule reads.
- **The name section** was half the module's bytes. The build removes it
  (`--remove-name-section`, also in the `Dockerfile`).
- `wasm-opt` is not installed here nor in the image; with it, the module would be smaller still.

## What the mirror doesn't know

The server sends a Player what is in their sight (`sight.rs`), and less of some of it. The mirror
fills the rest with defaults (`csp_sim::mirror`):

| Not sent                                                                                              | The mirror holds                                            |
| :---------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| A stranger's health and hunger, and until when they are Down                                          | full health, fed; Down without an end (`DOWN_UNTIL_UNSEEN`) |
| A horse's health and hunger, unless the Player's                                                      | the same                                                    |
| What is in a building, carriage or vessel not seen inside                                             | empty                                                       |
| A script's memory and log, since when it waits, an army's script but its id                           | empty, waiting since 0                                      |
| A caravan's or trader's stop, plan, load and job                                                      | at its storage, with nothing to do                          |
| Whether an order holds against blows, the Alarm a defence script interrupted                          | none                                                        |
| Realms, events, crimes, contracts, standings, offers, demands, Last seen and the rest of `WorldState` | none at all                                                 |

So a rule that reads one of them answers on the mirror as if it were so. The parity test
(`crates/csp-sim/tests/mirror_parity.rs`) asks each rule it covers on the fixture worlds, for each
realm, of the full world and of a mirror of what that realm is sent with every tile in sight, and
fails on a rule that answers otherwise unless it is named there. Named so far, with what the client
shows in that case today (its TypeScript copy reads the same Seen data, so the same):

| Rule           | On the mirror                                              | The client today        |
| :------------- | :--------------------------------------------------------- | :---------------------- |
| `inputAt`      | a workplace not seen inside has none of its input in stock | the same: no stock sent |
| `npcCityStock` | an NPC city's storage not seen inside holds nothing        | the same                |
| `storedFood`   | a city's storage not seen inside holds no Food             | the same                |

Any rule that reads realms, standings, contracts, alliances, offers or demands reads none on the
mirror; those come in their own messages (`diplomacy` and the rest) and are not mirrored yet.

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

## Measurements (T122.4: the whole mirror)

The same messages and machine as above, with the mirror now holding everything in sight:

| What                         |  Limit |                                             Measured |
| :--------------------------- | -----: | ---------------------------------------------------: |
| Added download, compressed   | 500 kB |                             493 KB gzipped as served |
| Start                        | 150 ms |            47 ms (module 2.9 ms, first mirror 44 ms) |
| Mirror update per tick       |   4 ms |      3.9–4.1 ms mean, 4.2–4.7 ms p95 over three runs |
| One rule call (`buildingAt`) |   1 ms | 0.002 ms mean; 0.2 ms the first call after an update |

What it took to get there:

- **Each thing in sight is read straight into its type.** `SeenEntity` is an internally tagged
  enum: serde buffers each entity before reading it, which costs twice the time, and from that
  buffer a map with number keys (a script's params by script id) doesn't read at all. The mirror
  reads the `is` the server writes first and the rest straight into that kind's type
  (`seen_entity_raw` in `rules.rs`).
- **`ResidentOrder` reads tag first** (`tag_first!` in `orders.rs`), the same for saves on the
  server; the derive's buffering of every resident's order and path was most of what was left.
- Tried and dropped: `opt-level = 3` for `serde_json` and `csp-shared` in the wasm profile (no
  faster, 14 KB bigger), `float_roundtrip` off (0.3 ms faster, but it changes how every number
  the server reads is rounded).

Both the download and the update are at their limits. A tick of this world changes about 400
residents, who move: reading their JSON is most of the update. What would give room is in a
follow-up issue: fewer fields per moving resident in a tick, `wasm-opt` in the image, or a binary
tick message.
