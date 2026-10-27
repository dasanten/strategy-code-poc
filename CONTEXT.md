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
  | Mountain | ~35%       | 200% | Ore-rich; walkers only, no carriages     |
  | Lake     | impassable | —    | Small inland water                       |
  | Sea      | impassable | —    | A few large bodies of water              |
  | Road     | ~130%      | 100% | Built by Players on top of passable land |

- **Road:** built on a tile like a building (laid out by a resident there, then materials and
  work) on any passable land except Mountain, and it may share a tile with a building, so roads
  can lead through gates. On a road residents and carriages move at road speed whatever the
  terrain beneath, and eat as on Plains. Nobody owns a road; anyone can walk it or tear it down.
  A resident can build road along a line from their tile to another, one tile after another; the
  line runs straight or diagonal, each tile a Step on from the one before.
- **Step:** a move onto one of the eight tiles around, straight or diagonal. A diagonal step is
  √2 (about 1.41) times as far as a straight one, so it takes that much longer on the same
  ground. A diagonal step can't squeeze between two corners: it is only possible when both
  straight tiles beside it could be stepped onto as well, so no wall, gate in the way, Lake, Sea
  or (for a carriage) Mountain may stand on either. Two wall tiles touching at a corner close
  the way like a straight stretch.
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
  Strength and skill and is limited by the workplace's maximum number of workers. Working there
  teaches its skill. Its output is left in the pile on the workplace's tile, not in the
  workers' hands. Getting it to a storage takes carrying it there.
  Kinds:
  - **Mine / Quarry / Lumber camp:** built on a resource node; makes what the node yields (a mine
    iron ore or gold ore). Lumber camps teach Woodcutting, quarries and mines Mining.
  - **Farm:** built on plains, produces Food and teaches Farming. Not tied to a node, but each
    farm has a cap. A farm belongs to the city of the resident who laid it out.
  - **Smelter / Mint:** a smelter turns ore into metal (Iron ore → Iron), a mint Gold ore into
    Coins, at fixed conversion rates. Anyone can build either. They have no storage: the ore
    they use is what their workers carry, then what lies in the pile on their tile; without it
    the workers stand idle. Both teach Smelting.
- **Carrying the output:** working a workplace includes getting its output home. Once the
  workplace's pile holds a full load, one of the residents working there, picked at random,
  takes a load (beside their own food; a farm keeps some Food for refills) to the nearest storage
  of their realm, stores it and comes back to work; only one carries at a time. With no storage
  in reach the pile just grows.
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
- **Fetching materials:** building a site includes getting its materials there. While the site
  still lacks some, one of the residents building it, picked at random, fetches a load of what is
  missing from the nearest storage of their realm that holds it, delivers it to the site and goes
  back to work; only one fetches at a time. With no storage holding them, they just build.
- **Tearing down:** anyone with residents on the tile can tear down a building or construction
  site. It takes work, less than building; part of a building's materials (all of an unfinished
  site's) are left on the tile as goods, and the tile is free again.
- **Footprint:** the square of tiles a building or construction site covers, the same for every
  building of a kind: Wall, Gate and Road 1×1; House, Storage, Smelter, Mint, Smithy, Mine,
  Quarry and Lumber camp 2×2; Town hall, Warehouse and Stable 3×3; Farm 4×4. A site covers its
  building's footprint from the moment it is laid out. Footprints are never turned.
- **Where buildings go:** one building per tile: every tile of a footprint must be free and
  passable. Mines, quarries and lumber camps go with one tile of their footprint on a resource
  node of their kind; farms and stables wholly on Plains; everything else on any passable terrain
  except Mountain. Only a node's workplace covers a node. Anyone can build anywhere else,
  including in another Organization's territory.
- **At a building:** standing on any tile of its footprint. Wherever a rule says "on a
  building's tile", it means at the building. Laying out a site takes a resident on one tile of
  the footprint it will cover.
- **A building's pile:** goods lying anywhere on a building's footprint are one pile, reached by
  anyone at the building: a workplace's output, a site's delivered materials, what a smelter
  uses. Elsewhere a pile is the goods on one tile.

## Trade Organization

- **Trade Organization:** one huge, non-player organization present from the start of the world.
  Buys and sells every good and carries transfers between Players for a fee. Its residents have
  normal stats; it is overpowered only through sheer size and stock.
- **Trade Org HQ:** the Trade Organization's home, the largest walled city on the map. Round,
  with its town hall in the middle and rings of walls around it. The **inner ring** holds its
  most valuable warehouses, above all its coins, and its soldiers keep everyone else out by
  force: possible to break into in theory, hopeless in practice. The **outer rings** are open to
  everyone, but the HQ closes its gates when too many armed outsiders want in: while more armed
  outsiders stand in its area or near an outer gate than a share of its soldiers at home, it
  closes its outer gates, and opens them once there are no more (its own mercenaries don't
  count). It keeps at least a multiple of the strongest Organization's armed residents as
  soldiers (an alliance's members counted together). When it grows too weak compared to the
  Players, so it can't arm that many from its adults and keep its workers, it grows like an NPC
  city (pairing, houses between its rings), and with no room left for a house it grows another
  ring: a round ring of wall a little further out, its gates in line with the others', keeping
  the old rings. The world starts out with it, as far from
  every city as the map allows and out of every Player's sight; starting cities keep well away
  from it. Its own workplaces stand on the nearest node of every kind, with a smelter and a mint
  between its rings, and the game runs it like an NPC city.
- **Warehouse:** a Trade Org building that keeps goods like a storage, a city building of the
  storage kind. The HQ keeps its coins in one and its other goods in another, inside the inner
  ring.
- **Trading post:** a small Trade Org city in a region, with a warehouse, so Players can trade
  nearby. Goods move between posts and HQ by caravan. It keeps soldiers like an NPC city, armed
  from its warehouse, so it is captured only by beating them; they fight attackers in its area,
  and also anyone there it knows stole from it (seen by one of its residents), which is no crime.
  A captured post joins the captor's realm like any city and leaves the Trade Organization: its
  warehouse becomes a storage with everything in it (no stock floor, no prices), its caravan
  route ends, and the deliveries and transfers waiting there go over to the HQ, which sends them
  out of its own stock.
- **Trading with the Trade Organization:** only in person, by a resident (or a carriage) on a
  warehouse's tile, at its HQ or a trading post. Selling hands the goods into the warehouse and
  takes its coins into the resident's hands, as far as they can carry; buying is the other way
  round. It happens at once. A carriage of theirs on the tile can trade its load instead of
  their hands. Each unit goes at the price its stock makes with that unit in it, so a big trade
  moves the price as it goes, and a trade is cut down to what the trader holds, what the
  warehouse holds and what fits. At the HQ the coins come from and go into its coin warehouse.
- **Warehouse prices:** each warehouse prices every good from its own stock, buying lower than it
  sells. Posts don't share prices, so carrying goods between regions can pay off. Anyone with a
  resident in sight of a warehouse sees its prices.
- **Trading with an NPC city:** only in person, by a resident (or a carriage) on the tile of an
  NPC city's storage, exactly like trading at a warehouse: it happens at once, goods and coins
  move between the trader's hands (or carriage) and the storage, and a trade is cut down to what
  the trader holds, what the storage holds and what fits. The city keeps a **reserve** of each
  good: Food for some game days for all its residents, and the materials its next house and some
  wall need. It sells only its surplus, what its storages hold above the reserve, and buys only
  goods it is short of, up to the reserve and with the coins in its storage; other goods it
  doesn't take. Its prices come from its own stock the way warehouse prices do (buying lower
  than it sells, each unit priced with its stock as it moves), then its standing toward the
  trader moves them like the city price: the better, the cheaper it sells and the more it pays.
  Anyone with a resident in sight of the storage sees its prices. A trade raises its standing
  toward the trader, like trade with the Trade Organization.
- **Stock floor:** the Trade Organization gets its stock physically (its own workplaces on every
  kind of resource, plus buying). When a warehouse runs low, it tops up to a minimum at the end of
  each game day. This is the one controlled exception to "everything is physical" (see ADR 0003).
- **Price anchor:** the Trade Organization buys low and sells high, so it is always there as a
  market of last resort. Its prices rise when its stock is low; Players usually get better deals
  trading with each other.
- **Caravan:** Trade Org carriages, driven by its own residents and always escorted by its
  soldiers. A route that is attacked more often gets more escorts. Caravans also carry the Trade
  Organization's own stock between its warehouses: each trading post has one caravan on a fixed
  route to the HQ, which at each end tops up the Food on board at the storage, unloads at the
  warehouse and loads what evens out the two warehouses' stock (half the difference of each good,
  not Food or coins). The escort walks along with the carriage, which waits for it; the crew
  refill from the carriage like an army.
- **Delivery:** a caravan brings goods bought from the Trade Organization to the storage of a
  city the buyer names, or picks up goods sold to it from the seller's city, for a fee. Anyone
  can instead carry the goods to or from the warehouse themselves, for free and at their own
  risk. It is ordered in person at the warehouse like any trade, to or from a city of the
  trader's own realm, at most one carriage load at a time. The fee grows with weight and
  distance. A delivery is paid at once, goods and fee; the warehouse keeps the goods for it, so
  nobody else can buy them, until a caravan standing at that warehouse loads them and brings them
  to the city's storage. A pick-up is paid when the caravan collects: it comes with coins, takes
  the goods from the storage (what is there, up to what was sold) and pays there at the
  warehouse's prices of that moment, less the fee. A caravan that can't get to the storage (closed
  gates, no way for a carriage) turns back and the next one tries again; one for a city no longer
  the realm's is cancelled.
- **Transfer:** the Trade Organization carries goods or coins from one realm to another as a
  courier: a caravan picks them up at a city of the sender (or they are handed in at a
  warehouse) and unloads them into the storage of a city of the recipient's realm. The sender
  picks that city; the recipient doesn't have to agree, the transfer simply arrives. At most one
  carriage load at a time, coins counting by their weight.
  - **Ordering it:** handed in at a warehouse, it is ordered there in person like a trade, and
    the goods and fee are paid at once. Picked up at one of the sender's cities, it can be
    ordered from anywhere, from the realm, with nobody at a warehouse.
  - **The fee:** a multiple of a delivery's fee for that weight over the caravan's whole way.
    A pick-up comes from the warehouse nearest the sender's city, to that city, straight on to
    the recipient's city and back to its warehouse. A hand-in goes from its warehouse to the
    recipient's city and back. A pick-up's caravan takes the fee in coins from the sender's
    storage along with the goods. When that storage doesn't hold the goods and the fee, it takes
    what is there, up to what was ordered, and a fee for what it takes.
  - **When it can't be finished:** a caravan that can't get to a storage (closed gates, no way
    for a carriage) turns back and the next one tries again. When the recipient's city is no
    longer that realm's, or the recipient's realm is gone, the transfer is cancelled: the caravan
    brings the goods back to the sender's city it took them from (a hand-in's to the sender's
    city nearest the warehouse). The fee is not refunded. Goods it can't bring back either stay
    with the Trade Organization.
- **Guaranteed carriage:** when a caravan is robbed, the Trade Organization sends the delivery or
  transfer again out of its own stock. That is part of why its prices and fees are high. A
  caravan is robbed when anyone not of the Trade Organization takes goods off its carriage; what
  was taken of a delivery goes again with the next caravan, and coins taken from a caravan on a
  pick-up are fetched again, so the seller is paid in full. Each route counts how often it was
  robbed.
- **Self-interest:** the Trade Organization defends only itself and whoever hires it. It is not a
  world police. It punishes anyone who steals from it, whoever they are.
- **Admin directive:** an admin orders the Trade Organization to weaken a Player or
  organization that is deliberately ruining the game for others (e.g. farming new Players). The
  game still forbids nothing; the Trade Organization acts because a healthy world is good for
  trade. It names a target (optionally with its alliance), a reason and **goals** (a city
  destroyed, a number or share of its soldiers killed, …); it has no time limit and ends when
  all goals are met or an admin lifts it. Until then the Trade Organization treats the target
  as one to punish. Every Player sees the target, the reason and the goals; only admins see who
  gave it and how far its goals have come. If the admin allows it, the target can **buy it off**
  by paying a set price in Coins at any Trade Org warehouse.
  - **Goals:** at least one. A **city destroyed** names a city of the target (or of its
    alliance, if named) and is met once that city is gone or belongs to none of them any more
    (captured, dissolved, self-managed); once met it stays met. **Soldiers killed** counts the
    soldiers of the target (and its alliance, as it stands) killed in combat since the directive
    was given, by anyone; a **share** is taken of the soldiers they had when it was given. When
    the last goal is met the directive ends and the target's realm log says so.

## Organizations and territory

- **Organization:** anything with its own interests and standing: a Realm, an NPC city, the
  Trade Organization.
- **Realm:** everything one Player controls through their Leader: cities, residents, workplaces,
  carriages. Breaks up into self-managed cities when the Leader dies.
- **Realm name:** what others know a realm by. The Player gives it when the realm is founded (their
  first spawn, and each respawn after a Leader death, since that founds a new realm) and it never
  changes; a Leader handover keeps it. Not the Leader's name. A realm from before realm names
  existed goes by its Leader's name until the Player names it, which they must do the first time
  they rename their Leader.
- **City:** a settlement with residents, buildings and usually a wall. Sizes range from
  **village** to large town. Every city has exactly one town hall; without it there is no city.
  Its shape is derived from its buildings, never drawn.
- **Renaming a city:** a new city gets a name from the game; the Player can rename any city of
  their realm, by hand or from a script: free, instant, from anywhere. Names need not be unique.
  NPC cities keep their names. A city that changes hands keeps its name until its new owner
  renames it. Others learn a new name only by sight (see Last seen).
- **Town hall:** the building that makes a city. Building one founds a new city, belonging to the
  realm whose residents finished it. Tearing it down dissolves the city: its buildings and
  residents stay where they are, and its residents are homeless.
- **City building:** a town hall, house, storage, wall or gate (and later ones of their kind);
  not farms, workplaces or stables. It is part of a city when it lies within a short distance of
  the city's town hall or of another building already part of that city, so a city grows outward
  in a chain. A building belongs to at most one city: the one whose town hall is nearer (the
  older city on a tie). A building cut off from the chain no longer belongs to the city.
- **City area:** the tiles right around a city's buildings. Building on its edge grows the city;
  tearing down shrinks it.
- **Wall / Gate:** buildings of one tile each, built on any passable tile except Mountain, in
  any shape: a closed ring, an inner ring or a single stretch. Nothing forces a closed ring.
  Walls count as city buildings, so they grow the area like houses do. A wall can be built along
  a line like a road, skipping tiles that have a wall or gate; a diagonal line closes the way,
  since two wall tiles touching at a corner do (see Step).
- **House:** a building in a city's area where a few residents live. A city's **free housing** is
  its houses' room minus its residents. Houses are the only housing for now; later buildings
  (a palace, a castle) may add room the same way.
- **Food surplus:** a city has one when its storage holds more Food than all its residents eat
  in a set number of game days. Food that residents carry doesn't count.
- **Storage:** a building in a city's area where its goods are kept.
- **At home:** a resident standing in the area of a city of their own realm; for a resident of an
  NPC city, in the area of that city.
- **NPC city:** a city run by the game. Self-managed cities are NPC cities. On its own it works
  its farms and workplaces and carries the output to its storage like anyone working a workplace
  (Carrying the output, to the nearest storage of that city; its workers take food from
  the storage before they set out and come home for more when they run low), pairs its adults,
  builds a house when it has a food surplus and no free housing, and puts more residents on farms (or
  builds a farm, when every farm is full) when Food runs short. When it needs a material it has no
  workplace for (Wood for walls and houses), it builds the matching workplace on the nearest
  fitting resource node and works it like its other workplaces, carrying the output to its
  storage. It never founds new cities: when it has no room left inside its wall it grows its area
  by building on the edge, puts up a new wall 8 tiles further out on every side, with the gate in
  the same place, and only once every tile of the new wall is finished tears down the old one.
  Its residents stand on its walls and pass its gates as a realm's do. It keeps some soldiers by
  its size, arms them from its smithy or by buying, fights attackers in its area and closes its
  gates when armed outsiders come near. A Player does the same by hand, if they want to. The world starts out with NPC villages
  and towns, on Plains, far from every starting city and from each other, and out of every
  Player's sight.
- **Integrating:** bringing a village or city into your realm, with its residents. Three ways:
  **conquer** it (capture by force), **buy** it, or **persuade** it (with high standing and
  respect it asks to join).
- **Buying a city:** an NPC city names a price in Coins from what it is worth (its residents and
  buildings). The buyer's residents carry the coins to its town hall; once they are all there,
  the city joins the buyer's realm with everything in it, and the coins are gone: they are used
  up by the deal, not kept by anyone. The better its standing toward the buyer, the lower the
  price; at very bad standing it won't sell to them at all.
- **Alliance:** a group of Organizations that agreed to join: Players' realms and NPC cities,
  never the Trade Organization. A realm is in at most one. Members share sight, pass each other's
  gates and stand on each other's walls. Members' armies by default don't attack each other, but
  a direct order can (that counts as a crime). Leaving, or being removed, takes effect after a
  delay. A realm whose Leader dies leaves at once.
- **Alliance leader:** the member who founded the alliance or was handed the role. Invites and
  removes members and commands the alliance army; nothing else. When they leave or die, the
  longest-standing member takes over.
- **NPC city in an alliance:** accepts an invitation when it holds every member in high standing
  and knows of no recent crime by them against it; leaves on its own when its standing toward
  any member falls too low. It keeps its own behaviour.
- **Alliance army:** soldiers and carriages members hand over to the alliance leader's command.
  They stay in their own realm but take orders only from the alliance leader. Their owner can
  recall them, which takes effect after a real hour; leaving the alliance recalls them.
- **Territory:** the area an Organization controls. Derived, not claimed: cities and guarded
  workplaces project control around them according to their size and garrison; where they
  overlap, the stronger wins. A workplace is **guarded** while an armed resident of whoever
  holds it stands on or next to it. Territory is shown only: no rule depends on it (for now).
- **Region map:** the map view colouring territory by owner. Alliance members show in the
  alliance's colour; details show which member holds each part. Territory is common knowledge:
  it shows live over all explored terrain.

## Sight

- **Sight:** what a Player currently sees: everything within sight range of any of their
  residents, or of any resident of an alliance they belong to. People, goods, buildings,
  horses, carriages and armies are only visible in sight, a Player's own included.
- **Seeing inside a storage:** what a storage, warehouse or stable holds is seen only by its own
  realm and its allies, and by anyone with a resident at it. From further off others see only the
  building (and a warehouse's or NPC city's prices, where those are shown).
  A carriage's load goes the same way, with a resident on its tile; from further off others see
  only how heavily it is loaded.
- **Seeing how someone fares:** a resident's or horse's hunger and health are seen only by its
  own realm and its allies. Others see that it is there.
- **Explored terrain:** tiles a Player has ever had in sight. Their terrain and resource nodes stay
  known, and so do the buildings on them (see Last seen); people, horses, carriages, armies and
  goods on them do not.
- **Last seen:** a building or construction site a Player has had in sight (their own included)
  stays on their map after it leaves their sight, as it was when they last saw it: where it
  stands, what it is, who held it and which city it belonged to (by that city's name then), along with whatever else they
  were allowed to see then (its prices, what it held). It is marked with when they saw it and
  always shown apart from what is in sight now. It changes only when it comes back into sight:
  once any tile it stood on is in sight again, the Player sees what is there now, and a building
  that is gone is forgotten. A city stays remembered while any of its buildings does. Things that
  move are never remembered. Like explored terrain, it grows only from sight: joining an alliance
  does not hand over what its members saw before, and leaving one keeps what was seen through it.

## Military

- **Soldier:** a resident carrying a weapon; Combat skill makes them better. Not a separate kind
  of being; soldiers eat, carry, age and die like everyone. **Armed** means carrying a weapon.
- **Weapons and armour:** goods like any other, with weight: **Spear** and **Sword** (attack),
  **Shield** and **Armour** (defence). A resident fights with the best weapon and the best
  protection they carry; there is nothing to equip, so heavy gear leaves less room for food.
  No ranged weapons for now.
- **Smithy:** a workplace that turns Iron and Wood into weapons and armour, at fixed recipes,
  from what its workers carry and the pile on its tile. Each worker's work order says which of
  them they make; they can switch. Teaches Smithing.
- **Army:** a named group of a realm's residents moving and fighting together under one order or
  script, at the pace of the slowest. A resident leaves it when given an order of their own.
  Needs a supply line or it starves far from home.
- **Supply line:** a carriage that follows an army is its supply wagon: army members refill from
  it like at home (Refilling from a carriage). A haul route can have an army as its second
  stop, so food keeps coming to wherever the army is. Cut the route and the army starves.
  At its army stop the carriage unloads nothing: it stays with the army, which refills from it,
  until the hauled goods are gone, then goes back for more. Nothing comes back from an army.
  A supply wagon's driver, not being of the army, eats only what they carry.
- **Combat:** resolved between residents in contact (the same or a neighbouring tile). Attack
  from Strength, weapon and Combat skill; Agility dodges, armour and shields take off damage.
  Fighting teaches Combat. An armed resident who is hit fights back; an unarmed one flees home.
  A city's soldiers fight attackers in its area on their own.
- **Walls in combat:** nobody walks through a wall. The city's own realm and its allies can stand on its walls
  and defend far better there. A **gate** lets the city's realm and its allies through always, everyone else
  only while it is open; the city's realm opens and closes it. A wall or gate can be **broken**
  (attacked until it falls, leaving part of its materials) or **climbed** (slow, and a climber
  can't defend themselves, so a defended wall is costly to climb).
- **Loot:** when a resident dies, everything they carried drops on the ground for anyone to take.
- **Capturing a city:** armed residents inside and no defender left fighting. The city and its
  residents join the captor's realm, loyal at once (for now).
- **Mercenary contract:** one Organization rents residents to another for coins over a period.
  One side offers (residents, game days, price per game week, a storage of the lender to pay
  into), the other accepts. The residents stay in the lender's realm but take only the hirer's
  orders; they always obey (for now). Each week is paid in advance: the hirer's residents put the
  coins into that storage with a pay order, or a Trade Org transfer brings them. A week left
  unpaid breaks the contract and costs standing; at the end, or when it breaks, they walk home.
- **Hiring from an NPC city:** an NPC city never offers on its own. Like the Trade Org army, a
  Player asks it for a number of its residents for some game days, paid into its storage. It
  accepts at once when the price per resident and week is at least its asking price (moved by
  its standing like its trade prices) and it can spare them, and declines otherwise. It lends
  only adults it can spare: it keeps its farmers to feed the city and a share of its adults at
  home to defend it, and lends idle adults first, then workers from its other workplaces. Its
  lent residents take weapons and armour from its storage along, as far as it has them. Paying
  and ending go as in any mercenary contract: each week in advance into that storage, an unpaid
  week breaks it and costs standing, a paid one raises it, and at the end they walk home.
- **Trade Org army:** a large army of normal residents of the Trade Org HQ, for hire like any
  mercenaries. The HQ builds it itself: it arms its own adults with weapons from its goods
  warehouse until it has its army's size, keeping enough of them at work. Its warehouses refill
  goods, never people, so lost soldiers come back only as new adults grow up, or as mercenaries.
  - **Hiring it:** in mercenary contracts the Trade Organization is a side like a realm. A Player
    asks for a number of its soldiers, paid into a Trade Org warehouse they name; it accepts at
    once when the price is at least its price per soldier and week and it can spare them, and
    declines otherwise. It never hires out so many that fewer than its guard stay at the HQ.
    Hired soldiers take the hirer's orders where they stand; getting them where they are needed
    is the hirer's business.
  - **Guarding the inner ring:** anyone not of the HQ on or inside its inner ring is an
    outsider: Players' residents, unarmed ones and its own hirers' included. The HQ's soldiers
    attack every outsider there until they are dead or gone; that is never a crime. The inner
    gates stay closed; the HQ's own residents pass them.
  - **Hiring mercenaries:** when its soldiers, the adults it could still arm and the mercenaries
    it has hired fall below a share of its army's size, it has lost too many: once a game day it
    asks Players' realms for their armed residents nearest the HQ (never a Leader), as many as
    it lacks, at its own price and length, paid into a storage of theirs. The Player accepts or
    declines like any offer. It pays each week in advance from its coin warehouse straight into
    that storage, like a transfer. Its mercenaries walk to the HQ and stand guard outside the
    inner gates, fighting whoever attacks the HQ; while in its area they eat from its storage.

## Crime and reputation

- **Crime:** theft, attack, killing or tearing down buildings against another organization.
- **Witness:** a resident who sees a crime (within sight range), or a victim who survives it. A
  crime only becomes known when a witness physically brings the news home. No witness, no
  consequences.
- **Standing:** how one organization regards another. Known crimes lower it; trade and kept
  contracts raise it; it slowly drifts back to neutral. Standing is per organization, so allies
  don't suffer for each other's crimes. A Player sees their standing toward others but it does
  nothing on its own; the game acts on it only for NPC cities and the Trade Organization.
- **NPC city reaction:** at low standing an NPC city won't trade with you or hire out to you
  (Trading with an NPC city, Hiring from an NPC city) and keeps its gates shut to your residents; the lower it is, the more it asks to be bought, and at
  very low standing it won't sell at all.
- **Persuading a city:** an NPC city that holds you in high standing and sees enough respect from
  you (more of your armed residents and walls in its sight than it has soldiers) asks to join
  your realm. You accept or decline.
- **Respect:** how dangerous a place looks to others, judged from the armed residents and walls
  they can see. Not stored; NPC cities and bandits avoid targets with high respect.
- **Trade Org reaction:** below one standing threshold it refuses to trade; below a lower one it
  sends its army to take back the value and punish: to the culprit's city nearest the crime, to
  carry home twice what it lost (coins first), fighting whoever resists. It never captures the
  city, and leaves once it has what it came for.

## Bandits

- **Bandit camp:** an Organization the game spawns in a remote spot out of every Player's sight,
  with a storage and a band of armed residents. Its standing toward everyone is fixed at hostile:
  it never trades, sells, hires out or joins an alliance, and attacking or robbing it is never a
  crime. Bandits and their camps are seen only in sight, like everything else.
- **Band:** a camp has a set size. It doesn't pair or farm; it eats from its loot and starves
  without it. Lost bandits are slowly replaced by drifters arriving, up to its size. When a camp
  is wiped out, a new one may later spawn elsewhere, out of every Player's sight.
- **Raiding:** a band goes after caravans and carriages on the move, lone residents far from home,
  and weak cities. It skips any target whose respect is higher than its own: more armed residents
  and walls in its sight than the band has bandits. At a city it fights whoever resists, carries
  off what it can from the storage (Food and Coins first) and goes home; it never captures a city.
  A band that is losing a fight flees home.
- **Bandit loot:** carried to the camp's storage. Bandits eat its Food and arm themselves from its
  weapons and armour. Whoever wipes out the camp can take what is left.
- **Wiping out a camp:** kill or drive off every bandit and tear down the camp.

## People

- **Player:** the human behind an account. Owns nothing physically; joins alliances. Not a thing
  in the world. Signs up with an invite code. _Avoid:_ user (in game rules), "the player" meaning
  the figure.
- **Admin:** an account with admin rights: creates invite codes, resets passwords and gives
  admin directives, in an admin panel apart from the game. Being an admin has nothing to do with
  the admin's own Player: it gives them no power in the world, and they play like anyone else.
  The one exception is knowledge: the admin panel shows the whole world (the **admin map**), so
  admins can watch over it. That knowledge is the admin's, never their Player's: the game screen
  and their scripts still see only their Player's sight, and nothing in the admin panel acts in
  the world except admin directives.
- **Wiki:** the game's rules and numbers for Players, readable by anyone, logged in or not, apart
  from the game. It states the rules in plain words with the game's current balance numbers and
  what follows from them (how many residents one farmer feeds, what a worker's day is worth), so
  Players can plan. It tells only what is true for everyone, never anything about the world's
  current state. _Avoid:_ help, manual, guide.
- **Leader:** the Player's figure in the world. A resident like any other (stats, food, can die),
  except that the Player controls their cities and residents only while their Leader lives.
  A Leader serves no one else: they are never hired out or handed over to an alliance army.
- **Leader handover:** the Player makes another resident their Leader while the old one lives,
  so the realm passes to a younger one. The new Leader is an adult of the realm who isn't serving
  anyone else (in a mercenary contract or the alliance army); both stand
  inside the same city of the realm when it happens, so a Leader out in the field comes home
  first. Only the Player chooses it (by hand or from a script); nothing else forces it. It is
  free and instant, also while the city is under attack. The old Leader stays on as
  an ordinary resident of the realm. Contracts, alliances, standing, scripts and the realm log
  belong to the Player and carry over; the realm log records the handover.
- **Leader death:** the Player instantly loses control of everything they held, wherever the
  Leader was. Their cities become self-managed and the realm ends: its alliance membership,
  contracts and standing end with it. The Player respawns as a new Leader with a fresh starting
  city on their next login, founding a new realm: they give its realm name and their new
  Leader's name (one from the game they may keep); the starting city gets one from the game.
  Their realm log tells them how their Leader died and what became of each city, and where it
  stands, so they can find it again on the map.
- **Self-managed city:** a city with no living Leader in charge. It runs on its own behaviour and
  can be traded with, contracted, conquered or integrated by anyone, including its former Player.
  When a Leader dies, each of their cities becomes its own self-managed city, with the residents
  who live there (those away walk home; homeless ones join the nearest) and the horses and
  carriages nearest it. Lent and hired soldiers walk home, and the realm leaves its alliance.
  Each such city starts out holding its former Player in good standing, which fades like any
  standing.

## Residents

- **Resident:** a person living in the world. Has stats, skills, health, hunger and an age.
  Needs food or dies; dies of old age eventually. Lives in one city, wherever they are standing.
  _Avoid:_ unit (old code term).
- **Renaming a resident:** the Player can rename any resident of their realm, their Leader
  included, by hand or from a script: free, instant, from anywhere. Names need not be unique.
  Renaming the Leader never renames the realm (see Realm name). The realm log keeps the names
  things had when they happened.
- **Stats:** Strength, Endurance, Agility, Intellect. Each has a **base value** and a
  **trained bonus**; the effective value is both together.
  - Strength: carry capacity, mining output, melee damage.
  - Endurance: health, how much food the resident needs, resistance to hard terrain.
  - Agility: walking speed, dodging.
  - Intellect: how fast the resident learns and trains.
- **Base value:** what a resident is born with. The only part children inherit.
- **Trained bonus:** what training adds on top of the base value. Capped relative to the base,
  so birth still matters. Never inherited.
- **Skill:** something learned by doing or training (Mining, Woodcutting, Smelting, Smithing, Construction, Farming, Combat, Driving, …). Starts at 0,
  never inherited. Not a stat. Work skills (Mining, Woodcutting, Smelting, Smithing, Farming)
  and Construction run from 0 to 100: each point adds 1 % to output or building work, so a
  skilled resident does at most twice what an unskilled one does; an average learner takes about
  a game year to get there.
- **Carry capacity:** the most weight a resident can carry, set by Strength. Everything has weight,
  including money, so nobody walks around with a fortune in their pocket.
- **Pairing:** two adult residents of the same city set to have children (a Player order, or on
  its own in NPC cities). Each pair has one child at most, so at most one per game year. The only
  way, besides integrating, that residents come into being. Once a game year has passed since
  they paired, and their city has free housing and a food surplus, one partner, chosen at random,
  starts **Carrying** the child; the other keeps working as before.
- **Carrying:** a partner carrying a child can't work for 10 game days (4 real hours); then the
  child is born and the pair ends. For another child the Player pairs them again (NPC cities do
  it on their own).
- **Child:** a resident born to a pair. Each base stat is the parents' average plus a small
  random amount. Born where a parent stands, into their city and realm. Grows up for a while
  before it can work: until grown, a child can walk and eats what they take at home (Refilling at
  home), but can't work, build, tear down, drive, pair, or pick up and put down goods.
- **Aging:** residents grow old; their stats decline late in life, and they die of old age at
  around 60 game years. Children age faster: each year of age up to 14 takes 10 game days
  (4 real hours), so a child is grown after about 140 game days (~56 real hours); from 14 on, a
  year of age is a game year.
- **Hunger:** each resident eats a fixed amount of Food per game day, more on hard terrain and
  less with high Endurance. An empty hunger meter costs health; without food a resident dies
  after about 5 game days (2 real hours). While the meter isn't empty, lost health slowly comes
  back.
- **Eating:** a resident eats only food they carry, everywhere, also at home. Nobody eats
  straight from a storage.
- **Own food:** the Food a resident keeps on them for their own meals, about four game days of
  eating. Putting goods away (storing, dropping, loading, delivering) leaves it in their hands
  unless the Player asks for an exact amount; NPC residents always keep it.
- **Refilling at home:** a resident in their own city's area who is running low on food takes a
  meal from the city's storage into their hands, without an order.
- **Refilling at a workplace:** a resident working at a workplace who is running low on food
  takes a meal the same way from Food lying on the workplace's tile, or else from a carriage
  standing there. Anywhere else (travelling, building) there is no refill: they need food on
  them or a delivery.
- **Refilling from a carriage:** a resident of an army running low on food takes a meal from a
  carriage of their own realm on or next to their tile, like refilling at home.

## Transport

- **Horse:** an animal that pulls a carriage. Eats Food and goes hungry like a resident: an empty
  hunger meter costs health, and a horse without food dies after about 5 game days. Bred at a
  stable, or bought from the Trade Organization.
- **Horses have no inventory:** a horse eats only what is in reach. At a stable it eats from the
  stable's storage; pulling a carriage, from the carriage's load; anywhere, from Food lying on the
  ground on its tile or right next to it, so Players can feed a horse by putting food down by it.
- **Stable:** a building on Plains where horses are kept. It has a storage for their Food, which
  residents fill and empty like any storage. Two fed horses of one realm at a stable breed a foal
  every so often, while the stable has room for another horse. No residents need to work there.
  Like a workplace, a stable has no owner: any horse standing in it eats from it.
- **Carriage:** a horse-drawn cart driven by a resident with Driving skill. Carries far more than
  any resident and is fast on plains and roads, slower in forest and hills, and cannot enter
  mountains.
- **Driving:** a grown-up resident on a carriage's tile drives it to another tile; the driver,
  the carriage and its horse move together. Driving teaches the Driving skill, and a more
  skilled driver goes faster. Players drive only their own carriages, with their own horses.
- **Hitched horse:** the one horse that pulls a carriage. A horse of the carriage's realm standing
  with it is hitched when the carriage is first driven, and stays hitched (for now). A carriage
  whose horse dies stands where it is until another horse is hitched.
- **Loading a carriage:** residents on a carriage's tile put goods on it and take goods off it
  like at a storage, up to what the carriage holds.
- **Haul route:** an order (as a script could do it) for a resident to drive a carriage between
  two stops again and again: they load the chosen goods at the first stop, drive them to the
  second, unload them, and come back for more, until stopped. Goods can go both ways: others
  chosen to come back are loaded at the second stop and unloaded at the first (e.g. ore home,
  Food out to the mine); no good goes both ways. A stop with a storage loads and
  unloads there, else on the ground; the driver loads by hand like anyone. Some Food stays on
  board for the horse, topped up at any stop that has Food. The carriage leaves the first stop
  once it has goods on board and nothing more to load; with no goods there yet it waits.

## Starting city

- **Starting city:** what a Leader spawns with, far from other Players: about 8 residents with
  random stats (one of them the Leader), a town hall, a ring of wooden wall with a gate, houses for everyone with a little room
  to spare, a storage with a small food stock, one farm outside the wall, a stable next to it
  with two horses and a little Food, and one carriage standing at the stable with one of the
  horses hitched to it. The residents start on the farm, working
  it, each with a little food on them.

## Control

- **Order:** an instruction a player gives through the UI (e.g. "work this mine"). It requests
  the same actions a script could. A one-off step (walk there, pick up, attack) is a single
  action; a **task** that repeats or decides (work, build, haul, tear down) runs its default
  script.
- **Script:** a program in the game's own language that requests actions automatically, every
  tick. A Player keeps a library of named scripts, with their history, also across Leader deaths.
  **Running a script** is an order for a resident or an army: the script runs once a tick for
  each of them, with its own memory, and can request only what that resident or army could. Any
  other order ends it. A script can hand over to a built-in order for a while and take control
  back. A saved change is picked up on the next tick: each save is a new version, and the
  newest one without syntax errors is the **active version** that runs. A version with syntax
  errors stays in the history but never becomes active; the Player can make an earlier version
  active again.
- **Script parameter:** a value the Player picks for whoever runs a script, declared by a
  `param name: type` line at the top of the script and read there as `params.name`; a `param`
  line anywhere else is a syntax error. A `building` param holds one of the realm's own buildings
  or construction sites; a `storage` param one of its storages, stables or carriages. The values
  are kept for each resident and each script: giving the task again keeps them, a param removed
  from the script is dropped, a new one starts unset. Unset, or once the one picked is gone (or no
  longer the realm's), it reads `null`. The resident card shows one field for each param of the
  script the resident runs, picked on the map and cleared with a button; picking one doesn't end
  the script. The Work default declares `storage` (where the output goes) and the Build default
  `source` (where materials come from, a carriage too), each falling back to the nearest storage
  while unset; a source picked that holds none of what the site lacks is left alone, and they
  just build.
- **Store:** a built-in order a script can hand over to: the resident walks to a storage,
  stable or carriage of their own (by default the nearest storage of their realm), puts down the
  chosen goods there (Food only beyond their own food, unless asked for exact units) and, at a
  storage with Food, tops up their own food. Then it is done. It ends early when there is no way
  there or the place is gone, and the script can read how it ended.
- **Fetch:** a built-in order a script can hand over to: the resident walks to a storage, stable
  or carriage of their own (by default the nearest storage or carriage of their realm holding the
  goods) and takes the chosen goods there, as much as is there and fits. Then it is done; it ends
  early like Store. Who stores or fetches, and when, stays in the script.
- **Default script:** the script behind a task the UI can give (working a workplace, building,
  hauling, …). The game ships one per task; giving a resident that task from the UI runs it.
  Each Player has their own version of every default script in their library, one per task,
  for all their residents doing that task; editing it changes how they all do it, with history
  like any script. **Resetting** it makes the game's current default its newest version again.
  Until the Player edits it, their version follows the game's default as the game improves it;
  once edited it stays theirs, and they are told when the game's default has changed since.
  Default scripts can't be renamed or deleted. NPC cities always run the game's defaults.
- **Memory:** the small store a running script or order keeps between ticks. Roles are just
  something a script keeps there. A script can read, never change, the memory of its own
  Player's residents and armies, so residents doing the same task can agree on who does what;
  other Players' memory stays hidden.
- **Step budget:** how much work a script may do each tick, for each resident or army and for a
  whole realm. Out of budget, the script stops for that tick; what it already requested still
  counts. Default scripts count like any other. NPC cities have no realm budget, only the one
  for each resident. A script sees only what its Player sees: their sight, explored terrain and
  what they last saw (Last seen), told apart from what is in sight now.
- **Script view:** what a script gets of each kind of thing (a resident, a building, a city, …):
  a fixed set of fields, the same for every Player and listed in the Wiki. A field the Player
  isn't allowed to see is always there and `null`, never missing. A script sees no field beyond
  these. The game may add fields at any time; renaming or removing one tells each Player whose
  scripts read it in their realm log, naming the field and the scripts.
- **Action:** a request (move, pick up, attack, …) that the world resolves at the end of a tick.
  The world only checks whether it's physically possible.
- **Tick:** one step of the world, one per second.
- **Realm log:** what happened in a Player's realm (residents going hungry, deaths, Food
  spoiling), shown only to that Player, also what happened while they were offline.
