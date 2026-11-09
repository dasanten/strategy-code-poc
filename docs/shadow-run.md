# The shadow run

Before the cutover (ADR 0030, "The cutover"), the Rust server runs beside the TypeScript one on
copies of one save for several game days, and their worlds and tick times are compared. One
command does it: `scripts/shadow-run.mts`.

## What it does

1. Copies the save with SQLite's backup (safe while a server is writing it) into an output
   directory, and lets the TypeScript server open it once and save it again. A save older than
   the format the Rust server reads (`FREEZE_FORMAT_VERSION`) is migrated that way. Both sides
   start from that copy.
2. Starts the TypeScript server's tick in the script's own process (`index.ts` without HTTP: the
   same `runTick` with orders, queues, scripts, walking, territory, sight and saves) and the Rust
   server's `Game` in the `shadow-step` binary of `csp-server`, each on its own copy of the
   database.
3. Steps both in lock-step, tick by tick, for the given number of game days. The clock both run
   by is the tick; no Player is connected, so no order arrives and nothing is broadcast.
4. At every game-day boundary (`--every`, 1440 ticks) and at the end, compares the two worlds as
   parsed JSON. Paths allowed to differ are listed in `ALLOWED_DIFFERENCES` in the script (none
   so far), each with its reason.
5. If the worlds differ, replays the run from the start, compares after every tick from the last
   check that matched, and compares the first tick that differs after each of its phases
   (orders, queues, scripts, the world's step, the rest). That gives the first difference's
   tick, phase and path.
6. Writes `report.md` (the result, the checks, tick times side by side overall, by game day and by
   phase, and what each server logged at warn or above) and `ticks.csv` (every tick's times) to
   the output directory, and prints the report. It exits with 1 if the worlds differ.

One thing differs from the real servers, on both sides alike: path searches run to the end within
the tick instead of stopping after `PATH_BUDGET_MS` of wall-clock time. With the budget, where a
walker is after a long search would depend on which server is faster. The fixture dumper and the
Rust differential test step their worlds the same way.

## Running it on a local save

From the repository root, in PowerShell (cargo needs the MSVC linker, which Git Bash shadows):

```bash
corepack pnpm shadow-run <path to world.db> --days 3
```

It builds `shadow-step` in release first (`cargo build --release -p csp-server --bin shadow-step`).
Options:

- `--days <n>`: game days to run, 3 by default.
- `--every <ticks>`: compare this often, every game day (1440 ticks) by default.
- `--out <dir>`: the output directory, a new temporary one by default.
- `--rust <binary>`: an already built `shadow-step`, which skips the build.
- `--invariant-sample-rate <r>`: the share of ticks that get the full invariant checks, 0.1 by
  default as on the live servers, so the tick times compare with theirs. 1 checks every tick and
  makes the TypeScript ticks several times slower.
- `--ignore <regex>`: another path allowed to differ (indices written `[]`, e.g.
  `^world\.residents\[\]\.x$`), for a look past a known difference.

The save is only read. Every copy goes into the output directory.

## Running it on the live save (Daniel)

The live save never leaves the server except as a backup copy. On the server, in the deploy
directory (`~/strategy-code-poc` by default), copy the newest backup out of the `world-backups`
volume:

```bash
docker compose exec server sh -c 'ls -t /backups | head -n 1'
```

```bash
docker compose cp server:/backups/<that file> ./shadow-world.db
```

Then, on your machine, fetch it and run the shadow run on it:

```bash
scp <user>@<host>:strategy-code-poc/shadow-world.db .
```

```bash
corepack pnpm shadow-run shadow-world.db --days 3 --out shadow-live
```

`shadow-live/report.md` is the result. Delete `shadow-world.db` from the server afterwards. A
difference is a port bug in the Rust server, to be fixed on `rust-backend` (never a rule change),
and the run repeated until the report says "No difference".
