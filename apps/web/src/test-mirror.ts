import { MAP_SIZE } from '@csp/balance'
import type { BuildingKind, KnownNode, WallMaterial } from '@csp/shared-types'
import { NODE_WORKPLACE } from './shared/world.js'
import { mirrorWelcome } from './world-mirror.js'
import { buildProblem, nodeCorner } from './world-rules.js'

/**
 * For tests: the rules module's mirror holds just what a test's world has (T122.6), as the server
 * would send it in a `welcome` message, so the checks the views ask the mirror answer on it. A
 * test's objects name only what it needs: every field the server always sends gets a blank, and
 * fields a Player is never sent are left out.
 */
export interface TestWorld {
  tick?: number
  size?: number
  residents?: readonly object[]
  buildings?: readonly object[]
  cities?: readonly object[]
  horses?: readonly object[]
  carriages?: readonly object[]
  piles?: readonly object[]
  vessels?: readonly object[]
  caravans?: readonly object[]
  traders?: readonly object[]
}

/** A stat no test names: average, untrained. */
const AVERAGE_STAT = { base: 10, trained: 0 }

/** What the server sends of each kind (`SeenResident` and the rest): anything else is dropped. */
const FIELDS: Record<string, readonly string[]> = {
  resident: [
    'id',
    'name',
    'gameName',
    'owner',
    'cityId',
    'x',
    'y',
    'stats',
    'skills',
    'health',
    'hunger',
    'bornAt',
    'lifespan',
    'carried',
    'equipped',
    'condition',
    'order',
    'orderEnded',
    'struck',
    'defenceScriptId',
    'alarmScriptId',
    'scriptParams',
    'queue',
    'pair',
    'carrying',
    'riding',
    'aboard',
    'up',
    'downUntil',
    'down',
  ],
  horse: [
    'id',
    'name',
    'realmId',
    'cityId',
    'x',
    'y',
    'hunger',
    'health',
    'stats',
    'bornAt',
    'downUntil',
    'down',
  ],
  carriage: [
    'id',
    'realmId',
    'cityId',
    'x',
    'y',
    'horseId',
    'load',
    'loadLevel',
    'passengerIds',
    'standsStill',
  ],
  vessel: [
    'id',
    'kind',
    'realmId',
    'x',
    'y',
    'load',
    'loadLevel',
    'passengerIds',
    'rowerId',
    'crewIds',
    'dockedAt',
  ],
  pile: ['id', 'x', 'y', 'goods'],
  caravan: ['id', 'postId', 'carriageId', 'driverId', 'escortIds', 'heading'],
  trader: ['id', 'postId', 'carriageId', 'driverId', 'escortIds', 'heading', 'standing', 'prices'],
}

/** The blanks for what the server always sends of each kind. */
const BLANKS: Record<string, object> = {
  resident: {
    name: '',
    owner: null,
    cityId: null,
    x: 0,
    y: 0,
    skills: {},
    bornAt: 0,
    lifespan: Number.MAX_SAFE_INTEGER,
    carried: {},
    order: null,
  },
  horse: {
    name: '',
    realmId: null,
    cityId: null,
    x: 0,
    y: 0,
    stats: { speed: 10, strength: 10, endurance: 10 },
    bornAt: 0,
  },
  carriage: {
    realmId: null,
    cityId: null,
    x: 0,
    y: 0,
    horseId: null,
    loadLevel: 'empty',
    passengerIds: [],
    standsStill: false,
  },
  vessel: {
    kind: 'boat',
    realmId: null,
    x: 0,
    y: 0,
    loadLevel: 'empty',
    passengerIds: [],
    crewIds: [],
  },
  pile: { x: 0, y: 0, goods: {} },
  building: { cityId: null, x: 0, y: 0 },
  city: { name: '', realmId: null, townHallId: '', occupation: null },
  caravan: { postId: '', driverId: null, escortIds: [], heading: 'post' },
  trader: { postId: '', driverId: null, escortIds: [], heading: 'post' },
}

/** Fields the client adds to a building or city of its own, which the server doesn't send. */
const CLIENT_ONLY = new Set(['is', 'remembered', 'seenAt'])

function seen(is: string, thing: object): object {
  const fields = FIELDS[is]
  const own = Object.fromEntries(
    Object.entries(thing).filter(
      ([k, v]) => v !== undefined && (fields ? fields.includes(k) : !CLIENT_ONLY.has(k)),
    ),
  )
  const out: Record<string, unknown> = { is, ...BLANKS[is], ...own }
  if (is === 'resident') {
    const stats = (own as { stats?: object }).stats
    out.stats = {
      strength: AVERAGE_STAT,
      endurance: AVERAGE_STAT,
      agility: AVERAGE_STAT,
      intellect: AVERAGE_STAT,
      ...stats,
    }
  }
  return out
}

/** What a welcome message carries of `world`, each as the server sends it. */
function entitiesOf(world: TestWorld): object[] {
  const lists: [string, readonly object[] | undefined][] = [
    ['resident', world.residents],
    ['building', world.buildings],
    ['city', world.cities],
    ['horse', world.horses],
    ['carriage', world.carriages],
    ['pile', world.piles],
    ['vessel', world.vessels],
    ['caravan', world.caravans],
    ['trader', world.traders],
  ]
  return lists.flatMap(([is, list]) => (list ?? []).map((t) => seen(is, t)))
}

function welcome(world: TestWorld, entities: object[]): string {
  return JSON.stringify({
    type: 'welcome',
    tick: world.tick ?? 0,
    map: { size: world.size ?? MAP_SIZE },
    entities,
  })
}

/** The `welcome` message's text a Player sent `world` would get. */
export function welcomeOf(world: TestWorld): string {
  return welcome(world, entitiesOf(world))
}

/**
 * The mirror holds `world` (and nothing else) until the next call; none without a world. Throws
 * for a thing the server would never send; `lenient` leaves such things out instead, for a test
 * whose sketches of things none of the mirror's checks read.
 */
export function mirrorOf(world?: TestWorld, lenient = false): void {
  if (!world || !lenient) return mirrorWelcome(world && welcomeOf(world))
  const readable = entitiesOf(world).filter((e) => {
    try {
      mirrorWelcome(welcome(world, [e]))
      return true
    } catch {
      return false
    }
  })
  mirrorWelcome(welcome(world, readable))
}

/** What a test knows of the ground: its size and terrain. */
interface TestGround {
  size: number
  at: (x: number, y: number) => number
}

/**
 * `buildProblem` with the mirror holding `seen` and the given nodes and terrain, as the views ask
 * it of what the Player knows.
 */
export function buildProblemOn(
  kind: BuildingKind,
  x: number,
  y: number,
  seen: TestWorld,
  nodeAt: (x: number, y: number) => KnownNode | undefined,
  terrain: TestGround,
  material?: WallMaterial,
): string | undefined {
  mirrorOf({ size: terrain.size, ...seen })
  return buildProblem(kind, x, y, { ...terrain, nodeAt }, material)
}

/** `nodeCorner` with the mirror holding `seen`, as for `buildProblemOn`. */
export function nodeCornerOn(
  node: KnownNode,
  seen: TestWorld,
  nodeAt: (x: number, y: number) => KnownNode | undefined,
  terrain: TestGround,
): { x: number; y: number } | undefined {
  mirrorOf({ size: terrain.size, ...seen })
  return nodeCorner(node, NODE_WORKPLACE[node.kind], { ...terrain, nodeAt })
}
