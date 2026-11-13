# Working on this repo

- **Game rules and terms:** `CONTEXT.md`. Use its words in code, UI and docs. If a rule you need
  is missing, ask Daniel and add it there before building on it.
- **Decisions:** `docs/adr/`. The game vision in `CONTEXT.md` wins over ADR 0001 where they
  conflict.
- **What to do next:** GitHub tickets, how they work in `docs/tasks.md`. `/next-ticket` picks the
  next one and works it into a PR. PRs reference their tickets (`Closes #n`, `Part of #epic`).
- **CI minutes are scarce** (ADR 0009): ticket PRs go into the epic branch `epic/<n>-<slug>` and
  are checked locally; only one PR per epic (and bug fixes) goes into `dev` and runs CI.
- **Releases** (ADR 0010): `main` is the live game and every merge into it deploys. Epics and bugs
  collect on `dev`; a release is one PR `dev` → `main`, opened only when Daniel asks.
- **Balance numbers** live in `crates/csp-shared/src/balance.rs`; pick sensible values and list
  them in the PR, then run `pnpm balance:rust` and commit `packages/balance/` (the client's copy).
  Rules (what happens) are Daniel's call.
- **Wiki** (`/wiki`, `apps/web/src/Wiki.tsx`): a ticket that changes a rule also updates its wiki
  section. Numbers come from `@csp/balance`, never typed into its text.
- **Keep scripting cheap to add** (ADR 0002): everything goes through the game API
  (`crates/csp-sim/src/script_api.rs`, `script_tables.rs`); orders only request actions; order
  state is plain serialisable data. After changing the script tables, run `pnpm script-data:rust`.
- **World state is never reset** (ADR 0006): a change to its shape bumps `WORLD_FORMAT_VERSION`
  (`crates/csp-shared/src/world/world_format.rs`) and ships a migration step in
  `crates/csp-server/src/world_format.rs` with a test.
- **Monitoring** (ADR 0004): new simulation rules come with invariants and tests.
- **The server is Rust (ADR 0030)**, in the cargo workspace at the root (`crates/csp-shared`,
  `csp-lang`, `csp-lang-wasm`, `csp-sim`, `csp-server`); the client (`apps/web`) is TypeScript.
  The TypeScript server, `packages/shared` and `packages/lang` were deleted at the cutover (T88.6;
  the last commit with them is `21f7a29e`). The fixtures in `crates/csp-sim/fixtures/` are their
  frozen output: never edit one to make a test pass; a rule change that a fixture comparison fails
  on replaces that comparison with a Rust test of the new rule, and says so in the PR.
  The client's types are generated from the crates (`ts-rs`): after changing a type the client
  sees, run `pnpm types:rust` and commit `packages/shared-types/src/generated/` (a Rust test fails
  when it is stale). Before finishing a change to the crates: `pnpm check:rust` (fmt, clippy with
  warnings as errors, `cargo nextest run`). A test over 5 s is a regression to fix, not to tag.
  Each crate's integration tests build into one binary: a new file in `tests/` goes into that
  crate's `tests/all.rs` (a test fails when one is missing). Cargo links with `rust-lld`
  (`.cargo/config.toml`), so it runs from PowerShell or bash alike.
- Toolchain: the machine's default Node is too old. In bash run
  `eval "$(fnm env --shell bash)" && fnm use` first (from the repo root), and call pnpm as
  `corepack pnpm`. `gh` is at `C:\Program Files\GitHub CLI\gh.exe`.
- Before finishing: `pnpm check <base>` (ADR 0013), with `<base>` the branch the change goes into
  (`origin/epic/<n>-<slug>`, or `origin/dev` for a bug). It runs lint, typecheck and only the
  client tests the change affects, and says what it ran. `pnpm test` is the client's full suite;
  CI runs it and `pnpm check:rust`'s steps.
