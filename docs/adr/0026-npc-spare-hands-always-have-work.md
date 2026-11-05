# NPC spare hands always have work, and news of far nodes is carried home

Status: decided (2026-11-05, with Daniel). Changes NPC city and Full city.

Big NPC cities stood idle: once nothing was short of the reserve, workers were released and nothing
else gave them a job. Daniel: they should build roads and send people to explore, gain resource nodes
in a wider area and seem alive.

## Decisions

- **Spare hands' work, in order:** road crews, scouts, then work for surplus up to a cap per good.
- **Roads:** first to the city's own workplaces, then to its nearest Trade Org post and neighbour.
  They follow the way a resident walks, tile by tile, since straight lines can't get round a lake.
- **Scouts carry the news:** a city learns the nodes a scout saw only when they get home alive, out
  to a wider limit. It still simply knows the nodes in its old reach.
- **A Full city counts them as spare,** so cities go on founding daughters.

## Why

- Knowing nodes at once, or a reach that just grows, would be simpler, but news would travel with
  nobody carrying it, and nothing a Player did to a scout would matter (Everything is physical).
- Waiting for the roads before founding would slow how the world spreads, for little gain.
- Calling the Claude API for NPC decisions wouldn't fix this: a model can only pick among jobs a city
  has, and it had none. It was left out for now, for its running cost as well.

## Consequences

- Cities produce more than their reserve, so more goods reach the market. The cap keeps that bounded.
- Roads appear across the world that anyone can use, or cut.
- More walking and more pathfinding: a road's way is worked out once and kept as plain data.
