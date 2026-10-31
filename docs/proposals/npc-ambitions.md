# Proposal: NPC cities with ambitions

Settled with Daniel on 2026-10-31 in a grilling session. The rules are in `CONTEXT.md` (Crew
food, NPC city, NPC reserve, NPC trader, Full city, Founding, Trade Org HQ, Trading post); the
compute model is ADR 0016. This file says what to build, in what order, and with which numbers.
Ticketed as [Epic 48](https://github.com/dasanten/strategy-code-poc/issues/567), tickets #568–#573.

## The problem

Cities the game runs only survive. An NPC city works its farms, pairs its adults when it has a
food surplus, builds a house when the houses are full, and a lumber camp or quarry only when a
house or wall wants Wood or Stone it hasn't got. Nothing else is ever built: no mine, smelter,
smithy, mint or stable, even though its defence code looks for "its smithy". It never trades on
its own and never spreads. Trading posts never change; the Trade Org HQ grows only while its army
is too small.

Workers at far nodes spend a third of their time walking for Food: they set out with 4 days of
Food, fetch more below 2 days' worth, and take only 6 days back, while a node may be 160 tiles
(0.8 game days of walking) from home.

And the way the cities think is the most expensive thing about them: every city re-decides
everything every tick, with searches over its area and scans of all residents per workplace.

## What changes, in short

1. **Crew food.** The worker who carries a load home brings Food back for the crew and drops it
   on the workplace's pile, where workers already eat. A resident sent to a workplace sets out
   with Food for the walk and the first days. Part of the Work default, so Players get it too.
2. **A plan once a game hour** (ADR 0016) instead of deciding every tick, stored in the world.
3. **A wider reserve drives the chain.** The city keeps a reserve of everything it can use
   (Food, building materials, weapons for its soldiers, the Iron and Wood to forge them, a Coin
   war chest). Spare hands go to the good shortest of the reserve and build its workplace on the
   nearest node if none exists. Weapons short → smithy → Iron → smelter → ore → mine.
4. **A trader.** When a surplus makes a full load and a Trade Org warehouse is in reach, one
   spare hand walks it there, sells, buys what the city is short of and has no node for, and
   comes home. One at a time.
5. **Posts and the HQ run the same chain** with their warehouse floor as reserve. No growth in
   people, no trader, no founding.
6. **A full city founds a daughter.** A city idle and short of nothing for a game week, with a
   surplus and a town hall's and storage's materials to spare, sends a founding party of six to
   a free Plains site near a node of what it lacks. The daughter is an independent NPC village.

Out of scope, by decision: NPC cities trading with each other, posts growing in people, the
Trade Organization founding anything, any cap on daughters beyond "full" and free land.

## Tickets, in order

Each ticket is a vertical slice with its tests and invariants (ADR 0004) and updates its Wiki
section. Balance numbers are first picks for `packages/shared/src/balance.ts`; list them in the
PR.

### T1. Crew food in the Work default

- New param `crewFood: number` on the Work default: units of Food the carrier brings back for the
  pile, 0 for none. After `store(...)` succeeds the carrier fetches `crewFood` Food at the same
  storage (own food topped up to `foodTake` as today) and drops it on the workplace's pile on
  arrival; the farm's `keepFood` logic is untouched.
- NPC cities (`putToWork`) send a resident off with Food for the walk there plus a few days of
  work, by the walking distance to the workplace, instead of the flat `OWN_FOOD`.
- Numbers: `CREW_FOOD = 20` units (a crew of 6 for about 6 days, of 4 for 10; well inside a
  30 kg load); `SET_OUT_WORK_DAYS = 3` added to twice the walk. Both capped by carry capacity.
- Invariant: a Work-default carrier never carries more than their capacity; the pile's Food is
  never negative. Test: a lumber camp 160 tiles from home keeps six workers working for 30 game
  days with no worker but the carrier leaving it.
- Wiki: Scripting (Work default params), Residents (Getting food).

### T2. The planning pass and the city plan (ADR 0016)

- `CityPlan` in the world state per game-run city: `plannedAt`, a job per resident
  (`{ kind: 'soldier' | 'farm' | 'work' | 'build' | 'trade' | 'found' | 'idle', buildingId? }`),
  `project`, `trader`, `fullSince`, `foundingSite`. `WORLD_FORMAT_VERSION` bump with a migration
  that starts every city with an empty plan (the first pass fills it).
- `planCity(world, city, terrain)` runs when `(world.tick + hash(city.id)) % NPC_PLAN_TICKS ===
0`, `NPC_PLAN_TICKS = 60`. It reproduces today's decisions exactly (farms first until surplus,
  house, farm, wall, material workplace) so this ticket changes performance, not behaviour.
- `stepNpcCities` per tick only indexes the city's residents once (by workplace, by order) and
  hands idle residents their planned job; `room()`/`takenPlaces()` read the index.
- Tick health gains `npcPlanMs`; a test asserts a full map's planning stays under a budget (say
  5 ms per tick on the CI machine, as a smoke check, not a hard gate).
- Existing NPC tests step a game hour where they stepped a tick.

### T3. The reserve-driven chain

- Widen the reserve (`npc-trade.ts` reserve → `npcReserve(world, city)`): Food 15 days as today;
  Wood and Stone for a house and `reserveWallStretches`; weapons for `npcSoldierTarget`; the
  smithy recipe's Iron and Wood for the missing weapons; coins `NPC_WAR_CHEST_PER_RESIDENT = 10`
  per resident. Stable wanted with a horse of the city and no stable; mint wanted with a gold
  node within `NPC_NODE_REACH` and coins short.
- Allocation in the pass, in this order: soldiers (as today), farmers
  `ceil(residents × FOOD_PER_DAY / WORK_OUTPUT_PER_DAY.food)` plus one without a surplus, up to
  two builders while a project exists, the rest to the workplace of the good shortest of the
  reserve (share of the reserve missing), filling a crew before the next.
- Projects: the next shortest good whose workplace doesn't exist and whose node is in reach
  (`NPC_NODE_REACH`), or whose workplace is a processing one (smelter, smithy, mint) placed in the
  city area like a house. Materials the project needs follow the existing "build the material's
  workplace first" rule.
- Processing workplaces (smelter, smithy, mint) are worked too; their inputs are fetched from the
  storage by the Work default as a Player's are.
- Invariants: every planned job points at a workplace of the city that exists and isn't a site;
  the planned farmers never fall below what feeds the city while a farm has room.
- Test: a town with forest, stone and iron nodes in reach builds lumber camp, quarry, mine,
  smelter and smithy in that order over game weeks and arms its soldiers with spears it forged.
- Wiki: NPC cities (new section on the reserve and the chain).

### T4. The NPC trader

- In the pass: a surplus of one good ≥ the trader's capacity, no trader out, a Trade Org
  warehouse within `NPC_TRADER_REACH = 720` tiles → one spare hand gets the `trade` job: pick up
  the surplus, walk to the warehouse, sell, buy the good shortest of the reserve that the city
  has no node for (up to the coins carried and their capacity), walk home, store. Through the
  existing trade orders; the trader is never a soldier.
- `plan.trader = { residentId, warehouseId, sells, buys, since }`; a trader gone for more than
  `NPC_TRADER_GIVE_UP_DAYS = 10` game days (dead, robbed, stuck) is dropped from the plan so the
  city may send another.
- Invariant: at most one trader per city. Test: a village with 60 surplus Wood and a post 500
  tiles away sends one resident who comes back with coins, and with Iron when Iron is short.
- Wiki: NPC cities (trader), Trade Organization (who trades at a warehouse).

### T5. Posts and the HQ run the chain

- `cityGrowth` no longer returns early for the Trade Organization's cities: the reserve of a post
  or the HQ is its warehouse floor (`WAREHOUSE_FLOOR`, times the HQ's multiple), its spare hands
  follow T3's allocation, the `trade` and `found` jobs are never given, pairing and houses stay
  as today (HQ only while too weak; posts never).
- Test: a post with an iron node in reach builds a mine and its warehouse rises above the floor
  in ore without the floor topping it up.
- Wiki: Trade Organization (what posts and the HQ produce).

### T6. Full cities found daughters

- `fullSince` is set when the pass finds idle spare hands and nothing short, cleared otherwise;
  full after `NPC_FULL_DAYS = 7` game days with a food surplus and a town hall's and storage's
  materials above the reserve.
- Founding site search, once a game day while full: `NPC_FOUND_SAMPLES = 200` random tiles
  between `NPC_CITY_MIN_DISTANCE` (480) and `NPC_FOUND_REACH = 960` from the home, Plains, fits
  a village's layout without the wall (`npcSiteFits` minus the wall and the out-of-sight rule),
  on no realm's territory; the one nearest a node of the good the mother is short of and has no
  node for wins, else the nearest. Cached in `plan.foundingSite`.
- Founding party: `NPC_VILLAGE.residents` (6) spare hands, one of them armed, each given a
  `found` job with their share of 60 Wood, 40 Stone and the storage's materials, plus Food for
  twice the walk and `NPC_FOUND_FOOD_DAYS = 20`. They walk to the site; the first there lays out
  the town hall and all build it by the Build default (materials from what they carry); finished,
  the town hall founds the daughter (`cityId` of the party moves to it, name from the game); then
  storage, farm, house in that order as the daughter's own projects. The daughter's first wall: a
  project of a ring `NPC_VILLAGE.size / 2` tiles round its home once its reserve holds the Wood
  for it.
- Standing: mother and daughter start at high standing toward each other.
- A party that loses its materials or members before the hall stands walks home after
  `NPC_FOUND_GIVE_UP_DAYS = 20`; the mother may try again later.
- Invariants: a founding party's members all belong to the mother until the hall is finished;
  one party per city; the daughter is a city of no realm with a town hall. Test (slow, tagged):
  a town with a food surplus and spare hands founds a village 500+ tiles away within a few game
  weeks, and the village then feeds itself.
- Wiki: NPC cities (founding), World (how the world changes).

## Compute, in one table

| Work                              | How often                      | Cost                             |
| --------------------------------- | ------------------------------ | -------------------------------- |
| Planning pass                     | 1 city per tick, each per hour | O(residents + buildings of city) |
| Project site search               | when the project changes       | area scan, cached                |
| Founding site search              | once a game day while full     | 200 samples, cached              |
| Idle resident gets planned job    | every tick                     | O(residents of city), indexed    |
| Defence, refills, default scripts | every tick, as today           | unchanged                        |

With 33 game-run cities today and, say, 60 after a month of daughters, about one planning pass
runs per tick. The per-tick work per city shrinks against today.

## Open numbers for Daniel

None block a ticket; each PR lists what it picked. The ones most worth a look: `CREW_FOOD` (how
long a crew lasts between carrier trips), `NPC_TRADER_REACH` (how far a lone trader walks), and
`NPC_FULL_DAYS` with `NPC_FOUND_REACH` (how fast and how far the world fills in).
