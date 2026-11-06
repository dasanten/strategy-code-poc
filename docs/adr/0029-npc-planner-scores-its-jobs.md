# The NPC planner scores its jobs, and big cities get more to do

Status: decided (2026-11-06, with Daniel). Changes ADR 0026; keeps ADR 0016's planning pass.

Production has an NPC city of 108 with at least 65 standing still on the storage, after Living NPC
cities (ADR 0026). A staged city of about 110 run for 40 game days shows 37 to 70 on the storage tile
at every count. They are its soldiers (a quarter of its adults, with nothing to do between fights),
spare hands with nothing short and the surplus at its cap, and children and those carrying one. Its
reserves, surplus caps, builders, road crews and traders stay the same size as a village's.

## Decisions

- **Each free adult gets the job that scores highest**, in place of the fixed order in `shareOut`
  (Utility AI). Scores are a pure function of what the planning pass knows, and their numbers are in
  `balance.ts`. A worker changes job only if another beats theirs by a margin, so nobody goes back
  and forth. The rewrite comes first and keeps today's behaviour; the new work then goes in as more
  scored jobs.
- **Outside the scores, as now:** soldiers by share, those carrying a child, the Down and their
  revivers, defence, the founding party. What must always happen isn't left to weighing.
- **The pass stays once a game hour** (ADR 0016), with its time in tick health.
- **Big cities get more to do:** needs, crews and traders that grow with residents; founding sooner
  with more people; a training ground, an inner wall ring and more roads from materials above the
  reserve.
- **Soldiers stand posts** on the hall, at gates and along the wall, some patrolling in turns and some
  training. Patrols are capped by a balance number, as they walk every tick.
- **Idle residents stand at a house**, the one their id hashes to, so nothing new is stored and it
  costs one walk.

## Alternatives

- **Keep the fixed order and add the new work to it.** Much the smaller change, and the first draft's
  recommendation: the idle crowd comes from missing demand, not bad picking, so scores alone would
  fix none of it. Daniel chose scores now: the job list keeps growing, and a fixed order gets harder
  to get right with each job.
- **Build scores beside the fixed order as an experiment.** Safer, but two planners to keep working.
- **Fewer soldiers in big cities.** Frees workers, but makes big cities easier to take, and those
  workers would still need jobs.

## Consequences

- Every NPC test is at risk from the rewrite, so it comes as one ticket that changes no behaviour, and
  a slow scenario gives before-and-after numbers.
- Old NPC cities slowly get stronger soldiers, which Players attacking one will notice.
- More trading, patrols and work mean more walking, so more server load: those tickets measure it.
- Free land fills faster as big cities found sooner.
