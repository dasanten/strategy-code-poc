# Glossary

The shared language of the game. Domain terms only — no implementation details.

## Core rule

- **Everything is physical:** goods, money and people exist at a place in the world and only
  change place by being carried there. Nothing teleports. Whatever isn't protected can be taken.

## World

- **World:** one persistent world that keeps running while nobody is online.
- **Map:** a rectangle whose opposite sides join: walk off the east side and you come back in from
  the west, off the north and you come back from the south. The world has no edge and no centre.
  An unloaded resident walking once around it on flat land takes about **12 real hours**.
- **Game time:** 1 game day = 1 real hour; 1 game year = 1 real day. Crossing the map takes about
  12 game days.
- **Tile:** one cell of the map, about 40 m across, with one terrain type. An unloaded resident
  walks one plains tile in about 30 seconds, so the map is 1,440 × 1,440 tiles. A building fills
  one tile. Every tile exists; two places are at most 720 tiles apart along each direction.
- **Terrain:** what a tile is made of. It sets how fast residents move across it and how much
  food they burn there (relative to plains). Agility softens the speed penalty, Endurance the
  food penalty.

  | Terrain  | Speed      | Food | Notes                                    |
  | -------- | ---------- | ---- | ---------------------------------------- |
  | Plains   | 100%       | 100% | Farmland                                 |
  | Forest   | ~70%       | 100% | Wood                                     |
  | Hills    | ~70%       | 130% | Stone, some ore                          |
  | Mountain | ~35%       | 200% | Ore-rich; walkers only, no carriages     |
  | Lake     | impassable | —    | Small inland water                       |
  | Sea      | impassable | —    | A few large bodies of water              |
  | Road     | ~130%      | 100% | Built by Players on top of passable land |

- No rivers and no water vehicles (for now), so all land is joined: any tile can be reached on
  foot from any other, if only the long way round.

## Resources and goods

- **Good:** any physical thing that can be carried, stored, traded or stolen. Every good has
  weight. PoC goods: Food, Wood, Stone, Iron ore, Iron, Gold ore, Coins. Goods are always
  somewhere: in a storage, carried by a resident or carriage, or in a pile.
- **Pile:** goods lying on the ground on one tile, for anyone to take.
- **Resource node:** a spot on the map that never runs out (forest, stone, iron ore, gold ore).
  Produces nothing on its own; it needs a workplace built on it and residents working there.
  Nodes lie on terrain that fits them: forest nodes in Forest, stone in Hills, ore in Hills and
  (more of it) Mountain.
- **Workplace:** a building where residents produce goods. Output depends on the workers'
  Strength and skill and is limited by the workplace's maximum number of workers. Kinds:
  - **Mine / Quarry / Lumber camp:** built on a resource node.
  - **Farm:** built on plains, produces Food. Not tied to a node, but each farm has a cap.
  - **Smelter:** turns ore into metal (Iron ore → Iron).
- **Holding a workplace:** whoever physically works and guards a workplace gets its output.
  There is no ownership flag. Drive out the workers, move your own in, and it's yours.
- **Spoilage:** Food slowly goes bad. Other goods don't.
- **Coins:** money, and just another good. Made from Gold ore at a **Mint**, which anyone can
  build. No special currency rules.

## Building

- **Construction site:** a building that has been ordered but isn't finished yet. It becomes the
  building once its **materials** (the goods that kind of building needs) have been carried to
  the site and residents working there have put in enough **work**. More or stronger workers
  finish it sooner. Any adult resident can build; how fast depends on Strength and the
  Construction skill, which also covers tearing down. Materials delivered to a site are goods like any others and can be taken.
  A resident has to be on the tile to lay out a site. Like a workplace, a site has no owner:
  whoever works on it holds it, and an unattended site can be finished by anyone.
- **Tearing down:** anyone with residents on the tile can tear down a building or construction
  site. It takes work, less than building; part of a building's materials (all of an unfinished
  site's) are left on the tile as goods, and the tile is free again.
- **Where buildings go:** one building per tile, on passable terrain only. Mines, quarries and
  lumber camps go on a resource node of their kind; farms and stables on Plains; everything else
  on any passable terrain except Mountain. Anyone can build anywhere else, including in another
  Organization's territory.

## Trade Organization

- **Trade Organization:** one huge, non-player organization present from the start of the world.
  Buys and sells every good and carries transfers between Players for a fee. Its residents have
  normal stats; it is overpowered only through sheer size and stock.
- **Trade Org HQ:** the Trade Organization's home, the largest walled city on the map.
- **Trading post:** a Trade Org warehouse in a region, so Players can trade nearby. Goods move
  between posts and HQ by caravan.
- **Stock floor:** the Trade Organization gets its stock physically (its own workplaces on every
  kind of resource, plus buying). When a warehouse runs low, it tops up to a minimum. This is the
  one controlled exception to "everything is physical" (see ADR 0003).
- **Price anchor:** the Trade Organization buys low and sells high, so it is always there as a
  market of last resort. Its prices rise when its stock is low; Players usually get better deals
  trading with each other.
- **Transfer:** the Trade Organization physically carries goods or coins from one place to another
  for a fee. The caravan takes time and can be robbed.
- **Self-interest:** the Trade Organization defends only itself and whoever hires it. It is not a
  world police. It punishes anyone who steals from it, whoever they are.
- **Admin directive** _(future)_: an admin orders the Trade Organization to weaken a Player or
  organization that is deliberately ruining the game for others (e.g. farming new Players). The
  game still forbids nothing; the Trade Organization acts because a healthy world is good for
  trade.

## Organizations and territory

- **Organization:** anything with its own interests and standing: a Realm, an NPC city, the
  Trade Organization.
- **Realm:** everything one Player controls through their Leader: cities, residents, workplaces,
  carriages. Breaks up into self-managed cities when the Leader dies.
- **City:** a settlement with residents, buildings and usually a wall. Sizes range from
  **village** to large town. On the map it is a square of tiles; its **wall** is the ring of
  tiles along the square's edge, with one **gate**. Buildings inside the wall take one tile each;
  farms and workplaces may lie outside.
- **House:** a building inside a city where a few residents live. A city's **free housing** is
  its houses' room minus its residents.
- **Storage:** a building inside a city where its goods are kept.
- **At home:** a resident standing inside the walls of a city of their own realm.
- **NPC city:** a city run by the game. Self-managed cities are NPC cities.
- **Integrating:** bringing a village or city into your realm, with its residents. Three ways:
  **conquer** it (capture by force), **buy** it (physically deliver the agreed coins and goods),
  or **persuade** it (with high standing and respect it asks to join).
- NPC cities grow slowly on their own through pairing.
- **Alliance:** a group of Organizations that agreed to join. Members' armies by default don't
  attack each other, but a direct order can (that counts as a crime). Leaving takes effect after
  a delay.
- **Territory:** the area an Organization controls. Derived, not claimed: cities and guarded
  workplaces project control around them according to their size and garrison; where they
  overlap, the stronger wins.
- **Region map:** the map view colouring territory by owner. Alliance members show in the
  alliance's colour; details show which member holds each part. Territory is common knowledge:
  it shows live over all explored terrain.

## Sight

- **Sight:** what a Player currently sees: everything within sight range of any of their
  residents, or of any resident of an alliance they belong to. People, goods, buildings,
  horses, carriages and armies are only visible in sight, a Player's own included.
- **Explored terrain:** tiles a Player has ever had in sight. Their terrain and resource nodes stay
  known; what is on them (people, goods, buildings) does not.

## Military

- **Soldier:** a resident with a weapon and Combat skill. Not a separate kind of being; soldiers
  eat, carry, age and die like everyone.
- **Army:** residents moving and fighting together under one order or script. Needs a supply line
  or it starves far from home.
- **Combat:** resolved between residents in contact. Attack from Strength, weapon and Combat
  skill; defence from Agility and armour. Walls must be broken or climbed and favour defenders.
- **Loot:** when a resident dies, everything they carried drops on the ground for anyone to take.
- **Capturing a city:** armed residents inside and no defender left fighting. The city and its
  residents join the captor's realm, loyal at once (for now).
- **Mercenary contract:** one Organization rents residents to another for coins over a period.
  They walk to the hirer and take its orders; they always obey (for now). Not paying breaks the
  contract and costs standing.
- **Trade Org army:** a large army of normal residents, for hire like any mercenaries. When it has
  lost too many, it hires mercenaries itself. Its warehouses refill goods, never people.

## Crime and reputation

- **Crime:** theft, attack, killing or tearing down buildings against another organization.
- **Witness:** a resident who sees a crime (within sight range), or a victim who survives it. A
  crime only becomes known when a witness physically brings the news home. No witness, no
  consequences.
- **Standing:** how one organization regards another. Known crimes lower it; trade and kept
  contracts raise it; it slowly drifts back to neutral. Standing is per organization, so allies
  don't suffer for each other's crimes.
- **Respect:** how dangerous a place looks to others, judged from the armed residents and walls
  they can see. Not stored; NPC cities and bandits avoid targets with high respect.
- **Trade Org reaction:** below one standing threshold it refuses to trade; below a lower one it
  sends its army to take back the value and punish.

## People

- **Player:** the human behind an account. Owns nothing physically; joins alliances. Not a thing
  in the world. Signs up with an invite code. _Avoid:_ user (in game rules), "the player" meaning
  the figure.
- **Admin:** a Player with admin rights: creates invite codes, resets passwords and (future) gives
  admin directives. Can play like anyone else.
- **Leader:** the Player's figure in the world. A resident like any other (stats, food, can die),
  except that the Player controls their cities and residents only while their Leader lives.
- **Leader death:** the Player instantly loses control of everything they held, wherever the
  Leader was. Their cities become self-managed. The Player respawns as a new Leader with a fresh
  starting city on their next login.
- **Self-managed city:** a city with no living Leader in charge. It runs on its own behaviour and
  can be traded with, contracted, conquered or integrated by anyone, including its former Player.

## Residents

- **Resident:** a person living in the world. Has stats, skills, health, hunger and an age.
  Needs food or dies; dies of old age eventually. _Avoid:_ unit (old code term).
- **Stats:** Strength, Endurance, Agility, Intellect. Each has a **base value** and a
  **trained bonus**; the effective value is both together.
  - Strength: carry capacity, mining output, melee damage.
  - Endurance: health, how much food the resident needs, resistance to hard terrain.
  - Agility: walking speed, dodging.
  - Intellect: how fast the resident learns and trains.
- **Base value:** what a resident is born with. The only part children inherit.
- **Trained bonus:** what training adds on top of the base value. Capped relative to the base,
  so birth still matters. Never inherited.
- **Skill:** something learned by doing or training (Mining, Construction, Combat, Driving, …). Starts at 0,
  never inherited. Not a stat.
- **Carry capacity:** the most weight a resident can carry, set by Strength. Everything has weight,
  including money, so nobody walks around with a fortune in their pocket.
- **Pairing:** two adult residents of the same city set to have children (a Player order, or on
  its own in NPC cities). A birth needs free housing and a food surplus; each pair has at most one
  child per game year. The only way, besides integrating, that residents come into being.
- **Child:** a resident born to a pair. Each base stat is the parents' average plus a small
  random amount. Grows up for a while before it can work.
- **Aging:** residents grow old; their stats decline late in life, and they die of old age at
  around 60 game years. Children are grown after about 14 game years.
- **Hunger:** each resident eats a fixed amount of Food per game day, more on hard terrain and
  less with high Endurance. An empty hunger meter costs health; without food a resident dies
  after about 2 game days. While the meter isn't empty, lost health slowly comes back.
- **Eating:** a resident eats from what they carry, or from their city's storage while at home.
  Away from home they need food on them or a delivery.

## Transport

- **Horse:** an animal that pulls a carriage. Eats Food. Bred at a **stable** on plains, or bought
  from the Trade Organization.
- **Carriage:** a horse-drawn cart driven by a resident with Driving skill. Carries far more than
  any resident and is fast on plains and roads, slower in forest and hills, and cannot enter
  mountains.

## Starting city

- **Starting city:** what a Leader spawns with, far from other Players: about 8 residents with
  random stats (one of them the Leader), a wooden wall, houses for everyone with a little room
  to spare, a storage with a small food stock, one farm outside the wall, one horse and one
  carriage.

## Control

- **Order:** an instruction a player gives through the UI (e.g. "work this mine"). It requests
  the same actions a script could.
- **Script:** a program in the game's own language that requests actions automatically, every
  tick.
- **Action:** a request (move, pick up, attack, …) that the world resolves at the end of a tick.
  The world only checks whether it's physically possible.
- **Tick:** one step of the world, one per second.
