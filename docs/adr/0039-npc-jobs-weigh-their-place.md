# An NPC city's jobs weigh their place, not only their band

Status: decided overnight (2026-11-17, T98.3), Daniel to confirm. Amends ADR 0029.

ADR 0029 gave each of an NPC city's jobs a score from a fixed band: farming, then the project, then a
good that is short (by how much it lacks), then the road crew, scouting, going back and surplus work.
Within a good, the first workplace with room took the worker, however far away it stood. Epic 98
gives a city a mind (`docs/context/npc-stances.md`: Stance, Threat): it remembers danger places where it lost people,
and a stance and temperament that should change what it does first. A fixed band per job can't say
"a far mine past where our traders died is worth less than the near one".

## Decisions

- **A job at a place is worth its band, less what the place costs** (`blended_score`). The place costs
  by its distance from the city's storage, the danger places the city remembers by the way there,
  and the crew already there, each times a weight (`NPC_JOB_WEIGHTS`, balance numbers), together at
  most a cap. The cap stays under the gap from work on a short good down to the road crew, so the
  bands still order what kinds of work come first; within a band and across neighbouring goods the
  place decides.
- **The weighing reaches what is tied to a place:** which workplace a good that is short goes to (the
  one that costs least, the first of equals), what that work is worth against the other offers,
  each surplus workplace's offer, and what a worker's own job is worth when another offers to take
  them (so a worker on a dangerous camp moves to a safe one of the same good by the usual margin).
- **Food short still comes first** and isn't weighed down; what ADR 0029 keeps outside the scores
  (soldiers, those carrying a child, the Down and their revivers, defence, the founding party) stays
  outside.
- **Neutral weights choose as the bands did.** All weights at zero give exactly the old choices; a
  test keeps the old planner's choices on staged cities (`npc_scores/neutral.json`) and checks them.
- **The weights are the city's** (`job_weights(city)`): the same for all for now; T98.4's stance and
  temperament tilt them.
- **Only danger weighs for now.** Distance and crew are weighed with a weight of nothing: with any
  weight of their own (tried: 0.05 a tile, 0.25 a worker) the slow NPC runs broke. Distance pulled
  spare hands from far surplus work across goods, so a big city never worked the new mine past its
  dry one, and the crew weight shook its farmer count past what the runs allow. A stance may give
  them weight where that is the point (Expand going further, say).

## Alternatives

- **Keep the bands and let a stance reorder them.** Smaller, and enough for "Fortify puts stone
  first", but it can't weigh one workplace against another of the same good, which is what danger
  places need.
- **Drop the bands for a full weighted sum** (need, distance, danger and crew all as considerations
  with curves). More expressive, but every NPC test hangs on the band order today, and the gaps in
  ADR 0029's numbers carry rules (a worker on a short good stays for another), which a free sum would
  have to re-earn.

## Consequences

- A city that lost people by a way stops sending its workers along it while it remembers the place.
- One more pass over the city's danger places per workplace weighed in a planning pass: a handful
  of places, once a game hour.
