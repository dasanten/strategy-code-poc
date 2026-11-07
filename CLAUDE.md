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
- **Balance numbers** live in `packages/shared/src/balance.ts`; pick sensible values and list them
  in the PR. Rules (what happens) are Daniel's call.
- **Wiki** (`/wiki`, `apps/web/src/Wiki.tsx`): a ticket that changes a rule also updates its wiki
  section. Numbers come from `@csp/shared`, never typed into its text.
- **Keep scripting cheap to add** (ADR 0002): everything goes through the game API in
  `packages/shared`; orders only request actions; order state is plain serialisable data.
- **World state is never reset** (ADR 0006): a change to its shape bumps `WORLD_FORMAT_VERSION`
  and ships a migration step with a test.
- **Monitoring** (ADR 0004): new simulation rules come with invariants and tests.
- **Rust backend (ADR 0030), on the branch `rust-backend`:** the server is being rewritten in Rust
  in the cargo workspace at the root (`crates/csp-shared`, `csp-lang`, `csp-sim`, `csp-server`).
  The TypeScript game is under a **feature freeze**: a frozen specification, bugs only. A rewrite
  ticket ports one module with its tests and proves parity against the fixtures in
  `crates/csp-sim/fixtures/` (written by `scripts/dump-fixtures.mts`, never by hand). No rule
  changes in the port. Rewrite epics branch from and merge into `rust-backend`, not `dev`.
  Before finishing a Rust ticket: `pnpm check:rust` (fmt, clippy with warnings as errors,
  `cargo nextest run`). A test over 5 s is a regression to fix, not to tag. Run cargo from
  PowerShell, or in bash with the MSVC `link.exe` ahead of Git's: `/usr/bin/link` is not a linker.
- Toolchain: the machine's default Node is too old. In bash run
  `eval "$(fnm env --shell bash)" && fnm use` first (from the repo root), and call pnpm as
  `corepack pnpm`. `gh` is at `C:\Program Files\GitHub CLI\gh.exe`.
- Before finishing: `pnpm check <base>` (ADR 0013), with `<base>` the branch the change goes into
  (`origin/epic/<n>-<slug>`, or `origin/dev` for a bug). It runs lint, typecheck and only the
  tests the change affects, and says what it ran. `pnpm test` is the full suite; CI runs it.
