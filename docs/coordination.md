# Coordination

How several sessions work tickets side by side, and why (T124.6). This is for every session: a
ticket session that wonders why its check failed, and the coordinating session, whose own steps are
in `.claude/skills/plan-features/COORDINATE.md`. How tickets, branches and PRs work is in
`docs/tasks.md`; the CI budget and the release flow in ADR 0009 and ADR 0010.

## Where to work

- **Each session in its own worktree** (`.claude/worktrees/<name>`). A checkout is shared state:
  two sessions that switch branches in one folder break each other's checks.
- **The coordinator too:** it checks and merges in `.claude/worktrees/coord-<epic>`
  (`git worktree add --detach .claude/worktrees/coord-<epic> origin/<epic-branch>`, then
  `corepack pnpm install --frozen-lockfile --prefer-offline`), never in the main checkout. The
  main checkout can sit weeks behind `dev` on a detached head: read `origin/dev` from a worktree
  before taking stock of the game.
- **One coordinator per epic.** A session can look idle in the session list while it still works.
  Before taking over another coordinator's epics, ask it and wait for the answer, and read the
  epic branch's `git log` right before pushing to it: two coordinators race on the same branch and
  start the same ticket twice.

## How work reaches `dev`

- **Ticket PRs** go into the epic branch after a local check of the PR merged with the epic tip
  (ticket PRs get no CI, ADR 0009). A PR whose head already contains the epic tip was checked by
  its worker on exactly what would be merged: it merges without running the checks again. A PR
  behind the tip is checked again on the merge, or its worker merges the tip in, checks and pushes.
- **Tickets are closed by hand** when their PR merges: GitHub closes them only on merges into
  `main`.
- **Epic and bug PRs** go into `dev` after the local checks, without waiting for CI: CI runs on
  them, and must be green on the release PR `dev` → `main`, which is opened only when Daniel asks.
- **Before an epic goes into `dev`,** `dev` is merged into the epic branch and `pnpm test:slow`
  runs (the slow NPC simulations, about 8 minutes). Epics developed apart meet only there, and the
  NPC simulation couples rules that look unrelated: an epic once moved workers' places, and so who
  went home hungry, and a town stopped arming its soldiers. The season and year runs
  (`pnpm test:year`) are no gate: they run each night on `dev` and report a regression as a bug.
- **An epic is reviewed before it goes into `dev`** (ADR 0048): a ticket PR merges on green checks
  without anyone reading it, and its tests are written by the session that wrote its code. When
  the last ticket is on the epic branch, the coordinator runs `/code-review` on the epic's diff
  against `dev` (`git diff origin/dev...epic/<n>-<slug>`) at the default level, never `max` or
  `ultra` unless Daniel asks: those start many reviewers for one epic.
  - **A confirmed bug** is fixed on the epic branch before the epic PR merges: one session with
    the finding as its brief, its PR into the epic branch like any ticket's.
  - **Everything else** (cleanups, uncertain findings, a bug older than the epic) goes into the
    epic PR's body under "Review: not fixed", one line each, and does not block. A bug older than
    the epic is also filed as a `bug` issue.
  - **A finding that needs a rule** is a `needs Daniel` question. The epic waits for the answer
    only if the code would otherwise do something `docs/context/` does not say.
- **A bug issue is closed** when its fix is on `dev`, with a comment naming the PR.

## The merge loop

`scripts/coord-merge.sh <epic-branch> <pr>...`, run from the coordinator's worktree: for each PR in
order it merges at once if the PR is up to date; otherwise it merges the epic tip in, resolves a
conflict that is only `pub mod` lines (`scripts/resolve-modlist.pl`) or `Cargo.lock`, runs
`pnpm check:rust` and `pnpm check origin/<epic>`, pushes the merge commit to the PR branch and
merges the PR. It skips a PR that conflicts otherwise or goes red, and names it at the end. Logs go
to `logs/` beside the worktree. `CHECK_ONLY=1` does everything but push and merge. Run it in the
background: several PRs take 10 to 25 minutes.

**A merge resolved by hand** is searched for conflict markers before it is committed
(`git grep -n -E '^(<{7}|>{7}|={7}$)'`): a failed one-line substitution once left them in, and the
broken file was pushed. Resolve with an editor, not a one-liner.

## What collides

- **Generated files** (`docs/architecture/generated.md` lists them; `.gitattributes` marks them)
  are never merged by hand: merge the sources, run `pnpm generate`, commit what it writes.
  `pnpm check` fails on a stale one.
- **Files split per domain** so that two tickets in different areas don't touch the same file
  (Epic 120): the balance numbers (`crates/csp-shared/src/balance/`), the world types
  (`crates/csp-shared/src/world/`), the script tables (`crates/csp-sim/src/script_tables/`), the
  invariants (`crates/csp-sim/src/invariants/`), the wiki (`apps/web/src/wiki/`) and the rules
  (`docs/context/`). Put a new declaration in its domain's file, not at the end of another's.
- **Serial by nature:** `WORLD_FORMAT_VERSION` (bumps go in order, one PR at a time: the
  coordinator tells the next PR which number to take), a crate's `pub mod` list in `lib.rs` (the
  merge loop resolves it) and the tick order in `crates/csp-sim/src/world.rs`.
- **What may run in parallel:** two tickets whose files (from the ticket's text, and from the files
  their area keeps, `docs/architecture/`) don't overlap, and of which neither needs the other's
  result. Two tickets that both bump the world format, or edit the same tick step, run one after
  the other.
- **Epic numbers** come from the tables in `docs/tasks.md` (open epics) and `docs/log.md`
  (finished ones), not from GitHub, so two planning sessions can pick the same one: read both and
  `gh issue list --label epic` again right before creating an epic.

## Checks under load

Other sessions build at the same time. `pnpm check` and `pnpm check:rust` can fail on timing alone
then (a timeout, a budget test over its limit), with a different set each run. `pnpm check:rust`
waits for another session's suite (ADR 0040) and says so.

- Send the output to a log file, not through `tail`, which hides the failing test and the exit code.
- Run each failing test alone, then on the base branch to compare.
- A failure that passes alone is named in the PR, with why, rather than reported as a clean pass.

## The build cache and disk

- Every cargo build on the machine goes through sccache, so third-party crates are built once.
  Each worktree keeps its own `target/` (10 to 20 GB, mostly incremental builds of the workspace).
- **Don't share a `CARGO_TARGET_DIR` between checkouts:** both get the same test-binary names, and
  cargo may run the other checkout's binary as fresh, reporting another branch's results. If one
  was shared, touch `crates/*/src/lib.rs` before building and list the tests to see which
  branch's binary it is.
- **When a ticket PR is merged,** its worktree's `target/` is deleted. Keep at least 25 GB free on
  `C:` before starting more Rust sessions.

## Running the app for review

- A fresh world takes over half an hour to generate. Copy a generated `world.db` to a scratch
  folder, point `DB_PATH` at it, and add a `.claude/launch.json` entry that starts the server and
  Vite on free ports (`PORT`, `ALLOWED_ORIGINS` for the Vite origin). A copy too old for the
  server's format is generated again on the copy with `csp-admin reset-world`.
- **A slow live server** is reproduced from a backup: copy it to scratch and run
  `DB_PATH=<copy> cargo run --release -p csp-server --bin bench-sim -- save 60`, which steps the
  newest save and prints the time per phase. Compare runs taken at the same time: the machine's
  load changes them by up to twice.

## Git

No hard reset, no force push, no `commit --amend` in a script: auto mode refuses them, and a
history that needs rewriting is Daniel's to rewrite. In a script, check each step's result before
the next (a branch switch that failed on a dirty tree once had a commit amended onto the wrong
branch), and check that a push reached the remote before opening or merging a PR.
