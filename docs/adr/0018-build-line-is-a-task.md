# Road and wall lines are built as a task

Status: decided (2026-11-01, with Daniel). Replaces the line order as the way the UI builds roads
and walls.

Until now a road or wall line was a one-off order (`roadLine`, `wallLine`) for one resident: they
walked the line from their own tile and built each tile only with what they carried. They never
fetched more, a group could not share a line, there was no default script to edit or params to
set, and a line could not be planned in a queue with its tiles picked on the map. So walls and
roads were the one kind of building that could not be left to run.

## Decisions

- **A task with a default script.** Build line is a task like Build, for road and wall alike,
  with its own default script and Build's params (`source`, `foodAt`, `foodTake`). Players edit it
  like any default.
- **The line comes from the order.** Road or wall and its two ends are picked on the map from the
  card, the group card or a queue step. Like a haul's route it is not a param: script params hold
  buildings and numbers, not lines. Started without one it ends.
- **Two picked ends.** The line no longer starts at the resident's tile, so it can be planned
  ahead; the resident walks to it.
- **One tile each.** Residents on the same line each take the nearest unfinished tile nobody else
  has taken, so a crew builds several tiles at once.
- **Each fetches their own.** A builder lacking materials fetches for their tile and the next ones
  from `source` or the nearest storage holding them.
- **No stock, move on.** With nothing anywhere, they lay out each tile's site and end once the
  whole line is laid out, saying why, so the line shows and can be finished later.
- The plain line orders stay in the game API as building blocks for scripts (ADR 0002).

## Alternatives

- **Two tasks, Build road and Build wall.** Two copies of one script to keep in step.
- **Lay out every site at once.** Laying out a line would put down all its sites without a
  resident on each tile, and the Build task would work them. Changes the rule that laying out
  needs a resident on the tile, and a crew would still pile onto one site.
- **All on one tile.** The crew works the line tile by tile together, like a crew on a building.
  Simpler, but a long wall goes up no faster than a short one with more hands.
- **One fetcher for the crew,** as Build does. On a long line the fetcher walks back and forth for
  everyone while the others wait.
- **Wait at the tile** when no storage holds materials, checking again now and then. Leaves
  residents standing idle at the first tile and the rest of the line unseen.
