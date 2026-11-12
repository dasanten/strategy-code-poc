# Code Strategy PoC

A persistent, real-time strategy world. Players run their realm through UI orders and scripts in
our own small language (ADR 0002). The server runs the world at 1 tick per second.

Design decisions live in `docs/adr/`; the domain glossary is `CONTEXT.md`.

## Layout

The server is Rust (ADR 0030), the client TypeScript. One cargo workspace at the root:

| Path                    | What it is                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `crates/csp-shared`     | World types, balance numbers (`src/balance.rs`), the wire protocol and helpers             |
| `crates/csp-lang`       | The script language: lexer, parser, checker, interpreter with the step budget              |
| `crates/csp-lang-wasm`  | `csp-lang`'s checker built to WebAssembly for the editor                                   |
| `crates/csp-sim`        | Everything in a tick: terrain, pathfinding, orders, the world step, NPC cities, invariants |
| `crates/csp-server`     | The I/O shell: HTTP, WebSocket sync, accounts, SQLite, saves, monitoring, admin CLI        |
| `apps/web`              | Vite + React client: PixiJS tile map and a CodeMirror script editor                        |
| `packages/shared-types` | The client's types, generated from the crates (`pnpm types:rust`)                          |
| `packages/balance`      | The balance numbers the client reads, generated (`pnpm balance:rust`)                      |
| `packages/lang-wasm`    | The editor's checker (`pnpm wasm:build`) and the script tables (`pnpm script-data:rust`)   |

The TypeScript server, `packages/shared` and `packages/lang` were the frozen specification of the
port and were deleted at the cutover (T88.6); the last commit with them is `21f7a29e`. The Rust
tests still compare against what they wrote, in `crates/csp-sim/fixtures/` (frozen; see its
README).

## Getting started

Needs:

- Rust: rustup stable (`rust-toolchain.toml`) with the Visual Studio MSVC build tools on Windows
  (the "Desktop development with C++" workload), `cargo install cargo-nextest --locked`, and for
  the editor's checker `rustup target add wasm32-unknown-unknown` plus
  `cargo install wasm-bindgen-cli --version <the wasm-bindgen version in Cargo.lock> --locked`.
- Node 22.12+ (Vite 8 needs it) and pnpm 10, for the client. The exact Node version is pinned in
  `.node-version` and pnpm in `package.json` (`packageManager`). With fnm and corepack:

```sh
fnm use            # picks up .node-version (fnm install first if it's missing)
corepack enable    # makes `pnpm` the pinned 10.x
```

Copy `.env.example` to `.env` for local settings; server and client both read it.

```sh
pnpm install
pnpm dev        # Rust server on :3000, client on http://localhost:5173 (proxies /api and /ws)
```

Signing up needs an invite code (ADR 0005). Create yourself an admin and a code:

```sh
cargo run -p csp-server --bin csp-admin -- create Daniel   # asks for a password (or set ADMIN_PASSWORD)
cargo run -p csp-server --bin csp-admin -- invite          # prints an invite code
```

Admins can also create invite codes and reset passwords in the client.

Other scripts:

```sh
pnpm check:rust    # cargo fmt --check, clippy with warnings as errors, cargo nextest run
pnpm types:rust    # the client's types from the crates (commit packages/shared-types/src/generated)
pnpm balance:rust  # the client's balance numbers from balance.rs
pnpm build         # type-check and bundle the client
pnpm start         # run the server in release
pnpm test          # Vitest, the client's full suite
pnpm check [base]  # lint, typecheck and the client tests affected by changes against base
pnpm lint          # ESLint
pnpm format        # Prettier
```

A Rust test over 5 s is a regression to fix (nextest flags it); `cargo fmt --all` fixes
formatting. Each crate's integration tests build into one test binary: `tests/all.rs` lists every
file in `tests/`, and a test fails when a file is missing from it. One binary instead of one per
file makes a rebuild after a change to `csp-sim` about three times faster on Windows. Cargo links
with `rust-lld` on Windows (`.cargo/config.toml`), so it works from Git Bash too, where
`/usr/bin/link` used to shadow the MSVC linker.

The server stores everything in `data/world.db` (override with `DB_PATH`). The world lives in
memory and is saved as a gzipped snapshot every 30 ticks and on shutdown; old saves are pruned
(ADR 0006). A dev world the TypeScript server made sits in `apps/server/data/world.db` of an older
checkout; copy it to `data/world.db` to keep playing it.

- **Table changes:** a new step in `crates/csp-server/src/db/migrations.rs`; migrations run on
  startup.
- **World state changes:** the world is never reset. Changing the shape of `WorldState` bumps
  `WORLD_FORMAT_VERSION` in `crates/csp-shared/src/world/world_format.rs` and adds a migration
  step to `crates/csp-server/src/world_format.rs`, with a test. A save older than format 111 (the
  TypeScript freeze) is refused: run the last TypeScript image on it once first (see Deploy).

## Benchmarks and profiling

Every performance claim in a PR comes from the benchmarks (ADR 0030), run in release:

```sh
cargo run --release -p csp-server --bin bench-world -- [size] [seed]       # generation by stage
cargo run --release -p csp-server --bin bench-sim -- <village|villages|hq|save> [ticks]
```

`bench-sim save` reads the newest save of the database at `DB_PATH` (it works on a copy of it).

To see where the time goes, record a CPU profile of the same command with
[samply](https://github.com/mstange/samply) (no code in the benchmarks; the profiler samples the
process from outside). Build with the `profiling` profile (release plus debug symbols, in the
workspace `Cargo.toml`) so the profile shows function names:

```sh
cargo install samply --locked
cargo build --profile profiling -p csp-server --bin bench-sim --bin bench-world
samply record --save-only -o village.json.gz target/profiling/bench-sim village
samply load village.json.gz        # serves the Firefox Profiler on localhost and opens it
```

In the profiler, the Call Tree tab with "Invert call stack" ticked lists the functions by self
time; the Flame Graph tab shows the same by stack. Without `--save-only`, `samply record` opens
the profiler straight away. `bench-world` works the same way (`target/profiling/bench-world`).

**Status:** the `record` step has not been run anywhere yet (T89.3, #1129); the commands are from
samply's documentation. On WSL2 (Ubuntu) `cargo install samply` and the `profiling` build work, but
samply refuses to record at the default `perf_event_paranoid` of 2. The tables in
`docs/proposals/rust-rewrite.md` come from a throwaway pprof-rs harness instead.

- **Linux, WSL2:** needs a C toolchain for the build (`sudo apt install build-essential`) and
  `kernel.perf_event_paranoid` of 1 or lower:
  `echo 1 | sudo tee /proc/sys/kernel/perf_event_paranoid` (system-wide; on WSL2 it resets when
  WSL restarts).
- **Windows (untested):** samply records through ETW, so it needs the Windows Performance Toolkit
  (`xperf`; the Windows ADK installer, tick only "Windows Performance Toolkit") and an elevated
  terminal (it asks for elevation itself). The record command is the same. To have the profile
  carry its symbols, add `--unstable-presymbolicate`, which writes a `.syms.json` beside it.

## Monitoring

See ADR 0004. The server logs JSON lines (level via `LOG_LEVEL`). Set `SENTRY_DSN` (server) and
`VITE_SENTRY_DSN` (client) to report to Sentry; without them reporting is off. Each tick runs the
invariant checks in `crates/csp-sim/src/invariants/` (every tick in dev, 10% of ticks in
production, `INVARIANT_SAMPLE_RATE` overrides) and reports tick duration and unit and action
counts; a tick above 800 ms is logged and sent to Sentry as a warning.

## How packages resolve each other

Workspace packages export a `source` condition pointing at `src/index.ts`. Vite and Vitest use it,
so dev needs no build step.

## Deploy

Every push to `main` that passes CI builds an image, pushes it to GHCR and deploys it over SSH
to Daniel's server, where Caddy serves it over HTTPS (ADR 0007). One-time setup:

1. On the server: Docker with the compose plugin, ports 80 and 443 open, a DNS record for the
   domain, and a deploy user in the `docker` group with an SSH key for GitHub.
2. In the deploy directory (`~/strategy-code-poc` by default): a `.env` copied from
   `deploy/.env.example`.
3. In GitHub: repository secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (the private key)
   and `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan <host>`); repository variable
   `DEPLOY_ENABLED=true`, optionally `DEPLOY_DIR` and `VITE_SENTRY_DSN`. Until
   `DEPLOY_ENABLED` is set, CI only builds the image.
4. After the first deploy, in the deploy directory:
   `docker compose exec server csp-admin create <name>` for the admin and
   `docker compose exec server csp-admin invite` for invite codes.

The image runs the Rust server (ADR 0030): a `cargo-chef` stage builds `csp-server`, `csp-admin`
and `check-fields` in release, a second Rust stage builds the editor's WebAssembly checker, the
client is built as before, and a slim Debian image runs them as the same unprivileged user
(uid 1000) with the same volumes, port and environment the TypeScript image had, so the compose
file and the volumes stay as they are. CI's `rust` job runs `pnpm check:rust`'s steps beside
`check`, on PRs into `dev` and `main` only (ADR 0009).

Backups go to the `world-backups` volume before every start (`world-<time>-start.db`) and daily,
14 days kept.

### Rolling back

Rolling back is the previous image plus the pre-deploy backup (ADR 0007). Image tags are the
first 12 characters of the commit on `main` (GHCR lists them); the previous one is still on the
server. In the deploy directory, with `IMAGE_TAG` set to the previous tag for every command:

```bash
export IMAGE_TAG=<previous tag>
```

1. Find the backup the bad deploy wrote as it started, before any migration: the `-start` file
   whose time matches that deploy (the server's first log line, `backup written`, names it). Every
   start writes one, so after more restarts it is no longer the newest.

   ```bash
   docker compose exec server sh -c 'ls -t /backups | head'
   ```

2. Stop the server:

   ```bash
   docker compose stop server
   ```

3. Put the backup over the live database, in a throwaway container on the server's volumes:

   ```bash
   docker compose run --rm --no-deps -T --entrypoint sh server -c 'cp /backups/<that file> /data/world.db && rm -f /data/world.db-wal /data/world.db-shm'
   ```

4. Start the previous image:

   ```bash
   docker compose up -d server
   ```

Without step 3 the previous server would run on what the newer one saved, and it refuses a newer
world format or table migration. Ticks played since the bad deploy are lost with the restore.

**Tested for the cutover (T88.6, 2026-11-10)**, locally with Docker and this compose file, both
images tagged under the GHCR name: on a copy of a dev world (tick 2010, format 111) the TypeScript
image of `main` ran and saved at tick 2102; the Rust image started on it (backup written, world at
tick 2102) and saved at 2174. The TypeScript image then loads even the Rust save (tick 2174, no
errors), and after steps 1 to 4 it ran from tick 2102 again, the world it had before the Rust
deploy, with no errors. So the last TypeScript image is the rollback for the cutover. It is also
the tool for a save older than format 111, which the Rust server refuses: run it once on that
database (it migrates and saves on start), then start the Rust image.

Before scripts see exactly their script views (ADR 0011), list the fields Players' active scripts
read that the views don't declare, with each script and Player. It only reads, so it is safe while
the server runs: `docker compose exec server check-fields` (reads `DB_PATH`). It finds reads from
values the checker is sure of (`me`, a query's result, a `for … of` over one, a `let` holding one);
a read through `memory` or a function's parameters isn't found.
