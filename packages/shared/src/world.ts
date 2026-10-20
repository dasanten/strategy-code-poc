import { Terrain } from './terrain.js'

export const TICK_MS = 1000

/** One game day is one real hour (`CONTEXT.md`: Game time). */
export const TICKS_PER_GAME_DAY = 3600
/** One game year is one real day. */
export const TICKS_PER_GAME_YEAR = 24 * TICKS_PER_GAME_DAY

/** A resident's stats (`CONTEXT.md`: Stats). */
export const STAT_NAMES = ['strength', 'endurance', 'agility', 'intellect'] as const
export type StatName = (typeof STAT_NAMES)[number]

/** A stat: what the resident was born with, plus what training added (capped by the base). */
export interface Stat {
  base: number
  trained: number
}

/** Something learned by doing or training; starts at 0, never inherited (`CONTEXT.md`: Skill). */
export type SkillName =
  | 'mining'
  | 'woodcutting'
  | 'smelting'
  | 'smithing'
  | 'construction'
  | 'farming'
  | 'combat'
  | 'driving'

/** A person living in the world (`CONTEXT.md`: Resident). Plain data. */
export interface Resident {
  id: string
  name: string
  /** The realm the resident belongs to; null for one of an NPC city (`cityId`) or of nobody. */
  owner: string | null
  /** The city the resident lives in (`CONTEXT.md`: City, House); null for one of no city. */
  cityId: string | null
  x: number
  y: number
  stats: Record<StatName, Stat>
  /** Skills learned so far; a missing skill is 0. */
  skills: Partial<Record<SkillName, number>>
  /** 0 is dead; the most is `MAX_HEALTH`. */
  health: number
  /** The hunger meter: `MAX_HUNGER` is fully fed, 0 is empty. */
  hunger: number
  /** The tick the resident was born; may be before the world began. Age follows from it. */
  bornAt: number
  /** The age in game years at which the resident dies of old age (`CONTEXT.md`: Aging). */
  lifespan: number
  /** Goods the resident carries, up to their carry capacity. */
  carried: Stock
  /** What the resident was ordered to do, as plain data; null when idle (ADR 0002). */
  order: ResidentOrder | null
  /**
   * The script the resident runs, when they were given the run-script order (`CONTEXT.md`:
   * Running a script). Its actions set `order` like UI orders; any other order ends it. Absent
   * when they run none.
   */
  script?: RunningScript
}

/** A script value as plain data, the only kind a script's memory keeps between ticks. */
export type MemoryValue = number | string | boolean | null | MemoryValue[] | ScriptMemory

/** A running script's memory (`CONTEXT.md`: Memory): plain, serialisable data (ADR 0002). */
export interface ScriptMemory {
  [key: string]: MemoryValue
}

/**
 * A resident's or army's run-script order: which script of the Player's library, and its memory.
 */
export interface RunningScript {
  /** The script in the Player's library; its active version is what runs each tick. */
  scriptId: number
  /** What the script kept between ticks, at most `SCRIPT_MEMORY_MAX` characters of JSON. */
  memory: ScriptMemory
  /** The tick its last error went into the realm log; errors are logged rate-limited. */
  errorLoggedAt?: number
  /** The tick its last out-of-steps warning went into the realm log. */
  budgetLoggedAt?: number
}

/**
 * A resident as Players see them (`CONTEXT.md`: Sight): which script they run, but not its
 * memory, which stays on the server.
 */
export type SeenResident = Omit<Resident, 'script'> & { script?: Pick<RunningScript, 'scriptId'> }

/**
 * Walking to a tile (`CONTEXT.md`: Order). The path is found a little at a time after the order
 * arrives; until then it is null. `progress` is how far into the next step the resident is, in
 * tiles; at 1 they request the step.
 */
export interface WalkOrder {
  kind: 'walkTo'
  target: { x: number; y: number }
  /** The tiles still to walk, in order; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /** The army whose order this is (`CONTEXT.md`: Army); missing for the resident's own order. */
  army?: string
}

/**
 * A place on the resident's own tile that goods are taken from or put: the pile on the ground,
 * a storage standing there, the materials delivered to a construction site there, or the load
 * of a carriage standing there.
 */
export type GoodsSpot =
  | { kind: 'ground' }
  | { kind: 'storage'; storageId: string }
  | { kind: 'site'; siteId: string }
  | { kind: 'carriage'; carriageId: string }

/**
 * Picking up goods on the resident's tile (`CONTEXT.md`: Core rule, whatever isn't protected can
 * be taken). The resident takes what is there of `goods`, as much as fits their carry capacity.
 */
export interface PickUpOrder {
  kind: 'pickUp'
  from: GoodsSpot
  goods: Stock
}

/**
 * Putting down carried goods on the resident's tile: on the ground (a pile), in a storage, or as
 * materials for a construction site (only what the site still needs).
 */
export interface DropOrder {
  kind: 'drop'
  to: GoodsSpot
  goods: Stock
}

/**
 * Building (`CONTEXT.md`: Building, Road): the resident lays out a construction site of
 * `building` on the tile they stand on (`at`), or joins the unfinished one of that kind already
 * there, then works on it until it is finished. `siteId` is null until they are on the site.
 */
export interface BuildOrder {
  kind: 'build'
  building: BuildingKind
  at: { x: number; y: number }
  siteId: string | null
}

/**
 * Working at a workplace (`CONTEXT.md`: Workplace): the resident works the workplace on the tile
 * they stand on (`at`), until ordered otherwise. `progress` is how much of the
 * next unit of output their work has made so far, from 0 up to (not including) 1.
 */
export interface WorkOrder {
  kind: 'workAt'
  buildingId: string
  at: { x: number; y: number }
  progress: number
  /**
   * At a workplace with more than one recipe (a smithy), the good this resident makes there
   * (`recipeFor`). Missing elsewhere.
   */
  makes?: Good
}

/**
 * Tearing down (`CONTEXT.md`: Tearing down): the resident works at taking down the building or
 * construction site `buildingId` on the tile they stand on (`at`) until it is gone.
 */
export interface TearDownOrder {
  kind: 'tearDown'
  buildingId: string
  at: { x: number; y: number }
}

/**
 * Pairing (`CONTEXT.md`: Pairing): the resident and their partner, two adults of the same city,
 * are set to have children. Both hold a pair order naming the other, with the same `since`: the
 * tick they paired or last had a child. A child can come once a game year has passed since then,
 * while their city has free housing and a food surplus. Any other order for either ends it.
 */
export interface PairOrder {
  kind: 'pair'
  partnerId: string
  since: number
}

/**
 * Driving a carriage to a tile (`CONTEXT.md`: Carriage): the resident drives the carriage
 * `carriageId` from their tile, and the carriage, its horse and the driver move together. The
 * path and `progress` work as for walking, at the carriage's speeds and never into mountains.
 */
export interface DriveOrder {
  kind: 'drive'
  carriageId: string
  target: { x: number; y: number }
  /** The tiles still to drive, in order; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /**
   * The army the carriage follows as its supply wagon (`CONTEXT.md`: Supply line): `target` is
   * then where the army was last seen, and the order lasts as long as the army does.
   */
  army?: string
}

/**
 * A haul route (`CONTEXT.md`: Haul route): the resident drives the carriage `carriageId` between
 * two stops again and again. At `from` they load `goods` onto it, as much as there is and fits;
 * at `to` they unload them, and the other way round for `returnGoods`. At both stops they top up
 * the Food on board to `keepFood` units, for the horse, and that much Food stays on. Loading and unloading go through their hands, one take
 * or put a tick, like a pick-up or drop order. Driving works as for a drive order.
 */
export interface HaulOrder {
  kind: 'haul'
  carriageId: string
  /** Where the goods are loaded. */
  from: { x: number; y: number }
  /** Where they are unloaded. */
  to: { x: number; y: number }
  /**
   * The army that is the second stop (`CONTEXT.md`: Supply line): `to` is then where the army was
   * last seen. There the carriage stays with the army, its members refilling from it, until the
   * hauled goods are gone, and then goes back for more. Nothing comes back.
   */
  toArmy?: string
  /** The goods hauled from `from` to `to`; at least one. */
  goods: Good[]
  /** The goods hauled back from `to` to `from`; none of `goods`, and maybe none at all. */
  returnGoods: Good[]
  /** Units of Food kept on board for the horse. */
  keepFood: number
  /** The stop the carriage stands at or is driving to. */
  stop: 'from' | 'to'
  /** Loading and unloading at the stop, or driving to it. */
  phase: 'loading' | 'driving'
  /** While driving, the tiles still to drive; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /**
   * Goods the resident took last tick to put on the carriage or at the stop: which good, how many
   * of it they held before, and where it goes. Null when they hold nothing for the route.
   */
  moving: { good: Good; before: number; onto: 'carriage' | 'stop' } | null
}

/**
 * Attacking a resident (`CONTEXT.md`: Combat): the resident goes after `targetId` and, once in
 * contact (the same or a neighbouring tile), strikes them until one of them dies, the target gets
 * out of their sight or they are given another order. The target may also be a wall or gate, which
 * they strike until it falls (`CONTEXT.md`: Walls in combat, broken). Out of contact they walk towards the target
 * along `path` (null while it is being found), as for a walk order; `progress` is how far into the
 * next step they are. `strike` is how far, from 0 up to 1, they are into their next blow.
 * `started` is set once the fight went in the realm logs. `defending` is set when the resident
 * fights back at someone who hit them, which is no crime (`CONTEXT.md`: Crime).
 */
export interface AttackOrder {
  kind: 'attack'
  targetId: string
  path: [number, number][] | null
  progress: number
  strike: number
  started: boolean
  defending?: true
  /** The army whose order this is (`CONTEXT.md`: Army); missing for the resident's own order. */
  army?: string
}

/**
 * Building a road along a line (`CONTEXT.md`: Road): the resident builds the road tiles of
 * `tiles` one after another. For each they walk to it (`path` and `progress` as for a walk
 * order), then lay out a road there or join the site already there, put in the materials they
 * carry that it needs, and work on it as for a build order (`siteId`) until it is finished. A
 * tile that already has a road, or can't take one, is skipped. The order ends after the last.
 */
export interface RoadLineOrder {
  kind: 'roadLine'
  /** The tiles still to build, in order; the first is being walked to or built. Never empty. */
  tiles: [number, number][]
  phase: 'walking' | 'building'
  /** While walking, the tiles still to walk; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /** While building, the road site on the first tile; null until it is laid out or joined. */
  siteId: string | null
}

/**
 * Climbing a wall or gate (`CONTEXT.md`: Walls in combat, climbed): the resident, standing at
 * `at` next to `wallId`, climbs over it. `progress` goes from 0 up to 1 (`CLIMB_TICKS`); then
 * they come down on the far side. While climbing they can't defend themselves.
 */
export interface ClimbOrder {
  kind: 'climb'
  wallId: string
  at: { x: number; y: number }
  progress: number
}

/** Any order a resident can hold. */
export type ResidentOrder =
  | WalkOrder
  | DriveOrder
  | HaulOrder
  | PickUpOrder
  | DropOrder
  | BuildOrder
  | TearDownOrder
  | WorkOrder
  | PairOrder
  | AttackOrder
  | ClimbOrder
  | RoadLineOrder
  | PayOrder
  | BuyCityOrder
  | TradeOrder

/** A stat's effective value: base and trained bonus together. */
export function effective(stat: Stat): number {
  return stat.base + stat.trained
}

/** A resident's age in game years at the given tick. */
export function ageInYears(resident: Resident, tick: number): number {
  return (tick - resident.bornAt) / TICKS_PER_GAME_YEAR
}

/**
 * Everything in the world that changes, saved as snapshots (ADR 0006). Terrain is not part of
 * it: it is generated once from `seed` and stored on its own.
 */
export interface WorldState {
  tick: number
  /** The seed the map was generated from. */
  seed: number
  residents: Resident[]
  /** Placed once when the world is created, from the terrain and the seed. */
  nodes: ResourceNode[]
  /** The number the next new entity's id gets, so ids are never reused. */
  nextId: number
  realms: Realm[]
  cities: City[]
  buildings: Building[]
  horses: Horse[]
  carriages: Carriage[]
  /** Goods lying on the ground, at most one pile per tile. */
  piles: Pile[]
  /** Each Player's latest realm events, oldest first, at most `REALM_LOG_LENGTH` each. */
  events: RealmEvent[]
  /** Alliances with at least one member (`CONTEXT.md`: Alliance). */
  alliances: Alliance[]
  /** Armies with at least one member (`CONTEXT.md`: Army). */
  armies: Army[]
  /** Crimes a witness still carries news of, or that an Organization still remembers. */
  crimes: Crime[]
  /** Mercenary contracts offered or in force (`CONTEXT.md`: Mercenary contract). */
  contracts: MercenaryContract[]
  /** The Trade Organization's caravans, one on each trading post's route (`CONTEXT.md`: Caravan). */
  caravans: Caravan[]
}

/**
 * A Trade Org caravan (`CONTEXT.md`: Caravan): one of the Trade Organization's carriages, driven
 * by one of its residents and escorted by others, on the fixed route between a trading post and
 * the Trade Org HQ. At each end it stops first at the storage, to top up the Food on board for
 * its crew and horse, then at the warehouse, where it unloads what it brought and loads what
 * evens out the two warehouses' stock. Plain data (ADR 0002): the game gives the crew the same
 * drive, pick-up, drop and walk orders a Player could give.
 */
export interface Caravan {
  id: string
  /** The trading post at the far end of its route; the other end is the HQ. */
  postId: string
  carriageId: string
  /** The resident who drives the carriage. */
  driverId: string
  /** The residents who walk along with it (the escort). */
  escortIds: string[]
  /** The end of the route it stands at or is driving to. */
  heading: 'hq' | 'post'
  /** Where at that end it stands or is going: the storage first, then the warehouse. */
  stop: 'storage' | 'warehouse'
  /**
   * Goods still to load at this end's warehouse for the other end, worked out once all it
   * brought is unloaded; null until then.
   */
  toLoad: Stock | null
  /**
   * Goods the driver took last tick to put down, and where they go; null when they hold nothing
   * for the caravan.
   */
  holding: { goods: Stock; onto: 'carriage' | 'stop' } | null
}

/** A caravan as Players see it, while its carriage or any of its crew is in sight. */
export type SeenCaravan = Pick<
  Caravan,
  'id' | 'postId' | 'carriageId' | 'driverId' | 'escortIds' | 'heading'
>

/**
 * A mercenary contract (`CONTEXT.md`: Mercenary contract): the lender rents some of its residents
 * to the hirer for `days` game days, at `pricePerWeek` coins a game week, paid into the lender's
 * storage `storageId`. One side offers it, the other accepts; until then it is only an offer.
 * The residents stay the lender's but take only the hirer's orders while it is in force. Each
 * game week is paid in advance; one that ends unpaid breaks the contract. For now both sides are
 * Players' realms. Plain data (ADR 0002).
 */
export interface MercenaryContract {
  id: string
  /** The realm whose residents are rented out. */
  lenderId: string
  /** The realm that rents them. */
  hirerId: string
  /** Which side offered it; the other side accepts or declines. */
  offeredBy: 'lender' | 'hirer'
  /** The rented residents, all the lender's; never empty. */
  residentIds: string[]
  /** How long it runs once accepted, in game days. */
  days: number
  /** Coins for each game week, paid in advance. */
  pricePerWeek: number
  /** The lender's storage the coins go into. */
  storageId: string
  /** The tick it was accepted; null while it is only offered. */
  startedAt: number | null
  /** Game weeks paid so far, counted from the first. */
  paidWeeks: number
}

/**
 * Paying for a mercenary contract (`CONTEXT.md`: Mercenary contract): the resident, standing on
 * the contract's storage, puts in the coins for `weeks` game weeks from what they carry.
 */
export interface PayOrder {
  kind: 'pay'
  contractId: string
  weeks: number
}

/**
 * Buying an NPC city (`CONTEXT.md`: Buying a city): the resident, standing on the city's town
 * hall, completes the deal with the coins the realm's residents there carry. It happens this tick.
 */
export interface BuyCityOrder {
  kind: 'buyCity'
  cityId: string
}

/**
 * Trading at a Trade Org warehouse (`CONTEXT.md`: Trading with the Trade Organization): the
 * resident, standing on its tile, buys or sells up to `units` of `good` at its prices, from and
 * into their hands, or the load of `carriageId` on their tile. It happens this tick.
 */
export interface TradeOrder {
  kind: 'trade'
  side: 'buy' | 'sell'
  good: Exclude<Good, 'coins'>
  units: number
  carriageId: string | null
}
/** What a crime was (`CONTEXT.md`: Crime). */
export type CrimeKind = 'theft' | 'attack' | 'killing' | 'tearDown'

/**
 * A crime against another Organization (`CONTEXT.md`: Crime, Witness). An Organization is named by
 * its realm's id, or by its city's id for a city of no realm (`organizationOf`). Plain data.
 */
export interface Crime {
  id: string
  kind: CrimeKind
  /** The tick it happened, and where the culprit stood. */
  tick: number
  x: number
  y: number
  /** Who did it, and their Organization with its name at the time. */
  culprit: { residentId: string; name: string; org: string; orgName: string }
  /** The Organization it was against. */
  victimOrg: string
  /** The resident attacked or killed. */
  victim?: { residentId: string; name: string }
  /** What was stolen. */
  goods?: Stock
  /** What was torn down. */
  building?: BuildingKind
  /**
   * Residents who saw it, or the victim who survived it, and have not got home yet. Each makes it
   * known to their own Organization once they stand in the area of one of its cities.
   */
  witnesses: string[]
  /** The Organizations it is known to. */
  knownBy: string[]
}

/**
 * A named group of a realm's residents moving and fighting together under one order
 * (`CONTEXT.md`: Army). A resident is in at most one army; one given an order of their own
 * leaves it. Plain data (ADR 0002).
 */
export interface Army {
  id: string
  /** Chosen by the Player who formed it. */
  name: string
  realmId: string
  /** Its residents; never empty. */
  memberIds: string[]
  /** What it was ordered to do; null when idle. */
  order: ArmyOrder | null
  /**
   * The script the army runs, when it was given the run-script order (`CONTEXT.md`: Running a
   * script). Its actions set `order` like UI army orders; any other army order ends it. Absent
   * when it runs none.
   */
  script?: RunningScript
}

/** An army as its Player sees it: which script it runs, but not its memory. */
export type SeenArmy = Omit<Army, 'script'> & { script?: Pick<RunningScript, 'scriptId'> }

/**
 * An army's order (`CONTEXT.md`: Army). It gives its members walk or attack orders tagged with
 * the army, and members walking for it keep together at the pace of the slowest. `started` is
 * set once the members got their orders.
 * - `walkTo`: all walk to a tile; done once none is still walking there.
 * - `attack`: all go after one resident and strike them; done once none is still at it.
 * - `guard`: all walk to a tile and stay; one who is idle away from it walks back. Until another
 *   order.
 * - `follow`: all keep in contact with a resident wherever they go, until that resident is gone
 *   or out of the army's sight.
 */
export type ArmyOrder =
  | { kind: 'walkTo'; target: { x: number; y: number }; started: boolean }
  | { kind: 'attack'; targetId: string; started: boolean }
  | { kind: 'guard'; at: { x: number; y: number }; started: boolean }
  | { kind: 'follow'; targetId: string; started: boolean }

/** What a resident died of: hunger, old age, or blows in a fight (`CONTEXT.md`: Combat). */
export type DeathCause = 'starved' | 'oldAge' | 'killed'

/** What happened, by kind; the rest of a `RealmEvent` says when and for whom. */
export type RealmEventWhat =
  /** A resident's hunger meter ran empty: they have nothing to eat and lose health. */
  | { kind: 'hungry'; residentId: string; name: string }
  /** A resident died; `leader` when it was the Leader, whose death ended the realm. */
  | {
      kind: 'died'
      residentId: string
      name: string
      cause: DeathCause
      leader: boolean
      /** Who killed them, by name, when they were `killed`. */
      by?: string
    }
  /**
   * A fight began (`CONTEXT.md`: Combat): the realm's resident `name` struck the first blow at
   * `other`, or, when not `attacker`, `other` struck it at them.
   */
  | {
      kind: 'fight'
      residentId: string
      name: string
      otherId: string
      other: string
      attacker: boolean
    }
  /**
   * A witness brought home news of a crime against the realm (`CONTEXT.md`: Crime, Witness):
   * `culprit` of `culpritOrg` did `crime` at tick `at`, to `victim`, taking `goods` or tearing
   * down `building`.
   */
  | {
      kind: 'crimeKnown'
      crimeId: string
      crime: CrimeKind
      at: number
      x: number
      y: number
      culpritId: string
      culprit: string
      culpritOrg: string
      victim?: string
      goods?: Stock
      building?: BuildingKind
    }
  /** A resident who carries no weapon was hit and flees home (`CONTEXT.md`: Combat). */
  | { kind: 'fled'; residentId: string; name: string }
  /**
   * A city changed realm by capture (`CONTEXT.md`: Capturing a city): this realm took `city`,
   * with its `residents`, from the realm of `other` (by its Leader's name; null for an NPC
   * city), or, when not `captor`, the realm of `other` took it from this one.
   */
  | {
      kind: 'cityCaptured'
      cityId: string
      city: string
      other: string | null
      captor: boolean
      residents: number
    }
  /**
   * The realm bought the NPC city `city` (`CONTEXT.md`: Buying a city) for `price` coins, now
   * gone, with its `residents`; its town hall is at (`x`, `y`).
   */
  | {
      kind: 'cityBought'
      cityId: string
      city: string
      price: number
      residents: number
      x: number
      y: number
    }
  /**
   * A buy order for `city` fell through when it was carried out: the realm's residents at its
   * town hall carried `coins`, short of its `price`.
   */
  | { kind: 'cityNotBought'; cityId: string; city: string; price: number; coins: number }
  /**
   * The resident `name` traded at the Trade Org warehouse at (`x`, `y`) (`CONTEXT.md`: Trading
   * with the Trade Organization): bought or sold `units` of `good` for `coins`, of the `wanted`
   * units; fewer when it was cut down, none when nothing could be traded.
   */
  | {
      kind: 'traded'
      residentId: string
      name: string
      side: 'buy' | 'sell'
      good: Exclude<Good, 'coins'>
      units: number
      wanted: number
      coins: number
      x: number
      y: number
    }
  /**
   * The realm's Leader died and the realm ended (`CONTEXT.md`: Leader death): each of its
   * `cities` became a self-managed city, with the residents living there, its town hall at
   * (`x`, `y`) so the Player can find it again.
   */
  | {
      kind: 'selfManaged'
      cities: { cityId: string; name: string; x: number; y: number; residents: number }[]
    }
  /**
   * The Player's Leader `name` founded the realm's starting city `city`, its town hall at
   * (`x`, `y`): on their first login, or as a fresh start after their Leader died.
   */
  | {
      kind: 'founded'
      residentId: string
      name: string
      cityId: string
      city: string
      x: number
      y: number
    }
  /** Food went bad over the game day in the realm's storages, residents' loads and carriages. */
  | { kind: 'foodSpoiled'; units: number }
  /** A pair had a child (`CONTEXT.md`: Pairing, Child); `parents` are their names. */
  | { kind: 'born'; residentId: string; name: string; parents: [string, string] }
  /** A child reached `ADULT_AGE` and can now work (`CONTEXT.md`: Child, Aging). */
  | { kind: 'grownUp'; residentId: string; name: string }
  /** One of the realm's horses starved to death (`CONTEXT.md`: Horse). */
  | { kind: 'horseDied'; horseId: string }
  /** Two of the realm's horses had a foal at a stable (`CONTEXT.md`: Stable). */
  | { kind: 'foaled'; horseId: string; stableId: string }
  /** An alliance leader invited the realm to join their alliance (`CONTEXT.md`: Alliance leader). */
  | { kind: 'allianceInvited'; allianceId: string; name: string }
  /** A realm (`realm`, by its Leader's name) joined the alliance: this one, or another. */
  | { kind: 'allianceJoined'; allianceId: string; name: string; realmId: string; realm: string }
  /**
   * A realm stopped being a member of the alliance: this one, or another. `removed` when the
   * alliance leader removed it; `leaderDied` when its Leader died and it left at once.
   */
  | {
      kind: 'allianceLeft'
      allianceId: string
      name: string
      realmId: string
      realm: string
      why: 'left' | 'removed' | 'leaderDied'
    }
  /** The role of alliance leader passed to a member (`CONTEXT.md`: Alliance leader). */
  | { kind: 'allianceLeader'; allianceId: string; name: string; realmId: string; realm: string }
  /**
   * A resident's or army's script stopped with an error this tick (`CONTEXT.md`: Running a
   * script); it runs again next tick. `line` and `column` say where, when the error is in the
   * script itself. Script events name the resident by `residentId` or the army by `armyId`.
   */
  | ({
      kind: 'scriptError'
      name: string
      scriptId: number
      message: string
      line?: number
      column?: number
    } & ScriptRunBy)
  /**
   * A resident's or army's script ran out of steps (`CONTEXT.md`: Step budget): its own budget,
   * or, when `realm`, the realm's, so it was cut short or skipped the tick.
   */
  | ({ kind: 'scriptOutOfSteps'; name: string; scriptId: number; realm: boolean } & ScriptRunBy)
  /** A run-script order ended because its script was deleted from the library. */
  | ({ kind: 'scriptEnded'; name: string; scriptId: number } & ScriptRunBy)
  /**
   * A mercenary contract (`CONTEXT.md`: Mercenary contract) with the realm `other` (by its
   * Leader's name) changed: `offered` to this realm, `started` once accepted, `paid` for `weeks`
   * more game weeks, `ended` when its time was up, or `broken` when a week went unpaid. `lender`
   * when this realm rents out the residents.
   */
  | {
      kind: 'contract'
      contractId: string
      what: 'offered' | 'started' | 'paid' | 'ended' | 'broken'
      lender: boolean
      other: string
      residents: number
      weeks?: number
    }

/**
 * Something that happened in a Player's realm, for their log. Plain data. It belongs to the
 * Player, not the realm: a realm ends with its Leader, and the Player should still read why.
 */
export type RealmEvent = RealmEventWhat & {
  /** Numbered from the world's `nextId`, so a later event has a higher number. */
  seq: number
  tick: number
  /** The Player's account. */
  userId: number
}

/** Goods lying on the ground on one tile, for anyone to take (`CONTEXT.md`: Pile). */
export interface Pile {
  id: string
  x: number
  y: number
  goods: Stock
}

/**
 * PoC goods (`CONTEXT.md`: Good, Weapons and armour). Amounts are counted in units;
 * `GOOD_WEIGHT` weighs them.
 */
export const GOODS = [
  'food',
  'wood',
  'stone',
  'ironOre',
  'iron',
  'goldOre',
  'coins',
  'spear',
  'sword',
  'shield',
  'armour',
] as const
export type Good = (typeof GOODS)[number]

/** Goods that make a resident armed (`CONTEXT.md`: Soldier, Weapons and armour). */
export const WEAPONS = ['spear', 'sword'] as const satisfies readonly Good[]
export type Weapon = (typeof WEAPONS)[number]

/** Goods that take off damage (`CONTEXT.md`: Weapons and armour): shields and armour. */
export const PROTECTION = ['shield', 'armour'] as const satisfies readonly Good[]
export type Protection = (typeof PROTECTION)[number]

/** Goods by kind, as unit counts; a missing good is 0. */
export type Stock = Partial<Record<Good, number>>

/** Everything one Player controls through their Leader (`CONTEXT.md`: Realm). */
export interface Realm {
  id: string
  /** The Player's account. */
  userId: number
  /** The resident who is the Player's Leader. */
  leaderId: string
}

/**
 * A group of Organizations that agreed to join (`CONTEXT.md`: Alliance). For now its members are
 * Players' realms; a realm is in at most one. It ends when its last member is gone.
 */
export interface Alliance {
  id: string
  /** Chosen by the realm that founded it. */
  name: string
  /** The member realm that is the alliance leader (`CONTEXT.md`: Alliance leader). */
  leaderId: string
  /** Members in the order they joined, so the first is the longest-standing. Never empty. */
  members: AllianceMember[]
  /** Realms the alliance leader invited that have not accepted or declined yet. */
  invites: string[]
  /**
   * The alliance army (`CONTEXT.md`: Alliance army): soldiers and carriages members handed over
   * to the alliance leader's command, in the order they were handed over.
   */
  army: AllianceArmyPart[]
}

/**
 * A soldier or carriage handed over to an alliance's army. It stays in its own realm (the
 * resident's `owner`, the carriage's `realmId`) but takes orders only from the alliance leader.
 */
export interface AllianceArmyPart {
  is: 'resident' | 'carriage'
  id: string
  /** The tick its owner's recall takes effect; null while it stays. */
  recallAt: number | null
}

/** A realm's membership in an alliance. */
export interface AllianceMember {
  realmId: string
  /** The tick it joined, or founded the alliance. */
  joinedAt: number
  /**
   * Set once it leaves, or the alliance leader removes it (`removed`): the tick that takes
   * effect. Until then it is a member like any other. Null while it stays.
   */
  leaving: { at: number; removed: boolean } | null
}

/**
 * A settlement (`CONTEXT.md`: City). It has exactly one town hall, and its shape follows from its
 * buildings (`cityMembership`, `inCityArea`); it is never stored. The number in its id says how
 * old it is: a lower one was founded earlier.
 */
export interface City {
  id: string
  name: string
  /** The realm it belongs to; null for an NPC city (`CONTEXT.md`: NPC city). */
  realmId: string | null
  /** The town hall that makes it a city (`CONTEXT.md`: Town hall). */
  townHallId: string
  /**
   * Set when the city is the Trade Organization's, saying which of its cities it is
   * (`CONTEXT.md`: Trade Organization, Trade Org HQ, Trading post). It belongs to no realm and
   * the game runs it like an NPC city.
   */
  tradeOrg?: 'hq' | 'post'
  /**
   * Workplaces the game has a city it runs work besides its farms, by id: the Trade Org HQ's own
   * workplaces on the nearest nodes, a trading post's one. A workplace still belongs to no city;
   * one that is gone is skipped.
   */
  workplaceIds?: string[]
}

export type BuildingKind =
  | 'townHall'
  | 'house'
  | 'storage'
  | 'warehouse'
  | 'wall'
  | 'gate'
  | 'farm'
  | 'stable'
  | 'mine'
  | 'quarry'
  | 'lumberCamp'
  | 'smelter'
  | 'mint'
  | 'smithy'
  | 'road'

/**
 * A building takes one tile (`CONTEXT.md`: Tile). While it has a `site` it is a construction
 * site, not yet the building. A road is built like a building but may share its tile with one
 * (`CONTEXT.md`: Road): a tile holds at most one road and one other building.
 */
export interface Building {
  id: string
  kind: BuildingKind
  /**
   * The city it belongs to; null for a building of no city, such as a workplace on a node. A
   * finished city building's follows from where it stands (`cityMembership`); a farm or stable
   * keeps the city it was laid out for, until that city is gone.
   */
  cityId: string | null
  x: number
  y: number
  /** Goods kept here; storages, warehouses and stables only. */
  stock?: Stock
  /**
   * A stable's progress toward its next foal, in ticks of breeding (`STABLE_BREED_DAYS`); there
   * once it has started.
   */
  breeding?: number
  /** There while the building is still a construction site. */
  site?: ConstructionSite
  /** Work put into tearing it down so far, once someone has started (`teardownWork`). */
  teardown?: number
  /** A gate its city's realm has closed (`CONTEXT.md`: Walls in combat); gates only, open without it. */
  closed?: true
  /**
   * Damage taken from blows so far (`CONTEXT.md`: Walls in combat), once someone has struck it;
   * finished walls and gates only. It falls at its `wallStrength`.
   */
  damage?: number
}

/**
 * How far a construction site has come (`CONTEXT.md`: Construction site): the materials carried
 * to it so far and the work residents have put in. Like a workplace, it has no owner.
 */
export interface ConstructionSite {
  /** Materials delivered so far; never more of a good than the building needs. */
  delivered: Stock
  /** Work put in so far, at most what the building needs (`BUILD_WORK`). */
  work: number
}

/**
 * An animal that pulls a carriage (`CONTEXT.md`: Horse). It has no inventory: it eats only what
 * is in reach (`horseFood`).
 */
export interface Horse {
  id: string
  /** The realm it belongs to; null for one of an NPC city (`cityId`) or of nobody. */
  realmId: string | null
  /**
   * The NPC city it belongs to when it belongs to no realm (`CONTEXT.md`: Self-managed city);
   * null for one of a realm or of nobody.
   */
  cityId: string | null
  x: number
  y: number
  /** The hunger meter, as for residents: `MAX_HUNGER` is fully fed, 0 is empty. */
  hunger: number
  /** 0 is dead; the most is `MAX_HEALTH`, as for residents. */
  health: number
}

/** A horse-drawn cart (`CONTEXT.md`: Carriage). */
export interface Carriage {
  id: string
  /** The realm it belongs to; null for one of an NPC city (`cityId`) or of nobody. */
  realmId: string | null
  /**
   * The NPC city it belongs to when it belongs to no realm (`CONTEXT.md`: Self-managed city);
   * null for one of a realm or of nobody.
   */
  cityId: string | null
  x: number
  y: number
  /**
   * The horse hitched to it, which pulls it, moves with it and eats from its load; null when
   * none is. A horse of the carriage's realm on its tile is hitched when it is first driven.
   */
  horseId: string | null
  /** Goods on board, up to `CARRIAGE_CAPACITY` by weight. */
  load: Stock
}

/** What a resource node yields once worked (`CONTEXT.md`: Resource node). */
export type ResourceKind = 'forest' | 'stone' | 'ironOre' | 'goldOre'

/** A spot on the map that never runs out. Nodes never move; one per tile. */
export interface ResourceNode {
  id: string
  kind: ResourceKind
  x: number
  y: number
}

/** The workplace built on each kind of node (`CONTEXT.md`: Workplace, Where buildings go). */
export const NODE_WORKPLACE: Record<ResourceKind, BuildingKind> = {
  forest: 'lumberCamp',
  stone: 'quarry',
  ironOre: 'mine',
  goldOre: 'mine',
}

/** The terrain each kind of node lies on (`CONTEXT.md`: Resource node). */
export const NODE_TERRAINS: Record<ResourceKind, readonly Terrain[]> = {
  forest: [Terrain.Forest],
  stone: [Terrain.Hills],
  ironOre: [Terrain.Hills, Terrain.Mountain],
  goldOre: [Terrain.Hills, Terrain.Mountain],
}

/** Who ran a script, in a script event: a resident or an army. */
export type ScriptRunBy =
  { residentId: string; armyId?: never } | { armyId: string; residentId?: never }
