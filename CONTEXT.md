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
  - **Smelter / Mint:** a smelter turns ore into metal (Iron ore → Iron), a mint Gold ore into
    Coins, at fixed conversion rates. Anyone can build either. They have no storage: the ore
    they use is what their workers carry, then what lies in the pile on their tile; the Work
    default fetches more (Fetching inputs), and without any the workers stand idle. Both teach
    Smelting.
- **Carrying the output:** working a workplace includes getting its output home. Once the
  workplace's pile holds a full load, one of the residents working there, picked at random,
  takes a load (beside their own food; a farm keeps some Food for refills) to the Work default's
  `output` param, else its `storage`, else the nearest storage of their realm, stores it and comes
  back to work; only one carries at a time. With no storage in reach the pile just grows.
- **Fetching inputs:** at a smelter, mint or smithy whose pile and workers lack what it uses (ore,
  or a recipe's Iron and Wood), one of the residents working there, picked at random, fetches a
  load of it from the Work default's `input` param, else its `storage`, else the nearest storage
  of their realm holding it, puts it on the pile and goes back to work; only one fetches at a
  time, and not while someone carries the output. With none anywhere they stand idle, as before.
- **Crew food:** on the way back from storing a load, the carrier brings Food for the whole crew
  and puts it on the workplace's pile, where the workers take their meals (Refilling at a
  workplace). So a far-off crew keeps working while one of them walks, and nobody else goes
  home for Food. How much they bring is a setting of the Work default (`crewFood`); 0 brings
  none. A resident sent to a workplace sets out with Food for the walk there and the first days
  of work, not a fixed amount, so they last until the carrier's first round trip.
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
- **Footprint:** the square of tiles a building or construction site covers, the same for every
  building of a kind: Wall, Gate and Road 1×1; House, Storage, Smelter, Mint, Smithy, Mine,
  Quarry and Lumber camp 2×2; Town hall, Warehouse, Stable and Training ground 3×3; Farm 4×4. A site covers its
  building's footprint from the moment it is laid out. Footprints are never turned.
- **Where buildings go:** one building per tile: every tile of a footprint must be free and
  passable. Mines, quarries and lumber camps go with one tile of their footprint on a resource
  node of their kind; farms and stables wholly on Plains; everything else on any passable terrain
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
  between its rings, and the game runs it like an NPC city: its warehouses' stock floor is its
  reserve, and its spare hands work and build the chain for whatever is short of it (NPC city),
  so less of its stock comes from the floor. It never founds cities; its caravans and wandering
  traders carry its goods.
- **Warehouse:** a Trade Org building that keeps goods like a storage, a city building of the
  storage kind. The HQ keeps its coins in one and its other goods in another, inside the inner
  ring.
- **Trading post:** a small Trade Org city in a region, with a warehouse, so Players can trade
  nearby. Goods move between posts and HQ by caravan. Its few spare hands work and build the
  chain for what is short of its warehouse's floor, like the HQ, but it never grows in people,
  founds nothing and sends no trader of its own. Nothing tops up its warehouse (Stock floor). It keeps soldiers like an NPC city, armed
  from its warehouse, so its town hall is occupied only by beating them; they fight attackers in its area,
  and also anyone there it knows stole from it (seen by one of its residents), which is no crime.
  A captured post joins the captor's realm like any city and leaves the Trade Organization: its
  warehouse becomes a storage with everything in it (no stock floor, no prices), its caravan
  route ends, and the deliveries and transfers waiting there go over to the HQ, which sends them
  out of its own stock.
- **Fall of the HQ:** the HQ is captured like any city, which is hopeless in practice but not
  forbidden. It joins the captor's realm and leaves the Trade Organization for good. Nothing ever
  takes its place and it never comes back, whoever holds the city later.
  - **What the captor gets:** the city with its people, wherever they stand, its walls and gates,
    and its warehouses as storages with everything in them, its coins included (no stock floor,
    no prices). Caravans and wandering traders end at once: their crew join the captor where they
    stand, each carriage, horse and load going with them.
  - **What lives on:** the Trade Organization lives on in its trading posts, which keep their
    warehouses, prices, stock floor and soldiers and go on trading in person. When the last post
    falls too it is gone, and standing toward it is forgotten.
  - **What is lost:** whatever only the HQ gave it. No caravans run, so deliveries and transfers
    still open are cancelled with a line in the realm's log and nothing refunded (goods at the HQ
    are the captor's, goods at a post stay in its warehouse, goods on a carriage go with it), and
    posts take no new ones. It has no army: its contracts end at once, without refund or loss of
    standing (soldiers a Player hired are the captor's where they stand, Players' mercenaries
    guarding the HQ walk home), punishments and debts end, and nobody can hire from it. Admin directives
    stay in force and can still be given and bought off at a post, but it sends nobody out for
    them.
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
  the trader holds, what the storage holds and what fits. It sells only its surplus, what its
  storages hold above its reserve (NPC reserve), and buys only goods it is short of, up to the
  reserve and with the coins in its storage; other goods it doesn't take. Its prices come from
  its own stock the way warehouse prices do (buying lower
  than it sells, each unit priced with its stock as it moves), then its standing toward the
  trader moves them like the city price: the better, the cheaper it sells and the more it pays.
  Anyone with a resident in sight of the storage sees its prices. A trade raises its standing
  toward the trader, like trade with the Trade Organization.
- **Swap:** goods for goods, in person at a warehouse or an NPC city's storage, with no Coins
  needed in hand. It is a sale and a purchase at once, each unit priced as those trades do, so the
  place's prices give the rate: the trader names what they want and how much, and hands over enough
  of the good they give to pay for it, rounded up. What is over comes back in Coins as far as
  the place holds them. It is cut down like any trade, and an NPC city swaps only its surplus for
  what it is short of. The Trade section lists an NPC city's **rates** without being asked: each
  good it is short of against each it has spare, worked out from its prices, so nothing new is kept
  and the city plans nothing for them.
- **Offer:** what a Player posts at a storage of their realm: "gives 10 Wood, wants 5 Stone", either
  side may be Coins, as many times over as the goods are there. The goods stay in the storage but
  set aside: workers, builders, Fetch and refills leave them alone, while a thief or raider can
  take them like any others, cutting the offer down. Anyone in sight sees it and its rate. A
  resident or carriage on the storage's tile accepts it, as many times as they can pay and carry;
  it happens at once, whether or not the Player is online, and raises standing like a trade. It
  ends when it is used up, when the Player takes it down, or when the storage is torn down or no
  longer the realm's (the goods are then ordinary goods of that storage). Scripts can post and accept
  offers.
- **NPC cities at an offer:** an NPC city sends its trader to a Player's offer within a set reach
  when the offer gives what it is short of and wants what it has spare (or Coins), at a rate at
  least as good as its own prices. The Trade Organization never accepts offers.
- **Direct offer:** an offer sent to one named realm, who sees it at once wherever they are and
  accepts or declines it within a set time. The sender picks how the goods change hands: **in
  person**, an offer at a storage of the sender's that only that realm can accept; or **carried**,
  where on accepting the Trade Organization carries both sides' goods as two Transfers, its fee
  paid by the sender or split, as the sender picks (offered only while the HQ stands, and each side's
  goods are taken as a pick-up takes them). A storage's goods are set aside only for the in-person
  way. Carried, the sender names both cities when sending, as for a Transfer, and can only name a
  city whose storage they see, so the fee shown is exact; the other side only accepts or declines,
  from anywhere. It is taken whole on accepting, each side's goods within one carriage load, and
  changes no standing. Split, each side pays half of both fees; paid by the sender, the sender pays
  both. Each caravan takes the share of the side it picks up from as it collects, and the other
  side's from their storage as it unloads there. A storage short of coins on unloading gives what it
  has, the goods stay delivered and the Trade Organization bears the loss. A Player can send one to any realm they know of: one they see residents of, an ally, one whose
  city they have seen (Last seen), one with a standing toward them or they toward it, or their side
  in a contract or Direct offer. Both sides see it in their Direct offers drawer until it ends, and a
  notice tells the one it is sent to, with the place. In person, it is otherwise an offer like any
  other: anyone in sight of the storage sees it and that it is for another realm, and the sender can
  take it down. Declined, lapsed or taken down, its goods are ordinary again and both sides are told;
  it lapses too when the realm it was sent to is gone. A realm can have only so many standing to one
  realm.
- **Trade section:** where a city's panel shows trading, for each of its warehouses or storages
  in sight, from the Player's side: what they **can buy** there and what they **can sell**, with
  how many units and the price (an NPC city lists only its surplus and what it is short of, and
  says it takes nothing else). With nobody of theirs there, it offers to **send** one of their
  residents (nearest first, with what they carry) or carriages: a walk order to the tile, then
  shown on the way. Once one is there, it shows what the trader carries and room left, and a
  trade that won't go says why (no coins in hand, no room, none in stock, not wanted). Delivery
  and Transfer each have a heading and a line saying what they do, with the fee before ordering,
  and the section links to the Wiki's "How to trade". The tile card of a warehouse or an NPC
  city's storage has **Trade here**, which opens it. Only the UI: the trades are those above.
- **Stock floor:** the Trade Organization gets its stock physically (its own workplaces on every
  kind of resource, plus buying). When a warehouse of the HQ runs low, it tops up to a minimum at
  the end of each game day. This is the one controlled exception to "everything is physical" (ADR
  0003). A trading post's warehouse has no such top-up (ADR 0023): its floor only says what its
  spare hands, caravan and wandering traders go for, and what it holds came by them. A post can
  run dry, and a raid can empty a region's market.
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
- **Caravan crew lost:** a caravan outlives its crew. When its driver dies, a surviving escort
  takes over driving. With no crew left, its carriage stands where it is and the HQ sends a new
  driver on foot, from the same adults it makes up escorts from, once it has one free. A caravan's
  carriage counts as driven or guarded only while its driver or an armed escort is up and near it,
  so one still walking out doesn't stop a theft. Once stolen (Guaranteed carriage), the same
  caravan gets a new carriage and horse at the HQ, and any surviving crew walk back to it.
- **Wandering trader:** a Trade Org carriage with a driver and a small escort, sent from the HQ on
  a fixed loop of trading posts, apart from the caravans, so posts can hold goods they don't
  produce. At each post it evens out its load with the warehouse, every good including Food and
  Coins: it leaves what the post has less of and takes what it has more of, as far as the carriage
  holds. Crew, escort, Food on board and a lost carriage go as for a caravan (Caravan crew lost);
  taking goods off it or stealing it is a theft like any against the Trade Organization, but it
  owes nobody a delivery, so nothing is sent again. How many there are is a balance number.
- **Trader stop:** on its way a wandering trader stops for a while at each NPC or Player city
  within a set reach of its route, beside the city's town hall. Anyone with a resident or carriage
  on its tile can trade with it like at a warehouse: it prices each good from what it carries,
  buying lower than it sells. An NPC city treats it as its visiting trader: it buys what it is
  short of and sells its surplus. A Player's realm gets a notice with the place while one stands
  at one of their cities, and anyone in sight sees its prices.
- **Lost post found out:** a captured post leaves the Trade Organization at once as before, but it
  learns who took it only by news: when a wandering trader reaches the post, or a surviving
  witness gets away, and the news is brought to another post or the HQ. A trader drops a lost post
  from its loop and carries the news on. From then on the capture is a crime it knows of (Trade Org
  debt); if nobody ever tells it, it never reacts.
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
  robbed. Stealing the carriage itself (Stealing a carriage or horse) robs the caravan the same
  way, its whole load counting as taken, and the Trade Organization replaces the carriage and
  horse out of its own stock.
- **Self-interest:** the Trade Organization defends only itself and whoever hires it. It is not a
  world police. It punishes anyone who steals from it, whoever they are.
- **Punishment trip:** the army always walks to the city, however far; the time it has there before
  giving up starts when it arrives. Whether the storages hold anything is checked when it arrives,
  so emptying them in time works, but you still see the army come. It still turns back on the road
  when the city is no longer the culprit's, or when it finds no way there at all. Each soldier packs Food at the HQ for the way there and
  back, leaving room for what they will carry home; on the way they refill at trading posts they
  pass, and at the city they may take Food from its storage for the way back, apart from what the
  army came to take. On the road its soldiers keep together at the pace of the slowest (Army). The
  realm log tells the truth: it is coming; it has arrived; it left with so much of what it came for;
  it turned back without reaching the city, and why; or it was lost on the way.
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
  residents stay where they are, and its residents are homeless (a Player can Relocate
  theirs).
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
  a line like a road (Build line), skipping tiles that have a wall or gate; a diagonal line closes the way,
  since two wall tiles touching at a corner do (see Step).
- **House:** a building in a city's area where a fixed number of residents live (the number is in `balance.ts` and the Wiki). A city's **free housing** is
  its houses' room minus its residents. Houses are the only housing for now; later buildings
  (a palace, a castle) may add room the same way.
- **Food surplus:** a city has one when its storage holds more Food than all its residents eat
  in a set number of game days. Food that residents carry doesn't count.
- **Storage:** a building where goods are kept. In a city's area it is that city's storage and goes
  with the city.
- **Outpost storage:** a storage that is part of no city. It belongs to the realm whose residents
  finished it, like a town hall does, and counts as a storage of that realm everywhere (Store,
  Fetch, Carrying the output, Fetching materials, carriage stops). It founds no city and has no
  city area; once a city grows to include it, it is that city's storage. Its stock is guarded like
  a workplace: while an armed resident of its realm is at it and none of anyone else's, nobody
  else can take from it; unguarded, anyone at it can, and for another organization that is theft.
  Tearing it down against its realm is a crime too.
- **Refilling at an outpost storage:** a resident of its realm within a short distance of an
  outpost storage who is running low on food takes a meal from it, as at home, without an order.
  A stocked outpost storage next to a remote workplace keeps its workers fed.
- **At home:** a resident standing in the area of a city of their own realm; for a resident of an
  NPC city, in the area of that city.
- **NPC city:** a city run by the game. Self-managed cities are NPC cities. On its own it works
  its farms and workplaces and carries the output to its storage like anyone working a workplace
  (Carrying the output, to the nearest storage of that city; its workers set out with Food for
  the walk and the first days, and the carrier brings the crew's Food back: Crew food), pairs its adults,
  builds a house when it has a food surplus and no free housing, and shares its adults out:
  soldiers by its size first; then farmers, as many as feed everyone (one farmer feeds about
  four) and one more while it has no food surplus, building a farm when they don't fit; then at
  most two builders while it has a project; everyone else is its **spare hands**. A worker stays
  where they are until the city moves them. Beyond that it is driven by its
  reserve (NPC reserve): its spare hands go to the good shortest of its reserve first; they work
  the workplace that makes the good, or build it first on the nearest fitting resource node
  (within a set reach of its home) and work it like its other workplaces, carrying the output to
  its storage (Crew food). So a city builds the whole chain its land allows, one need at a time:
  weapons short means a smithy, which wants Iron, so a smelter, which wants ore, so a mine. A
  good with no node in reach stays short; the city buys it from its trader or a visiting trader,
  or does without. When it has no room left inside its wall it grows its area
  by building on the edge, puts up a new wall 8 tiles further out on every side, with the gate in
  the same place, and only once every tile of the new wall is finished tears down the old one.
  Its residents stand on its walls and pass its gates as a realm's do. It keeps some soldiers by
  its size, arms them from its smithy or by buying, fights attackers in its area and closes its
  gates when armed outsiders come near. A Player does the same by hand, if they want to. The world starts out with NPC villages
  and towns, on Plains, far from every starting city and from each other, and out of every
  Player's sight.
- **NPC reserve:** what an NPC city keeps of each good it can use, and never sells: Food for
  some game days for all its residents; Wood and Stone for its next house and some wall; weapons
  for the soldiers it keeps by its size, and the Iron and Wood to forge them; Coins as its war
  chest, for buying what it lacks and hiring help. A stable is wanted once it has horses, a mint
  only with a gold node in reach. Whatever its storages hold above the reserve is its surplus,
  for sale (Trading with an NPC city); whatever is below is short and drives what it works and
  builds next (NPC city).
- **NPC trader:** an NPC city's own trade run. Once a good's surplus makes a full load and a
  Trade Org warehouse (HQ or trading post) lies within a set reach, one of its spare hands,
  never a soldier, carries the load there, sells it, buys the good shortest of the reserve that
  the city has no node for, as far as its coins and their arms allow, and walks home to the
  storage. One trader per city at a time. Nothing protects them on the way but what they carry.
- **Full city:** an NPC city that for a whole game week has had idle spare hands and nothing
  short of its reserve, holds a food surplus, and holds a town hall's and a storage's materials
  above its reserve. A full city founds a daughter (Founding).
- **Founding:** how a full NPC city spreads out. It picks a free Plains site the usual distance
  from every city, within a set reach of itself and on no realm's territory, nearest a node of
  the good it is short of and has no node for. A **founding party** of a village's worth of
  adults, one of them armed, each carrying a share of the materials and Food for the walk and
  the first weeks, walks there and builds the town hall, which founds the **daughter** as an
  ordinary NPC city with a name from the game; then its storage, a farm and a house. Its first
  wall comes later out of its own reserve, a ring round its home. Mother and daughter are
  independent and hold each other in high standing, which fades like any standing; neither
  shares anything with the other. A city founds again once it is full again. Trading posts and
  the Trade Org HQ never found cities.
- **Integrating:** bringing a village or city into your realm, with its residents. Three ways:
  **conquer** it (capture by force), **buy** it, or **persuade** it (with high standing and
  respect it asks to join).
- **What joins with a city:** however a city joins a realm, its horses and carriages come with
  it. An NPC city's are all its own, wherever they stand. A Player's aren't tied to one city, so
  of those the ones in its area or at its stables join. Either way a horse a joining resident
  rides, and a carriage one drives, joins with them, and a carriage's hitched horse with it.
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
  Last seen is brought up to date once every few ticks for each realm, staggered across realms
  like NPC planning (ADR 0016), not every tick: a building that leaves sight between two refreshes
  is remembered as it was at the last refresh, up to those few ticks earlier. What is in sight now
  is unaffected.

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
  A supply wagon's driver, not being of the army, refills from the carriage like anyone aboard
  (Refilling from a carriage).
- **Combat:** resolved between residents in contact (the same or a neighbouring tile). Attack
  from Strength, weapon and Combat skill; Agility dodges, armour and shields take off damage.
  Fighting teaches Combat. **Under attack:** a resident who is struck runs their Defence script
  (Control): by default they fight back when armed and go home when not, and then go on with
  what they were doing. Scripts see who last struck a resident and when (`struckBy`, `struckAt`),
  as far as the Player may see how that resident fares.
  A city's soldiers fight attackers in its area on their own.
- **Walls in combat:** nobody walks through a wall. The city's own realm and its allies can stand on its walls
  and defend far better there. A **gate** lets the city's realm and its allies through always, everyone else
  only while it is open; the city's realm opens and closes it. A wall or gate can be **broken**
  (attacked until it falls, leaving part of its materials) or **climbed** (slow, and a climber
  can't defend themselves, so a defended wall is costly to climb).
- **Loot:** when a resident dies, everything they carried drops on the ground for anyone to take.
- **Capturing a city:** only by occupying its town hall for a set number of game days without a
  break (Occupying a town hall; ADR 0017). When the time is up, the city and its residents join
  the occupier's realm, loyal at once (for now). Beating its defenders is not enough on its own.
  Every city is captured this way: NPC cities, Players' cities, trading posts and the HQ (Fall of
  the HQ).
- **Occupying a town hall:** armed residents of one realm stand on a city's town hall (any of its
  tiles), no armed resident of any other realm stands there, and no defender of the city does
  (one on its side: its realm, an ally, or for an NPC city its own residents). An ally of the
  occupier on the hall counts as another realm, so nobody occupies it. The occupation starts the
  tick that holds and runs as long as it keeps holding; the first tick it doesn't, it is broken
  and its days are lost: the next one starts again from nothing. The city goes on as before
  meanwhile; its soldiers fight the occupiers as they fight any attacker in its area. Its realm's
  log says when its town hall is occupied, by whom, and when the occupation is broken. Anyone
  with the town hall in sight sees who occupies it and how long is left; scripts see it too.
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
- **Stealing a carriage or horse:** a grown resident on the tile of another organization's
  carriage or free horse can take it, by driving the carriage off, by mounting the horse, or by
  hitching the horse when they drive off in a carriage with none hitched. It joins the thief's
  realm at once, a carriage with its load and hitched horse, and from then on is an ordinary
  carriage or horse of that realm. It can't be taken while someone drives it, rides it or is
  aboard, nor while an armed resident of its owner is on its tile and none of the thief's realm
  is (guarded like an outpost storage). A stable doesn't protect a horse. A Down horse can't be
  ridden or hitched, so it is Fed first. Each taking is one theft (Crime, Witness), worth the
  carriage, the horse and the load together; taking back what was stolen from you is theft like
  any other. The victim's realm log says at once that it is gone and where it was last; who took
  it becomes known only through a witness. Taking one that belongs to nobody is no crime.
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
  carry home twice what it lost (coins first), fighting whoever resists. It leaves once it has what
  it came for; what it couldn't take becomes a debt.
- **Trade Org debt:** what the Trade Organization came for and couldn't take stays owed by that
  Organization, however long it takes, from when its army heads home or is lost, whatever the reason.
  It says so in the realm log, and a resident on any warehouse's tile can pay it in Coins at any time,
  in part or in full, from their hands or a carriage there, even if the Trade Organization otherwise
  refuses them. It rises by what later crimes cost: a crime it comes to know of while it is owed adds
  what it cost, once, and sends no army of its own. An Organization that is gone takes its debt with
  it. While it is owed the Trade Organization goes up these steps, one after the other (ADR 0025), and
  paying it in full stops it at any step:
  1. **It demands:** a demand (Demand) for the debt, with a deadline.
  2. **It wrecks:** past the deadline, its next army goes to that city and tears down workplaces of
     it, each counting for its worth against the debt, until the debt is covered or none are left.
     Those who resist are fought.
  3. **It takes the city:** with a debt still owed after a set number of trips, its army occupies the
     town hall (Holding the town hall). The city joins the Trade Organization as a new trading
     post: its storages become warehouses with what is in them, its people stay as the post's, and
     the debt is settled.
  Its army travels with a **supply wagon**, when the HQ has a free adult to drive it: a new Trade Org
  carriage and horse, loaded at the HQ with Food for the whole trip as far as that leaves room for what
  it takes. It follows the army (Supply line) and its soldiers refill from it, go to meet it when they
  run out with it out of reach, and put on it what they take when it is near. It is robbed like a
  caravan's: taking from it or stealing it is a crime and its soldiers go after those who do, and its
  crew is lost like one (Caravan crew lost): a soldier takes over from a dead driver, unless they are
  the last, and with no crew left the HQ sends a new driver on foot, who packs for the walk. Stolen,
  or with its horse dead, it is gone for the army, which goes on with what it carries. It comes home
  with them, or by itself once they are lost, and its whole load goes into the warehouses; the carriage
  and horse go back into the HQ's stock. And short of Food on the way its army
  buys some from a post, NPC city or Player's offer it passes. A captured post the Trade Organization
  has heard of (Lost post found out) is a debt too: it demands the city back, and returning it
  settles the debt. Admin directives go on as before, with no debt.
- **Demand:** a Player or the Trade Organization sends a demand to another Organization: **terms**
  (hand over a named city; hand over goods or Coins), a short written note, and a deadline. It
  arrives at once, like a mercenary offer, wherever the other side is, and sending them is limited.
  They accept, decline or let it lapse; the sender hears that at once.
  - **The threat is only words.** Ignoring a demand does nothing by itself. Whatever was threatened
    is the sender's to carry out, or not. The game forbids nothing.
  - **Accepting** carries the terms out: a named city joins the sender's realm at once, as a captured
    one does, and goods and Coins are set aside at a storage of the one who accepts, for the sender
    alone to fetch (like a Direct offer in person), or sent by a Transfer.
  - **An NPC city** accepts when the respect it sees from the sender (their armed residents and
    walls in its sight) far outweighs its soldiers, so an army at the gate can take a city without a
    fight; otherwise it declines and its standing toward the sender drops. It carries out goods the
    same way. **The Trade Organization** always declines, and being asked costs standing.


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
- **Admin:** an account with admin rights: creates invite codes, resets passwords, gives
  admin directives and offers horses again (Horse offer), in an admin panel apart from the game.
  Being an admin has nothing to do with
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
- **Homeless:** a resident who lives in no city (their town hall was torn down, or they were
  left behind when their city changed hands). They have no home to refill at and can't pair
  until they Relocate.
- **Relocate:** a Player order (UI, queue step or script, `relocate(cityId)`) for any resident of
  their realm, the Leader, children and homeless ones included, naming another city of the same
  realm. The resident walks there and becomes its resident on stepping into its area, at once if
  already in it; like any order it replaces the current one. It can be given only while the city
  has free housing for them, counting residents already relocating there; a group needs room
  for all of them. A partner who is Carrying can't be told to relocate until the child is born.
  On arrival, the city must still have free housing and still be the realm's: if not, the order
  ends, they keep their old city and the realm log says why (in a group, each moves in while room
  lasts). Moving to another city ends a pair (Pairing needs one city). NPC cities don't relocate
  residents, besides sending a founding party to a daughter city.
- **Renaming a resident:** the Player can rename any resident of their realm, their Leader
  included, by hand or from a script: free, instant, from anywhere. Names need not be unique.
  Renaming the Leader never renames the realm (see Realm name). The realm log keeps the names
  things had when they happened.
- **Game-given names:** a name the game gives a resident (a starting city, a birth, a founding
  party, integration) is one no living resident of that realm has, an NPC city counting as a
  realm; a name the game gives a city is one no city in the world has. When the game's list of
  names runs dry it adds a numeral ("Edda II") rather than repeating one. Renaming stays free and
  may make duplicates. Names given before this rule stay as they are; a list that holds two
  residents of one name tells them apart by age and, with several cities, by city.
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
- **Training ground:** a building where residents train (`Training`). 3×3, on any passable terrain
  except Mountain, built like any building. Like a workplace, it has no owner: whoever teaches
  there holds it. One ground teaches one **subject** at a time: a stat (Strength, Endurance,
  Agility, Intellect) or a skill (Combat, Driving, Mining, …), the one its teacher set.
- **Teacher:** a grown resident at a training ground with the **Teach** order, which names the
  subject. A ground has one teacher at a time; a second Teach there fails. Leaving the ground or
  taking another order ends the teaching, and the ground teaches nothing until someone teaches
  again.
- **Trainee:** a grown resident at a training ground with the **Train** task (default script
  "Train"), up to a maximum per ground (a balance number). Trainees learn only while a teacher is
  there; without one they wait.
- **Training:** a trainee gains in the ground's subject each tick a teacher is there, only while
  below the teacher's own effective value in it: nobody learns past their teacher. A stat's
  trained bonus never passes its cap (Trained bonus); a skill trains toward the teacher's skill,
  up to the skill's maximum. A trainee at the ceiling waits. The trainee's Intellect sets the
  pace, as for learning by doing; training a skill goes faster than learning it by doing. The
  teacher's level is only the ceiling, never the pace. The teacher gains nothing and needs no
  skill to teach. Training costs nothing but time and food: teacher and trainees eat as usual and
  refill at the ground as at a workplace (Refilling at a workplace); the Train default has the
  usual food params. Nothing trained decays; only old age lowers stats.
- **Who trains:** Players' residents, by order, queue step or script. NPC cities and the Trade
  Organization train nobody for now; whether an NPC city puts a spare hand to teaching its
  soldiers is a question for the reserve-driven chain (NPC city), not settled here. Scripts have
  `teach(subject)` and `train()`; a building's script view shows its teacher, subject and trainees.
- **Carry capacity:** the most weight a resident can carry, set by Strength. Everything has weight,
  including money, so nobody walks around with a fortune in their pocket.
- **Pairing:** two adult residents of the same city set to have children (a Player order, or on
  its own in NPC cities). Each pair has one child at most. The only way, besides integrating,
  that residents come into being. Once 10 game days have passed since they paired, and their city
  has free housing and a food surplus, one partner, chosen at random,
  starts **Carrying** the child; the other keeps working as before.
- **Carrying:** a partner carrying a child can't work for 10 game days (4 real hours); then the
  child is born and the pair ends. For another child the Player pairs them again (NPC cities do
  it on their own).
- **Child:** a resident born to a pair. Each base stat is the parents' average plus a small
  random amount. Born where a parent stands, into their city and realm. Grows up for a while
  before it can work: until grown, a child can walk, but can't work, build, tear down, drive,
  pair, or pick up and put down goods other than Food. Food they may pick up, put down, Fetch
  and Store like anyone, so they can carry their meals. In their own city's area, a child with
  less than their own food on them tops up to it from the city's storage (Refilling at home,
  but to their own food and not only when running low), so a child leaving the city has food
  on them.
- **Aging:** residents grow old; their stats decline late in life, and they die of old age at
  around 60 game years. Children age faster: each year of age up to 14 takes 10 game days
  (4 real hours), so a child is grown after about 140 game days (~56 real hours); from 14 on, a
  year of age is a game year.
- **Hunger:** each resident eats a fixed amount of Food per game day, more on hard terrain and
  less with high Endurance. An empty hunger meter costs health; without food a resident goes
  Down after about 5 game days (2 real hours), and dies if nobody revives them. While the meter
  isn't empty, lost health slowly comes back.
- **Down:** a resident whose health hunger has used up doesn't die at once but lies unconscious
  on their tile for a while (a balance number, about one real day). Down, they do nothing: their
  order, script and queue end, they take no orders (the card says Down and how long is left),
  don't eat and lose no more health. Anyone in sight sees that they are Down. Anyone on their
  tile can take the goods they carry, as from a pile; from another realm's resident that is
  theft. Attacked, they die like anyone. When the time is up and nobody has revived them, they
  die of hunger. Only hunger puts a resident Down: wounds kill as before. A Leader who is Down is
  not a Leader death. The realm log says when one of its residents goes Down, wakes or dies.
- **Reviving:** any grown resident of any realm on or next to a Down resident's tile can **Feed**
  them (an order, queue step or script `feed(targetId, units)`), putting Food from their own
  hands into the Down resident's. Once their hunger meter isn't empty they wake at low health
  and stand idle. A Down horse wakes the same way once it has eaten, from Food in reach (Horses
  have no inventory) or when a resident Feeds it (Feeding a horse).
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
- **Refilling from a carriage:** a resident of an army, a passenger, or the driver, running low on food
  takes a meal from a carriage of their own realm on or next to their tile, like refilling at
  home.
- **Getting food:** in the Work, Build, Build line and Tear down defaults, a resident whose
  `foodAt` param is set and who carries less Food than that many units stops, walks to their
  `food` param, else their `storage` (Work) or `source` (Build, Build line, Tear down) param, or
  else the nearest storage of their realm with Food, takes
  Food there up to `foodTake` units on them, and goes back. Whenever they are at a storage anyway
  (carrying the output, fetching materials), their own food is topped up to `foodTake` instead of
  the usual own food. The game's defaults give both params a default (about a day of Food for
  `foodAt`, a few days for `foodTake`), so residents get food on their own unless the Player
  changes them; `foodAt` set to 0 turns it off, and they rely on refilling. NPC cities run the
  defaults with these defaults.

## Transport

- **Horse:** an animal that pulls a carriage. Eats Food and goes hungry like a resident: an empty
  hunger meter costs health, and a horse without food goes Down after about 5 game days (Down,
  Reviving) and dies if it eats nothing before its time is up. Bred by a
  resident at a stable, or bought from the Trade Organization.
- **Horse grant:** a one-time gift, given once when it ships: every Player realm with a living
  Leader and no horse at all (in a stable, hitched or ridden) gets two new horses with stats drawn
  as in a starting city. They appear in the realm's finished stable nearest the Leader's city;
  with no stable, on free tiles next to the storage of the Leader's city (or the realm's oldest
  city; with no city, next to the Leader), each with a few days of Food on the ground by it. The
  realm log says where they arrived. Realms that still have a horse get none.
- **Horse offer:** every Player may claim two new horses once, when they choose, whether
  or not they have horses. Until claimed, the HUD shows a notice with a Claim button; claiming
  places them as the Horse grant does (stats, stable or storage, Food by them, realm log) and
  the notice is gone, also across Leader deaths. A Player with no living Leader can't
  claim until they have one again. **Offering horses again:** an admin can re-open the offer in
  the admin panel, for every Player at once or for one by name, as often as needed. Each Player
  who had claimed may then claim once more, whether or not they still have horses, and sees the
  notice at once; a Player who hadn't claimed still has just the one claim.
- **Horse name:** every horse has a name, given by the game when it comes into being (starting
  city, Trade Organization, foal, Horse grant) from a pool of horse names apart from the
  residents' pool. **Renaming a horse:** the Player can rename any horse of their realm, by hand
  or from a script, like renaming a resident: free, instant, from anywhere; names need not be
  unique. The name shows wherever the horse shows: the tile card, the stable, the carriage it
  pulls, its rider's card and the realm log. Scripts see it.
- **Horses drawer:** a drawer on the tool rail, like the Residents drawer, listing the realm's
  horses grouped by where they stand: each stable by name, hitched to a carriage, ridden, loose.
  A row shows name, stats, age, health and hunger; tapping it centres the map on the horse and
  picks it.
- **Horse stats:** every horse has Speed, Strength and Endurance, and an age. Speed is how fast
  it pulls its carriage or carries a rider (`Riding`); Strength is how much the carriage it pulls
  can hold; Endurance is how much Food it needs, as a resident's Endurance is for them. New
  horses (in a starting city, at the Trade Organization, in an NPC city) get stats drawn in a
  range. A horse's stats never change; they show with its age, health and hunger on the tile card
  and in the stable.
- **Horses have no inventory:** a horse eats only what is in reach. At a stable it eats from the
  stable's storage; pulling a carriage, from the carriage's load; anywhere, from Food lying on the
  ground on its tile or right next to it, so Players can also feed a horse by putting food down
  by it (or Feed it directly, Feeding a horse).
  A ridden horse also eats from the Food its rider carries beyond the rider's own food, after
  Food in reach on the ground: the rider never goes without for the horse, and the realm log says
  when a ridden horse is hungry with nothing to spare.
- **Stable:** a building on Plains where horses are kept. It has a storage for their Food, which
  residents fill and empty like any storage. Horses don't breed there on their own: a resident
  breeds them (**Breeding**). Like a workplace, a stable has no owner: any horse standing in it
  eats from it.
- **Breeding:** an order (as a script could do it) for a grown resident at a finished stable: they
  pick two fed horses of their realm standing in it (wherever the Player picks them, each shows its
  name and stats) and tend them for a while; then a foal of
  their realm is born in the stable, with its parents' average stats plus a little noise. It
  pauses when the resident leaves or is given another order, or while the stable has no room for
  another horse. Like a construction site's work, the progress belongs to the two horses in that
  stable, not to the resident: any grown resident who breeds there later carries on with that
  pair first, where it stopped. The progress is lost only when one of the two leaves the stable
  or dies. Before starting, the default takes Food for the resident's meals from the stable. NPC
  cities breed their horses the same way, with one of their residents.
- **Feeding the stable:** a task (default script "Feed the stable") given to a grown-up resident
  standing in a stable, from their card. They keep Food in the stable for about 10 game days for
  the horses standing in it: below that they fetch what is missing from a storage and store it in
  the stable; otherwise they wait there. Its params: `stable`, the stable to feed (by default the
  one they stand in when it starts), and `source`, where the Food comes from (by default the nearest
  storage of their realm with Food). With no Food to fetch they wait.
- **Carriage:** a horse-drawn cart driven by a resident with Driving skill. Carries far more than
  any resident and is fast on plains and roads, slower in forest and hills, and cannot enter
  mountains except on a road. Built at a stable (Building a carriage).
- **Building a carriage:** a resident at a finished stable lays out a **carriage site** on their
  tile of the stable, or on a tile right next to it, where a carriage can stand, off resource nodes
  and other buildings; it shares the tile with the stable, one carriage site per tile. It is a
  construction site like any other (materials, mostly wood and some iron, and work; fetching
  materials, no owner, finished by anyone, torn down leaving all its materials). Once finished it
  is gone, and an empty carriage of the realm of the resident who finished it stands on its tile,
  with no horse hitched until it is first driven.
- **Driving:** a grown-up resident on a carriage's tile drives it to another tile; the driver,
  the carriage and its horse move together. Driving teaches the Driving skill, and a more
  skilled driver goes faster. Driving off in another organization's carriage steals it (Stealing
  a carriage or horse).
- **Feeding a horse:** a grown resident of any realm on or next to a horse's tile can **Feed** it
  (an order, queue step or script), any horse that isn't full, Down or not. Full means its hunger
  meter has no room for a whole unit, as when it eats on its own, so no Food is wasted. It eats
  Food from their hands until then, up to the units asked for; the rest stays with them. A Down
  horse wakes as under Reviving.
- **Hitched horse:** the one horse that pulls a carriage. A horse of the carriage's realm standing
  with it is hitched when the carriage is first driven (another's is stolen by that: Stealing a
  carriage or horse), and stays hitched until **unhitched**: a grown resident of the carriage's realm standing on its
  tile unhitches it (an order, as a script could do it); the horse stands free on the tile, and
  the carriage stands where it is until it is next driven. A carriage
  whose horse dies stands where it is until another horse is hitched.
- **Riding:** a resident on a tile with a horse that pulls no carriage and nobody rides mounts
  it (another organization's is stolen by that: Stealing a carriage or horse), and dismounts
  anywhere; the horse stays on that tile. Riding is not an order:
  the rider goes on with what they do, and their walking goes at the horse's pace, as fast as it
  would pull a carriage there (fast on plains and roads, slower in forest and hills, never into
  mountains off a road or onto walls), slower while the horse is hungry. Gates and walls stop a rider as
  anyone. The rider carries what they could on foot; the horse eats Food in reach as usual.
  Riding teaches Driving, and Driving makes riding faster. A horse has at most one rider and is
  never hitched while ridden; a rider doesn't drive. A rider whose horse dies, or who leaves it
  behind (climbing a wall), is on foot again. On the map a rider's token sits on a horse token,
  so riders stand out from walkers; their Doing line says "Riding" where it would say
  "Walking", and their card shows the horse they ride with its stats, age, health and hunger.
- **Loading a carriage:** residents on a carriage's tile put goods on it and take goods off it
  like at a storage, up to what the carriage holds.
- **Passenger:** a resident aboard a carriage of their realm, children too. Any carriage takes
  passengers: each counts as a fixed weight against what it holds, so it carries goods, people
  or a mix. A resident on the carriage's tile **boards** it (card, group card, queue step,
  script); aboard, they move with the carriage and don't walk on their own, and **get off** on
  its tile or right next to it. Giving a passenger a walk or an order that acts on a tile gets
  them off first. Being aboard isn't an order, like Riding. The driver isn't a passenger.
  Passengers eat their own food and, running low, take a meal from the carriage's Food
  (Refilling from a carriage). A carriage whose horse dies stands still with its passengers
  aboard until they get off.
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
  back. **Waiting:** a script may call `wait()`: it is not run again until its current order ends,
  is replaced, or the resident is struck (Defence script); then it runs every tick again. The
  game's defaults wait after every walk, store and fetch, so a resident on the move costs no
  script run; an edited copy of a default behaves like the default. A script ends itself by
  calling `end()`: the resident stands idle, and in a queue its next
  step starts. `end(reason)` also notes the short reason in the realm log ("Ana stopped Work: no
  workplace on her tile"). The defaults end that way when their target is missing or gone; the
  Build, Tear down and Breed horses defaults also end once the site is finished, the building is
  gone or the foal is born. A script's own runtime error stops it for the tick and it runs again
  next tick; an error of the game's own while running it ends the script like `end()`, noted
  once in the realm log, and the rest of the tick goes on for everyone else. A saved change is
  picked up on the next tick: each save is a new version, and the
  newest one without syntax errors is the **active version** that runs. A version with syntax
  errors stays in the history but never becomes active; the Player can make an earlier version
  active again. **Deleting versions:** any version but the active one can be deleted for good,
  one at a time or all those older than the active one at once; the others keep their numbers.
- **Library cap:** a Player's library holds at most so many scripts, and each script so many versions,
  the defaults' versions included. A save past either cap is refused and says to delete versions or
  scripts first. The caps are listed in the Wiki.
- **Script parameter:** a value the Player picks for whoever runs a script, declared by a
  `param name: type` line at the top of the script and read there as `params.name`; a `param`
  line anywhere else is a syntax error. A `building` param holds a building the Player knows: a workplace or construction site
  anywhere in sight or last seen, whoever built it (a workplace has no owner), or any other
  building of the realm's own; a `storage` param one of its storages, stables or carriages; a `number`
  param a whole number of zero or more, typed into a number field; a `choice` param one of the
  words its line lists (`param toward: choice(north, east, south, west)`), picked from a list;
  a `waypoint` param one of the Player's waypoints. A `number` or `choice` param may declare a
  **default** (`param foodAt: number = 3`); `building`, `storage` and `waypoint` params can't. The values
  are kept for each resident and each script (at a workplace, see Workplace settings): giving the task again keeps them, a param removed
  from the script is dropped, a new one starts unset. Unset, or once the one picked is gone (or no
  longer the realm's), it reads its default, or `null` without one; clearing a field goes back to
  the default. **Starting at once:** giving a task or Run script starts it at once with the kept values or
  the defaults. **Before it starts:** a Customise button beside the order opens the form with those
  params, filled the same way, and Start gives the order with them; it opens by itself only when a
  param has no default and no `none:` in its comment, since the script has nothing to go on without
  it. The form fits a phone screen. The resident card shows one field
  for each param of the script the resident runs, picked on the map and cleared with a button;
  picking one doesn't end the script. **Param comment:** the `//` comment at the end of a `param`
  line says what the param is for and, after `none:`, what the script uses while none is picked;
  each field shows it and the value the script uses: the one picked, else a `number` param's
  default, a default script's target the one on the resident's tile, or what the comment says
  after `none:`. The Work default declares `storage`, its main storage, and three `storage` params
  that, when set, take its place for one use: `output` (where the output goes, Carrying the
  output), `input` (where a smelter's, mint's or smithy's inputs come from, Fetching inputs) and
  `food` (where Food comes from, Getting food and Crew food). The Build default declares `source`
  (where materials come from, a carriage too); a source picked that holds none of what the site
  lacks is left alone, and they just build. Unset, each falls back to the main one, then to the
  nearest storage. Work, Build, Build line and Tear down also declare `food` and the `number`
  params `foodAt` and `foodTake` (Getting food).
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
  Default scripts can't be renamed or deleted. NPC cities always run the game's defaults. Each
  default reads top-down: a short main block first saying what happens in order, then a named
  `fn` for each step, with plain names and no tricks (the game API's `floor` and `pickRandom`
  help there). Shared pieces such as Getting food are copied into each default that needs them.
  **Started directly:** a default script's target is a param: Work's `workplace`, Tear down's
  `building`, Feed the stable's and Breed horses' `stable` (Breed horses then picks the pair as
  Breeding says, a paused pair first). Giving the task from the UI fills
  it; unset, it is the one on the resident's tile when the script starts, kept until it ends. So
  running the same script with Run script or as a queue step works like giving the task.
  Build's is `site`, a construction site to join; laying out a new one (its kind and place)
  stays the Build order's. Haul's is `carriage`; its route (where to, which goods) comes only
  from the Haul order, so Haul started without one ends ("no route given"). Build line has no
  target param: its line comes only from the order, so it ends without one too. The target param is
  never kept: each start fills it (the task order, or what the Player picks before it starts) or
  leaves it unset; the script's other params are kept as usual.
- **Working a site:** Work's `workplace` may also be a construction site of a workplace kind
  (farm, mine, smelter, …), so Work can be given or queued for a workplace still being built.
  At a site the Work default first builds it as the Build default would (fetching materials from
  the nearest storage of the realm holding them), then works it once it is finished, with no new
  order. The planner's Work step can be picked on such a site.
- **Workplace settings:** for each workplace, or construction site of a workplace kind, it knows,
  a realm keeps its own settings, set on the building's card and never seen by other realms: the
  **work script** (the Work default, or one of the Player's scripts that declares
  `param workplace: building`) and values for that script's params. Giving a resident Work there
  (card, group card, queue step) runs the work script; Customise (Before it starts) shows its params
  filled with the workplace's values, and a value the Player changes there becomes that
  resident's **override**; their earlier kept values for that script don't carry over. While they
  work there, a param reads the resident's override, else the workplace's setting, else the
  script's default. Changing a workplace's setting changes it at once for everyone working there
  without an override; clearing an override goes back to the workplace's value. Changing the work
  script switches everyone working there by it to the new one, as if given Work again. A script
  given by hand with Run script stays the resident's own choice. NPC cities keep no settings and
  run the game's defaults.
- **Explore:** a task (default script "Explore") for a grown resident, on foot or riding, to go
  into the unknown. Its params: `find`, a `choice` of a resource node kind (forest, stone, iron
  ore, gold ore) or none to just explore; `toward`, a `choice` of compass direction, and
  `waypoint`, a waypoint to head for instead, both unset meaning the nearest unexplored tiles
  first; and `food`, where to refill (else the nearest storage of the realm with Food). They set
  out with as much Food as they can carry and walk toward unexplored tiles that way. They turn
  back when the Food on them, a rider's horse's included (Horses have no inventory), just covers
  the way back to that storage plus a margin (a balance number), refill there and go back out to
  where they turned. Once a node of the kind `find` asks for comes into sight that none of the
  Player's waypoints marks, they put a waypoint on it named after it ("Gold ore node"), note it in
  the realm log, walk back to the storage and end; holding the most waypoints already, they still
  walk back and end, saying no waypoint was added. In sight means the Player's sight, checked
  each tick on the way out. Without `find` they go on until stopped. With
  no unexplored tile left in reach, they walk back to the storage and end saying so.
- **Defence script:** the script a resident runs when struck: the game's **Defend** default (armed,
  attack the attacker until they are dead, gone or out of sight; unarmed, walk home to the town
  hall; it ends once no blow has landed for a while) unless the Player picked one of their own
  scripts for that resident, on the card's Script tab or the group card; cleared, it is Defend
  again. Kept per resident like any script. Being struck interrupts what the resident was doing;
  when the defence script calls `end()`, the interrupted script goes on with its memory, the
  queue step continues, or the plain order resumes. A struck resident whose defence script is
  already running isn't interrupted again; a Player order given meanwhile ends both. NPC
  residents, and residents with no Player, run the game's Defend default.
  **A Player's order under attack:** what the Player gives a resident while they are under attack
  (their defence script runs, or a blow landed within the calm time Defend waits for) isn't
  interrupted by further blows. An order that ends by itself (a walk, a drive to a target, and
  the like) stands until it is done or replaced, however long that takes. What goes on until
  stopped (a haul route, working, a task, a script, a queue) holds until no blow has landed for
  the calm time; after that the next blow runs the defence script as usual. What a script or
  queue requests itself doesn't count as given by the Player.
  **On a carriage under attack (Defend default):** an unarmed driver drives on where they were
  going instead of leaving the carriage, and an armed one fights back and then goes on. An unarmed
  passenger stays aboard while the carriage is being driven; on one standing still (no driver
  driving it, its horse Down or dead) they get off and walk home. An armed passenger fights back.
  A Player's own defence script decides for itself: a driver's drive or haul route goes on until it
  gives them another order. Residents with no Player follow the same rule, and a caravan's driver
  under attack doesn't wait for their escort.
- **Doing:** the line on a resident's card and in the resident list that says what they are
  doing, shown to the owning Player only. It is derived from their task and current order
  ("Building a house: fetching 10 wood from the storage", "Working the farm"); the script they
  run is named on a small line of its own, left out when it is their task's own default script
  ("Working the farm" alone). Long lines wrap rather than being cut off. A script can say it
  itself with `doing(text)`: short
  text, kept in its memory, that shows instead until the script says something else or stops.
  **Estimates:** the Doing line and every meter or countdown that shows progress also say about
  how long is left, in real time with game time in brackets ("about 3 min (half a game day)"),
  from the current pace (terrain, horse, hunger, skill), rounded to one coarse unit: walking,
  driving and riding say when they arrive; breeding, building, tearing down, carrying a child,
  pairing and growing up say how long is left.
- **Memory:** the small store a running script or order keeps between ticks. Roles are just
  something a script keeps there. A script can read, never change, the memory of its own
  Player's residents and armies, so residents doing the same task can agree on who does what;
  other Players' memory stays hidden.
- **Script log:** a resident's last lines of `log(text)` (short text, each with its game time),
  shown to the owning Player only and never in the realm log; `end(reason)` adds its reason too.
  Kept with the resident across scripts, so it still shows why the last one ended; once full,
  the oldest line goes. The game's defaults log their decisions and turns (carrying a load off,
  getting Food, fetching materials), never every tick.
- **Debugging a script:** the Script tab of a resident card shows, for the script they run,
  read-only and live: its memory and params, the script log, its last runtime error with the
  line (a click opens that line in the Library), and the steps it used last tick against its
  step budget.
- **Step budget:** how much work a script may do each tick, for each resident or army and for a
  whole realm. Out of budget, the script stops for that tick; what it already requested still
  counts. Default scripts count like any other. NPC cities have no realm budget, only the one
  for each resident. A script sees only what its Player sees: their sight, explored terrain and
  what they last saw (Last seen), told apart from what is in sight now.
- **Value limits:** a single value a script holds is bounded: a string's length, a list's items and an
  object's keys each have a cap. Past it the script fails with a runtime error, like a call too
  deep. The caps are listed in the Wiki.
- **Script view:** what a script gets of each kind of thing (a resident, a building, a city, …):
  a fixed set of fields, the same for every Player and listed in the Wiki. A field the Player
  isn't allowed to see is always there and `null`, never missing. A script sees no field beyond
  these. The game may add fields at any time; renaming or removing one tells each Player whose
  scripts read it in their realm log, naming the field and the scripts.
- **Group:** several of the Player's residents picked on the map at once (box-drag or
  Shift-click), so an order goes to each. Not an Army: nothing ties them together in the world.
  Ctrl+1–9 saves the picked residents as that number's group and 1–9 picks them again (pressed
  twice, it also centres the map on them); saved groups are kept per browser, not in the world.
  Dead residents and ones no longer the Player's drop out of a group when it is picked again.
  **One command for a group:** the group card gives each the same order request as their own card
  would (walk to, work, build, store, fetch, run a script, stop); nothing new is kept in the
  world. A walk-to spreads them over distinct free tiles around the target, the nearest of them
  to the nearest tile. Work and Build make each join the workplace or site: Build walks them
  there, the first lays out the site and the others join it; Work is tile-bound, so it goes only
  to those standing at the workplace. Every order a resident card offers is on the group card
  too (mount, feed the stable, breed, haul, Run script with its params, …). Those who can't take
  it (children, a partner carrying a child, too far for a tile-bound order) are skipped, and the
  card says who and why. **Planning for a group:** the group card has the same queue planner as
  a resident card; "Give to all" sets a copy of the planned steps as each member's queue, and
  appending (Shift, or Add step) adds the step to each member's own queue. Members' queues stay
  their own afterwards.
- **Queue:** an order holding a list of steps for a resident and which step they are on. A step
  is any order the Player could give them on its own: a one-off action (walk to, pick up, drop,
  Store, Fetch, …), a task, or one of their scripts with its params. A step ends when it's done
  (a walk arrives, a script calls `end()`), or once its duration in game minutes is up, if the Player gave
  it one; a task that never ends on its own (work, haul, feed the stable) needs a duration unless it's the last
  step. With **loop**, the first step follows the last; without, the queue ends after it. Steps
  can be added, removed and reordered while it runs: the current step keeps going unless removed,
  and then the step in its place starts. **Planning ahead:** a step may act somewhere else than
  where the resident stands now: the planner's Add step offers every kind of step, and one that
  acts on a place (work, build, fetch, store, pick up, feed the stable, breed, …) is picked on the
  map, with a walk there put before it. Adding only checks that the step could make sense (the place
  exists as last known, and is the realm's where it must be: a workplace or site anyone may work
  can be anywhere in sight or last seen); whether it can start is checked when its turn comes. A step that can't start or ends in a failure is skipped
  and noted in the realm log; when none of them can start, the queue ends. Any order that isn't a
  step ends it. Scripts see a resident's queue (which step, and what it is) but can't start or
  change one; their `order` and `script` stay the current step's own.
- **Saved queue:** the Player saves the planner's steps under a name, kept per browser like saved
  groups, so the server never sees them. The planner offers Save and Load; Load appends the
  saved steps to the planned ones. A saved step keeps its places (buildings, tiles); on Load, a
  step whose place is gone from the last-seen map is flagged in the planner, and the server
  skips it when its turn comes, as any step that can't start.
- **Planner clipboard:** steps are picked in the planner (tap; Shift for a range); Copy puts
  copies on a clipboard in the browser, Paste inserts them after the picked step, in the same
  planner or another resident's or a group's. The clipboard survives switching cards, not
  reloading the page.
- **Repeat block:** in the planner, some steps in a row wrapped with a count, nestable. It is a
  planner thing only: when the queue is given, the block becomes that many plain copies of its
  steps, so the queue, the server and scripts see only steps. A queue holds at most so many
  steps (a balance number); the planner says when a plan would exceed it. A running queue shows
  the copies, the current one marked. The whole-queue loop stays as it is.
- **Action:** a request (move, pick up, attack, …) that the world resolves at the end of a tick.
  The world only checks whether it's physically possible.
- **Tick:** one step of the world, one per second.
- **Realm log:** what happened in a Player's realm (residents going hungry, deaths, Food
  spoiling), shown only to that Player, also what happened while they were offline.
- **Resident card:** what the UI shows for a picked resident (and, laid out the same, a group or
  an army): a header that always shows (name, Doing, hunger and health, what they carry) and one
  open tab under it: Orders, Queue, Stats or Script. Orders are grouped by kind (Move, Work &
  build, Goods, Scripts). The card opens with only the orders they can take; while it stays open
  each row keeps its slot: an order that stops being possible greys out saying why, one that
  becomes possible is added at the end of its group, and the rows are sorted afresh only when
  something else is picked (ADR 0019). A group card has the same rows, with the group's own
  reasons.
- **Goods on cards:** each kind of good has one icon. Every inventory a card or drawer shows
  (what a resident carries, a carriage's load, a storage's or stable's stock, a workplace's pile,
  a site's materials, trade lists) is a compact grid of icon and amount, the name on hover or
  long-press; a resident's own food shows apart from the rest. Cards give facts as labelled rows
  and meters, not sentences: a carriage its load against capacity, its horse with hunger, driver
  and passengers, and its route as "A → B" with the current leg and arrival; a storage or stable
  its stock and who is on the way to it; a workplace its pile and crew; a site what it has
  against what it needs, per good. Doing lines and the realm log stay sentences.
- **Motion on the map:** the world moves once a tick, but the map shows it smoothly. A token on
  its way (walking, driving, riding along a path it was sent) moves steadily along that path at
  its current pace between ticks, across tile edges, without stopping at each tile, however many
  ticks a step takes on that ground. When the next state disagrees (it stopped, turned or was
  blocked) the token eases to where the world says it is. Any other token that changed tile
  glides from the old tile to the new one over the tick, and the tokens of residents at work move
  a little on their tile, so a crew looks busy rather than frozen. Pure drawing in the browser:
  the world and what it sends change nothing.
- **Way on the map:** while residents are picked (one, or each member of a group), the map draws
  the way each is going for any order that goes along a path: walk to, drive, haul, Store, Fetch,
  a road or wall line, going after someone. So a script that hands over to Fetch to get food
  shows its way too. A passenger's way is the carriage's they are aboard. It is drawn at every
  zoom tier; at the far tier as a thin line with its end marked.
- **Places of the picked:** while residents are picked, the buildings their script's params point
  at (workplace, storage, source, site, …) and the place their current order heads for (the
  storage a Fetch goes to) are outlined on the map in the way's colour. Pure drawing.
- **Planned building:** what the Player's residents are set to build but haven't laid out yet
  shows on the map as faint ghosts: the tiles still to build of every road or wall line they are
  on or have queued, and the footprint of every build they are ordered or queued to do. The
  picked residents' plans are drawn stronger. Only the owning Player sees them; pure drawing.
- **Picking a target:** an order that needs a tile or building (walk to, store at, build here)
  shrinks the card to its header and shows "Tap where …" with Cancel until the Player picks one
  on the map; then the card comes back as it was. On a phone every card is a bottom sheet (peek,
  half, full), one finger pans, pinch zooms, a tap picks, a long-press does what right-click does,
  and a Select toggle makes a drag pick a group. While the card is shrunk, the room it took
  stays dead: a click there does nothing. Before the pick, the map previews under the pointer
  what it would do: the way of a walk, drive or ride with its arrival estimate, the line of a road
  or wall with its tile count, the footprint of a building (marked where it doesn't fit), or the
  building a Store, Fetch or Work would use. On a touch screen the first tap shows the preview
  and the banner gains Confirm; a tap elsewhere moves the preview. Escape leaves the top-most
  thing first: pick mode, then an open panel on the card, then a tile card, then the card, then
  the drawer.
- **Picking on the map:** what a click (or tap) picks on a tile, in this order: a resident of the
  Player's, then a building (a carriage or horse of the Player's with nobody on it counts as
  one), then the bare tile. A click on a stack of the Player's residents picks them all as a
  group; a stack with others' residents shows the tile card, which lists them. A click beside
  their tokens on a tile with another realm's carriage shows the tile card too, where it can be
  driven off (Stealing a carriage or horse). With a pointer, what a click would pick is outlined
  on hover.
- **Build menu:** every buildable kind as an icon with a short name, under group headings
  (Resources, Food and animals, Industry, City, Defence, Transport), all in sight without reading.
  Tapping one shows what it is for, what it costs and Build. A kind that can't go on this tile is
  dimmed, and tapping it says why. It is the same on a resident's card, a group card and the
  planner. Only the UI: where a kind may be built doesn't change.
- **Residents list:** the Residents drawer opens fully, to a list of the realm's residents with their
  stats, skills, gear, what they carry and what they are doing. It can be searched by name, filtered
  (has weapons, idle, child, by city, and the like) and sorted by any column; the choice is kept per
  browser. Tapping a row opens that resident. **Pick these** picks everyone listed, or those ticked,
  as a Group on the map. Only the UI: nothing new is kept in the world. It works on a phone.
- **Notices:** what the HUD tells the Player unasked (the Horse offer, a Direct offer sent to them,
  the pick banner, a group order's report, the first-day card) shows in one lane under the top bar, over the map and never
  over a drawer or card. While the pick banner shows it replaces the others; they come back after.
- **First day:** a new realm's HUD shows a checklist card: claim the Horse offer, pick a
  resident, give them an order, open the Wiki. Each line is ticked when the game sees it done;
  the card goes for good once all are ticked or the Player dismisses it. Kept per Player, not per
  realm: a Player who dismissed it never sees it again, also after a Leader death.
- **Minimap:** a small map bottom right of the screen (ADR 0008): the Player's explored terrain
  at a glance with their home city, their other cities, their residents and carriages away from
  home and the cities they know (Last seen), each a dot in its relationship colour, and the
  current view as a rectangle; a click centres the map there. It folds to a button, remembered
  per browser, and is folded on a phone.
- **Region map:** the map's territory overlay (one colour per Organization, ADR 0008). It is
  the far zoom tier's look and comes on there by itself; at the middle and close tiers only
  territory borders are drawn, so the terrain stays readable. The Region map button forces the
  overlay on at any tier and shows that it is on.
- **Roads far out:** at the far zoom tier the map draws the roads the Player knows (in sight or
  last seen) as thin lines over the terrain, so the way between cities stays readable however far
  out; road sites are left out there.
- **Waypoint:** a named marker the Player puts on a tile (from the map's right-click or
  long-press, or a script's `addWaypoint`), seen only by that Player: on the map at every zoom
  tier, on the minimap, and in the Waypoints drawer, where it can be renamed, centred on or
  removed. Kept in the world per Player, not per realm, so it survives a Leader death. A waypoint
  is a place like a tile: a walk-to target, a queue step's place, a `waypoint` script param.
  Scripts see their Player's waypoints and can add and remove them; a waypoint a script adds is
  noted in the realm log (who put it, its name and tile). A Player holds at most so many (a
  balance number); Explore marks its finds with them.
