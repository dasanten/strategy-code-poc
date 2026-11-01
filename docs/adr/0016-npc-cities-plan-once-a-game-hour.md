# NPC cities think once a game hour and keep a stored plan

Status: decided (2026-10-31, with Daniel). Builds on ADR 0002 (orders plus scripts), ADR 0004
(monitoring) and ADR 0006 (world state is never reset).

Every city the game runs (NPC villages and towns, self-managed cities, trading posts, the Trade
Org HQ, and from now on the daughters that full cities found) decides what its residents do. Until
now each of them re-decided everything every tick: which workplace has room, what to build and
where, scanning its area for a house tile and all residents per workplace. That is quadratic in
residents and runs for every city every second, and it is what made adding ambitions (the reserve
chain, a trader, founding) look too expensive.

## Decisions

- **A planning pass per city once a game hour** (60 ticks). Cities are staggered by a hash of
  their id, so about one city plans per tick. The pass does all the thinking: soldiers and
  farmers, spare hands to the shortest reserve, the next project, whether to send the trader,
  whether the city is full.
- **The result is a city plan stored in the world state**, plain serialisable data like an
  order's state: a job per resident, the project, the trader run, when the city became full,
  cached search results. Changing its shape bumps `WORLD_FORMAT_VERSION` with a migration.
- **Per tick only the cheap reactive parts run:** defence, handing an idle resident the job the
  plan gives them, refills, and the residents' default scripts, which run per tick for everyone
  anyway. Per-tick code touches only the city's own residents, indexed once per tick.
- **The expensive searches run rarer still:** a building site only when the project changes, a
  founding site once a game day at most with a bounded number of sampled tiles.
- **NPC planning time is a tick-health number** (ADR 0004), so a regression shows up in
  monitoring before it shows up as a slow tick.

## Alternatives

- **Keep deciding every tick, optimise the scans.** Indexing alone fixes the quadratic part, but
  every ambition added would still run its search every second for every city, and the per-tick
  budget (one real second for the whole world) is shared with everything else.
- **Plan once a game day.** Cheaper, but a city that notices an empty storage or a dead farmer
  only after 24 real minutes looks broken; a minute is invisible for economics.
- **Keep the plan in memory only.** Simpler, but a restart would make every city rethink at
  once, and a job in flight (a trader on the road, a founding party) would be forgotten.

## Consequences

- A city reacts to a change within a minute, not a second. Defence is untouched and stays per
  tick.
- A worker stays where the plan put them until the next pass moves them; nobody ping-pongs.
- Tests that step a city for a few ticks and expect a decision must step a game hour, or call the
  planning pass directly.
