# Working on this repo

The rules below hold for every change; the docs after them say how. Read only those your ticket
needs.

## Rules

- **Game rules and terms:** read `CONTEXT.md`, then only the section files your ticket names and
  those whose terms it uses. Use their words in code, UI and docs. A missing rule is Daniel's
  call: ask Daniel and add it to its section file (a new term also to the index) before building
  on it.
- **Decisions:** the game vision in `CONTEXT.md` and `docs/context/` wins over ADR 0001.
- **Tickets:** `/next-ticket` picks the next one and works it into a PR. PRs reference their
  tickets (`Closes #n`, `Part of #epic`).
- **CI minutes are scarce** (ADR 0009): ticket PRs go into the epic branch `epic/<n>-<slug>` and
  are checked locally; only one PR per epic (and bug fixes) goes into `dev` and runs CI.
- **Releases** (ADR 0010): `main` is the live game and every merge into it deploys. Epics and bugs
  collect on `dev`; a release is one PR `dev` → `main`, opened only when Daniel asks.
- **Balance numbers** live in `crates/csp-shared/src/balance/`, one declaration each in the file
  of its domain: pick sensible values, list them in the PR, run `pnpm balance:rust` and commit
  `packages/balance/`. Rules (what happens) are Daniel's call.
- **Generated files** (marked in `.gitattributes`): `pnpm generate` writes them all. On a
  conflict, merge the sources, run it and commit; never merge a generated file by hand.
- **Wiki** (`apps/web/src/wiki/<topic>.tsx`): a ticket that changes a rule also updates its wiki
  section. Numbers come from `@csp/balance`, never typed into its text.
- **Keep scripting cheap to add** (ADR 0002): everything goes through the game API
  (`crates/csp-sim/src/script_api.rs`); orders only request actions; order state is plain
  serialisable data. After changing the script tables, run `pnpm script-data:rust`.
- **World state is never reset** (ADR 0006): a change to its shape bumps `WORLD_FORMAT_VERSION`
  with a migration step and a test. ADR 0035 set this aside once (`csp-admin reset-world`; a save
  from before it is refused).
- **Monitoring** (ADR 0004): new simulation rules come with invariants and tests.
- **The server is Rust (ADR 0030)**; the client (`apps/web`) is TypeScript. The TypeScript server
  was deleted at the cutover (T88.6; last commit with it `21f7a29e`). Its frozen output,
  `crates/csp-sim/fixtures/`, is never edited to make a test pass: a rule change a fixture
  comparison fails on replaces that comparison with a Rust test of the new rule, said in the PR.
- **Toolchain:** the machine's default Node is too old. In bash run
  `eval "$(fnm env --shell bash)" && fnm use` first (from the repo root), and call pnpm as
  `corepack pnpm`. `gh` is at `C:\Program Files\GitHub CLI\gh.exe`.
- **Before finishing:** `pnpm check <base>`, with `<base>` the branch the change goes into, and
  `pnpm check:rust` once when the crates changed. A test over 5 s is a regression to fix.

## Where to read

- `CONTEXT.md`: the game's terms, the index of `docs/context/` (the rules, one file per section).
- `docs/adr/README.md`: every decision, one line each, with its state.
- `docs/architecture/sim.md`: the simulation crate, its modules and the tick order.
- `docs/architecture/client.md`: the client, how a part is written, and the server's edge.
- `docs/architecture/generated.md`: what is generated, by which command, and its checks.
- `docs/wasm-rules.md`: the Rust rules the client runs as WebAssembly.
- `docs/adding-content.md`: a building kind, a good, a vessel or siege machine, an order.
- `docs/recipes.md`: a rule, a world format bump, a balance number, an invariant, a script
  function, a client query, an NPC behaviour, a panel or map layer; and what the checks run.
- `docs/tasks.md`: how tickets, branches and PRs work, the priority rule, the open epics
  (what was agreed before, and the finished epics: `docs/log.md`).
- `docs/coordination.md`: sessions side by side, the merge loop, checks under load, the build cache.
