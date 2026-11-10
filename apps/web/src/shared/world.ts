// Ported from packages/shared/src/world.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type {
  Alliance,
  Army,
  Building,
  BuildingKind,
  Caravan,
  Carriage,
  City,
  CrimeKind,
  DemandTerms,
  DirectOfferTerms,
  DirectiveGoal,
  Good,
  GoodsSpot,
  Horse,
  MercenaryContract,
  Pile,
  RealmEvent,
  Remembered,
  Resident,
  ResourceKind,
  ResourceNode,
  SkillName,
  Stock,
  Trader,
  TrainingSubject,
  Waypoint,
  WorkplaceSettings,
} from '@csp/shared-types'

/** A resident's stats (`CONTEXT.md`: Stats). */
export const STAT_NAMES = ['strength', 'endurance', 'agility', 'intellect'] as const

/** A horse's stats (`CONTEXT.md`: Horse stats). */
export const HORSE_STAT_NAMES = ['speed', 'strength', 'endurance'] as const

/** Every skill, in the order the UI lists them. */
export const SKILL_NAMES: readonly SkillName[] = [
  'mining',
  'woodcutting',
  'smelting',
  'smithing',
  'construction',
  'farming',
  'combat',
  'driving',
]

/** Whether `x` names a stat or a skill, something a training ground can teach. */
export function isTrainingSubject(x: unknown): x is TrainingSubject {
  return (
    (STAT_NAMES as readonly unknown[]).includes(x) ||
    (SKILL_NAMES as readonly unknown[]).includes(x)
  )
}

/**
 * Whether a resident or horse is Down (`CONTEXT.md`: Down), lying unconscious and doing nothing:
 * from the world, or as a Player sees them (`SeenResident.down`, `SeenHorse.down`).
 */
export function isDown(r: { downUntil?: number; down?: true }): boolean {
  return r.downUntil !== undefined || r.down === true
}

/** Why a resident carrying a child is turned down for work, building, tearing down or hauling. */
export const CARRYING_A_CHILD = 'carrying a child'

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
 * Building a road or wall along a line (`CONTEXT.md`: Road, Wall / Gate): a `roadLine` order
 * builds road and a `wallLine` order wall (`LINE_BUILDING`) on the tiles of `tiles`, one after
 * another. For each the resident walks to it (`path` and `progress` as for a walk order), then
 * lays out a site there or joins the one already there, puts in the materials they carry that it
 * needs, and works on it as for a build order (`siteId`) until it is finished. A tile that already
 * has one, or can't take one, is skipped. The order ends after the last.
 */
export interface LineOrder {
  kind: 'roadLine' | 'wallLine'
  /** The tiles still to build, in order; the first is being walked to or built. Never empty. */
  tiles: [number, number][]
  phase: 'walking' | 'building'
  /** While walking, the tiles still to walk; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /** While building, the site on the first tile; null until it is laid out or joined. */
  siteId: string | null
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
  /** Every standing other than neutral, one per pair of Organizations (`CONTEXT.md`: Standing). */
  standings: Standing[]
  /** Mercenary contracts offered or in force (`CONTEXT.md`: Mercenary contract). */
  contracts: MercenaryContract[]
  /** Demands not yet answered, oldest first (`CONTEXT.md`: Demand). */
  demands: Demand[]
  /**
   * NPC cities asking a realm to join it, and asks a realm declined that the city still
   * remembers (`CONTEXT.md`: Persuading a city).
   */
  joinRequests: JoinRequest[]
  /** The Trade Organization's caravans, one on each trading post's route (`CONTEXT.md`: Caravan). */
  caravans: Caravan[]
  /** The Trade Organization's wandering traders (`CONTEXT.md`: Wandering trader). */
  traders: Trader[]
  /** Deliveries and pick-ups ordered and not yet done, oldest first (`CONTEXT.md`: Delivery). */
  deliveries: Delivery[]
  /** Transfers between realms ordered and not yet done, oldest first (`CONTEXT.md`: Transfer). */
  transfers: Transfer[]
  /** The offers standing at Players' storages, oldest first (`CONTEXT.md`: Offer). */
  offers: Offer[]
  /**
   * How often each caravan route was robbed (`CONTEXT.md`: Guaranteed carriage), by the trading
   * post at its far end; a route never robbed has no entry.
   */
  routeRobberies: Record<string, number>
  /** The Trade Org army's punishments under way (`CONTEXT.md`: Trade Org reaction). */
  punishments: Punishment[]
  /** The supply wagons of its punishments, and those still on the way home from one. */
  supplyWagons: SupplyWagon[]
  /** Admin directives in force, oldest first (`CONTEXT.md`: Admin directive). */
  directives: Directive[]
  /** What Organizations owe the Trade Organization, at most one for each (`CONTEXT.md`: Trade Org debt). */
  debts: Debt[]
  /**
   * What each Player has seen of buildings and cities, by their account id (`CONTEXT.md`: Last
   * seen): what is in their sight now as of this tick, and what left it as they last saw it.
   */
  lastSeen: Record<number, Remembered[]>
  /**
   * How many of the breaking changes to the script views (`SCRIPT_VIEW_CHANGES`) the Players were
   * told of in their realm logs; the server tells them of the rest at start.
   */
  scriptViewChanges: number
  /**
   * The account ids of the Players who claimed their Horse offer (`CONTEXT.md`: Horse offer):
   * kept with the Player, not the realm, so a claim outlives a Leader death. Offering horses
   * again takes them out.
   */
  horseOffersClaimed: number[]
  /**
   * Each Player's waypoints by their account id, oldest first (`CONTEXT.md`: Waypoint): kept with
   * the Player, not the realm, so they outlive a Leader death. A Player with none may have no
   * entry.
   */
  waypoints: Record<number, Waypoint[]>
  /**
   * The plan of each city the game runs, by city id (`CONTEXT.md`: NPC city; ADR 0016): what its
   * residents do until its next planning pass. A city without one has not planned yet.
   */
  cityPlans: Record<string, CityPlan>
  /**
   * Each realm's Workplace settings (`CONTEXT.md`), by realm id, then by the workplace's or
   * site's building id. A realm with none set has no entry; NPC cities keep none.
   */
  workplaceSettings: Record<string, Record<string, WorkplaceSettings>>
}

/**
 * What a game-run city's plan has one of its residents do (`CONTEXT.md`: NPC city; ADR 0016):
 * stand as a soldier, teach or train at its training ground (Who trains), work a farm or another
 * workplace, build its project, go on its trade run (NPC trader), found its daughter (Founding),
 * revive one of its own (Reviving), scout (Scout), feed its stable (NPC horses), or nothing, until the
 * next pass moves them.
 */
export interface CityJob {
  kind:
    | 'soldier'
    | 'teach'
    | 'train'
    | 'farm'
    | 'work'
    | 'build'
    | 'road'
    | 'trade'
    | 'found'
    | 'revive'
    | 'scout'
    | 'feed'
    | 'idle'
  /** The farm or workplace to work, for `farm` and `work`. */
  buildingId?: string
  /** The Down resident to revive, for `revive`. */
  targetId?: string
  /** The stable to feed, for `feed`. */
  stableId?: string
  /** The training ground, for `teach` and `train`. */
  groundId?: string
  /** What the ground teaches, for `teach`. */
  subject?: TrainingSubject
}

/** A road a game-run city builds (`CONTEXT.md`: NPC road): its way, worked out once. */
export interface CityRoad {
  /** The building it leads to; for one to a neighbour (the edge of its area), that city. */
  to: string
  /** The tiles of the way from its home, as a resident would walk it; none when it is given up. */
  tiles: [x: number, y: number][]
}

/** What a game-run city builds or takes down next (`CONTEXT.md`: NPC city), as plain data. */
export type CityProject =
  | { kind: 'build'; building: BuildingKind; x: number; y: number }
  | { kind: 'tearDown'; buildingId: string }

/** A trader's run to a Player's offer (`CONTEXT.md`: NPC cities at an offer). */
export interface CityTraderOffer {
  /** The offer they go to take. */
  offerId: string
  /** How many times over the city means to take it. */
  times: number
  /** The good they pay with: what the offer wants. */
  pays: Good
  /** Units of it they take along. */
  units: number
  /** Where they are in the run: to load up at home, to set off, or on their way. */
  leg: 'load' | 'setOff' | 'walking'
}

/** A game-run city's trade run under way (`CONTEXT.md`: NPC trader). */
export interface CityTrader {
  /** The trader, one of its spare hands. */
  residentId: string
  /**
   * The Trade Org warehouse they trade at; on a run to an offer, the offer's storage; null when
   * they go to a visiting trader instead.
   */
  warehouseId: string | null
  /** The wandering trader standing at the city they trade with (`CONTEXT.md`: Trader stop). */
  visitingId?: string
  /** On a run to a visiting trader: whether they have fetched what they take along. */
  loaded?: boolean
  /** On a run to a Player's offer, that run, until they have been there or given it up. */
  offer?: CityTraderOffer
  /** The load still to sell there; empty once sold. */
  sells: Stock
  /** What they still buy there, up to what the city is short of; empty once bought. */
  buys: Stock
  /** The tick they were sent. */
  since: number
}

/**
 * What a scout out has seen and not brought home yet (`CONTEXT.md`: Scout), in sectors
 * (`NPC_SCOUT_SECTOR`). Lost if they die on the way.
 */
export interface ScoutTrip {
  /** The sectors they have had in sight. */
  saw: number[]
  /** The sectors of the tiles they found no way to. */
  noWay?: number[]
}

/**
 * What a city the game runs decided at its last planning pass (`CONTEXT.md`: NPC city;
 * ADR 0016), kept in the world so a restart forgets nothing: plain serialisable data like an
 * order's state (ADR 0002). Only the pass changes the jobs; between passes the city hands them
 * out, and replaces its project once it is finished.
 */
export interface CityPlan {
  /** The tick of the pass that made it. */
  plannedAt: number
  /** A job per resident of the city, by resident id. */
  jobs: Record<string, CityJob>
  /** What the city builds or takes down next; none when it has nothing to build. */
  project?: CityProject
  /** The roads it has worked out the way of (`CONTEXT.md`: NPC road), in the order it builds them. */
  roads?: CityRoad[]
  /**
   * The tiles of its layout's streets it wanted as road at its last pass (`CONTEXT.md`: City layout),
   * which its road crew builds ahead of `roads`; worked out anew each pass.
   */
  streets?: [x: number, y: number][]
  /** Its trade runs under way (`CONTEXT.md`: NPC trader); none while no trader is out. */
  traders?: CityTrader[]
  /**
   * Since when it has been full (`CONTEXT.md`: Full city); while its founding party is out (its
   * residents with the `found` job), since when the party has been on its way (`CONTEXT.md`:
   * Founding).
   */
  fullSince?: number
  /**
   * Since when a city with `fullSince` has been short of something (`CONTEXT.md`: Full city): a dip
   * that lasts past `NPC_FULL_DIP_DAYS` restarts its wait. None while nothing is short.
   */
  shortSince?: number
  /**
   * The tile of the town hall it founds its daughter round (`CONTEXT.md`: Founding): found once
   * full, and the founding party's goal once it is out.
   */
  foundingSite?: { x: number; y: number }
  /** Its scouts with something still to bring home, by resident id (`CONTEXT.md`: Scout). */
  scouts?: Record<string, ScoutTrip>
  /** Its soldiers walking a round now (`CONTEXT.md`: Soldier posts); none while nobody is. */
  patrols?: CityPatrol[]
  /** The soldier who last set out on a round: the next by id goes next. */
  patrolledLast?: string
}

/** A soldier of an NPC city walking a round (`CONTEXT.md`: Soldier posts). Plain data (ADR 0002). */
export interface CityPatrol {
  residentId: string
  /** The tiles still ahead of them, the next first; the last is where they set out from. */
  stops: { x: number; y: number }[]
}

/**
 * An admin's order to the Trade Organization to weaken an Organization (`CONTEXT.md`: Admin
 * directive). Until an admin lifts it, the Trade Organization treats the target, and with
 * `withAlliance` every member of its alliance, as one to punish. Every Player sees the target and
 * the reason; only admins see `givenBy`. Plain data (ADR 0002).
 */
export interface Directive {
  id: string
  /** The Organization it names: a realm or an NPC city. */
  target: string
  /** Whether it also names whoever is in the target's alliance, as the alliance stands. */
  withAlliance: boolean
  reason: string
  /** The giving admin's account name. */
  givenBy: string
  givenAt: number
  /**
   * What ends it (`CONTEXT.md`: Admin directive): once every goal is met the game lifts it. A
   * directive given before goals existed has none and ends only when an admin lifts it.
   */
  goals: DirectiveGoal[]
  /** Soldiers of the Organizations it names killed since it was given, for `soldiers` goals. */
  soldiersKilled: number
  /**
   * The Coins the target can pay at any Trade Org warehouse to buy the directive off, or null when
   * the admin doesn't allow it (`CONTEXT.md`: Admin directive).
   */
  price: number | null
}

/**
 * A delivery or pick-up the Trade Organization owes a realm (`CONTEXT.md`: Delivery), ordered at
 * its warehouse `warehouseId`. A `delivery` was bought and paid for, fee and all: `units` of
 * `good` that the warehouse keeps for it until a caravan loads them and brings them to the
 * storage of the realm's city `cityId`. A `pickUp` is a sale of up to `units` of `good` from that
 * city's storage: a caravan comes with coins, takes the goods there and pays for them at the
 * warehouse's prices of the moment, less the fee, and brings them to the warehouse. A caravan
 * standing at the warehouse takes it on (`caravanId`). Plain data (ADR 0002).
 */
export interface Delivery {
  id: string
  kind: 'delivery' | 'pickUp'
  realmId: string
  warehouseId: string
  cityId: string
  good: Exclude<Good, 'coins'>
  units: number
  /** The fee a delivery was paid with; 0 for a pick-up, whose fee comes off what it pays. */
  fee: number
  /** The caravan carrying it out, or null while it waits for one. */
  caravanId: string | null
}

/**
 * A transfer between realms (`CONTEXT.md`: Transfer): the Trade Organization carries `units` of
 * `good` (coins too) from the realm `realmId` to the storage of `toCityId`, a city of the realm
 * `toRealmId`, with a caravan of its warehouse `warehouseId`. Ordered from the realm, a caravan
 * picks the goods up at the storage of the sender's city `fromCityId` and takes the fee there;
 * handed in at the warehouse, the warehouse keeps them for it (`fromCityId` null), the fee paid.
 * What robbers took is sent again out of the warehouse's stock the same way. Cancelled, it is
 * brought `back` to the sender's city `toCityId` instead. A caravan standing at the warehouse
 * takes it on (`caravanId`). With `debt` it collects Coins owed to the Trade Organization and
 * brings them to the warehouse's coin warehouse: `realmId` is who owes them, maybe an NPC city, and
 * `toRealmId` is `TRADE_ORG`. Plain data (ADR 0002).
 */
export interface Transfer {
  id: string
  realmId: string
  toRealmId: string
  toCityId: string
  warehouseId: string
  fromCityId: string | null
  good: Good
  units: number
  /** The fee paid for it so far; a pick-up's is taken when the caravan collects. */
  fee: number
  /** Whether it was cancelled and goes back to the sender's city `toCityId`. */
  back: boolean
  /** The caravan carrying it out, or null while it waits for one. */
  caravanId: string | null
  /** Set on one of the two Transfers of a carried Direct offer (`CONTEXT.md`: Direct offer). */
  carriedOffer?: CarriedTransfer
  /** Set on one that collects a debt's Coins (`CONTEXT.md`: Trade Org debt). */
  debt?: DebtCollection
}

/**
 * Where a caravan collects a debt's Coins (`CONTEXT.md`: Trade Org debt): at the storage `storageId`
 * of the one who owes them, out of what is set aside there for the Trade Organization on the offer
 * `offerId`, for no fee, or without one out of what is free there, for the fee a Transfer costs.
 */
export interface DebtCollection {
  storageId: string
  offerId?: string
}

/** How a carried Direct offer's Transfer is paid: part at its pick-up, part on unloading. */
export interface CarriedTransfer {
  /** The part of the fee taken from the storage it unloads at: 0, a half or all of it. */
  unloadShare: number
  /** The coins still to take there, worked out once it has collected. */
  due: number
}

/** One line of what a wandering trader names: as a warehouse's (`CONTEXT.md`: Trader stop). */
export interface TraderPrice {
  good: Exclude<Good, 'coins'>
  buy: number
  sell: number
  stock: number
}

/**
 * An NPC city asking a realm to join it (`CONTEXT.md`: Persuading a city). It stands until the
 * Player accepts or declines, or the city stops holding the realm in high standing. A declined
 * ask is kept for `PERSUADE_ASK_AGAIN_DAYS`, so the city doesn't ask that realm again before
 * then. Plain data (ADR 0002).
 */
export interface JoinRequest {
  cityId: string
  realmId: string
  /** The tick the city asked, or, once declined, the tick the Player declined. */
  at: number
  /** Whether the Player declined; the city then only remembers it. */
  declined: boolean
}

/**
 * What a Player posts at a storage of their realm (`CONTEXT.md`: Offer): "gives 10 Wood, wants 5
 * Stone", `times` more times over. The goods stay in the storage's stock; `times` × `givesUnits`
 * of them are set aside (`setAsideAt`). Plain data.
 */
export interface Offer {
  id: string
  /** The realm that posted it, or the NPC city, by its id, that set it aside on a demand. */
  realmId: string
  storageId: string
  /** The storage's tile, for the log once the storage is gone. */
  x: number
  y: number
  gives: Good
  givesUnits: number
  wants: Good
  /** At least one, but 0 for goods set aside on accepting a demand, which want nothing back. */
  wantsUnits: number
  /** How many times over it can still be accepted; at least one while it stands. */
  times: number
  /** Set on a Direct offer: only that realm can accept it, until it lapses. */
  direct?: DirectOfferTerms
}

/**
 * How the Organization `of` regards `toward` (`CONTEXT.md`: Standing), from -`STANDING_RANGE`
 * to +`STANDING_RANGE`. An Organization is a realm's id, an NPC city's id, or `TRADE_ORG`
 * (`standingOrganization`). A pair with none is neutral (0). Plain data.
 */
export interface Standing {
  of: string
  toward: string
  value: number
}

/**
 * The Trade Org army out to punish an Organization for crimes against the Trade Organization
 * (`CONTEXT.md`: Trade Org reaction): its soldiers go to the culprit's city nearest the crime,
 * take back `worth` Coins' worth from its storages and carry it home. Plain data (ADR 0002).
 */
export interface Punishment {
  id: string
  /** The Organization punished: a realm or an NPC city. */
  culpritOrg: string
  /** The city it goes to. */
  cityId: string
  /**
   * What it comes to take back, in Coins' worth: twice what it lost. An army that wrecks (`wrecks`)
   * comes for what it has counted so far and what is still owed.
   */
  worth: number
  /**
   * Its soldiers, each with what they carried as they set out: anything they carry above that is
   * what they took. `packed` once they have seen to their Food at the HQ (`CONTEXT.md`: Punishment
   * trip), so that they set out. `seller` is the place they are on their way to buy Food at, and
   * `noWay` the places they found no way to (`CONTEXT.md`: Trade Org debt).
   */
  members: {
    residentId: string
    own: Stock
    packed?: true
    seller?: string
    noWay?: string[]
  }[]
  /** Out to the city while it hasn't got what it came for; home once it has or gives up. */
  heading: 'out' | 'home'
  /**
   * The Coins' worth it took, as it stood when it headed home; an army that wrecks, the worth of what
   * it tore down that came off the debt.
   */
  took: number
  startedAt: number
  /**
   * The tick it reached the city (`CONTEXT.md`: Punishment trip), its time there counting from it.
   * None while it is on the way, and for good if it turned back without getting there.
   */
  arrivedAt?: number
  /**
   * The admin directive it was sent for (`CONTEXT.md`: Admin directive) rather than crimes; it
   * heads home once that directive is lifted.
   */
  directiveId?: string
  /**
   * There for an army sent for a debt at its step `wrecks` (`CONTEXT.md`: Trade Org debt), which tears
   * down workplaces rather than taking goods: the workplaces it means to tear down, in that order,
   * found once it is at the city.
   */
  wrecks?: string[]
  /**
   * An army sent for a debt once its trips are over (`CONTEXT.md`: Trade Org debt): it takes no goods
   * and tears nothing down, but occupies the town hall until the city joins the Trade Organization.
   */
  takes?: true
}

/**
 * The supply wagon of a punishment (`CONTEXT.md`: Trade Org debt, Supply line): a carriage of the
 * Trade Org HQ with a driver, Food for the trip and room for what the army takes. It follows the
 * soldiers, outlives them and goes home to unload. Plain data.
 */
export interface SupplyWagon {
  id: string
  /** The punishment it follows; null once that is over and it goes home by itself. */
  punishmentId: string | null
  carriageId: string
  /** Who drives it; null with no crew left, until the HQ has someone to send (Caravan crew lost). */
  driverId: string | null
  /** The Food it means to set out with. */
  food: number
  /** How much of the Food on board is what it set out with; any more was taken. */
  ownFood: number
  /** Whether it is done loading Food at the HQ. */
  loaded?: true
  /** The driver was sent out on foot and still has to pack Food for the walk. */
  sentOut?: true
  /** Goods in the driver's hands to put down next, and where. */
  holding: { goods: Stock; to: GoodsSpot } | null
}

/**
 * What an Organization owes the Trade Organization, in Coins (`CONTEXT.md`: Trade Org debt): what its
 * army came for and couldn't take, and what crimes cost it since. Plain data.
 */
export interface Debt {
  /** The Organization that owes it: a realm or an NPC city. */
  org: string
  coins: number
  /**
   * How far up its steps the Trade Organization has gone (ADR 0025): none until its demand goes out;
   * `demanded` from then on; `wrecks` once that demand was declined or lapsed, or its deadline passed
   * with something still owed after an answer that didn't cover it, and its army goes to tear down
   * workplaces from then on (`Punishment.wrecks`). While it only wants a captured post back there is
   * none yet: that demand, refused, goes straight to `wrecks`.
   */
  step?: 'demanded' | 'wrecks'
  /** The deadline of its demand, in ticks, while the step is `demanded`. */
  deadline?: number
  /**
   * How many armies have reached a city to tear down workplaces for it. Once that is
   * `TRADE_ORG_DEBT_TRIPS`, the next one comes to take the city (`Punishment.takes`). None before
   * the first.
   */
  trips?: number
  /**
   * The city its army came to when it left this debt, where it comes back to at the step `wrecks`.
   * None for a debt from before that was kept; its army then goes to the city nearest the HQ.
   */
  cityId?: string
}

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
  /** What was stolen, a stolen carriage's load included. */
  goods?: Stock
  /** A carriage was stolen (`CONTEXT.md`: Stealing a carriage or horse). */
  carriage?: true
  /** The name of the horse that was stolen, alone or hitched to the stolen carriage. */
  horse?: string
  /** What was torn down. */
  building?: BuildingKind
  /**
   * The trading post captured (`CONTEXT.md`: Lost post found out). It waits for a wandering trader
   * to reach that post, however long that takes, while the post is on a trader's loop.
   */
  post?: string
  /**
   * Residents who saw it, or the victim who survived it, and have not got home yet. Each makes it
   * known to their own Organization once they stand in the area of one of its cities. News of a
   * captured post goes to any city of the Trade Organization.
   */
  witnesses: string[]
  /** The Organizations it is known to. */
  knownBy: string[]
  /**
   * The tick a captured post's news reached the Trade Organization, which it remembers from then
   * on rather than from the capture, however long ago that was.
   */
  heardAt?: number
  /**
   * The Trade Organization has dealt with it: sent its army to punish it (`CONTEXT.md`: Trade Org
   * reaction), or put it on a debt, as it does with any captured post it hears of.
   */
  punished?: true
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

/** Goods that make a resident armed (`CONTEXT.md`: Soldier, Weapons and armour). */
export const WEAPONS = ['spear', 'sword'] as const satisfies readonly Good[]

/** Goods that take off damage (`CONTEXT.md`: Weapons and armour): shields and armour. */
export const PROTECTION = ['shield', 'armour'] as const satisfies readonly Good[]

/** Everything one Player controls through their Leader (`CONTEXT.md`: Realm). */
export interface Realm {
  id: string
  /** The Player's account. */
  userId: number
  /** The resident who is the Player's Leader. */
  leaderId: string
  /**
   * What others know the realm by (`CONTEXT.md`: Realm name); never changes once given. Realms
   * from before realm names have none and go by their Leader's name until named.
   */
  name?: string
  /**
   * When the realm last sent demands, oldest first, only those still counting against
   * `DEMANDS_PER_GAME_DAY` (`CONTEXT.md`: Demand). None while it has sent none lately.
   */
  demandsSentAt?: number[]
}

/**
 * A demand waiting for its answer (`CONTEXT.md`: Demand; ADR 0024): it goes once it is accepted,
 * declined or lapses, and the realm logs say which. Plain data (ADR 0002).
 */
export interface Demand {
  id: string
  /**
   * The realm that sent it; or the Trade Organization (`TRADE_ORG`), for a debt or, naming a city, a
   * captured post it wants back (`CONTEXT.md`: Trade Org debt).
   */
  fromId: string
  /**
   * The realm it was sent to, the only one who can answer it; or an NPC city by its id or the Trade
   * Organization (`TRADE_ORG`), for the game to answer within a game hour.
   */
  toId: string
  terms: DemandTerms
  /** The sender's words: plain text, trimmed, at most `DEMAND_NOTE_MAX_LENGTH` characters. */
  note: string
  sentAt: number
  /** The tick it lapses at, unanswered. */
  deadline: number
}

/** The workplace built on each kind of node (`CONTEXT.md`: Workplace, Where buildings go). */
export const NODE_WORKPLACE: Record<ResourceKind, BuildingKind> = {
  forest: 'lumberCamp',
  stone: 'quarry',
  ironOre: 'mine',
  goldOre: 'mine',
}
