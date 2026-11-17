# Checks share the machine; slow runs have their own profile

Status: decided (2026-11-18, with Daniel). Amends ADR 0030 (local checks, slow tests) and ADR 0013.

Measured on `dev` on an idle machine (2026-11-17), one check is not slow: 30 s to rebuild the tests
after a changed line in `csp-sim`, 54 s for the suite, about 6 minutes for the first check in a
fresh worktree. What takes long is several sessions at once, each taking all 24 threads, and the
long NPC runs: 2.5 min of release build and 7.2 min of tests for an epic gate, about 65 min for the
year and season runs, and the whole run again to look at a late failure. Epic 111 (#1417) holds the
numbers.

## Decisions

- **A check does not take the whole machine.** `pnpm check:rust` caps itself or waits its turn
  while another check runs, whichever T111.2 measures as faster for four checks at once. Alone on
  an idle machine it runs as fast as before. CI is unchanged.
- **Iterate on one crate, check everything once.** While working, a session runs the tests of the
  crate it changes (`cargo nextest run -p csp-sim [filter]`); `pnpm check:rust` runs once before
  finishing.
- **The simulation crates build at opt-level 3 in dev**, like `csp-lang`: the suite runs about a
  quarter faster and the incremental build takes the same time.
- **Slow runs have a `slow` cargo profile and commands.** Release without LTO, run under nextest:
  `pnpm test:slow` (the epic gate: `npc_slow` without the year runs), `pnpm test:year`,
  `pnpm test:ignored` (every test ignored for time).
- **Every test ignored for time runs each night on `dev`**, with the year run, into the same
  report. ADR 0030's "a test over 5 s is a regression to fix, not to tag" stays the aim; a test
  that is tagged all the same is at least run.
- **The year run saves checkpoints and fails on the day.** A late failure is looked at, and a fix
  first checked, from the last checkpoint before it. Resuming from a save is the same run tick for
  tick, which a test in the default suite holds.

## Considered

- **One shared `CARGO_TARGET_DIR`:** rejected on 2026-11-16 (locks across sessions, a stale binary
  of another checkout).
- **Cranelift, the parallel front end, Cargo's cross-workspace cache:** nightly-only or unfinished.
- **Fewer sessions at once:** not decided here; sessions stay one per workable ticket.

## Consequences

- A session's check can wait for another's. The wait is shorter than the slowdown it replaces, and
  timing tests stop failing on load.
- Left for a later epic if this isn't enough: profiling the tick, sharing runs between slow tests,
  world-generation tests that each make a world, reusing warm worktrees, a Dev Drive.
