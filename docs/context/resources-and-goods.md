# Resources and goods

- **Good:** any physical thing that can be carried, stored, traded or stolen. Every good has
  weight. PoC goods: Food, Wood, Stone, Iron ore, Iron, Gold ore, Coal, Steel, Coins. Goods are always
  somewhere: in a storage, carried by a resident or carriage, or in a pile.
- **Pile:** goods lying on the ground on one tile, for anyone to take.
- **Resource node:** a spot on the map that yields a good (forest, stone, iron ore, gold ore,
  coal). Produces nothing on its own; it needs a workplace built on it and residents working
  there. Nodes lie on terrain that fits them: forest nodes in Forest, stone in Hills, ore and coal
  in Hills and (more of it) Mountain.
- **Richness** (Epic 101): every resource node is **poor**, **normal** or **rich**, fixed when it
  comes into being. The workplace on it makes less or more per worker by its richness. Heartland
  nodes are poor; frontier nodes are normal, with a few rich ones at spots worth fighting over;
  island nodes are rich. A Player sees a node's richness on its tile card once the tile is
  explored, and scripts see it. Farms are on no node and yield the same everywhere.
- **Rare goods** (Epic 101): Gold ore and Coal have no nodes in a heartland, only in the frontier
  and on islands. A heartland realm gets Coins and Steel by trade, or by holding a node out there.
- **Coal:** a good mined at a mine on a coal node. A smelter turns Iron and Coal into **Steel**,
  and a smithy makes a steel Sword, Shield and Armour from Steel, each better than the iron one.
- **Running dry** (Epic 102): a normal or rich ore node (iron ore, gold ore, coal) holds a
  **stock**, and working it uses the stock up. Poor nodes, forest and stone never run dry. A node
  whose stock is gone is gone for good: the mine on it stays as a building and makes nothing,
  its workers stop working it, the log of each realm working it says so once, and no mine can be
  built there again. A Player who explored the tile keeps the node on their map until they see
  the tile again, as a building (Last seen). A new
  node of the same kind and richness then comes into being somewhere else in a region that fits,
  out of every Player's sight; nobody is told, so it has to be found. It comes into being in the
  same tick, on terrain that fits its kind and a free tile spaced from other nodes, in another
  region than the old one where one fits (a rich one on an island or near a contested frontier
  spot, a normal one in the frontier) and, where the map allows, on a tile no Player explored; a
  Player who explored that tile before sees no node there until they see the tile again. The
  nodes of each kind and richness stay as many as the world was made with: with no fitting tile
  anywhere (a tiny map) the node comes back where it was after a few game days. Whoever works a
  mine (their realm and its allies) sees how its vein stands in words (plenty, thinning, nearly
  gone), never as a number; others see nothing of it. The log of each realm working it says once
  when it turns to thinning and once at nearly gone. When the mine an NPC city, a trading post or
  the HQ works runs dry, its workers are free at the next planning pass, and its builders tear the
  dead mine down for its materials once they have nothing better to do. The good is short again,
  so the city opens a mine on the next fitting node it knows of within its reach (ADR 0029); with
  none known it buys the good or does without, and a node its scouts find later counts from then
  on. The HQ takes the next nearest node of the kind, however far.
- **Workplace:** a building where residents produce goods. Output depends on the workers'
  Strength and skill and is limited by the workplace's maximum number of workers. Working there
  teaches its skill. Its output is left in the pile on the workplace's tile, not in the
  workers' hands. Getting it to a storage takes carrying it there.
  **Workplace amounts:** a workplace's card tells its Player how much is being made there: for
  each worker of their realm working there, what they make and how much a game day at their
  Strength and skill, and the total of each good. It is the pace while they have what they need,
  not a count of what has been made. Other realms' workers aren't counted, as their stats aren't
  known.
  Kinds:
  - **Mine / Quarry / Lumber camp:** built on a resource node; makes what the node yields (a mine
    iron ore or gold ore). Lumber camps teach Woodcutting, quarries and mines Mining.
  - **Farm:** built on plains, produces Food and teaches Farming. Not tied to a node, but each
    farm has a cap. A farm belongs to the city of the resident who laid it out.
  - **Smelter / Mint:** a smelter turns ore into metal (Iron ore → Iron), or Iron and Coal into
    Steel, a mint Gold ore into Coins, at fixed conversion rates. Which of the two a smelter's
    worker makes is said with their Work, as at a smithy; told nothing, they make Iron. Anyone can build either. They have no storage: the ore
    they use is what their workers carry, then what lies in the pile on their tile; the Work
    default fetches more (Fetching inputs), and without any the workers stand idle. Both teach
    Smelting.
- **Carrying the output:** working a workplace includes getting its output home. Once the
  workplace's pile holds a full load, one of the residents working there, picked at random,
  takes a load (beside their own food; a farm keeps some Food for refills) to the Work default's
  `output` param, else its `storage`, else the nearest storage of their realm, stores it and comes
  back to work; only one carries at a time. With no storage in reach the pile just grows.
- **Fetching inputs:** at a smelter, mint or smithy whose pile and workers lack what it uses (ore,
  Steel's Iron and Coal, or a recipe's Iron and Wood), one of the residents working there, picked at random, fetches a
  load of it from the Work default's `input` param, else its `storage`, else the nearest storage
  of their realm holding it, puts it on the pile and goes back to work; only one fetches at a
  time, and not while someone carries the output. With none anywhere they stand idle, and their
  Doing line says what is missing ("Idle: no coal").
- **Crew food:** on the way back from storing a load, the carrier brings Food for the whole crew
  and puts it on the workplace's pile, where the workers take their meals (Refilling at a
  workplace). So a far-off crew keeps working while one of them walks, and nobody else goes
  home for Food. How much they bring is a setting of the Work default (`crewFood`); 0 brings
  none. A resident sent to a workplace sets out with Food for the walk there and the first days
  of work, not a fixed amount, so they last until the carrier's first round trip. An NPC
  city's builders of a site beyond its node reach from its storage set out with the same, and go back for
  more while they still have what the walk home eats (decided overnight, Daniel to confirm).
  So do its workers at a workplace beyond its node reach: they set out with that too, and go home
  for Food while they still have what the walk home eats, not once they have none (Daniel, #1379:
  Larkspur's quarry workers 270 tiles out set off home with nothing and went Down on the way).
- **Holding a workplace:** whoever physically works and guards a workplace gets its output.
  There is no ownership flag. Drive out the workers, move your own in, and it's yours.
- **Gathering** (Epic 114, settled with Daniel on 2026-11-19): a grown resident takes Wood or Food
  from a Forest tile they stand on, or Stone from a Hills tile, straight into their hands, with no
  resource node and no workplace. For each resident it goes faster than working a poor node and
  slower than working a normal one (a balance number). Strength, the good's skill (Woodcutting for
  Wood, Mining for Stone, Farming for Food) and Tools count as at a workplace, and gathering
  teaches that skill as working there does. Iron ore, Gold ore and Coal are never gathered. A tile
  under a building, a construction site or a resource node gives nothing; a road counts as a
  building (decided while Daniel was away, Daniel to confirm). A gatherer gathers until their
  hands are full or the patch is gone, and their order then says which.
- **Patch:** what a Forest or Hills tile still holds for gathering: about one resident's load (a
  balance number), on a Forest tile used up by Wood and Food alike, and the same for everyone who
  gathers there. A tile whose patch is gone is **picked over** and gives nothing; it grows back
  steadily over some game days (a balance number). A patch grows back only once nobody has
  gathered there for a while (a balance number, about a game day), so a tile being gathered runs
  out rather than growing about as fast as one gatherer takes from it (decided while Daniel was
  away, Daniel to confirm). So the land near a city empties and gatherers
  walk further out, while a workplace on a node never runs out. A Player sees on the tile card
  and on the map whether a tile in sight is picked over, and scripts see it.
- **Gather:** a task (default script "Gather") for a grown resident. Its params: `good` (Wood,
  Stone or Food), `storage` (where the load goes; unset, the nearest storage of their realm) and
  the usual food params (Getting food). They walk to the nearest tile that fits the good and
  isn't picked over, gather there until their hands are full or the patch is gone, go on to the
  next tile, and with a full load store it and come back. With no such tile within a set reach (a
  balance number) of where they started, they end and say why, first storing what they carry of
  it. "Nearest" counts from where they started, so they work outward from it; a tile out of
  sight counts as not picked over until they get there and see it (decided while Daniel was
  away, Daniel to confirm). Scripts have `gather(good)` for the
  tile they stand on (ADR 0002). Only Players' residents gather: NPC cities, trading posts and
  the HQ keep to their workplaces for now.
- **Tools** (Epic 97): a good a smithy makes from Iron and Wood. A resident carrying Tools works a
  share faster at a workplace or a construction site (also tearing down and repairing); without
  them they work at the plain pace, so nothing stops for want of Tools. They aren't equipped:
  carrying one set is enough, a second adds nothing, and nobody else sees them. Tools wear with
  each day's work and break (Wear). Iron only. An NPC city keeps a set for each of its workers and
  builders and a few spare in its reserve, and its workers fetch one from its storage. Only a city
  with a smithy of its own, finished or begun, keeps Tools in its reserve, so one without is never
  short of them. They are kept and never sold, but they never count as short: its spare hands forge
  them (Spare hands' work), first of all surplus work while it holds fewer than its reserve, from
  Iron and Wood above its reserve, and its smithy forges them only once its soldiers are armed. So
  a big city forging a set for every worker still counts as full, founds, lays roads and trains. A
  trading post's or the HQ's workers fetch theirs from its warehouse, only what it holds above its
  floor of Tools (all decided overnight, Daniel to confirm).
- **Spoilage:** Food slowly goes bad. Other goods don't (but see Wear and Decay).
- **Coins:** money, and just another good. Made from Gold ore at a **Mint**, which anyone can
  build. No special currency rules.
