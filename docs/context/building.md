# Building

- **Construction site:** a building that has been ordered but isn't finished yet. It becomes the
  building once its **materials** (the goods that kind of building needs) have been carried to
  the site and residents working there have put in enough **work**. More or stronger workers
  finish it sooner. Any adult resident can build; how fast depends on Strength and the
  Construction skill, which also covers tearing down. Materials delivered to a site are goods like any others and can be taken.
  Until it is finished, a site belongs to the realm whose resident laid it out, so that realm's
  scripts and params can pick it; finished, the building belongs where it does today.
  A resident has to be on the tile to lay out a site. Like a workplace, a site has no owner:
  whoever works on it holds it, and an unattended site can be finished by anyone.
- **Fetching materials:** building a site includes getting its materials there. While the site
  still lacks some, one of the residents building it, picked at random, fetches a load of what is
  missing from the nearest storage of their realm that holds it, delivers it to the site and goes
  back to work; only one fetches at a time. With no storage holding them, they just build.
- **Build line:** a task for building road or wall along a line (ADR 0018). Its line (road or
  wall, a start and an end tile the Player picks on the map) comes only from the order, like a
  haul's route: from the card, the group card or a queue step, and started without one it ends
  ("no line given"). The resident walks to the line themselves. Tiles that already have one, or
  can't take one, are skipped. **A crew on one line:** residents on the same line each take the
  nearest unfinished tile that no other of them has taken, so several tiles go up at once.
  **Materials:** what a builder carries goes in first; lacking some for their tile, they fetch
  from the `source` param, or else the nearest storage of their realm holding them, as much as
  they can carry for their tile and the next unbuilt ones, and top up their own food there. With
  none in any storage they lay out their tile's site and go on to the next; once every tile is
  laid out or built and there is still nothing to fetch, they end, saying why ("no stone in any
  storage"), and the sites stay for later. Its default script has Build's params (`source`,
  `foodAt`, `foodTake`). The plain road and wall line orders, built only from what the resident
  carries, stay in the game API for scripts.
- **Tearing down:** anyone with residents on the tile can tear down a building or construction
  site. It takes work, less than building; part of a building's materials (all of an unfinished
  site's) are left on the tile as goods, and the tile is free again. A road on Mountain waits
  while a carriage or ridden horse stands on it (Road). A horse left there unridden stays, and
  can't be ridden on bare Mountain.
- **Decay** (Epic 97): every finished building, wall, gate and road slowly loses **condition**,
  at a steady pace per game day of its own kind (roads and wooden walls fastest, stone slowest),
  whether used or not. Blows from attackers are apart from this (Walls in combat). Its condition
  reads in words: good, worn, nearly a ruin. Everyone's buildings decay, the Trade
  Organization's too, which repairs its own from its stock so they never fall while it stands.
  A city left alone for a real month is still there: its buildings may be worn, but none has
  fallen to ruin from decay alone (Daniel, 2026-11-17). That is about decay only: Food and
  defence while away are the Player's own setup (work scripts that give every resident access to
  Food, and the defence scripts), and the game adds no protection for absent Players beyond slow
  decay.
- **Repairing:** a resident at a worn building puts its condition back to good with a share of its
  materials (fetched like Fetching materials) and some work, less than building it. It is an
  order and a script call; under the Build default a builder with nothing to build repairs worn
  buildings in their city's area on their own, and further off it takes an order. An NPC city's
  builders repair its buildings, and its road crew its roads (NPC road).
- **Ruin:** a building nobody repaired. It still stands where it stood and blocks the way, but
  does nothing: a ruined wall tile is a gap, a house houses nobody, a workplace makes nothing, a
  storage takes nothing in. Goods in a ruined storage stay in it, but anyone at it can take them
  out, as from an unguarded outpost storage (theft for another organization). A ruin is rebuilt
  like a building, for less than a new one. Left for a long while more it **collapses**: it is
  gone, and part of its materials, with any goods still in it, lie on its tiles as a pile.
- **Footprint:** the square of tiles a building or construction site covers, the same for every
  building of a kind: Wall, Gate and Road 1×1; Tower, House, Storage, Smelter, Mint, Smithy, Mine,
  Quarry and Lumber camp 2×2; Town hall, Warehouse, Stable, Training ground and Haven 3×3; Farm 4×4. A site covers its
  building's footprint from the moment it is laid out. Footprints are never turned.
- **Where buildings go:** one building per tile: every tile of a footprint must be free and
  passable. Mines, quarries and lumber camps go with one tile of their footprint on a resource
  node of their kind; farms and stables wholly on Plains; havens on the shore (Haven); everything else on any passable terrain
  except Mountain. Only a node's workplace covers a node. Anyone can build anywhere else,
  including in another Organization's territory.
- **At a building:** standing on any tile of its footprint. Wherever a rule says "on a
  building's tile", it means at the building. Laying out a site takes a resident on one tile of
  the footprint it will cover. **Spreading over the footprint:** a resident sent to work, build or
  breed at a building (the Work, Build and Breeding defaults) walks to the footprint tile with
  the fewest of the crew standing on it, the nearest on ties, so a crew stands spread over the
  building rather than on one corner. Which tile they stand on changes nothing else.
- **A building's pile:** goods lying anywhere on a building's footprint are one pile, reached by
  anyone at the building: a workplace's output, a site's delivered materials, what a smelter
  uses. Elsewhere a pile is the goods on one tile.
