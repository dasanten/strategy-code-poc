import { offerTerms, setAsideLine } from './offers-view.js'
import {
  BUILD_MATERIALS,
  BUILD_WORK,
  BUILDABLE,
  CARRYING_A_CHILD,
  CHILD_GOODS,
  SHARES_A_TILE,
  GOODS,
  HORSE_FOOD_PER_DAY,
  HORSE_HUNGRY_SHARE,
  PASSENGER_WEIGHT,
  carriageCapacity,
  isDown,
  carriagePulledBy,
  driveOffProblem,
  riderOf,
  hitchOffProblem,
  horseToSteal,
  mountOffProblem,
  feedHorseProblem,
  feedProblem,
  horsesInNeed,
  MAP_SIZE,
  NO_CHILD_FEEDS,
  NO_FOOD_TO_FEED,
  horseAgeInYears,
  horseFoodFactor,
  MAX_HEALTH,
  MAX_HUNGER,
  MAX_WORKERS,
  NODE_GOOD,
  NODE_WORKPLACE,
  RECIPES,
  STABLE_BREED_TICKS,
  STABLE_CAPACITY,
  STABLE_FEED_DAYS,
  breedersAt,
  keptBreeding,
  teacherAt,
  traineesOf,
  trainingCeiling,
  subjectValue,
  TICKS_PER_GAME_DAY,
  WORK_OUTPUT_PER_DAY,
  WORKPLACE_SKILL,
  buildProblem,
  canWork,
  unhitchProblem,
  isOutpostStorage,
  nodeCorner,
  stockWeight,
  type BuildingKind,
  type TerrainLookup,
  type Building,
  type Carriage,
  type City,
  type KnownNode,
  type Pile,
  type Resident,
  type Stock,
  covers,
  wrap,
  FOOTPRINT,
  handOverProblem,
  type Alliance,
  type Diplomacy,
  type MercenaryContract,
  type SeenResident,
  type SeenCaravan,
  type SeenTrader,
  type SeenCarriage,
  type HaulOrder,
  type GoodsPlace,
  type GoodsWanted,
  aboutTime,
  drivenCarriageId,
  workLeft,
  type LoadLevel,
  type Horse,
  type SeenHorse,
  type Good,
  type SeenBuilding,
  type SeenCity,
  type RealmLabel,
  FOOD_PER_DAY,
  HOUSING_ROOM,
  PROTECTION,
  TERRAIN_FOOD,
  TERRAIN_SPEED,
  Terrain,
  WEAPONS,
  footprintTiles,
  hasChoice,
  hungerFactor,
  madePerDay,
  recipeFor,
  recipeGood,
  teardownWork,
  workFactor,
  UNEXPLORED,
} from '@csp/shared'
import type { Relationship } from './theme.js'
import { cityRelationship, rankedAs, type Viewer } from './map/tokens.js'
import { BUILDING_NAMES, NODE_NAMES, TERRAIN_NAMES } from './map/palette.js'
import { faresKnown, horseFaresKnown } from './seen.js'
import { FEED_HORSE_HINT, horseDownLine, horseNeed } from './horses-view.js'
import { lastSeenText, type LastSeenBuilding } from './last-seen.js'
import { describeOccupation, type OccupationView } from './city-view.js'
import type { Picking } from './Residents.js'

/**
 * What the selection card shows (ADR 0008): one of the Player's residents, or a tile of the map
 * with whatever stands on it (a building or site, a carriage, a pile, a resource node).
 */
export type Selection = { kind: 'resident'; id: string } | { kind: 'tile'; x: number; y: number }

/** An action the selection card offers. */
export type ActionId =
  | 'walk'
  | 'relocate'
  | 'stop'
  | 'ride'
  | 'board'
  | 'unhitch'
  | 'drive'
  | 'driveOff'
  | 'hitchOff'
  | 'stealHorse'
  | 'haul'
  | 'explore'
  | 'build'
  | 'roadTo'
  | 'wallTo'
  | 'work'
  | 'feedStable'
  | 'teach'
  | 'train'
  | 'tearDown'
  | 'breed'
  | 'goods'
  | 'pair'
  | 'attack'
  | 'feed'
  | 'walls'
  | 'script'
  | 'makeLeader'
  | 'rename'
  | 'sendHere'
  | 'gate'
  | 'openCity'
  | 'tradeHere'
  | 'renameCity'
  | 'renameHorse'
  | 'addWaypoint'

/** The key that runs each action; fixed per action, so it is the same whatever is selected. */
export const ACTION_KEYS: Record<ActionId, string> = {
  walk: 'W',
  relocate: 'V',
  stop: 'S',
  ride: 'M',
  board: 'K',
  unhitch: 'U',
  drive: 'D',
  driveOff: 'D',
  hitchOff: 'D',
  stealHorse: 'M',
  haul: 'H',
  explore: 'Z',
  build: 'B',
  roadTo: 'R',
  wallTo: 'Q',
  work: 'E',
  feedStable: 'F',
  teach: 'Y',
  train: 'I',
  tearDown: 'T',
  breed: 'F',
  goods: 'G',
  pair: 'P',
  attack: 'A',
  feed: 'O',
  walls: 'C',
  script: 'X',
  makeLeader: 'L',
  rename: 'N',
  sendHere: 'W',
  gate: 'O',
  openCity: 'C',
  tradeHere: 'T',
  renameCity: 'N',
  renameHorse: 'N',
  addWaypoint: 'J',
}

/**
 * One row of actions on the card. An action either acts at once (or starts picking a tile on the
 * map) or `opens` a panel below the rows with what it needs: goods, a partner, a target, a script.
 */
export interface CardAction<Id extends string = ActionId> {
  id: Id
  label: string
  key: string
  opens?: true
  disabled?: true
  /** Why a disabled action can't run now, shown with it. */
  reason?: string
  /** The map is waiting for a tile for this action. */
  active?: true
}

/** What a resident's card needs to know about them and their tile. */
export interface ResidentHere {
  /** A child can't build, work, drive or pair, and handles only Food (`CONTEXT.md`: Child). */
  adult: boolean
  /** They have an order or run a script, so there is something to stop. */
  busy: boolean
  /** They belong to a city, so they can pair. */
  inCity: boolean
  carriage?: Carriage
  /** The horse hitched to that carriage is Down (`CONTEXT.md`: Down), so it can't be driven. */
  carriageHorseDown?: boolean
  /** That carriage is another organization's: not theirs to drive or haul with. */
  carriageTheirs?: boolean
  /**
   * Another organization's carriage on their tile, to drive off, and why it can't be taken now, if
   * so (`CONTEXT.md`: Stealing a carriage or horse).
   */
  driveOff?: { problem: string | undefined }
  /**
   * Their realm's carriage on their tile with no horse of the realm's to pull it, and another
   * organization's free horse there to steal for it, and why they can't now, if so (`CONTEXT.md`:
   * Stealing a carriage or horse).
   */
  hitchOff?: { problem: string | undefined }
  /**
   * Another organization's free horse on their tile, to mount, and why it can't be taken now, if
   * so (`CONTEXT.md`: Stealing a carriage or horse).
   */
  stealHorse?: { problem: string | undefined }
  pile?: Pile
  storage?: Building
  /** The building or construction site on their tile, not a road. */
  building?: Building
  road?: Building
  /** The carriage site on their tile (`CONTEXT.md`: Carriage). */
  carriageSite?: Building
  node?: KnownNode
  /** Residents of other realms, or of none, in sight. */
  othersInSight: number
  /** Walls and gates of other realms' cities, or of none, in sight. */
  wallsInSight: number
  /** What the map is waiting for a tile for. */
  picking: Picking
  /**
   * For one of the Player's own residents who isn't their Leader: why the Leader can't hand the
   * realm over to them now (`CONTEXT.md`: Leader handover), undefined when they can. Absent for
   * the Leader and for anyone else's resident, who get no Make Leader row.
   */
  makeLeader?: { problem: string | undefined }
  /** One of the Player's own residents, whom they can rename (`CONTEXT.md`: Renaming a resident). */
  renamable?: boolean
  /**
   * For one of the Player's own residents: why they can't be told to relocate at all
   * (`relocateActionProblem`), undefined when they can. Absent for anyone else's resident, who
   * gets no Relocate row (`CONTEXT.md`: Relocate).
   */
  relocate?: { problem: string | undefined }
  /** They ride a horse, and can dismount (`CONTEXT.md`: Riding). */
  riding?: boolean
  /** They are aboard a carriage, and can get off (`CONTEXT.md`: Passenger). */
  aboard?: boolean
  /** They drive a carriage, so they can't board one (`CONTEXT.md`: Passenger). */
  driving?: boolean
  /** A carriage of their realm on their tile, to board (`CONTEXT.md`: Passenger). */
  carriageToBoard?: boolean
  /** A carriage of their realm on their tile with a horse hitched, to unhitch (`CONTEXT.md`: Hitched horse). */
  carriageToUnhitch?: boolean
  /** A horse of their realm on their tile that pulls no carriage and nobody rides, to mount. */
  horseToRide?: boolean
  /** They carry a child (`CONTEXT.md`: Carrying), so they can't work, build, tear down, haul or pair. */
  carrying?: boolean
  /** They carry goods, so there is something to drop or store. */
  carries?: boolean
  /** What anyone Down on their tile carries, which they can take (`CONTEXT.md`: Down). */
  downCarrying?: Stock[]
  /** They are Down (`CONTEXT.md`: Down) and take no orders. */
  down?: boolean
  /**
   * Others in sight on or next to their tile whom they could Feed: anyone Down, any horse that isn't
   * full (`CONTEXT.md`: Reviving, Feeding a horse).
   */
  toFeedNear?: number
  /** They have Food in their hands, to Feed with. */
  carriesFood?: boolean
}

/**
 * Whether a building can be worked: a finished workplace with something to make (`CONTEXT.md`:
 * Workplace), on its node for a node's workplace.
 */
export function isWorkable(building: Building | undefined, node: KnownNode | undefined): boolean {
  if (!building || building.site || MAX_WORKERS[building.kind] === undefined) return false
  if (!WORKPLACE_SKILL[building.kind]) return false
  const good = building.kind === 'farm' ? 'food' : node && NODE_GOOD[node.kind]
  return !!good || (RECIPES[building.kind] ?? []).length > 0
}

/**
 * The actions a resident's card offers, in the order it shows them. Orders they can't take right
 * now are left out (ADR 0012): a child's work, building and pairing (`CONTEXT.md`: Child), the
 * work, building, hauling and pairing of someone carrying a child (`CONTEXT.md`: Carrying), and
 * Goods with nothing carried and nothing on their tile to pick up (for a child: no Food).
 */
export function residentActions(h: ResidentHere): CardAction[] {
  return residentOrders(h).actions
}

/** Why a carriage whose horse is Down can't be driven (`CONTEXT.md`: Down). */
export const HORSE_DOWN_NO_DRIVE = 'its horse is Down'

/** The action that steals a carriage, which says so (`CONTEXT.md`: Stealing a carriage or horse). */
export const DRIVE_OFF_LABEL = 'Drive off (theft)'

/** The action that steals a horse by driving off with it hitched, which says so. */
export const HITCH_OFF_LABEL = 'Drive with their horse (theft)'

/** The action that steals a horse by mounting it, which says so. */
export const STEAL_HORSE_LABEL = 'Mount their horse (theft)'

/**
 * The carriages of the alliance army a realm commands as its leader (`CONTEXT.md`: Alliance army):
 * another realm's, but no theft to drive.
 */
export function commandedCarriages(
  alliance: { leaderId: string; army: readonly { is: string; id: string }[] } | null | undefined,
  realmId: string | undefined,
): ReadonlySet<string> {
  if (!alliance || alliance.leaderId !== realmId) return new Set()
  return new Set(alliance.army.filter((p) => p.is === 'carriage').map((p) => p.id))
}

/**
 * Whether a carriage is another organization's as the Player sees it (`stealsCarriage`): driving
 * it off would be theft. `commanded` is `commandedCarriages`.
 */
export function strangersCarriage(
  k: { id: string; realmId: string | null },
  realmId: string | undefined,
  commanded: ReadonlySet<string> = new Set(),
): boolean {
  return k.realmId !== realmId && !commanded.has(k.id)
}

/** Why a Down resident's card offers no orders (`CONTEXT.md`: Down). */
export const DOWN_NO_ORDERS = 'Down: takes no orders'

/**
 * The actions a resident's card offers (`residentActions`), and why each order left out can't be
 * given now: the reason its row shows greyed while the card stays open (ADR 0019). Someone Down
 * gets none (`CONTEXT.md`: Down).
 */
export function residentOrders(h: ResidentHere): {
  actions: CardAction[]
  missing: Partial<Record<ActionId, string>>
} {
  const orders = ordersOffered(h)
  if (!h.down) return orders
  const ids = [...orders.actions.map((a) => a.id), ...(Object.keys(orders.missing) as ActionId[])]
  return { actions: [], missing: Object.fromEntries(ids.map((id) => [id, DOWN_NO_ORDERS])) }
}

/** The orders a resident's card offers while they aren't Down (`residentOrders`). */
function ordersOffered(h: ResidentHere): {
  actions: CardAction[]
  missing: Partial<Record<ActionId, string>>
} {
  const row = (id: ActionId, label: string, more: Partial<CardAction> = {}): CardAction => ({
    id,
    label,
    key: ACTION_KEYS[id],
    ...more,
  })
  const picks = (mode: ResidentHere['picking'], label: string) =>
    h.picking === mode ? { label: 'Pick a tile…', active: true as const } : { label }
  // A Build line's two ends, its start first (`CONTEXT.md`: Build line).
  const picksLine = (start: Picking, end: Picking, label: string) =>
    h.picking === start || h.picking === end
      ? { label: h.picking === start ? 'Pick the start…' : 'Pick the end…', active: true as const }
      : { label }
  // Working, building, tearing down, hauling and pairing (`CONTEXT.md`: Child, Carrying).
  const works = h.adult && !h.carrying
  const unfit = (doing: string) => (!h.adult ? `children can’t ${doing}` : CARRYING_A_CHILD)
  const actions: CardAction[] = []
  const missing: Partial<Record<ActionId, string>> = {}
  const add = (a: CardAction) => actions.push(a)
  const miss = (id: ActionId, why: string) => (missing[id] ??= why)
  add(row('walk', '', picks('walk', 'Walk to')))
  if (h.busy) add(row('stop', 'Stop'))
  else miss('stop', 'nothing to stop')
  // Children and homeless residents too (`CONTEXT.md`: Relocate).
  if (h.relocate) {
    const { problem } = h.relocate
    const refused = problem ? { disabled: true as const, reason: problem } : {}
    add(row('relocate', 'Relocate…', { opens: true, ...refused }))
  }
  if (h.riding) add(row('ride', 'Dismount'))
  else if (h.horseToRide) add(row('ride', 'Mount horse'))
  else miss('ride', 'no free horse here')
  // Children ride along too; a rider gets off their horse first, and the driver stays the driver
  // (`CONTEXT.md`: Passenger).
  if (h.aboard) add(row('board', 'Get off'))
  else if (h.carriageToBoard) {
    const reason = h.driving ? 'the driver can’t board' : h.riding ? 'dismount first to board' : ''
    const refused = reason ? { disabled: true as const, reason } : {}
    add(row('board', 'Board carriage', refused))
  } else miss('board', 'no carriage of yours here')
  if (h.adult && h.carriageToUnhitch) add(row('unhitch', 'Unhitch horse'))
  else miss('unhitch', h.adult ? 'no hitched horse here' : 'children can’t unhitch')
  const drivable = h.carriage && !h.carriageTheirs
  if (drivable && h.adult) {
    // A rider doesn't drive (`CONTEXT.md`: Riding), and a Down horse pulls nothing (Down).
    const refused = (reason: string) => ({ disabled: true as const, reason })
    const unable = h.riding
      ? refused('dismount first to drive')
      : h.carriageHorseDown
        ? refused(HORSE_DOWN_NO_DRIVE)
        : {}
    add(row('drive', '', { ...picks('drive', 'Drive carriage to'), ...unable }))
    if (h.carriageHorseDown) miss('haul', HORSE_DOWN_NO_DRIVE)
    else if (!h.carrying) {
      const label = h.picking === 'haul' ? 'Pick the other stop…' : 'Haul route…'
      add(row('haul', label, { opens: true }))
    } else miss('haul', CARRYING_A_CHILD)
  } else {
    const why = h.carriageTheirs
      ? 'no carriage of yours here'
      : h.carriage
        ? 'children can’t drive'
        : 'no carriage here'
    miss('drive', why)
    miss('haul', why)
  }
  // Only ever on its own row, saying what it is (`CONTEXT.md`: Stealing a carriage or horse).
  if (h.driveOff) {
    const { problem } = h.driveOff
    add(
      row('driveOff', '', {
        ...picks('driveOff', DRIVE_OFF_LABEL),
        ...(problem ? { disabled: true as const, reason: problem } : {}),
      }),
    )
  } else miss('driveOff', 'no carriage of another realm here')
  if (h.hitchOff) {
    const { problem } = h.hitchOff
    add(
      row('hitchOff', '', {
        ...picks('hitchOff', HITCH_OFF_LABEL),
        ...(problem ? { disabled: true as const, reason: problem } : {}),
      }),
    )
  } else miss('hitchOff', 'no horse of another realm to hitch here')
  if (h.stealHorse) {
    const { problem } = h.stealHorse
    add(
      row(
        'stealHorse',
        STEAL_HORSE_LABEL,
        problem ? { disabled: true as const, reason: problem } : {},
      ),
    )
  } else miss('stealHorse', 'no free horse of another realm here')
  // Into the unknown and back for Food (`CONTEXT.md`: Explore).
  if (h.adult) add(row('explore', 'Explore'))
  else miss('explore', 'children can’t explore')
  if (works && isWorkable(h.building, h.node)) {
    add(
      row('work', `Work at the ${BUILDING_NAMES[h.building!.kind].toLowerCase()}…`, {
        opens: true,
      }),
    )
  } else miss('work', works ? 'not on a workplace' : unfit('work'))
  const stable = h.building?.kind === 'stable' && !h.building.site
  // A finished stable: keep Food in it for its horses (`CONTEXT.md`: Feeding the stable).
  if (h.adult && stable) add(row('feedStable', 'Feed the stable'))
  else miss('feedStable', h.adult ? 'not in a stable' : 'children can’t work')
  // A finished training ground: teach a subject there, or train (`CONTEXT.md`: Teacher, Trainee).
  if (h.adult && h.building?.kind === 'trainingGround' && !h.building.site) {
    add(row('teach', 'Teach…', { opens: true }))
    add(row('train', 'Train'))
  } else {
    miss('teach', h.adult ? 'not on a training ground' : 'children can’t teach')
    miss('train', h.adult ? 'not on a training ground' : 'children can’t train')
  }
  if (works) {
    const site = h.building?.site
      ? h.building
      : (h.carriageSite ?? (h.road?.site ? h.road : undefined))
    add(
      row('build', site ? `Help build the ${BUILDING_NAMES[site.kind].toLowerCase()}…` : 'Build…', {
        opens: true,
      }),
    )
    add(row('roadTo', '', picksLine('roadFrom', 'roadTo', 'Build line: road')))
    add(row('wallTo', '', picksLine('wallFrom', 'wallTo', 'Build line: wall')))
    const torn = [h.building, h.carriageSite, h.road].filter((b) => b && BUILDABLE.includes(b.kind))
    if (torn.length > 0) add(row('tearDown', 'Tear down…', { opens: true }))
    else miss('tearDown', 'nothing to tear down here')
    if (stable) add(row('breed', 'Breed horses…', { opens: true }))
    else miss('breed', 'not in a stable')
  } else {
    for (const id of ['build', 'roadTo', 'wallTo', 'tearDown'] as const) miss(id, unfit('build'))
    miss('breed', unfit('breed horses'))
  }
  if (h.carries || goodsOnTile(h, h.adult ? GOODS : CHILD_GOODS)) {
    add(row('goods', 'Goods…', { opens: true }))
  } else miss('goods', 'nothing carried or here to pick up')
  // Anyone Down or a horse that isn't full nearby, of any realm (`CONTEXT.md`: Reviving, Feeding a horse).
  if (h.toFeedNear) {
    const reason = !h.adult ? NO_CHILD_FEEDS : !h.carriesFood ? NO_FOOD_TO_FEED : undefined
    add(row('feed', 'Feed…', { opens: true, ...(reason ? { disabled: true, reason } : {}) }))
  } else miss('feed', 'nobody to feed nearby')
  if (works && h.inCity) add(row('pair', 'Pair…', { opens: true }))
  else miss('pair', works ? 'homeless' : unfit('pair'))
  if (h.othersInSight > 0) add(row('attack', 'Attack…', { opens: true }))
  else miss('attack', 'nobody in sight to attack')
  if (h.wallsInSight > 0) add(row('walls', 'Break or climb a wall…', { opens: true }))
  else miss('walls', 'no wall in sight')
  add(row('script', 'Run script…', { opens: true }))
  if (h.makeLeader) {
    const { problem } = h.makeLeader
    add(
      row('makeLeader', 'Make Leader…', {
        opens: true,
        ...(problem ? { disabled: true as const, reason: problem } : {}),
      }),
    )
  }
  if (h.renamable) add(row('rename', 'Rename…', { opens: true }))
  return { actions, missing }
}

/**
 * Whether there are some of `goods` on a resident's tile to pick up: on the ground, stored, at a
 * site, on a carriage or carried by someone Down there.
 */
function goodsOnTile(h: ResidentHere, goods: readonly Good[]): boolean {
  const some = (stock: Stock | undefined) => !!stock && goods.some((g) => (stock[g] ?? 0) > 0)
  return (
    some(h.pile?.goods) ||
    some(h.storage?.stock) ||
    some(h.building?.site?.delivered) ||
    some(h.carriageSite?.site?.delivered) ||
    some(h.road?.site?.delivered) ||
    some(h.carriage?.load) ||
    (h.downCarrying ?? []).some(some)
  )
}

/** The kinds the Orders tab groups a resident's orders under (ADR 0012). */
export type OrderGroup = 'move' | 'work' | 'goods' | 'scripts' | 'other'

/** Each kind's heading on the Orders tab, in the order they show. */
export const ORDER_GROUP_LABELS: Record<OrderGroup, string> = {
  move: 'Move',
  work: 'Work & build',
  goods: 'Goods',
  scripts: 'Scripts',
  other: 'Other',
}

/** Which kind each action is grouped under; an action not listed goes under Other. */
const ORDER_GROUP: Partial<Record<ActionId, OrderGroup>> = {
  walk: 'move',
  relocate: 'move',
  stop: 'move',
  ride: 'move',
  board: 'move',
  unhitch: 'move',
  drive: 'move',
  driveOff: 'move',
  hitchOff: 'move',
  stealHorse: 'move',
  haul: 'move',
  explore: 'move',
  work: 'work',
  feedStable: 'work',
  teach: 'work',
  train: 'work',
  build: 'work',
  roadTo: 'work',
  wallTo: 'work',
  tearDown: 'work',
  breed: 'work',
  goods: 'goods',
  feed: 'goods',
  script: 'scripts',
}

/** The kind a resident's order is grouped under on the Orders tab. */
export const orderGroupOf = (id: ActionId): OrderGroup => ORDER_GROUP[id] ?? 'other'

/** A card's rows as a fresh card shows them: by kind in the kinds' order, as listed within each. */
export function sortRows<Id extends string>(
  rows: readonly CardAction<Id>[],
  groupOf: (id: Id) => OrderGroup,
): CardAction<Id>[] {
  const kinds = Object.keys(ORDER_GROUP_LABELS)
  const rank = (a: CardAction<Id>) => kinds.indexOf(groupOf(a.id))
  return [...rows].sort((a, b) => rank(a) - rank(b))
}

/**
 * A card's rows by kind for the Orders tab, each kind where its first row is, so a kind that
 * comes up while the card is open goes below the others.
 */
export function rowGroups<Id extends string>(
  rows: readonly CardAction<Id>[],
  groupOf: (id: Id) => OrderGroup,
): { group: OrderGroup; label: string; actions: CardAction<Id>[] }[] {
  const groups: { group: OrderGroup; label: string; actions: CardAction<Id>[] }[] = []
  for (const a of rows) {
    const group = groupOf(a.id)
    let g = groups.find((x) => x.group === group)
    if (!g) groups.push((g = { group, label: ORDER_GROUP_LABELS[group], actions: [] }))
    g.actions.push(a)
  }
  return groups
}

/** A resident's actions by kind for the Orders tab, in the kinds' order, empty kinds left out. */
export function groupOrders(
  actions: CardAction[],
): { group: OrderGroup; label: string; actions: CardAction[] }[] {
  return rowGroups(sortRows(actions, orderGroupOf), orderGroupOf)
}

/**
 * The rows a card shows while it stays open (ADR 0019), from the rows it showed last (`kept`,
 * none when something else was just picked) and the orders it offers now (`fresh`). Each row
 * keeps its slot: an order no longer offered stays, greyed, with why (`missing`); a newly
 * offered one goes at the end of its kind, a new kind below the others. With nothing kept the
 * rows are sorted afresh (`sortRows`).
 */
export function keepRows<Id extends string>(
  kept: readonly CardAction<Id>[] | undefined,
  fresh: readonly CardAction<Id>[],
  missing: Partial<Record<Id, string>>,
  groupOf: (id: Id) => OrderGroup,
): CardAction<Id>[] {
  if (!kept) return sortRows(fresh, groupOf)
  const rows = kept.map((k): CardAction<Id> => {
    const now = fresh.find((a) => a.id === k.id)
    if (now) return now
    const was = { ...k, disabled: true as const, reason: missing[k.id] ?? 'not now' }
    // No longer waiting for a tile: the order can't be given.
    delete was.active
    return was
  })
  for (const a of fresh) {
    if (rows.some((r) => r.id === a.id)) continue
    const group = groupOf(a.id)
    const last = rows.findLastIndex((r) => groupOf(r.id) === group)
    rows.splice(last < 0 ? rows.length : last + 1, 0, a)
  }
  return rows
}

/** What the Player knows that the handover check needs: their diplomacy and what is in sight. */
export interface HandOverSeen {
  tick: number
  diplomacy: Pick<Diplomacy, 'alliance' | 'contracts'>
  cities: City[]
  buildings: Building[]
  mapSize: number
}

/**
 * The shared handover check (`handOverProblem`, the one the server runs) on what the Player
 * sees: their alliance's army and their realm's contracts stand in for the world's. The server
 * checks again when the order arrives.
 */
export function makeLeaderProblem(
  seen: HandOverSeen,
  realm: { id: string; leaderId: string },
  leader: Resident | undefined,
  target: Resident,
): string | undefined {
  const a = seen.diplomacy.alliance
  const alliances: Alliance[] = a
    ? [
        {
          id: a.id,
          name: a.name,
          leaderId: a.leaderId,
          members: a.members.map((m) => ({
            realmId: m.realmId,
            joinedAt: m.joinedAt,
            leaving: m.leavesAt === null ? null : { at: m.leavesAt, removed: false },
          })),
          invites: a.invites.map((i) => i.realmId),
          army: a.army.map((p) => ({ is: p.is, id: p.id, recallAt: p.recallAt })),
        },
      ]
    : []
  const contracts: MercenaryContract[] = seen.diplomacy.contracts.map((c) => ({
    id: c.id,
    lenderId: c.lender.realmId,
    hirerId: c.hirer.realmId,
    offeredBy: c.offeredBy,
    residentIds: c.residents.map((r) => r.id),
    days: c.days,
    pricePerWeek: c.pricePerWeek,
    storageId: c.storage?.id ?? '',
    startedAt: c.startedAt,
    paidWeeks: c.paidWeeks,
  }))
  const world = {
    tick: seen.tick,
    alliances,
    contracts,
    cities: seen.cities,
    buildings: seen.buildings,
  }
  return handOverProblem(world, realm, leader, target, seen.mapSize)
}

/** The relationship of a carriage's or a resident's owner (ADR 0008), seen from the viewer. */
function realmRelationship(
  realmId: string | null,
  cityId: string | null,
  cities: Pick<City, 'id' | 'realmId' | 'tradeOrg'>[],
  viewer: Viewer,
): Relationship | undefined {
  if (realmId === viewer.realmId) return 'own'
  if (realmId !== null) return viewer.allies.has(realmId) ? 'alliance' : 'otherRealm'
  return themeRelationship(
    cityRelationship(
      cities.find((c) => c.id === cityId),
      viewer,
    ),
  )
}

/** The map's short relationship names to the theme's. */
function themeRelationship(tone: ReturnType<typeof cityRelationship>): Relationship | undefined {
  const rel = rankedAs(tone)
  if (!rel) return undefined
  return (
    {
      own: 'own',
      alliance: 'alliance',
      other: 'otherRealm',
      npc: 'npcCity',
      trade: 'tradeOrg',
    } as const
  )[rel]
}

/** Owner names for the card's lines. */
export const RELATIONSHIP_NAMES: Record<Relationship, string> = {
  own: 'Yours',
  alliance: 'Alliance',
  otherRealm: 'Another realm',
  npcCity: 'NPC city',
  tradeOrg: 'Trade Organization',
}

/** How heavily a carriage looks loaded, when the Player can't see its load (`loadLevel`). */
export const LOAD_LEVEL_NAMES: Record<LoadLevel, string> = {
  empty: 'empty',
  light: 'lightly loaded',
  half: 'half loaded',
  heavy: 'heavily loaded',
  full: 'fully loaded',
}

/** What the card's head shows: a name, the owner's colour, and a few lines about it. */
export interface TileCard {
  title: string
  rel?: Relationship
  /** What the card is named after, which picks its icon. */
  what: 'building' | 'carriage' | 'pile' | 'node' | 'residents' | 'horses' | 'tile'
  lines: string[]
  /** An own gate on the tile, to open or close. */
  gate?: Building
  /**
   * A resource node with nothing built on it: its workplace, and the north-west tile where that
   * fits (`nodeFit`), if anywhere.
   */
  buildHere?: { kind: BuildingKind; at: { x: number; y: number } | undefined }
  /** A city the card links to in the city inspector: an own town hall's. */
  city?: { id: string; label: string }
  /**
   * Where the Player trades on the tile (`CONTEXT.md`: Trade section, Trader stop): a Trade Org
   * warehouse, an NPC city's storage whose prices they see or a wandering trader standing there,
   * opened in the city panel at that building or trader.
   */
  tradeHere?: { cityId: string; buildingId: string }
  /** A city of the Player's own whose town hall is in sight on the tile, which they may rename. */
  renameCity?: { id: string; name: string }
  /**
   * Who occupies the town hall on the tile and how long is left, while it is in sight
   * (`CONTEXT.md`: Occupying a town hall).
   */
  occupation?: OccupationView
  /**
   * The Player's own horses the card lists (loose on the tile, or in the stable), which they may
   * rename (`CONTEXT.md`: Renaming a horse).
   */
  renameHorses?: { id: string; name: string }[]
  /**
   * Residents in sight lying Down on the tile, of any realm, whom the resident picked last may
   * Feed (`CONTEXT.md`: Reviving).
   */
  downHere?: { id: string; name: string; x: number; y: number; down: true }[]
  /**
   * Horses on the tile that aren't full as far as the Player knows, of any realm, which the resident
   * picked last may Feed, most in need first (`CONTEXT.md`: Feeding a horse).
   */
  horsesToFeed?: { id: string; name: string; x: number; y: number; down?: true }[]
  /**
   * For a building the Player only remembers (`CONTEXT.md`: Last seen): when they last saw it,
   * and what they saw of it then (what it held, a site's materials, as lists), shown apart from
   * the lines and lists about what is there now.
   */
  lastSeen?: { when: string; lines: string[]; lists: CardList[]; sites?: SiteView[] }
  /** The carriage on the tile, as rows and meters (`CONTEXT.md`: Goods on cards). */
  carriage?: CarriageView
  /**
   * The carriage on the tile with a horse hitched, and the Player's residents on it who may
   * unhitch the horse (`unhitchProblem`), when there are any (`CONTEXT.md`: Hitched horse).
   */
  unhitch?: { carriageId: string; residents: { id: string; name: string }[] }
  /**
   * Another organization's carriage on the tile and the Player's residents on it, who may drive it
   * off, each with why they can't now, if so (`CONTEXT.md`: Stealing a carriage or horse).
   */
  driveOff?: {
    carriageId: string
    residents: { id: string; name: string; problem: string | undefined }[]
  }
  /**
   * The realm's carriage on the tile with no horse of the realm's to pull it, another organization's
   * free horse to steal for it, and who may drive off with it, as `driveOff`.
   */
  hitchOff?: {
    carriageId: string
    horseId: string
    residents: { id: string; name: string; problem: string | undefined }[]
  }
  /**
   * Another organization's free horse on the tile and the Player's residents on it, who may mount
   * it, each with why they can't now, if so (`CONTEXT.md`: Stealing a carriage or horse).
   */
  stealHorse?: {
    horseId: string
    residents: { id: string; name: string; problem: string | undefined }[]
  }
  /**
   * The construction sites on the tile, the building's own and a carriage's on a stable, as a work
   * meter and a row per material (`CONTEXT.md`: Goods on cards).
   */
  sites?: SiteView[]
  /**
   * Each Down resident on the tile who carries anything, with what they carry, and the Player's
   * residents on the tile who may take it, as from a pile (`CONTEXT.md`: Down).
   */
  downGoods?: { residentId: string; name: string; goods: Stock; takers: SeenResident[] }[]
  /**
   * Who and what the tile holds, under the card's lines: the horses in a stable or on the tile and
   * a workplace's crew as rows; the goods in a storage and a pile as goods grids.
   */
  lists?: CardList[]
  /**
   * How long the Food in a stable lasts the horses standing in it, a meter full at the days of Food
   * the Feed the stable task keeps there (`CONTEXT.md`: Feeding the stable).
   */
  stableFood?: { units: number; share: number; lasts: string }
}

/** Someone the card names, a link that picks them when they are the Player's to command. */
export interface NamedResident {
  id: string
  name: string
  pick: boolean
}

/**
 * A carriage on the tile card (`CONTEXT.md`: Goods on cards): its load against what it holds, its
 * horse with hunger, its driver and passengers, and its haul route. Only what the Player may see
 * (`CONTEXT.md`: Seeing inside a storage, Seeing how someone fares).
 */
export interface CarriageView {
  /** Its section's head: "Carriage (yours)". */
  title: string
  /**
   * How full it is: "40 / 60 kg" with the share for a meter when the Player sees inside, else
   * only how heavily it is loaded ("half loaded"), with no meter.
   */
  load: { text: string; share?: number }
  /** What it holds, for the goods grid, when the Player sees inside. */
  goods?: Stock
  /** Its horse as a row of its own, with health and hunger where the Player knows them. */
  horse?: CardList
  /** Said instead of a horse row: "No horse hitched", or "Horse hitched" with it out of sight. */
  noHorse?: string
  driver?: NamedResident
  /** Its passengers in sight, and what they weigh of what it holds: "160 kg of it people". */
  passengers?: { residents: NamedResident[]; weight: string }
  /**
   * The haul route its driver drives, when that driver is the Player's (`CONTEXT.md`: Haul route,
   * Estimates): "Eastmere storage → Eastmere mine", and the leg it is on or what it does at a
   * stop: "Leg 1 of 2 · about 3 min (3 game hours)", "Loading at Eastmere storage".
   */
  route?: { stops: string; leg: string }
}

/**
 * A construction site on the tile card (`CONTEXT.md`: Goods on cards, Construction site): its work
 * done as a meter with how long is left, and what it has against what it needs, per good.
 */
export interface SiteView {
  /** Its section's head, where the card is named after something else: "Carriage site". */
  title?: string
  /**
   * The work done: "40%", the share for its meter, and about how long is left at the pace of
   * those building it now (`workLeft`); no estimate for a site only remembered.
   */
  work: { text: string; share: number; left?: string }
  /** Each material it takes, in the usual order: what was delivered against what it needs. */
  materials: { good: Good; have: number; need: number }[]
}

/** A list of rows on the tile card (`TileCard.lists`), its head with a count on the right. */
export interface CardList {
  title: string
  /** On the right of the title: "2 · 1 hungry", "7 / 10". */
  count: string
  /** What shows with no rows (or no goods). */
  empty?: string
  /** The meters each row has, by name, as the resident card shows them: Health, Hunger. */
  meters: readonly string[]
  rows: CardRow[]
  /** An inventory, shown as the goods grid in place of rows (`CONTEXT.md`: Goods on cards). */
  goods?: Stock
}

/** One row of a `CardList`: a horse, one of a workplace's crew, or how much is made there. */
export interface CardRow {
  id: string
  name: string
  /** Under the name: a horse's stats and age, what one of a crew is doing and whose they are. */
  detail?: string
  /** On the right, with the good's icon: how much of it (`CONTEXT.md`: Workplace amounts). */
  amount?: { good: Good; text: string }
  /**
   * Each of the list's meters filled to this share, undefined where the Player doesn't know how
   * they fare (`CONTEXT.md`: Seeing how someone fares).
   */
  shares?: number[]
  /**
   * What a click on the row opens: the card of one of the Player's residents, or one of their
   * horses in the Horses drawer.
   */
  opens?: 'resident' | 'horse'
}

/** The meters a horse's or a resident's row has, as the Horses drawer and the resident card. */
const FARES_METERS = ['Health', 'Hunger'] as const

/** The meters' shares for someone whose health and hunger the Player knows. */
const faresShares = (x: { health?: number; hunger?: number }) =>
  x.health === undefined || x.hunger === undefined
    ? undefined
    : [x.health / MAX_HEALTH, x.hunger / MAX_HUNGER]

/** What the Player sees on a tile, for the tile card. */
export interface TileThings {
  x: number
  y: number
  buildings: SeenBuilding[]
  carriages: SeenCarriage[]
  horses: SeenHorse[]
  piles: Pile[]
  node: KnownNode | undefined
  /** The known resource node on a tile, to find the one under a workplace's footprint. */
  nodeAt?: (x: number, y: number) => KnownNode | undefined
  /** The tile's explored terrain (`Terrain`), undefined while unknown. */
  terrain?: number
  /** Residents in sight on the tile that are not the Player's to command. */
  strangers: SeenResident[]
  /** Everyone in sight, for who works where and who lives in a city. */
  residents?: SeenResident[]
  cities: (Pick<
    SeenCity,
    'id' | 'name' | 'realmId' | 'tradeOrg' | 'trade' | 'refuses' | 'horses' | 'horsesToSell'
  > &
    Partial<Pick<SeenCity, 'occupation'>>)[]
  /** The realms the Player knows by name, for who occupies a town hall. */
  realms?: RealmLabel[]
  viewer: Viewer
  tick?: number
  /** Residents in sight working each building, by building id. */
  workers: (b: Building) => number
  /**
   * About how many ticks until one of the Player's residents arrives where they drive
   * (`arrivalTicks`), for a haul route's leg.
   */
  arrivesIn?: (r: SeenResident) => number | undefined
  /** The armies the Player knows, by name, for a haul route to one (`CONTEXT.md`: Supply line). */
  armies?: readonly { id: string; name: string }[]
  /** The caravans the Player sees, whose crew keep their carriages from being driven off. */
  caravans?: readonly Pick<SeenCaravan, 'carriageId' | 'driverId' | 'escortIds'>[]
  /** The wandering traders the Player sees, likewise. */
  traders?: readonly (Pick<SeenTrader, 'carriageId' | 'driverId' | 'escortIds' | 'id'> &
    Partial<Pick<SeenTrader, 'standing'>>)[]
  /** The map's size, for how near a caravan's crew are to its carriage. */
  mapSize?: number
  /** The alliance army's carriages the Player commands (`commandedCarriages`). */
  commandedCarriages?: ReadonlySet<string>
  /** The buildings the Player remembers out of sight, and the tick now (`CONTEXT.md`: Last seen). */
  lastSeen?: { buildings: LastSeenBuilding[]; tick: number }
  /** Where the node's workplace fits on what the Player knows (`nodeFit`), if anywhere. */
  nodeFit?: { x: number; y: number }
}

/**
 * Where the workplace of a resource node can be laid out, as far as the Player knows
 * (`nodeCorner`, `CONTEXT.md`: Where buildings go): the buildings they see, the nodes and terrain
 * they have explored. The server checks again when the order arrives.
 */
export function nodeFit(
  node: KnownNode,
  seen: { buildings: Building[]; cities: City[] },
  nodeAt: (x: number, y: number) => KnownNode | undefined,
  terrain: TerrainLookup,
): { x: number; y: number } | undefined {
  // The nodes a footprint over this one could also cover.
  const reach = FOOTPRINT[NODE_WORKPLACE[node.kind]] - 1
  const nodes: KnownNode[] = []
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const n = nodeAt(wrap(node.x + dx, terrain.size), wrap(node.y + dy, terrain.size))
      if (n) nodes.push(n)
    }
  }
  return nodeCorner({ ...seen, nodes }, terrain, node)
}

/**
 * Why a building of `kind` can't be laid out from (x, y), its footprint running east and south, as
 * far as the Player knows (`buildProblem`, `CONTEXT.md`: Where buildings go): the buildings and
 * cities they see, the nodes and terrain they have explored. The server checks again when the
 * order arrives.
 */
export function buildHereProblem(
  kind: BuildingKind,
  x: number,
  y: number,
  seen: { buildings: Building[]; cities: City[] },
  nodeAt: (x: number, y: number) => KnownNode | undefined,
  terrain: TerrainLookup,
): string | undefined {
  const nodes: KnownNode[] = []
  for (const [tx, ty] of footprintTiles({ kind, x, y }, terrain.size)) {
    const n = nodeAt(tx, ty)
    if (n) nodes.push(n)
  }
  return buildProblem({ ...seen, nodes }, x, y, kind, terrain)
}

/** A node's kind in words: "forest", "iron ore". */
const nodeKindName = (node: KnownNode) => NODE_NAMES[node.kind].replace(/ node$/, '').toLowerCase()

/** "a mine", "an iron ore node". */
const aOrAn = (words: string) => `${/^[aeiou]/.test(words) ? 'an' : 'a'} ${words}`

const capital = (words: string) => `${words[0]!.toUpperCase()}${words.slice(1)}`

/** A value in a stat or skill to a tenth, rounded down so nobody shows at a ceiling too soon. */
const tenths = (n: number) => `${Math.floor(n * 10 + 1e-9) / 10}`

/**
 * Who teaches and trains at a training ground, among the residents in sight (`teacherAt`,
 * `traineesOf`): "Ann teaches Strength", or "Nobody teaches here yet"; then each trainee with
 * their value in the subject and their ceiling (`trainingCeiling`), "waiting" while they learn
 * nothing (`CONTEXT.md`: Training).
 */
function trainingLines(ground: Building, t: TileThings): string[] {
  const residents = t.residents ?? []
  const teacher = teacherAt(ground, residents)
  const o = teacher?.order
  const subject = o?.kind === 'teach' ? o.subject : undefined
  const tick = t.tick ?? 0
  const lines = [
    teacher && subject ? `${teacher.name} teaches ${capital(subject)}` : 'Nobody teaches here yet',
  ]
  for (const r of traineesOf(ground, residents)) {
    const waiting = r.order?.kind === 'train' && r.order.learning ? '' : ', waiting'
    if (!teacher || !subject) {
      lines.push(`${r.name} trains${waiting}`)
      continue
    }
    const has = subjectValue(r as Resident, subject, tick)
    const ceiling = trainingCeiling(r as Resident, teacher as Resident, subject, tick)
    lines.push(`${r.name} trains: ${tenths(has)} of ${tenths(ceiling)}${waiting}`)
  }
  return lines
}

/**
 * What an unbuilt resource node's card says (`CONTEXT.md`: Resource node, Workplace): what can be
 * built on it and whether it fits, what that takes, makes and teaches, and what a worker of
 * average Strength and no skill makes there a game day.
 */
function unbuiltNodeLines(
  node: KnownNode,
  fit: { x: number; y: number } | undefined,
  goodLabels: Record<string, string>,
): string[] {
  const kind = NODE_WORKPLACE[node.kind]
  const name = BUILDING_NAMES[kind].toLowerCase()
  const good = NODE_GOOD[node.kind]
  const goodName = goodLabels[good]!.toLowerCase()
  const materials = BUILD_MATERIALS[kind] ?? {}
  const days = (BUILD_WORK[kind] ?? 0) / TICKS_PER_GAME_DAY
  const skill = WORKPLACE_SKILL[kind]!
  const needs =
    Object.keys(materials).length > 0 ? goodsText(materials, goodLabels) : 'no materials'
  return [
    fit ? `${capital(aOrAn(name))} can be built here` : `No room for ${aOrAn(name)} here`,
    `Needs ${needs} and ${days} game day${days === 1 ? '' : 's'} of one resident’s work`,
    `Makes ${goodName} · teaches ${capital(skill)}`,
    `Up to ${MAX_WORKERS[kind]} workers · about ${WORK_OUTPUT_PER_DAY[good]} ${goodName} each a game day at average Strength`,
  ]
}

/** Goods in words: "4 iron ore, 2 wood". */
function goodsText(stock: Stock | undefined, labels: Record<string, string>): string {
  const parts = GOODS.filter((g) => (stock?.[g] ?? 0) > 0).map(
    (g) => `${stock![g]} ${labels[g]!.toLowerCase()}`,
  )
  return parts.length > 0 ? parts.join(', ') : 'nothing'
}

/** How a horse fares in words: fed, hungry or starving, and healthy or hurt. */
function horseFares(h: Horse): { hunger: 'fed' | 'hungry' | 'starving'; health: string } {
  const hunger =
    h.hunger <= 0 ? 'starving' : h.hunger < HORSE_HUNGRY_SHARE * MAX_HUNGER ? 'hungry' : 'fed'
  return { hunger, health: h.health < MAX_HEALTH ? 'hurt' : 'healthy' }
}

/** A horse's age in words: game days for a foal under a game year, whole game years after. */
export function horseAgeText(h: Pick<SeenHorse, 'bornAt'>, tick: number): string {
  const years = Math.floor(horseAgeInYears(h, tick))
  if (years >= 1) return `${years} ${years === 1 ? 'year' : 'years'} old`
  const days = Math.max(0, Math.floor((tick - h.bornAt) / TICKS_PER_GAME_DAY))
  return `${days} game ${days === 1 ? 'day' : 'days'} old`
}

/**
 * A horse's stats and age, and how it fares where the Player knows it (`CONTEXT.md`: Horse stats,
 * Seeing how someone fares): "Speed 12, Strength 8, Endurance 10 · 5 years old · fed, healthy",
 * or for a Down horse that it is Down and how long it has left (`horseDownLine`).
 */
export function horseDetail(h: SeenHorse, tick: number | undefined): string {
  const parts = [horseStatsText(h, tick)]
  if (isDown(h)) parts.push(horseDownLine(h, tick))
  else if (horseFaresKnown(h)) {
    const fares = horseFares(h)
    parts.push(`${fares.hunger}, ${fares.health}`)
    if (fares.hunger !== 'fed') parts.push(FEED_HORSE_HINT)
  }
  return parts.join(' · ')
}

/** A horse's stats and age: "Speed 12, Strength 8, Endurance 10 · 5 years old". */
export function horseStatsText(
  h: Pick<SeenHorse, 'stats' | 'bornAt'>,
  tick: number | undefined,
): string {
  const { speed, strength, endurance } = h.stats
  const stats = `Speed ${speed}, Strength ${strength}, Endurance ${endurance}`
  return tick === undefined ? stats : `${stats} · ${horseAgeText(h, tick)}`
}

/**
 * The line on a rider's card for the horse they ride (`CONTEXT.md`: Riding), as the tile card
 * shows a horse, and that it eats from the rider's spare Food: "Horse: Speed 12, Strength 8,
 * Endurance 10 · 5 years old · fed, healthy · eats from your spare Food". Undefined for someone
 * on foot.
 */
export function riddenHorseLine(
  r: Pick<Resident, 'riding'>,
  horses: readonly SeenHorse[],
  tick: number | undefined,
): string | undefined {
  const horse = r.riding === undefined ? undefined : horses.find((h) => h.id === r.riding)
  return horse && `Horse: ${horse.name} · ${horseDetail(horse, tick)} · eats from your spare Food`
}

/**
 * Lists for horses standing together, one per owner: "Horses (yours)" with "2 · 1 hungry" on the
 * right, then a row for each with its stats and age (`horseStatsText`), led for a Down horse by
 * that it is Down and how long it has left (`horseDownLine`), and its health and hunger
 * meters where the Player knows how it fares (`CONTEXT.md`: Seeing how someone fares). A click on
 * one of the Player's own opens it in the Horses drawer.
 */
function horseLists(
  horses: SeenHorse[],
  rel: (h: SeenHorse) => Relationship | undefined,
  tick: number | undefined,
): CardList[] {
  const groups = new Map<string, SeenHorse[]>()
  for (const h of horses) {
    const key = `${h.realmId}/${h.cityId}`
    groups.set(key, [...(groups.get(key) ?? []), h])
  }
  return [...groups.values()].map((group) => {
    const r = rel(group[0]!)
    const owner = r ? RELATIONSHIP_NAMES[r].toLowerCase() : 'nobody’s'
    const parts = [`${group.length}`]
    const down = group.filter(isDown).length
    const known = group
      .filter(horseFaresKnown)
      .filter((h) => !isDown(h))
      .map(horseFares)
    const hungry = known.filter((f) => f.hunger !== 'fed').length
    const hurt = known.filter((f) => f.health === 'hurt').length
    if (down > 0) parts.push(`${down} Down`)
    if (hungry > 0) parts.push(`${hungry} hungry`)
    if (hurt > 0) parts.push(`${hurt} hurt`)
    return {
      title: `${group.length === 1 ? 'Horse' : 'Horses'} (${owner})`,
      count: parts.join(' · '),
      meters: FARES_METERS,
      rows: group.map((h) => {
        const shares = faresShares(h)
        return {
          id: h.id,
          name: h.name,
          detail: [horseNeed(h, tick), horseStatsText(h, tick)].filter(Boolean).join(' · '),
          ...(shares ? { shares } : {}),
          ...(r === 'own' ? { opens: 'horse' as const } : {}),
        }
      }),
    }
  })
}

/**
 * A workplace's crew in sight (`CONTEXT.md`: Workplace, Goods on cards): "Crew" with "2 / 10" at
 * work on the right and how many are away, then a row for each with what they are doing (working,
 * carrying a load, fetching) and their health and hunger where the Player knows them. The crew
 * are those working it, and the Player's own whose script works it (its `workplace` param) while
 * they are away carrying its output, fetching or on their way. A click on one of the Player's
 * own opens their card.
 */
function crewList(
  b: Building,
  max: number,
  t: TileThings,
  labels: Record<string, string>,
): CardList {
  const working = (r: SeenResident) => r.order?.kind === 'workAt' && r.order.buildingId === b.id
  const crew = (t.residents ?? []).filter((r) => working(r) || r.script?.params?.workplace === b.id)
  const away = crew.filter((r) => !working(r)).length
  return {
    title: 'Crew',
    count: `${t.workers(b)} / ${max}${away > 0 ? ` · ${away} away` : ''}`,
    empty: 'Nobody works here',
    meters: FARES_METERS,
    rows: crew.map((r) => {
      const stranger = t.strangers.some((s) => s.id === r.id)
      const rel = stranger ? realmRelationship(r.owner, r.cityId, t.cities, t.viewer) : 'own'
      const shares = faresShares(r)
      const whose = stranger ? ` · ${rel ? RELATIONSHIP_NAMES[rel] : 'Nobody’s'}` : ''
      return {
        id: r.id,
        name: r.name,
        detail: `${crewDoing(r, b, labels)}${whose}`,
        ...(shares ? { shares } : {}),
        ...(stranger ? {} : { opens: 'resident' as const }),
      }
    }),
  }
}

/**
 * What one of a workplace's crew is doing, by their order: "Working", "Carrying a load" (storing
 * its output), "Fetching iron ore" (inputs, or Food), "On the way", else "Idle".
 */
function crewDoing(r: SeenResident, b: Building, labels: Record<string, string>): string {
  const o = r.order
  if (o?.kind === 'workAt' && o.buildingId === b.id) return 'Working'
  if (o?.kind === 'store') return 'Carrying a load'
  if (o?.kind === 'fetch') {
    const goods = GOODS.filter((g) => g in o.goods).map((g) => labels[g]!.toLowerCase())
    return goods.length > 0 ? `Fetching ${goods.join(', ')}` : 'Fetching'
  }
  return o ? 'On the way' : 'Idle'
}

/**
 * Who of the Player's own residents is on the way to a storage or stable (`CONTEXT.md`: Goods on
 * cards): walking there to store or fetch, getting food there, or driving a haul route's carriage
 * to it as the next stop; each with what for and about when they arrive, soonest first. Undefined
 * while nobody is.
 */
export function onTheWayList(
  b: Building,
  t: TileThings,
  goodLabels: Record<string, string>,
): CardList | undefined {
  const label = (g: string) => (goodLabels[g] ?? g).toLowerCase()
  const named = (goods: readonly Good[]) => goods.map(label).join(', ')
  // "10 wood, stone": units where the order names them.
  const wanted = (goods: GoodsWanted) =>
    Object.entries(goods)
      .map(([g, n]) => (n == null ? label(g) : `${n} ${label(g)}`))
      .join(', ')
  const coming = (t.residents ?? []).flatMap((r) => {
    if (t.strangers.some((s) => s.id === r.id)) return []
    const o = r.order
    let what: string | undefined
    let path: readonly unknown[] | null = null
    if (o?.kind === 'store' && o.phase === 'walking' && storageIs(o.to, b)) {
      what = `Store · ${wanted(o.goods)}`
      path = o.path
    } else if (o?.kind === 'fetch' && o.phase === 'walking' && storageIs(o.from, b)) {
      // Getting food hands over to Fetch for Food alone (`CONTEXT.md`: Getting food).
      const food = Object.keys(o.goods).every((g) => g === 'food')
      what = food ? 'Getting food' : `Fetch · ${wanted(o.goods)}`
      path = o.path
    } else if (o?.kind === 'haul' && o.phase === 'driving' && covers(b, o[o.stop].x, o[o.stop].y)) {
      // At `to` the hauled goods come off and the return goods go on; at `from` the other way.
      const [brings, takes] = o.stop === 'to' ? [o.goods, o.returnGoods] : [o.returnGoods, o.goods]
      what = [
        'Haul',
        ...(brings.length > 0 ? [`brings ${named(brings)}`] : []),
        ...(takes.length > 0 ? [`takes ${named(takes)}`] : []),
      ].join(' · ')
      path = o.path
    }
    if (!what) return []
    const ticks = path ? t.arrivesIn?.(r) : undefined
    return [{ r, what, ticks, eta: wayLeft(path, ticks) }]
  })
  if (coming.length === 0) return undefined
  coming.sort((x, y) => (x.ticks ?? Infinity) - (y.ticks ?? Infinity))
  return {
    title: 'On the way',
    count: `${coming.length}`,
    meters: [],
    rows: coming.map(({ r, what, eta }) => ({
      id: r.id,
      name: r.name,
      detail: `${what} · ${eta}`,
      opens: 'resident' as const,
    })),
  }
}

/** Whether a store or fetch order's place is the storage or stable `b`. */
function storageIs(place: GoodsPlace, b: Building): boolean {
  return place.kind === 'storage' && place.storageId === b.id
}

/**
 * How much of a way is left (`CONTEXT.md`: Estimates): about when they arrive, else how many
 * tiles there are still to go, or that the way is still being found.
 */
function wayLeft(path: readonly unknown[] | null, ticks: number | undefined): string {
  if (!path) return 'finding the way'
  return ticks === undefined ? `${path.length} tiles to go` : aboutTime(ticks)
}

/**
 * An inventory on the card as the goods grid (`CONTEXT.md`: Goods on cards): a storage's goods, a
 * pile, a site's materials; by default with what they weigh on the right.
 */
function goodsList(
  title: string,
  stock: Stock,
  empty: string,
  count = `${Math.round(stockWeight(stock))} kg`,
): CardList {
  return { title, count, empty, meters: [], rows: [], goods: stock }
}

/**
 * How long a stable's Food lasts the horses standing in it (`CONTEXT.md`: Feeding the stable):
 * "about 6 game days for its horses", a meter full at `STABLE_FEED_DAYS`.
 */
export function stableFoodMeter(
  food: number,
  horses: readonly SeenHorse[],
): NonNullable<TileCard['stableFood']> {
  const perDay = horses.reduce((n, h) => n + HORSE_FOOD_PER_DAY * horseFoodFactor(h), 0)
  if (perDay <= 0) return { units: food, share: food > 0 ? 1 : 0, lasts: 'no horses in it to feed' }
  const days = Math.floor(food / perDay + 1e-9)
  const lasts =
    days < 1 ? 'less than a game day' : `about ${days} game ${days === 1 ? 'day' : 'days'}`
  return {
    units: food,
    share: Math.min(1, food / perDay / STABLE_FEED_DAYS),
    lasts: `${lasts} for its horses`,
  }
}

/**
 * Game days until the foal of each resident in sight breeding at a stable (`CONTEXT.md`:
 * Breeding), soonest first.
 */
export function daysToFoals(stable: Building, residents: readonly SeenResident[]): number[] {
  return breedersAt(residents, stable)
    .map((r) => (r.order?.kind === 'breed' ? STABLE_BREED_TICKS - r.order.progress : 0))
    .map((left) => Math.max(1, Math.ceil(left / TICKS_PER_GAME_DAY)))
    .sort((a, b) => a - b)
}

/**
 * Lines for the breedings a stable keeps that nobody in sight is tending (`CONTEXT.md`:
 * Breeding): how far along each is, then its two horses (`horseDetail`).
 */
export function pausedBreedingLines(
  stable: Building,
  residents: readonly SeenResident[],
  horses: readonly SeenHorse[],
  tick: number | undefined,
): string[] {
  const tended = breedersAt(residents, stable).flatMap((r) =>
    r.order?.kind === 'breed' ? [keptBreeding(stable, r.order.horseIds)] : [],
  )
  return (stable.breedings ?? [])
    .filter((k) => !tended.includes(k))
    .flatMap((k) => {
      const pair = k.horseIds.map((id) => horses.find((h) => h.id === id))
      return [
        `Breeding paused: ${Math.floor((k.progress / STABLE_BREED_TICKS) * 100)}% of the way to a foal`,
        ...pair.flatMap((h) => (h ? [`· ${h.name} · ${horseDetail(h, tick)}`] : [])),
      ]
    })
}

/**
 * The card for a tile: named after the most important thing on it (a building or site, then a
 * carriage, goods on the ground, a resource node, strangers), with a line for everything there.
 * Where no building is in sight but the Player remembers one, the card is named after that, says
 * when they last saw it and what they saw then, and offers nothing to do with it.
 */
export function describeTile(t: TileThings, goodLabels: Record<string, string>): TileCard {
  const here = <T extends { x: number; y: number }>(xs: T[]) =>
    xs.filter((v) => v.x === t.x && v.y === t.y)
  // A building shows on every tile of its footprint, with its one pile (`CONTEXT.md`: At a building).
  const live = t.buildings.find((b) => !SHARES_A_TILE.includes(b.kind) && covers(b, t.x, t.y))
  const remembered = live
    ? undefined
    : t.lastSeen?.buildings.find((b) => !SHARES_A_TILE.includes(b.kind) && covers(b, t.x, t.y))
  const building = live ?? remembered
  const road = here(t.buildings).find((b) => b.kind === 'road')
  const carriageSite = here(t.buildings).find((b) => b.kind === 'carriage')
  const carriage = here(t.carriages)[0]
  const pileTile = live ?? t
  const pile = t.piles.find((p) => p.x === pileTile.x && p.y === pileTile.y)
  const cityOf = (b: Building) => t.cities.find((c) => c.id === b.cityId)
  // Every horse in the stable on the tile, hitched or not, as it is bred and fills up
  // (`breedProblem`); elsewhere the horses on the tile not pulling a carriage.
  const hitched = new Set(t.carriages.map((k) => k.horseId))
  // Who is in or at a building only remembered is not known.
  const stable = live?.kind === 'stable' && !live.site ? live : undefined
  const horsesHere = t.horses.filter((h) =>
    stable ? covers(stable, h.x, h.y) : !hitched.has(h.id) && h.x === t.x && h.y === t.y,
  )
  const horseRel = (h: SeenHorse) => realmRelationship(h.realmId, h.cityId, t.cities, t.viewer)
  const renameHorses = horsesHere
    .filter((h) => h.realmId !== null && h.realmId === t.viewer.realmId)
    .map(({ id, name }) => ({ id, name }))
  const lines: string[] = []
  const lists: CardList[] = []
  const sites: SiteView[] = []
  let stableFood: TileCard['stableFood']
  let card: Omit<TileCard, 'lines'> | undefined
  let buildHere: TileCard['buildHere']
  let unhitch: TileCard['unhitch']
  let driveOff: TileCard['driveOff']
  let hitchOff: TileCard['hitchOff']
  let stealHorse: TileCard['stealHorse']
  let carriageView: CarriageView | undefined
  if (building) {
    const city = cityOf(building)
    // An outpost storage goes by its own realm (`CONTEXT.md`: Outpost storage).
    const rel = realmRelationship(building.realmId ?? null, building.cityId, t.cities, t.viewer)
    const name = BUILDING_NAMES[building.kind]
    const outpost = isOutpostStorage(building) ? `Outpost ${name.toLowerCase()}` : name
    card = {
      title: building.site ? `${name} site` : city ? `${city.name} ${name.toLowerCase()}` : outpost,
      rel,
      what: 'building',
      gate:
        building === live && building.kind === 'gate' && !building.site && rel === 'own'
          ? building
          : undefined,
    }
    lines.push(rel ? RELATIONSHIP_NAMES[rel] : 'Nobody’s')
    if (building.site) sites.push(describeSite(building, live ? t : undefined))
    else {
      const max = MAX_WORKERS[building.kind]
      if (max !== undefined && live) lists.push(crewList(live, max, t, goodLabels))
      const amounts = live && amountsList(live, t, goodLabels)
      if (amounts) lists.push(amounts)
      // A house's room (`CONTEXT.md`: House), and how its city is housed where the Player may know.
      const room = HOUSING_ROOM[building.kind]
      if (room !== undefined) {
        const housed = live && city && (rel === 'own' || rel === 'alliance')
        lines.push(
          `Room for ${room} residents${housed ? ` · ${city.name}: ${housingLine(city.id, t)}` : ''}`,
        )
      }
      if (stable) {
        if (horsesHere.length === 0) lines.push('No horses in it')
        lists.push(...horseLists(horsesHere, horseRel, t.tick))
        lines.push(`Room for ${Math.max(0, STABLE_CAPACITY - horsesHere.length)} more horses`)
      }
      const makes = live && makesLine(live, t, goodLabels, amounts !== undefined)
      if (makes) lines.push(makes)
      // A finished training ground teaches what its teacher set, and nothing while nobody
      // teaches there (`CONTEXT.md`: Training ground, Teacher).
      if (building.kind === 'trainingGround') lines.push(...trainingLines(building, t))
      // What is inside a building as the goods grid, a stable's Food as a meter.
      if (building.stock && stable) {
        stableFood = stableFoodMeter(building.stock.food ?? 0, horsesHere)
        const rest: Stock = { ...building.stock, food: 0 }
        if (GOODS.some((g) => (rest[g] ?? 0) > 0)) lists.push(goodsList('Goods', rest, ''))
      } else if (building.stock) lists.push(goodsList('Goods', building.stock, 'Nothing in it'))
      const coming = live?.stock && onTheWayList(live, t, goodLabels)
      if (coming) lists.push(coming)
      for (const foal of stable ? daysToFoals(stable, t.residents ?? []) : [])
        lines.push(`Breeding: a foal in about ${foal} game ${foal === 1 ? 'day' : 'days'}`)
      if (stable) lines.push(...pausedBreedingLines(stable, t.residents ?? [], t.horses, t.tick))
      if (building.kind === 'gate') lines.push(building.closed ? 'Closed' : 'Open')
      if (building.kind === 'townHall' && live && city)
        card.occupation = describeOccupation(city, t.tick ?? 0, t.viewer.realmId, t.realms ?? [])
      if (building.kind === 'townHall' && (rel === 'own' || rel === 'alliance') && city) {
        if (live) lines.push(...townHallLines(city.id, t))
        if (rel === 'own')
          card.city = { id: city.id, label: `Open ${city.name} in the city inspector` }
        // Renaming a city (`CONTEXT.md`): from its town hall's card, while it is the Player's.
        if (rel === 'own' && live) card.renameCity = { id: city.id, name: city.name }
      }
      if (live && city && tradesHere(live, city)) {
        lines.push(live.kind === 'stable' ? horseTradeLine(live, city) : 'Buys and sells here')
        card.tradeHere = { cityId: city.id, buildingId: live.id }
      }
      // Offers (`CONTEXT.md`: Offer) stand at a Player's storage: anyone in sight sees them, and its
      // own Player posts them from the trade section Trade here opens.
      const offers = live?.kind === 'storage' ? (live.offers ?? []) : []
      if (live && city && live.kind === 'storage' && (offers.length > 0 || rel === 'own')) {
        if (offers.length > 0) lines.push(offers.map((o) => offerTerms(o, goodLabels)).join(' · '))
        if (rel === 'own' && live.stock) {
          const aside = setAsideLine(live, goodLabels)
          if (aside) lines.push(aside)
        }
        card.tradeHere ??= { cityId: city.id, buildingId: live.id }
      }
    }
    if (building.teardown) lines.push(teardownLine(building))
    if (remembered && t.lastSeen) {
      card.lastSeen = {
        when: lastSeenText(remembered.seenAt, t.lastSeen.tick),
        lines: lines.splice(0),
        lists: lists.splice(0),
        ...(sites.length > 0 ? { sites: sites.splice(0) } : {}),
      }
    }
  }
  if (carriageSite?.site) {
    // A carriage site has no owner (`CONTEXT.md`: Construction site), even on a stable.
    // On a stable's card under a head of its own.
    const head = card ? { title: 'Carriage site' } : {}
    card ??= { title: 'Carriage site', what: 'building' }
    sites.push({ ...head, ...describeSite(carriageSite, t) })
    if (carriageSite.teardown) lines.push(teardownLine(carriageSite))
  }
  if (carriage) {
    const rel = realmRelationship(carriage.realmId, carriage.cityId, t.cities, t.viewer)
    // On a card of its own, its owner is the card's first line, as a building's.
    if (!card) {
      card = { title: 'Carriage', rel, what: 'carriage' }
      lines.push(rel ? RELATIONSHIP_NAMES[rel] : 'Nobody’s')
    }
    carriageView = describeCarriage(carriage, rel, t)
    const own = (t.residents ?? []).filter(
      (r) => !t.strangers.some((s) => s.id === r.id) && !unhitchProblem(r, carriage, t.tick ?? 0),
    )
    if (own.length > 0) {
      unhitch = { carriageId: carriage.id, residents: own.map(({ id, name }) => ({ id, name })) }
    }
  }
  const stealable = here(t.carriages).find((k) =>
    strangersCarriage(k, t.viewer.realmId, t.commandedCarriages),
  )
  const realmId = t.viewer.realmId
  const thieves = here(t.residents ?? []).filter(
    (r) => !t.strangers.some((s) => s.id === r.id) && !isDown(r),
  )
  if (realmId && thieves.length > 0) {
    const seen = {
      tick: t.tick ?? 0,
      residents: t.residents ?? [],
      horses: t.horses,
      carriages: t.carriages,
      caravans: t.caravans ?? [],
      traders: t.traders ?? [],
    }
    /** Each of them with why they can't, by `problem`. */
    const each = (problem: (thief: (typeof thieves)[number]) => string | undefined) =>
      thieves.map((r) => ({ id: r.id, name: r.name, problem: problem(r) }))
    if (stealable) {
      driveOff = {
        carriageId: stealable.id,
        residents: each((r) => driveOffProblem(seen, r, stealable, realmId, t.mapSize)),
      }
    }
    const own = here(t.carriages).find((k) => k.realmId === realmId && !k.horseId)
    const hitched = own && horseToSteal(seen, thieves[0]!, own, realmId)
    if (own && hitched) {
      const carriage = { ...own, realmId }
      hitchOff = {
        carriageId: own.id,
        horseId: hitched.id,
        residents: each((r) => hitchOffProblem(seen, r, carriage, hitched.id)),
      }
    }
    // Only what's free: a hitched horse shows as its carriage, a ridden one as its rider.
    const loose = here(t.horses).filter(
      (h) => h.realmId !== realmId && !carriagePulledBy(seen, h) && !riderOf(seen, h),
    )
    const horse = loose.find((h) => !isDown(h)) ?? loose[0]
    if (horse) {
      stealHorse = {
        horseId: horse.id,
        residents: each((r) => mountOffProblem(seen, r, horse, realmId)),
      }
    }
  }
  if (pile) {
    card ??= { title: 'Goods on the ground', what: 'pile' }
    // At a building it is the building's pile (`CONTEXT.md`: A building's pile).
    lists.push(goodsList(building ? 'Pile' : 'On the ground', pile.goods, 'Nothing'))
  }
  if (t.node) {
    const kindName = nodeKindName(t.node)
    card ??= { title: `${capital(kindName)} node`, what: 'node' }
    // Only a node's workplace covers a node: one on it, or its site, has built it over.
    if (building) lines.push(`On ${aOrAn(kindName)} node`)
    else {
      lines.push(...unbuiltNodeLines(t.node, t.nodeFit, goodLabels))
      buildHere = { kind: NODE_WORKPLACE[t.node.kind], at: t.nodeFit }
    }
  }
  if (t.strangers.length > 0) {
    const r = t.strangers[0]!
    const rel = realmRelationship(r.owner, r.cityId, t.cities, t.viewer)
    card ??= {
      title: t.strangers.length === 1 ? r.name : `${t.strangers.length} residents`,
      rel,
      what: 'residents',
    }
    if (t.strangers.length === 1) {
      const gear = gearText(r, goodLabels)
      lines.push(
        `${r.name}${rel ? ` · ${RELATIONSHIP_NAMES[rel]}` : ''}${isDown(r) ? ' · Down' : ''}${gear ? ` · ${gear}` : ''}`,
      )
    } else lines.push(...strangersLines(t.strangers))
  }
  // Anyone Down here, own or not, for the Feed row (`CONTEXT.md`: Reviving).
  const downHere = here(t.residents ?? t.strangers)
    .filter((r) => isDown(r))
    .map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y, down: true as const }))
  const horsesToFeed = horsesInNeed(horsesHere).map((h) => ({
    id: h.id,
    name: h.name,
    x: h.x,
    y: h.y,
    ...(isDown(h) ? { down: true as const } : {}),
  }))
  if (!stable && horsesHere.length > 0) {
    card ??= {
      title: horsesHere.length === 1 ? 'Horse' : `${horsesHere.length} horses`,
      rel: horseRel(horsesHere[0]!),
      what: 'horses',
    }
    lists.push(...horseLists(horsesHere, horseRel, t.tick))
  }
  const terrain = terrainLine(t.terrain, road)
  if (road) {
    lines.push(road.site ? roadSiteLine(road, t.terrain) : terrain!)
    if (road.teardown) lines.push(teardownLine(road))
  }
  if (terrain && !(road && !road.site)) lines.push(terrain)
  // A wandering trader standing at a stop buys and sells on its tile (`CONTEXT.md`: Trader stop).
  const visitor = t.traders?.find((v) => v.standing?.x === t.x && v.standing.y === t.y)
  if (visitor) lines.push('A wandering trader buys and sells here')
  lines.push(`Tile ${t.x}, ${t.y}`)
  // Anyone on a Down resident's tile can take what they carry (`CONTEXT.md`: Down).
  const onTile = here(t.residents ?? [])
  const takers = onTile.filter((r) => !isDown(r) && !t.strangers.some((s) => s.id === r.id))
  const downGoods = onTile
    .filter((r) => isDown(r) && Object.values(r.carried).some((n) => n > 0))
    .map((r) => ({ residentId: r.id, name: r.name, goods: r.carried, takers }))
  return {
    ...(card ?? {
      title: road && !road.site ? 'Road' : (groundName(t.terrain) ?? 'Open ground'),
      what: 'tile',
    }),
    lines,
    ...(visitor?.standing
      ? { tradeHere: { cityId: visitor.standing.cityId, buildingId: visitor.id } }
      : {}),
    ...(buildHere ? { buildHere } : {}),
    ...(carriageView ? { carriage: carriageView } : {}),
    ...(unhitch ? { unhitch } : {}),
    ...(driveOff ? { driveOff } : {}),
    ...(hitchOff ? { hitchOff } : {}),
    ...(stealHorse ? { stealHorse } : {}),
    ...(downGoods.length > 0 ? { downGoods } : {}),
    ...(renameHorses.length > 0 ? { renameHorses } : {}),
    ...(sites.length > 0 ? { sites } : {}),
    ...(downHere.length > 0 ? { downHere } : {}),
    ...(horsesToFeed.length > 0 ? { horsesToFeed } : {}),
    ...(lists.length > 0 ? { lists } : {}),
    ...(stableFood ? { stableFood } : {}),
  }
}

/**
 * A carriage as rows and meters (`CONTEXT.md`: Goods on cards): its load against what it holds,
 * its passengers counted in, and its goods, when the Player sees inside, else only how heavily it
 * is loaded (`CONTEXT.md`: Seeing inside a storage); its horse as a row with its meters where the
 * Player knows how it fares, and how long the Food on board feeds it; its driver and passengers in
 * sight by name; and the haul route its driver drives, when the driver is the Player's.
 */
export function describeCarriage(
  carriage: SeenCarriage,
  rel: Relationship | undefined,
  t: TileThings,
): CarriageView {
  const pick = (r: SeenResident): NamedResident => ({
    id: r.id,
    name: r.name,
    pick: !t.strangers.some((s) => s.id === r.id),
  })
  // Its passengers, as many as are in sight (they are on its tile, `CONTEXT.md`: Passenger).
  const aboard = (carriage.passengerIds ?? []).flatMap((id) => {
    const r = t.residents?.find((x) => x.id === id)
    return r ? [pick(r)] : []
  })
  const people = aboard.length * PASSENGER_WEIGHT
  const capacity = carriageCapacity(t, carriage)
  const weight = carriage.load ? stockWeight(carriage.load) + people : 0
  const load = carriage.load
    ? { text: `${Math.round(weight)} / ${Math.round(capacity)} kg`, share: weight / capacity }
    : { text: capital(LOAD_LEVEL_NAMES[carriage.loadLevel]) }
  const view: CarriageView = {
    title: `Carriage${rel ? ` (${RELATIONSHIP_NAMES[rel].toLowerCase()})` : ''}`,
    load,
    ...(carriage.load ? { goods: carriage.load } : {}),
  }
  // Who pulls it, by name, when the horse is in sight (`CONTEXT.md`: Horse name), and how it
  // fares only for the Player's own and allies' (`CONTEXT.md`: Seeing how someone fares).
  const horse = t.horses.find((h) => h.id === carriage.horseId)
  if (horse) {
    const shares = faresShares(horse)
    let count = ''
    if (horseFaresKnown(horse)) {
      const food = carriage.load?.food ?? 0
      const days = Math.floor(food / (HORSE_FOOD_PER_DAY * horseFoodFactor(horse)) + 1e-9)
      count =
        food <= 0
          ? 'No Food on board'
          : days <= 0
            ? 'Food on board for less than a game day'
            : `Food on board for ${days} game ${days === 1 ? 'day' : 'days'}`
    }
    view.horse = {
      title: 'Horse',
      count,
      meters: FARES_METERS,
      rows: [
        {
          id: horse.id,
          name: horse.name,
          // A Down horse says so, as in a stable (`CONTEXT.md`: Down).
          detail: isDown(horse)
            ? `${horseDownLine(horse, t.tick)} · ${horseStatsText(horse, t.tick)}`
            : horseStatsText(horse, t.tick),
          ...(shares ? { shares } : {}),
          ...(rel === 'own' ? { opens: 'horse' as const } : {}),
        },
      ],
    }
  } else {
    const ours = rel === 'own' || rel === 'alliance'
    view.noHorse = carriage.horseId ? 'Horse hitched' : ours ? 'No horse hitched' : 'No horse'
  }
  const driver = t.residents?.find((r) => drivenCarriageId(r) === carriage.id)
  if (driver) view.driver = pick(driver)
  if (aboard.length > 0) {
    view.passengers = { residents: aboard, weight: `${Math.round(people)} kg of it people` }
  }
  // A route as the Doing line says it, only for the Player's own driver (`CONTEXT.md`: Doing).
  const o = driver?.order
  if (driver && view.driver?.pick && o?.kind === 'haul') view.route = haulRoute(driver, o, t)
  return view
}

/**
 * A haul route's stops by name and where along it the carriage is (`CONTEXT.md`: Haul route,
 * Estimates): leg 1 drives to the second stop, leg 2 back to the first, each with about when it
 * arrives; at a stop, what is done there.
 */
function haulRoute(driver: SeenResident, o: HaulOrder, t: TileThings): CarriageView['route'] {
  const from = stopName(o.from, t)
  const to = o.toArmy
    ? (t.armies?.find((a) => a.id === o.toArmy)?.name ?? 'the army')
    : stopName(o.to, t)
  const at = o.stop === 'from' ? from : to
  let leg: string
  if (o.phase === 'loading') {
    const both = o.returnGoods.length > 0
    leg = both
      ? `Unloading and loading at ${at}`
      : o.stop === 'from'
        ? `Loading at ${at}`
        : `Unloading at ${at}`
  } else {
    const ticks = o.path ? t.arrivesIn?.(driver) : undefined
    leg = `Leg ${o.stop === 'to' ? 1 : 2} of 2 · ${wayLeft(o.path, ticks)}`
  }
  return { stops: `${from} → ${to}`, leg }
}

/**
 * A haul route's stop by what stands there, as its card is named: "Eastmere storage", "Outpost
 * storage", "Mine"; else by its tile: "12, 40".
 */
function stopName(at: { x: number; y: number }, t: TileThings): string {
  const b = t.buildings.find((b) => !SHARES_A_TILE.includes(b.kind) && covers(b, at.x, at.y))
  if (!b) return `${at.x}, ${at.y}`
  const name = BUILDING_NAMES[b.kind]
  const city = t.cities.find((c) => c.id === b.cityId)
  if (b.site) return `${name} site`
  if (city) return `${city.name} ${name.toLowerCase()}`
  return isOutpostStorage(b) ? `Outpost ${name.toLowerCase()}` : name
}

/**
 * How far a road site has come (`CONTEXT.md`: Road), on `terrain` beneath it: "Road site · 25% of
 * the work done", and on Mountain how many times the work it takes there (`workFactor`).
 */
function roadSiteLine(site: Building, terrain: number | undefined): string {
  const work = BUILD_WORK.road ?? 0
  const done = work > 0 ? Math.floor(((site.site?.work ?? 0) / work) * 100) : 100
  const factor = workFactor('road', terrain)
  const mountain = factor > 1 ? ` · ${factor}× the work on Mountain` : ''
  return `Road site · ${done}% of the work done${mountain}`
}

/** The explored terrain's name, undefined while it is unknown. */
function groundName(terrain: number | undefined): string | undefined {
  return terrain === undefined || terrain === UNEXPLORED ? undefined : TERRAIN_NAMES[terrain]
}

/**
 * How the tile's ground walks and feeds (`CONTEXT.md`: Terrain, Road): "Hills · speed ~70% · food
 * 130%", or a finished road's speed on whatever it lies on.
 */
function terrainLine(terrain: number | undefined, road: Building | undefined): string | undefined {
  const speed = (v: number) => `speed ${v === 1 ? '' : '~'}${Math.round(v * 100)}%`
  const food = (v: number) => `food ${Math.round(v * 100)}%`
  const name = groundName(terrain)
  if (road && !road.site) {
    const on = name ? ` on ${name.toLowerCase()}` : ''
    return `Road${on} · ${speed(TERRAIN_SPEED[Terrain.Road])} · ${food(TERRAIN_FOOD[Terrain.Road])}`
  }
  if (!name) return undefined
  const s = (TERRAIN_SPEED as Partial<Record<number, number>>)[terrain!]
  const f = (TERRAIN_FOOD as Partial<Record<number, number>>)[terrain!]
  return s === undefined || f === undefined
    ? `${name} · impassable`
    : `${name} · ${speed(s)} · ${food(f)}`
}

/**
 * A construction site as a work meter and a row per material (`SiteView`). With `t`, what is in
 * sight now, it says how long the work is left at the pace of those building it; a site only
 * remembered has none.
 */
function describeSite(site: Building, t: TileThings | undefined): SiteView {
  const work = BUILD_WORK[site.kind] ?? 0
  const share = work > 0 ? Math.min(1, (site.site?.work ?? 0) / work) : 1
  const need = BUILD_MATERIALS[site.kind] ?? {}
  const left =
    t?.tick === undefined
      ? undefined
      : workLeft(site, (t.residents ?? []) as Resident[], t.tick, { under: t.terrain })
  return {
    work: { text: `${Math.floor(share * 100)}%`, share, ...(left ? { left } : {}) },
    materials: GOODS.filter((g) => (need[g] ?? 0) > 0).map((good) => ({
      good,
      have: site.site?.delivered[good] ?? 0,
      need: need[good]!,
    })),
  }
}

/**
 * What a workplace makes (`CONTEXT.md`: Workplace); at a smithy, what its workers in sight are
 * making (`CONTEXT.md`: Smithy). Its pile shows as a goods grid of its own. With `amounts` on the
 * card (`amountsList`) only what they leave out: what other realms' workers make at a smithy.
 */
function makesLine(
  b: Building,
  t: TileThings,
  labels: Record<string, string>,
  amounts: boolean,
): string | undefined {
  if (MAX_WORKERS[b.kind] === undefined || !WORKPLACE_SKILL[b.kind]) return undefined
  const label = (g: Good) => labels[g]!.toLowerCase()
  if (hasChoice(b.kind)) {
    const making = new Map<Good, number>()
    for (const r of t.residents ?? []) {
      const o = r.order
      if (o?.kind !== 'workAt' || o.buildingId !== b.id) continue
      // Who the amounts already say what they make for needn't be said again.
      if (amounts && r.owner === t.viewer.realmId) continue
      const recipe = recipeFor(b.kind, o.makes)
      if (recipe) making.set(recipeGood(recipe), (making.get(recipeGood(recipe)) ?? 0) + 1)
    }
    if (making.size === 0) return amounts ? undefined : 'Makes weapons and armour, nobody at it'
    const list = [...making].map(([g, n]) => `${label(g)} (${n})`).join(', ')
    return `${amounts ? 'Others make' : 'Its workers make'} ${list}`
  }
  const good = amounts ? undefined : goodMadeAt(b, t)
  return good && `Makes ${label(good)}`
}

/**
 * The good a workplace makes, as far as the Player knows (`workplaceGood`): on a resource node
 * what the known node under its footprint yields; at a smithy what `makes` names.
 */
function goodMadeAt(b: Building, t: TileThings, makes?: Good): Good | undefined {
  if (b.kind === 'farm') return 'food'
  if (RECIPES[b.kind]) {
    const recipe = recipeFor(b.kind, makes)
    return recipe && recipeGood(recipe)
  }
  if (!NODE_WORKPLACE_KINDS.has(b.kind) || !t.nodeAt) return undefined
  const node = footprintTiles(b)
    .map(([x, y]) => t.nodeAt!(x, y))
    .find((n) => n && NODE_WORKPLACE[n.kind] === b.kind)
  return node && NODE_GOOD[node.kind]
}

/**
 * How much is being made at a workplace (`CONTEXT.md`: Workplace amounts): a row for each worker of
 * the Player's realm working there, with what they make and how much a game day at their Strength
 * and skill, then a row for the total of each good. Undefined with none of them there. It is the
 * pace while they have what they need; other realms' workers aren't counted, as their stats aren't
 * known.
 */
function amountsList(
  b: Building,
  t: TileThings,
  labels: Record<string, string>,
): CardList | undefined {
  if (MAX_WORKERS[b.kind] === undefined || !WORKPLACE_SKILL[b.kind]) return undefined
  const made = (t.residents ?? []).flatMap((r) => {
    const o = r.order
    if (r.owner !== t.viewer.realmId || o?.kind !== 'workAt' || o.buildingId !== b.id) return []
    const good = goodMadeAt(b, t, o.makes)
    if (!good) return []
    return [{ r, good, perDay: madePerDay(r as Resident, b.kind, good, t.tick ?? 0) }]
  })
  if (made.length === 0) return undefined
  return {
    title: 'Made a game day',
    count: 'with what they need',
    meters: [],
    rows: [
      ...made.map(({ r, good, perDay }) => ({
        id: r.id,
        name: r.name,
        detail: labels[good]!,
        amount: { good, text: tenths(perDay) },
        opens: 'resident' as const,
      })),
      ...GOODS.filter((good) => made.some((m) => m.good === good)).map((good) => ({
        id: `total-${good}`,
        name: 'Total',
        detail: labels[good]!,
        amount: {
          good,
          text: tenths(made.reduce((n, m) => (m.good === good ? n + m.perDay : n), 0)),
        },
      })),
    ],
  }
}

/** The kinds of workplace built on a resource node. */
const NODE_WORKPLACE_KINDS = new Set<string>(Object.values(NODE_WORKPLACE))

/** The weapons and armour a resident carries (`CONTEXT.md`: Weapons and armour), in words. */
function gearText(
  r: Pick<Resident, 'carried'>,
  labels: Record<string, string>,
): string | undefined {
  const has = (g: Good) => (r.carried[g] ?? 0) > 0
  const gear = [...WEAPONS, ...PROTECTION].filter(has).map((g) => labels[g]!.toLowerCase())
  if (gear.length === 0) return undefined
  return WEAPONS.some(has) ? `armed: ${gear.join(', ')}` : `unarmed, with ${gear.join(', ')}`
}

/** The army a resident's order is for, if it is one (`CONTEXT.md`: Army). */
function armyOf(r: SeenResident): string | undefined {
  return (r.order as { army?: string } | null)?.army
}

/**
 * Several strangers on a tile: each army among them as "Army · 12 soldiers" (`CONTEXT.md`:
 * Soldier, Army), then the rest and how many of them are armed.
 */
function strangersLines(strangers: SeenResident[]): string[] {
  const armies = new Map<string, SeenResident[]>()
  const rest: SeenResident[] = []
  for (const r of strangers) {
    const a = armyOf(r)
    if (a) armies.set(a, [...(armies.get(a) ?? []), r])
    else rest.push(r)
  }
  const armed = (rs: SeenResident[]) =>
    rs.filter((r) => WEAPONS.some((w) => (r.carried[w] ?? 0) > 0)).length
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const lines = [...armies.values()].map((rs) => {
    const soldiers = armed(rs)
    const unarmed = rs.length - soldiers
    return `Army · ${plural(soldiers, 'soldier', 'soldiers')}${unarmed > 0 ? ` · ${unarmed} unarmed` : ''}`
  })
  if (rest.length > 0) {
    const n = armed(rest)
    // Anyone in sight sees who is Down (`CONTEXT.md`: Down).
    const down = rest.filter((r) => isDown(r)).length
    lines.push(
      `${plural(rest.length, 'resident', 'residents')} of other realms${n > 0 ? ` · ${n} armed` : ''}${down > 0 ? ` · ${down} Down` : ''}`,
    )
  }
  return lines
}

/**
 * An own or allied city's town hall: its residents, free housing (`CONTEXT.md`: House) and how
 * many game days the Food in its storages lasts them, from what the Player sees of it.
 */
/** A city's residents in sight and its free housing (`CONTEXT.md`: House), as far as in sight. */
function housingLine(cityId: string, t: TileThings): string {
  const residents = (t.residents ?? []).filter((r) => r.cityId === cityId)
  const room = t.buildings
    .filter((b) => b.cityId === cityId && !b.site)
    .reduce((n, b) => n + (HOUSING_ROOM[b.kind] ?? 0), 0)
  return `${residents.length} residents · ${room - residents.length} free housing`
}

function townHallLines(cityId: string, t: TileThings): string[] {
  const residents = (t.residents ?? []).filter((r) => r.cityId === cityId)
  const mine = t.buildings.filter((b) => b.cityId === cityId && !b.site)
  const lines = [housingLine(cityId, t)]
  const food = mine
    .filter((b) => b.kind === 'storage')
    .reduce((n, b) => n + (b.stock?.food ?? 0), 0)
  const perDay = residents
    .filter(faresKnown)
    .reduce((n, r) => n + FOOD_PER_DAY * hungerFactor(r, t.tick ?? 0), 0)
  if (perDay > 0) {
    const days = Math.floor(food / perDay)
    lines.push(
      days < 1
        ? 'Food for less than a game day'
        : `Food for ${days} game ${days === 1 ? 'day' : 'days'}`,
    )
  }
  return lines
}

/**
 * Whether the building is where the Player trades with a Trade Org warehouse or an NPC city
 * (`CONTEXT.md`: Warehouse prices, Trading with an NPC city, Trade section), with prices they are
 * shown: a warehouse, or a storage of an NPC city that doesn't refuse them (`npcCityRefuses`). Or
 * its stable with horses it lists, or of the Player's standing in it (`CONTEXT.md`: Horse market).
 */
export function tradesHere(
  b: Pick<SeenBuilding, 'kind' | 'prices'> & { id?: string },
  city: TileThings['cities'][number],
): boolean {
  if (b.kind === 'warehouse') return (b.prices?.length ?? 0) > 0
  if (b.kind === 'stable') {
    const here = (h: { stableId: string }) => h.stableId === b.id
    return !city.refuses && ((city.horses ?? []).some(here) || (city.horsesToSell ?? []).some(here))
  }
  return (
    b.kind === 'storage' &&
    city.realmId === null &&
    !city.tradeOrg &&
    !city.refuses &&
    (city.trade?.length ?? 0) > 0
  )
}

/** What an NPC city's stable that trades (`tradesHere`) does for the Player, for its tile's card. */
function horseTradeLine(b: { id: string }, city: TileThings['cities'][number]): string {
  const here = (h: { stableId: string }) => h.stableId === b.id
  const sells = (city.horses ?? []).some(here)
  const buys = (city.horsesToSell ?? []).some(here)
  return sells && buys
    ? 'Buys and sells horses here'
    : buys
      ? 'Buys horses here'
      : 'Sells horses here'
}

/** How far tearing a building or site down has come (`CONTEXT.md`: Tearing down). */
function teardownLine(b: Building): string {
  const work = teardownWork(b)
  const done = work > 0 ? Math.min(100, Math.floor(((b.teardown ?? 0) / work) * 100)) : 100
  return `Being torn down · ${done}% done`
}

/** Whom a resident can Feed on a tile, from its card: anyone Down but them, then the horses. */
export function feedTargets(
  card: Pick<TileCard, 'downHere' | 'horsesToFeed'>,
  actor: Pick<Resident, 'id'>,
): { id: string; name: string; x: number; y: number; horse?: true; down?: true }[] {
  const down = card.downHere?.filter((r) => r.id !== actor.id) ?? []
  const horses = card.horsesToFeed?.map((h) => ({ ...h, horse: true as const })) ?? []
  return [...down, ...horses]
}

/** How the Feed block names whom to Feed: a horse says so, and says when it is Down. */
export function feedTargetLabel(t: { name: string; horse?: true; down?: true }): string {
  if (!t.horse) return t.name
  return t.down ? `${t.name} (horse, Down)` : `${t.name} (horse)`
}

/**
 * The actions a tile's card offers: send the resident picked last there, or have them build an
 * unbuilt node's workplace there (`buildHere`), open or close an own gate, open the city
 * inspector at the city the card links to, and trade at a warehouse or storage (`tradeHere`), and
 * have them Feed someone Down there or a horse that isn't full (`feedTargets`), greyed with the
 * reason while they can't (`feedProblem`, `feedHorseProblem`). Everything else a resident does on the tile is on
 * their own card once they stand there. `tick` tells whether the resident is still a child;
 * `size` is the map's.
 */
export function tileActions(
  card: TileCard,
  actor: Resident | undefined,
  tick = 0,
  size = MAP_SIZE,
): CardAction[] {
  const actions: CardAction[] = []
  if (actor)
    actions.push({ id: 'sendHere', label: `Send ${actor.name} here`, key: ACTION_KEYS.sendHere })
  const toFeed = actor ? feedTargets(card, actor) : []
  if (actor && toFeed.length > 0) {
    const first = toFeed[0]!
    const reason = first.horse
      ? feedHorseProblem(actor, first, tick, size)
      : feedProblem(actor, { ...first, down: true }, tick, size)
    actions.push({
      id: 'feed',
      label: toFeed.length === 1 ? `Feed ${first.name}…` : 'Feed…',
      key: ACTION_KEYS.feed,
      opens: true,
      ...(reason ? { disabled: true as const, reason } : {}),
    })
  }
  if (actor && card.buildHere) {
    const name = BUILDING_NAMES[card.buildHere.kind].toLowerCase()
    const reason = !card.buildHere.at
      ? `no room for ${aOrAn(name)} here`
      : !canWork(actor, tick)
        ? 'children can’t build'
        : undefined
    actions.push({
      id: 'build',
      label: `Build ${aOrAn(name)} here`,
      key: ACTION_KEYS.build,
      ...(reason ? { disabled: true as const, reason } : {}),
    })
  }
  if (card.unhitch)
    actions.push({ id: 'unhitch', label: 'Unhitch horse', key: ACTION_KEYS.unhitch })
  const thief = thiefOf(card, actor)
  if (thief) {
    actions.push({
      id: 'driveOff',
      label: DRIVE_OFF_LABEL,
      key: ACTION_KEYS.driveOff,
      ...(thief.problem ? { disabled: true as const, reason: thief.problem } : {}),
    })
  }
  const hitcher = thiefAmong(card.hitchOff?.residents, actor)
  if (hitcher) {
    actions.push({
      id: 'hitchOff',
      label: HITCH_OFF_LABEL,
      key: ACTION_KEYS.hitchOff,
      ...(hitcher.problem ? { disabled: true as const, reason: hitcher.problem } : {}),
    })
  }
  const rider = thiefAmong(card.stealHorse?.residents, actor)
  if (rider) {
    actions.push({
      id: 'stealHorse',
      label: STEAL_HORSE_LABEL,
      key: ACTION_KEYS.stealHorse,
      ...(rider.problem ? { disabled: true as const, reason: rider.problem } : {}),
    })
  }
  if (card.gate)
    actions.push({
      id: 'gate',
      label: card.gate.closed ? 'Open the gate' : 'Close the gate',
      key: ACTION_KEYS.gate,
    })
  if (card.city) actions.push({ id: 'openCity', label: card.city.label, key: ACTION_KEYS.openCity })
  if (card.tradeHere)
    actions.push({ id: 'tradeHere', label: 'Trade here', key: ACTION_KEYS.tradeHere })
  if (card.renameCity)
    actions.push({
      id: 'renameCity',
      label: 'Rename the city…',
      key: ACTION_KEYS.renameCity,
      opens: true,
    })
  const horses = card.renameHorses ?? []
  if (horses.length > 0)
    actions.push({
      id: 'renameHorse',
      label: horses.length === 1 ? `Rename ${horses[0]!.name}…` : 'Rename a horse…',
      key: ACTION_KEYS.renameHorse,
      opens: true,
    })
  // Any tile can carry a waypoint (`CONTEXT.md`: Waypoint).
  actions.push({
    id: 'addWaypoint',
    label: 'Add waypoint…',
    key: ACTION_KEYS.addWaypoint,
    opens: true,
  })
  return actions
}

/**
 * Who unhitches the horse from the tile card's carriage (`TileCard.unhitch`): the resident picked
 * last when they may, or else the first of the Player's residents on its tile who may.
 */
export function unhitcherOf(card: TileCard, actor: { id: string } | undefined): string | undefined {
  const residents = card.unhitch?.residents ?? []
  return (residents.find((r) => r.id === actor?.id) ?? residents[0])?.id
}

/**
 * Who drives off the tile card's carriage (`TileCard.driveOff`): the resident picked last when they
 * stand on its tile, or else the first of the Player's there who can, or else the first of them.
 */
export function thiefOf(
  card: TileCard,
  actor: { id: string } | undefined,
): { id: string; problem: string | undefined } | undefined {
  return thiefAmong(card.driveOff?.residents, actor)
}

/**
 * Who of those on the tile takes what the card offers: the resident picked last when they stand on
 * its tile, or else the first of the Player's there who can, or else the first of them.
 */
export function thiefAmong(
  residents: readonly { id: string; problem: string | undefined }[] = [],
  actor: { id: string } | undefined,
): { id: string; problem: string | undefined } | undefined {
  return (
    residents.find((r) => r.id === actor?.id) ?? residents.find((r) => !r.problem) ?? residents[0]
  )
}

/**
 * The action a key press runs, if one of the shown actions has that key and can run. Keys typed
 * into a field never run actions.
 */
export function actionForKey<Id extends string>(
  actions: readonly CardAction<Id>[],
  key: string,
): CardAction<Id> | undefined {
  const k = key.toUpperCase()
  return actions.find((a) => a.key === k && !a.disabled)
}

/**
 * What Escape leaves, top-most first (`CONTEXT.md`: Picking a target): pick mode, an open panel
 * on the card (an order's, or the form before a script starts), the tile card, the resident or
 * group card, then the drawer.
 */
export type EscapeStep = 'pick' | 'panel' | 'tile' | 'card' | 'drawer'

const ESCAPE_ORDER: readonly EscapeStep[] = ['pick', 'panel', 'tile', 'card', 'drawer']

/** The top-most of what is open, which Escape leaves; undefined with nothing open. */
export function escapeStep(open: Partial<Record<EscapeStep, boolean>>): EscapeStep | undefined {
  return ESCAPE_ORDER.find((s) => open[s])
}
