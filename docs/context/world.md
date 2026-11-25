# World

- **World:** one persistent world that keeps running while nobody is online.
- **Map:** a rectangle whose opposite sides join: walk off the east side and you come back in from
  the west, off the north and you come back from the south. The world has no edge and no centre.
  An unloaded resident walking once around it on flat land takes about **12 real hours**.
- **Game time:** 1 real second = 1 game minute, so 1 game day = 24 real minutes; 1 game week = 7
  game days; 1 game year = 420 game days = 1 real week. Walking once around the map takes about
  30 game days. Work is counted in game days (eating, production, building, skill, spoilage,
  breeding); social and political timers (memory, standing, persuasion, contracts, punishment,
  alliance delays) keep their real-time length, so they last more game days than before.
- **Tile:** one cell of the map, about 10 m across, with one terrain type. An unloaded resident
  walks one plains tile in about 7.5 seconds, so the map is 5,760 × 5,760 tiles. Every tile
  exists; two places are at most 2,880 tiles apart along each direction.
- **Terrain:** what a tile is made of. It sets how fast residents move across it and how much
  food they burn there (relative to plains). Agility softens the speed penalty, Endurance the
  food penalty.

  | Terrain  | Speed      | Food | Notes                                    |
  | -------- | ---------- | ---- | ---------------------------------------- |
  | Plains   | 100%       | 100% | Farmland                                 |
  | Forest   | ~70%       | 100% | Wood                                     |
  | Hills    | ~70%       | 130% | Stone, some ore                          |
  | Mountain | ~35%       | 200% | Ore-rich; no carriages except on a road  |
  | Lake     | impassable | —    | Small inland water                       |
  | Sea      | impassable | —    | A few large bodies of water              |
  | Road     | ~130%      | 100% | Built by Players on top of passable land |

- **Road:** built on a tile like a building (laid out by a resident there, then materials and
  work) on any passable land, and it may share a tile with a building, so roads can lead through
  gates. A road tile on Mountain takes the same materials but four times the work. On a road
  residents and carriages move at road speed whatever the terrain beneath, and eat as on Plains;
  a finished road on Mountain lets carriages and riders cross it like any road, so roads open
  mountain passes. Nobody owns a road; anyone can walk it or tear it down, except a road tile on
  Mountain while a carriage or a ridden horse stands on it, so nobody is stranded there.
  Residents build road along a line with the Build line task (Building); the line runs straight
  or diagonal between two tiles, each tile a Step on from the one before.
- **Step:** a move onto one of the eight tiles around, straight or diagonal. A diagonal step is
  √2 (about 1.41) times as far as a straight one, so it takes that much longer on the same
  ground. A diagonal step can't squeeze between two corners: it is only possible when both
  straight tiles beside it could be stepped onto as well, so no wall, gate in the way, Lake, Sea
  or (for a carriage) Mountain without a road may stand on either. Two wall tiles touching at a corner close
  the way like a straight stretch.
- No rivers. Boats and ships (Water) cross Lake and Sea; nobody walks on them.
- **The land** (settled with Daniel on 2026-11-14, Epics 100 to 102, ADR 0035): one **mainland**
  and, off its coasts, **islands**, with Sea all around. The mainland is joined: any mainland tile
  can be reached on foot, and by carriage, from any other. An island is reached only by vessel.
- **Region:** a part of the land of one kind, known for every land tile: a **heartland**, a
  **frontier** region or an island. Regions of the mainland are parted by Mountain ranges and by
  arms of the Sea, and joined only by a few **passes** (a gap in a range that a carriage can
  cross) and **land bridges** (a narrow neck of land between two arms of the Sea). Whoever holds
  a pass or a land bridge holds the way between two regions. Not the Region map, which shows
  territory.
- **Heartland:** a mainland region of good farmland and poor resource nodes, where Players start
  (Starting city). It has a trading post near its middle. No rule protects it: it is safe only in
  that it holds little worth taking, and the admin directive covers whoever farms new Players.
  Its Forest lies in wide patches, so where none lies near, a small **grove** of Forest grows on
  its Plains, a grove at most every few dozen tiles (balance numbers; decided while Daniel was
  away, Daniel to confirm): Forest is never far, and every starting site has its forest node a
  short walk away.
- **Frontier:** a mainland region beyond the passes and land bridges, with normal resource nodes,
  a few rich ones, and the rare goods (Coal, Gold ore). Nobody starts there.
- **Island:** land off the mainland, reached only by vessel, holding the richest nodes.
