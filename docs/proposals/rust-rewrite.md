# Proposal: rewriting the backend in Rust

> **Decided (2026-11-07):** Daniel chose the rewrite, against the recommendation below, with a
> feature freeze on the TypeScript game meanwhile. The decisions are in ADR 0030; the work is
> Epics 84 to 88 (the "Epics" section at the end). The analysis stays as written.

Written on 2026-11-07 at Daniel's request, from a reading of the code and the ADRs. It answers two questions: should the backend (server, shared, lang) be rewritten in
Rust, and if so, how. The focus is server usage, development time, and test and simulation time.

**Recommendation:** not now. Measure the live ticks first, fix world generation in TypeScript, and
move at most three hot kernels to Rust as native modules. A full rewrite only pays off once the
rules stop changing weekly and real players push ticks past about half the budget. The plan for
the full rewrite is below anyway, so the decision can be made with the costs visible.

## Where the backend stands

| Fact                                           | Value                                   |
| ---------------------------------------------- | --------------------------------------- |
| Backend code to port (server, shared, lang)    | ~44,000 lines TypeScript                |
| Backend tests to port (they are the rule spec) | 138 files, ~41,000 lines                |
| Client files importing `@csp/shared`           | 136                                     |
| Age of the codebase                            | 16 days, 933 commits                    |
| World format migrations so far                 | 69                                      |
| Tick budget / alert (ADR 0004)                 | 1,000 ms / 800 ms                       |
| Production tick profile in the repo            | none (Epic 49 said "no profile yet")    |
| Full test suite (ADR 0013)                     | ~4 min idle, ~10 min under session load |
| Slow simulation tests                          | 1 to 3 min each, CI only                |
| Fresh world generation in dev                  | over 30 min                             |
| Target scale (ADR 0001)                        | 50 players, one process, one box        |
| CI budget (ADR 0009)                           | ~65 min/day                             |

Two things in that table matter more than everything else. The rules still change daily, with 69
world-format bumps in three weeks and Epics 79 and 80 open. And nobody has measured a production
tick yet, so the main argument for Rust rests on a guess.

## Pro and contra

### Server usage

| Pro                                                                                                                                                                                                                                       | Contra                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU per tick drops roughly 3 to 10× on object-heavy rule code, more on the script interpreter (tree walking in Rust is 10 to 30× faster than in V8). That headroom could raise the script step budget or the player cap without sharding. | The box is Daniel's own server and already paid for (ADR 0007). Headroom is only worth money if you want a smaller VPS or more worlds. At 50 players on one process Node is nowhere near the limit, as far as anyone knows. |
| RAM drops 2 to 4×: structs instead of JS objects, no JIT or heap overhead. The 33 MB terrain blob is already a typed array and gains nothing.                                                                                             | Epic 49 just removed the quadratic scans, repeated sight builds and sync-per-socket. Those algorithmic fixes gave far more than a language change would, and the same fix list is not exhausted.                            |
| A static binary in a 20 MB image, faster cold start, no npm advisory churn (the lockfile already carries three overrides for advisories).                                                                                                 | Cargo has its own advisories and build times. Debug-build Rust is often slower than V8 for numeric code, so tests and dev need an optimised profile, which lengthens every compile.                                         |

### Development time

| Pro                                                                                                                                                                             | Contra                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The world is plain serialisable data with ids, not object graphs (ADR 0002, ADR 0006). That maps onto serde structs and `Vec` plus index lookups better than most TS codebases. | This is a redesign, not a transliteration. Rules mutate `world` while iterating it; Rust forces split borrows, index-based access and a world-index type at the centre. Every one of the 85 modules touching `WorldState` gets restructured, and sessions fighting the borrow checker burn time and tokens.                                                                 |
| Types catch more at compile time; exhaustive matches on order kinds and terrain replace a class of invariant violations.                                                        | Feature freeze. Porting 44k lines plus 41k lines of tests with the current session workflow is 4 to 8 weeks of calendar time with no new rules, plus 1 to 2 weeks of shadow running. The estimate is wide because the TS code is the only spec and it changes under the port.                                                                                               |
|                                                                                                                                                                                 | The client shares `@csp/shared` (136 files) and `@csp/lang` (editor checks). Either keep a TS copy (two sources of truth, breaks the "numbers come from shared" wiki rule) or add WASM and generated types to the build. Both cost ongoing work.                                                                                                                            |
|                                                                                                                                                                                 | Iteration speed is the project's engine: tsx with no build step, Vitest picking affected tests from the module graph, ten parallel ticket sessions. Cargo compiles the whole crate per change, affected-test selection needs a multi-crate split, and ten sessions compiling Rust on 24 threads is heavier than the 52 node processes that already push the machine to 96%. |

### Test and simulation time

| Pro                                                                                                                                                                                                                              | Contra                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Long simulations (an NPC village left alone for game weeks) would drop from minutes to seconds. That could end the slow/CI split of ADR 0013 and relieve the CI-minute scarcity of ADR 0009 directly. This is the strongest pro. | The suite's time is mostly simulation ticks, and a tick's cost is mostly algorithmic. A 10× faster interpreter of the same algorithm still leaves the slowest tests at 10 to 20 s, so the split survives in weaker form. |
| World generation would likely fall under a minute.                                                                                                                                                                               | World generation at 30 minutes is almost certainly an unoptimised TS loop running under `tsx watch` in 1 GB. A day of profiling fixes that in TypeScript.                                                                |
| Differential testing (same snapshot, same seed, same orders, diff the states) gives a very strong port check.                                                                                                                    | The 41k lines of tests are the real cost. They encode rules nobody wrote down elsewhere, and a persistent world (never reset, ADR 0006) means every behaviour drift reaches players.                                     |

### Other

| Pro                                                                                                                       | Contra                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust's `sentry`, `axum`, `tokio-tungstenite`, `rusqlite` and `serde` cover every runtime dependency the server has today. | A panic in one rule takes the whole world down unless every tick is wrapped in `catch_unwind`. The TS loop isolates a throwing phase today. |
| Deterministic, bounded script execution is natural in Rust.                                                               | The 68 historical migrations do not need porting, but every future rule change pays the Rust cost forever.                                  |

## The plan, if we do it

One cargo workspace mirroring the pnpm one: `csp-shared` (types, balance, protocol, with `ts-rs`
emitting TypeScript types for the client), `csp-lang` (lexer, parser, interpreter, also built to
WASM for the editor) and `csp-server` (axum, tokio-tungstenite, rusqlite, sentry).

1. **Measure first, in TypeScript, about one week.** Record `tick.phase.*` from Sentry on the
   live world for a week and profile world generation. Exit rule: a full rewrite only goes ahead
   if a quiet tick with real players is above about 400 ms after the cheap TS fixes, or we want
   more than one world or more than 50 players.
2. **Foundations, one to two weeks.** The Rust world type round-trips the real production
   snapshot at the frozen `WORLD_FORMAT_VERSION` byte for byte, with a test. Port the seeded RNG
   exactly, because differential testing needs identical random draws. Set up `cargo nextest`, a
   `cargo-chef` Dockerfile, a CI job with a cargo cache, and a `pnpm check` equivalent that runs
   the crates a change touches.
3. **Port the simulation phase by phase, three to five weeks.** Follow the tick order in
   `apps/server/src/tick.ts`: orders, queues, scripts, world (NPC planning, walking), invariants,
   territory, sight. Each module brings its tests across. After each phase, run both servers from
   the same snapshot for a game day with the same orders and diff the states. Freeze TS rule
   changes during this phase, or every merged ticket reopens a diff.
4. **HTTP, WebSocket, auth, admin CLI, backups, table migrations, one to two weeks.** Keep the
   same SQLite tables so accounts, sessions, invites and scripts carry over without a data move.
5. **Client, about one week.** Types from `ts-rs`, the script checker via WASM, balance numbers
   exported as generated JSON so the wiki rule holds. The 136 importing files mostly keep their
   imports if the generated package keeps the `@csp/shared` name.
6. **Cutover, one to two weeks.** Shadow-run on a copy of the live world, compare for a few game
   days, then swap the image. Rollback is the previous image plus the pre-deploy backup, which
   ADR 0007 already provides. Write the ADR superseding ADR 0001's TypeScript-everywhere decision
   and update `CLAUDE.md` and the skills that run checks.

Total: roughly 8 to 13 weeks with no new game rules, against a codebase that grew its whole 44k
lines in 3 weeks.

## The cheaper alternative (recommended)

Keep the TypeScript backend and move leaf computations to Rust through `napi-rs`, as prebuilt
native modules the way `better-sqlite3` ships today. Candidates in order of likely payoff:

1. terrain and node generation,
2. pathfinding over the 5,760-tile torus,
3. the sight grid,
4. later, the script interpreter.

Each is a pure function over plain data, which is exactly what ADR 0002 already demands, so
nothing about `WorldState` or the rules changes. Each kernel is one to two weeks and ships as its
own epic through the normal branch flow (ADR 0009). If the measurements from step 1 of the plan
show the tick dominated by rule code rather than these kernels, that is the moment to revisit the
full rewrite with numbers in hand.

## Epics (2026-11-07)

Ticketed the same day; the order was agreed with Daniel the same day (`docs/tasks.md`):

- [Epic 81: Tick numbers](https://github.com/dasanten/strategy-code-poc/issues/974), tickets
  #977–#981: a tick-health summary in the log, over HTTP and on the admin panel; world generation
  timed by stage with `bench:world`; a simulation benchmark `bench:sim` with a CPU profile; and
  T81.5 (`needs Daniel`), the decision on Epics 82 and 83 from a week of live numbers. Their
  results go into a `## Measurements` section of this file.
- [Epic 82: Fast worlds](https://github.com/dasanten/strategy-code-poc/issues/975), tickets
  #982–#985: resource nodes in one flat pass; a fresh world in under two minutes; the full-size
  map generated once per test run; cheaper ticks on a small world (slow tests halved).
- [Epic 83: Native kernels](https://github.com/dasanten/strategy-code-poc/issues/976), scope
  only: the open questions above (go or no go, napi-rs or WASM, first kernel, parity, ADR), to be
  ticketed only if T81.5 says so.

## Measurements

Written by T84.7 (`scripts/bench-ts.mts`, run as `corepack pnpm exec tsx --conditions=source scripts/bench-ts.mts <what>`):
the TypeScript game's speed before the port. The Rust `bench-world` and `bench-sim` print the same
tables. Machine: AMD Ryzen 9 7900X (12 cores, 24 threads), 31 GiB, Windows 11, node 22.23.3, 2026-11-07.
The machine was **not idle**: other sessions were building and testing, so read these as upper bounds
(single-threaded runs lose less than the suite does).

### TypeScript baseline (T84.7)

**World generation, full size (5760x5760, seed 1)**, `world`. Load during the run: 8–17 node
processes, CPU 45–80% (the run itself is single-threaded). About 21 s in all, far from the half hour
the old numbers suggested; trading posts and seas are where it goes.

| generateTerrain stage |   ms |  share |
| :-------------------- | ---: | -----: |
| seas                  | 5313 |  56.3% |
| lakes                 | 1166 |  12.4% |
| relief                |  967 |  10.2% |
| forest                |  700 |   7.4% |
| joining               | 1287 |  13.6% |
| total                 | 9434 | 100.0% |

| generateWorld stage |    ms |  share |
| :------------------ | ----: | -----: |
| nodes               |  2348 |  20.1% |
| HQ                  | 79.68 |   0.7% |
| NPC cities          |   432 |   3.7% |
| trading posts       |  8820 |  75.5% |
| caravans            |  7.76 |   0.1% |
| total               | 11687 | 100.0% |

made: 3310 nodes, 33 cities, 330 residents, 16 caravans, 6 traders

**Ticks.** `sim <scene> [ticks]` steps the world through `runTick` with a `TickTimer`, invariants off,
no Players' orders, queues or scripts (the NPC cities' scripts do run), walking on. Ticks include the
JIT warm-up. The phases the server loop owns (`territory`, `sight`, `broadcast`, `save`) are not run
here and print 0. Load: 8–30 node processes, CPU 45–100%.

`village` (one village, `village()` of `npc-growth.fixture.ts`):

| phase        | mean ms | p95 ms |
| :----------- | ------: | -----: |
| orders       |   0.000 |  0.000 |
| queues       |   0.000 |  0.001 |
| scripts      |   0.000 |  0.001 |
| world        |    3.14 |  12.59 |
| npc          |    2.48 |  10.49 |
| walking      |   0.255 |  0.240 |
| rest         |   0.385 |  0.600 |
| lastSeen     |   0.005 |  0.008 |
| invariants   |   0.000 |  0.000 |
| territory    |   0.000 |  0.000 |
| sight        |   0.000 |  0.000 |
| broadcast    |   0.000 |  0.000 |
| save         |   0.000 |  0.000 |
| tick (total) |    3.14 |  12.60 |

residents: 6 on average (6 to 6); ms per tick per resident: 0.524 mean, 2.10 p95

`villages` (60 villages, `villages(60)` of `npc-plan.test.ts`):

| phase        | mean ms | p95 ms |
| :----------- | ------: | -----: |
| orders       |   0.000 |  0.001 |
| queues       |   0.003 |  0.001 |
| scripts      |   0.001 |  0.001 |
| world        |     218 |    393 |
| npc          |     164 |    282 |
| walking      |   31.62 |    116 |
| rest         |   22.10 |  50.47 |
| lastSeen     |   0.018 |  0.022 |
| invariants   |   0.003 |  0.001 |
| territory    |   0.000 |  0.000 |
| sight        |   0.000 |  0.000 |
| broadcast    |   0.000 |  0.000 |
| save         |   0.000 |  0.000 |
| tick (total) |     218 |    393 |

residents: 360 on average (360 to 360); ms per tick per resident: 0.605 mean, 1.09 p95

`hq` (the Trade Org HQ, `hq()` of `trade-org.test.ts`):

| phase        | mean ms | p95 ms |
| :----------- | ------: | -----: |
| orders       |   0.000 |  0.001 |
| queues       |   0.000 |  0.001 |
| scripts      |   0.000 |  0.001 |
| world        |   16.12 |  59.47 |
| npc          |   14.48 |  56.49 |
| walking      |   0.711 |  0.788 |
| rest         |   0.886 |   1.16 |
| lastSeen     |   0.031 |  0.010 |
| invariants   |   0.000 |  0.000 |
| territory    |   0.000 |  0.000 |
| sight        |   0.000 |  0.000 |
| broadcast    |   0.000 |  0.000 |
| save         |   0.000 |  0.000 |
| tick (total) |   16.14 |  59.48 |

residents: 32 on average (32 to 32); ms per tick per resident: 0.504 mean, 1.86 p95

`save` (newest save of a copy of a live-format world from 2026-11-01, full-size map; `DB_PATH` names
the database):

| phase        | mean ms | p95 ms |
| :----------- | ------: | -----: |
| orders       |   0.001 |  0.001 |
| queues       |   0.000 |  0.001 |
| scripts      |   0.001 |  0.001 |
| world        |     214 |    219 |
| npc          |     135 |    187 |
| walking      |   52.25 |   7.11 |
| rest         |   25.83 |  32.62 |
| lastSeen     |   0.224 |  0.950 |
| invariants   |   0.000 |  0.000 |
| territory    |   0.000 |  0.000 |
| sight        |   0.000 |  0.000 |
| broadcast    |   0.000 |  0.000 |
| save         |   0.000 |  0.000 |
| tick (total) |     214 |    219 |

residents: 338 on average (338 to 338); ms per tick per resident: 0.632 mean, 0.649 p95

**Suite**, `suite` (`pnpm test` once with Vitest's JSON reporter, slow tests included, `maxWorkers` 50%).
Load before the run: 1 node process, CPU 48%. A first run on a heavily loaded machine (15 node
processes, CPU 100%) took 2774 s and failed 9 tests on timeouts, so it is not recorded. File times are
wall times with several files running side by side.

wall time 1716 s; 277 files, 4511 tests, 0 failed (exit 0)

| ten slowest files                             | seconds |
| :-------------------------------------------- | ------: |
| apps/server/src/npc-big-city.test.ts          |  1714.0 |
| apps/server/src/npc-roads.test.ts             |   780.5 |
| apps/server/src/npc-training.test.ts          |   682.7 |
| apps/server/src/posts-supplied.test.ts        |   384.4 |
| apps/server/src/waiting-for-food.test.ts      |   316.8 |
| apps/server/src/npc-far-nodes.test.ts         |   315.9 |
| apps/server/src/trade-org-debt-demand.test.ts |   231.1 |
| apps/server/src/npc-growth-village.test.ts    |   211.6 |
| apps/server/src/trade-org.test.ts             |   194.6 |
| apps/server/src/transfers-caravans.test.ts    |   192.1 |
### Explored map loading (T84.6, 2026-11-07)

A copy of a worked world (5,760 tiles across, 180 × 180 chunks) with its Player's explored
terrain grown to a disc of 2,997 whole chunks, loaded in the browser through the Vite dev proxy
on one machine (no compression, no network latency), minimap open so every explored chunk loads.

|                                                   | Before (one chunk per request) | After (batches of 64) |
| ------------------------------------------------- | ------------------------------ | --------------------- |
| Requests for the start view (12 chunks)           | 12                             | 1                     |
| Start view complete after the first chunk request | 0.95 s                         | 0.94 s                |
| Requests for every explored chunk                 | 2,997                          | 47                    |
| Every explored chunk loaded                       | 25.1 s                         | 4.3 s                 |
| Bytes on the wire                                 | 3.97 MB                        | 3.11 MB               |

The server answers a chunk in ~4 ms and a batch of 64 in ~5 ms, so per call the time is not in
the server. What remains: the TypeScript server's tick holds every request in flight for
~0.5 s once a second, and the client spends ~1.4 ms per chunk making its texture. Over a real
network each request also pays a round trip, which batches pay 64 times less often.
