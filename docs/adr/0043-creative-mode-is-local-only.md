# Creative mode is local only

Status: decided (2026-11-21, with Daniel). Rules in `CONTEXT.md` under **Creative mode**; built in
Epic 117.

## Context

One tick is one game minute and one real second (`TICK_MS`), so testing a change by hand means
waiting: a house takes real hours, a child grows up over real days, and a fresh full-size world
takes a long time to set up. Daniel wants to test locally as an admin without waiting. Until now
being an admin gives no power in the world (`CONTEXT.md`, **Admin**), and every action goes
through the game API (ADR 0002).

## Decisions

- **Behind a server flag, not a role.** Creative mode exists only when the server starts with
  `CREATIVE=1`. The live deploy never sets it, and every creative route refuses without it, even
  for an admin. On such a server it is the one exception to "admins have no power in the world".
- **Time is the main lever.** Pause, step, ×N speed and skip ahead drive the same `Game::tick` as
  normal, so every rule runs unchanged, only sooner. No timer inside a rule is shortened.
- **Creative actions act directly, between ticks.** Like admin directives, they are admin HTTP
  routes that touch the world through `with_game`, not order kinds and not script calls. So the
  game API for Players (ADR 0002) stays whole and no cheat can leak into a Player's script.
- **Any realm.** Testing NPC and fight behaviour needs both sides set up, so the actions reach every
  realm and unowned tiles.
- **Test worlds are the real generator, small.** Same terrain, NPC cities and Trade Organization as
  the live world, at a picked size and seed, so what is tested is what Players get.
- **No world format change.** Speed, pause and reveal live in the running server, not the world
  (ADR 0006); checkpoints are saves kept beside the world, not part of it.

## Considered

- **Instant timers per realm** (zero building, walking and training time for a flagged realm):
  puts a creative branch inside every rule, and time controls give most of the same for free.
- **Creative order kinds callable from scripts:** scriptable test setups, but cheats inside the
  Player-facing game API.
- **Only the admin's own realm:** safer, but fights and NPC behaviour could not be set up.
- **Bench scenes as test worlds:** fast, but flat Plains without NPC cities or trading posts.
- **A Creative tab in the admin panel:** keeps the game view clean, but every test means switching
  screens.
