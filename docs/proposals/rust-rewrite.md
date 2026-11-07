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
