# The backend is rewritten in Rust

Status: decided (2026-11-07, with Daniel). Supersedes decision 3 of ADR 0001 ("TypeScript on
both server and client") for the server; the client stays TypeScript. Builds on ADR 0002 (the
game API is the single source of truth), ADR 0006 (the world is never reset) and ADR 0013 (fast
local checks).

Daniel read `docs/proposals/rust-rewrite.md`, which recommended against a rewrite for now, and
decided for it: the server (`apps/server`), the shared game code (`packages/shared`) and the
script language (`packages/lang`) are rewritten in Rust. While that happens the TypeScript game is
under a **feature freeze**: bugs only, no new rules, so the TypeScript code is a fixed
specification for the port. The goals, in Daniel's order: a fast development loop, tests and
simulations that take seconds instead of minutes, and a server with headroom; the proposal's
optimisations (world generation in seconds, cheap ticks on small worlds, the explored map loading
fast) are part of the rewrite, not separate work.

## Decisions

### Where the code lives

- **One repository, one cargo workspace** at the root: `Cargo.toml` with `crates/*`.
  - `csp-shared`: world state types (serde), balance numbers, terrain and footprint helpers,
    goods, time, the wire protocol types. The Rust twin of `packages/shared`.
  - `csp-lang`: lexer, parser, checker and interpreter of the script language, with the step
    budget. The twin of `packages/lang`. Also built to WebAssembly for the editor (Epic 88).
  - `csp-sim`: everything that happens in a tick: terrain and node generation, pathfinding,
    sight, orders and queues, scripts' game API bindings and views, the world step with every
    rule, NPC cities, invariants, territory. The twin of the simulation half of `apps/server`.
  - `csp-server`: the I/O shell: HTTP (axum), WebSocket sync, accounts and sessions, SQLite
    (rusqlite, bundled), saves and migrations, explored terrain, monitoring (Sentry, tick health),
    the admin CLI and the benchmarks. The twin of the rest of `apps/server`.
- **The client stays TypeScript** (`apps/web`). During the rewrite it keeps importing
  `packages/shared` and `packages/lang`. At cutover its types come from the Rust crates
  (`ts-rs`), the editor's checker from `csp-lang` compiled to WebAssembly, and the wiki's numbers
  from a balance JSON the Rust build writes. `packages/shared` and `packages/lang` are deleted
  then, `apps/server` with them.
- **Branches:** the rewrite lives on the long-lived branch `rust-backend`, cut from `dev` on
  2026-11-07. Its epics' branches (`epic/<n>-<slug>`) are cut from and merged into
  `rust-backend` instead of `dev`; the ticket flow of ADR 0009 is otherwise unchanged. `dev` and
  `main` keep running the TypeScript game (bugs only) until the cutover, when `rust-backend` is
  merged into `dev` as one release. Bug fixes on `dev` are merged into `rust-backend` as they
  land and ported in the ticket they touch.

### How the port keeps the game the same

- **The TypeScript code and its tests are the spec.** `CONTEXT.md` names the rules; the
  TypeScript module says exactly what happens; its test file says what to assert. Every ticket
  ports a module with its tests. A test that reads oddly is ported as it is and the oddity noted
  in the PR; a rule is never changed in the port (that is Daniel's call, after the cutover).
- **Fixtures from the frozen TypeScript decide parity.** `scripts/dump-fixtures.mts` writes golden
  files from the TypeScript game into `crates/csp-sim/fixtures/`: terrain and nodes for several
  seeds and sizes, random streams, hashes, worlds after a given number of ticks, path requests
  with their results, a live-format save. Rust tests compare against them: bit-identical for
  terrain, nodes, random numbers, hashes and paths; semantically identical (parsed JSON, not
  text) for world state. A fixture is regenerated only by the script, never edited.
- **Numbers are the same numbers.** `balance.rs` carries every constant of `balance.ts` with the
  same name in Rust spelling; a test compares the whole table with a JSON export of the
  TypeScript values, so no number drifts during the port.
- **The world keeps its format.** `WORLD_FORMAT_VERSION` at the freeze is the version the Rust
  server reads first; the gzipped-JSON snapshot stays the save format (ADR 0006), read and written
  with `serde_json` so an old save loads and a Rust save loads back into the TypeScript server
  during the shadow run. Earlier migrations are not ported: a save older than the freeze version
  is migrated once by the TypeScript server before the cutover. From the cutover on, migrations
  are written in Rust as before.
- **Same randomness.** `mulberry32`, `hash` and every seeded choice are ported bit for bit
  (`Math.imul`, `>>>`, `| 0` semantics on `u32`/`i32`), so a world generated or stepped from the
  same seed is the same world. `f64` everywhere a JavaScript number was; integer-valued fields
  stay `f64` where the TypeScript could hold a fraction, and become integer types only where the
  TypeScript provably never did.
- **Same shape of state.** World state stays plain serialisable data: `Vec`s of entities with
  string ids, an index (`WorldIndex`) built once per tick as scratch, request/resolve pairs that
  return plain action lists. Functions take `&WorldState` or `&mut WorldState` plus the index;
  no entity holds a reference to another. That is the TypeScript design (ADR 0002, ADR 0006), and
  it is what makes the port a translation rather than a redesign. Where the TypeScript mutated
  the world while iterating it, the Rust collects first and applies after.

### The development loop

- **Fast tests are a requirement, not a hope.** The suite runs under `cargo nextest`, in a
  profile with optimised dependencies (`[profile.dev.package."*"] opt-level = 3`) and
  `opt-level = 1` for our crates, so a village left alone for ten game weeks (today four minutes)
  takes seconds. A test over 5 s is a regression to fix, not to tag: the slow/CI split of
  ADR 0013 ends with the TypeScript suite.
- **Local checks:** `pnpm check:rust` runs `cargo fmt --check`, `cargo clippy` with warnings as
  errors, and `cargo nextest run` for the workspace. Cargo only rebuilds the crates a change
  touches; the crate split above is also the compile-time split. A ticket PR says what it ran.
- **Benchmarks ship with the port:** `bench-world` (world generation by stage) and `bench-sim`
  (ms per tick per phase on a village, sixty villages, the HQ and a save) are binaries in
  `csp-server`, and tick health keeps its per-phase numbers plus a rolling summary readable
  without Sentry. Every performance claim in a PR comes from them.
- **Parallel work:** one session per ticket, in its own worktree, on Opus (as today). Tickets
  are cut so that two sessions never write the same module; the foundations (types, balance,
  RNG, fixtures) land first, kernels (terrain, pathfinding, language) in parallel with them,
  then the rules phase by phase, then the shell, then the client and cutover.

### The cutover

- The Rust server runs beside the TypeScript one on a copy of the live save for several game
  days (shadow run); their tick health and world states are compared. Then the image switches
  (ADR 0007); rollback is the previous image plus the pre-deploy backup.
- The explored map must load fast on the Rust server for a Player who has seen a lot: chunks are
  served in batches, not one HTTP request per 32×32 chunk (Epic 84, T84.6), and the client's
  `ChunkStore` asks in batches.
- **Done (T88.6, 2026-11-10):** at feature parity `rust-backend` went into `dev`; `apps/server`,
  `packages/shared` and `packages/lang` were deleted (the last commit with them is `21f7a29e`) and
  the feature freeze ended. The fixtures stay as frozen goldens. The rollback path was tested
  locally with Docker and is written down in `README.md` (Deploy, Rolling back).

## Alternatives considered

- **No rewrite; measure, fix the TypeScript, move kernels to Rust** (the proposal's
  recommendation). Daniel chose the rewrite for the development loop and the headroom, accepting
  the freeze.
- **Rust kernels inside the Node server** (napi-rs). Rejected with the rewrite: two runtimes and
  two build toolchains forever.
- **A new repository.** Rejected: the client, the docs, the tickets and the deploy stay; one
  workspace keeps the TypeScript spec next to its port.

## Consequences

- No new rules until the cutover. Daniel's feature ideas are written down as scope-only epics and
  wait.
- Every ticket of the rewrite is checked against fixtures and the TypeScript tests, not against a
  reading of the code.
- The machine needs the Rust toolchain (rustup, stable; MSVC build tools on Windows), `cargo
nextest`, and for the Docker image a Rust build stage with cargo-chef. CI gets a Rust job on
  the release PR; ticket PRs stay local-only (ADR 0009).
- `CLAUDE.md` says how to run the Rust checks and that the TypeScript code is a frozen spec.
