# UI tasks run default scripts in the game language

Status: decided (2026-10-22, with Daniel). Changes how ADR 0002's UI orders are built.

Every task the UI can give that repeats or decides (work a workplace, build, haul, tear down) is a
**default script** written in the game's own language (`CONTEXT.md`: Default script, Order).
Giving a resident such a task runs that script, with the task's target (the workplace, the site,
the haul stops) written into its memory. One-off steps (walk, pick up, put down, attack, trade)
stay single actions, and the scripts still call the built-in actions such as `workAt`.

Each Player has their own version of every default script, one per task and shared by all their
residents doing it. Until the Player edits it, it follows the game's default; once edited it is
theirs, with history like any script, until they **reset** it. NPC cities run the game's defaults
through the same interpreter.

## Why

Daniel wants Players to change how their residents do things without writing scripts from
scratch: open the script behind a task, tweak it, reset it if it goes wrong. That only works if
the built-in behaviour _is_ a script they can read. ADR 0002 already made orders behave like
scripts (they read queries and request actions, with plain-data state); this goes one step
further and writes them in the language itself.

## Considered options

- **Keep orders as server code and show a script template** when a task is picked. Cheaper to
  run, but the template and the real behaviour drift apart, and the Player edits a copy rather
  than the behaviour.
- **A copy per resident.** Rejected: changing how 30 farmers work would take 30 edits.
- **A shared notes store per building** for co-workers to coordinate (one carrier at a time).
  Rejected for read-only access to the memory of the Player's own residents, which needs no new
  kind of state.

## Consequences

- Default scripts use the step budget like any script. They are kept well under the per-resident
  budget (a test checks each), and the realm budget is sized so a realm running only defaults
  doesn't hit it. NPC cities have no realm budget.
- An invariant flags a resident running an unedited default that ran out of budget: that is our
  bug, not the Player's.
- Every new task now means writing its default script, and any query or action it needs goes
  into the script API, which keeps scripting complete by construction.
- The old server-side behaviours for these tasks (Player orders and NPC carrying) go away; the
  game's defaults replace both.
- Running the interpreter for every working resident each tick costs more CPU than native code.
  Watch tick time once realms grow.
