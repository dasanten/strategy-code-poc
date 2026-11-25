# Glossary

The shared language of the game. Domain terms only — no implementation details.

## Core rule

- **Everything is physical:** goods, money and people exist at a place in the world and only
  change place by being carried there. Nothing teleports. Whatever isn't protected can be taken.

## How to use this

The rules are in `docs/context/`, one file per section; this is their index. Find the term here,
then read the section files your ticket names and those whose terms it uses, not all of them. A
new or changed rule goes into its section file, and a new term also into its line below. A
reference elsewhere to `CONTEXT.md` and a term means that term's entry in its section file; "above"
and "below" in an entry can mean another file of the same section.

## Sections

- [World](docs/context/world.md): World, Map, Game time, Tile, Terrain, Road, Step, The land,
  Region, Heartland, Frontier, Island.
- [Resources and goods](docs/context/resources-and-goods.md): Good, Pile, Resource node, Richness,
  Rare goods, Coal, Running dry, Workplace, Workplace amounts, Mine / Quarry / Lumber camp, Farm,
  Smelter / Mint, Carrying the output, Fetching inputs, Crew food, Holding a workplace, Gathering,
  Patch, Gather, Tools, Spoilage, Coins.
- [Building](docs/context/building.md): Construction site, Fetching materials, Build line, A crew
  on one line, Materials, Tearing down, Decay, Repairing, Ruin, Footprint, Where buildings go, At
  a building, Spreading over the footprint, A building's pile.
- [Trade Organization](docs/context/trade-organization.md) (what it is and owns; its fall): Trade
  Organization, Trade Org HQ, Warehouse, Trading post, Fall of the HQ, What the captor gets, What
  lives on.
- [Trade Organization: trading](docs/context/trading.md) (trades with it, with NPC cities and
  between realms; prices): Trading with the Trade Organization, Warehouse prices, Trading with an
  NPC city, Swap, Offer, NPC cities at an offer, Direct offer, Trade section, Stock floor, Price
  anchor.
- [Trade Organization: caravans](docs/context/caravans.md) (caravans, deliveries, what it does
  when robbed, admin directives): Caravan, Waiting for Food, Caravan crew lost, Wandering trader,
  Trader stop, Lost post found out, Delivery, Transfer, Guaranteed carriage, Self-interest,
  Punishment trip, Admin directive.
- [Organizations and territory](docs/context/organizations-and-territory.md) (realms, cities and
  their buildings, how a city joins, alliances, territory): Organization, Realm, Realm name, City,
  Renaming a city, Town hall, City building, City area, Wall / Gate, Wood or stone, Tower, House,
  City layout, Food surplus, Storage, Outpost storage, Refilling at an outpost storage, At home,
  Integrating, What joins with a city, Buying a city, Alliance, Alliance leader, NPC city in an
  alliance, New realm's shelter, Alliance army, Territory, Region map.
- [Organizations and territory: NPC cities](docs/context/npc-cities.md) (how they run, stock,
  build, trade, scout and found): NPC city, NPC reserve, Spare hands' work, Standing idle, Soldier
  posts, Bigger projects, NPC road, Scout, NPC trader, Escort, Soldiers in peace, Full city,
  Founding.
- [Organizations and territory: NPC stances](docs/context/npc-stances.md) (what an NPC city is
  like and how it acts against others): Temperament, Stance, Grow, Fortify, Trade, Expand,
  Retaliate, Threat, Acting first, Hunting a thief, NPC demand, Retaliating, Taking a node.
- [Sight](docs/context/sight.md): Sight, Seeing inside a storage, Seeing how someone fares,
  Explored terrain, Last seen.
- [Military](docs/context/military.md): Soldier, Weapons and armour, Equipment, Seeing it, Smithy,
  Ranged combat, Wear, Mending, Army, Supply line, Combat, Under attack, Walls in combat, Wall
  walk, High ground, A tile breaks, Siege machine, Ram, Catapult, Loot, Capturing a city,
  Occupying a town hall, Mercenary contract, Hiring from an NPC city, Trade Org army, Guarding the
  inner ring, Hiring mercenaries.
- [Crime and reputation](docs/context/crime-and-reputation.md): Crime, Witness, Stealing a
  carriage or horse, Standing, NPC city reaction, Persuading a city, Respect, Trade Org reaction,
  Trade Org debt, It demands, It wrecks, It takes the city, Trade Org army at an NPC gate, Demand.
- [Bandits](docs/context/bandits.md): Bandit camp, Band, Raiding, Bandit loot, Wiping out a camp.
- [People](docs/context/people.md): Player, Admin, Creative mode, Time controls, Creative actions,
  Checkpoints, Test worlds, Wiki, Leader, Zeal, Rallying the crew, Leader handover, Heir, Leader
  death with an heir, Leader death, Self-managed city.
- [Residents](docs/context/residents.md): Resident, Homeless, Relocate, Renaming a resident,
  Game-given names, Stats, Base value, Trained bonus, Skill, Training ground, Teacher, Trainee,
  Training, Who trains, Carry capacity, Pairing, Carrying, Child, Drifter, Drifters on the city
  card, Aging, Hunger, Down, Reviving, Eating, Own food, Refilling at home, Refilling at a
  workplace, Refilling from a carriage, Getting food.
- [Transport](docs/context/transport.md): Horse, Horse grant, Horse offer, Offering horses again,
  Horse name, Renaming a horse, Horses tab, Horse stats, Horses have no inventory, Stable,
  Breeding, Feeding the stable, Once, NPC horses, Horse market, Carriage, Building a carriage,
  Driving, Feeding a horse, Hitched horse, Hitching, Riding, Loading a carriage, Passenger, Haul
  route.
- [Water](docs/context/water.md): Water, Haven, Boat, Vessel, Building a boat, Beside a vessel,
  Seafaring, Rowing, No ferrying by itself, Vessels in sight, Fighting at a vessel, Haul route by
  water, Ship, Building a ship, Docked, Crew, Sailing, What vessels carry.
- [Starting city](docs/context/starting-city.md): Starting site, Starting city.
- [Control: orders and scripts](docs/context/control.md) (orders, scripts, default, defence and
  alarm scripts, actions and ticks): Order, Script, Waiting, Deleting versions, Library cap,
  Script parameter, Starting at once, Before it starts, Param comment, Store, Fetch, Default
  script, Started directly, Working a site, Workplace settings, Explore, Defence script, A
  Player's order under attack, On a carriage under attack (Defend default), Alarm, Alarm script,
  The Alarm default, Doing, Estimates, Memory, Script log, Debugging a script, Step budget, Value
  limits, Script view, Action, Tick.
- [Control: groups and queues](docs/context/queues.md) (orders for several residents, queues and
  their planner): Group, One command for a group, Planning for a group, Queue, Planning ahead,
  Saved queue, Planner clipboard, Queue draft, Clear, Repeat block, If block, Wait until,
  Condition, Planner blocks.
- [Control: the screen](docs/context/screen.md) (the UI: sidebar, cards, map, control modes,
  notices): Sidebar, Cities tab, Realm log, Screen, Pixel frontier, Resident card, Art style,
  Goods on cards, Motion on the map, Way on the map, Places of the picked, Planned building,
  Picking a target, Picking on the map, Control mode, Unit control mode, Realm control mode, Realm
  order, Who-list, Build menu, Residents list, Notices, First day, Goods in the top bar, Minimap,
  Region map, Roads far out, Waypoint.
