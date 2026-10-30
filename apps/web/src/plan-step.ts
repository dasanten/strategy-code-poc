import {
  GOODS,
  MAX_WORKERS,
  RECIPES,
  buildingRealm,
  isAt,
  recipeGood,
  type Building,
  type BuildingKind,
  type Carriage,
  type City,
  type Good,
  type GoodsSpot,
  type OrderRequest,
  type SeenHorse,
  type Stock,
} from '@csp/shared'
import type { HaulSetup } from './Residents.js'

/**
 * The queue planner's Add step (`CONTEXT.md`: Queue, Planning ahead): every kind of step a queue
 * can hold, the places each one picks on the map, what it asks for on the card after, and the
 * order it becomes. A step acting on a place goes after a walk there (`appendRequest`'s `at`).
 * The server checks the step again when its turn comes (ADR 0002).
 */

/** What a planned step picks on the map, one after another. */
export type PlanPick =
  'tile' | 'spot' | 'workplace' | 'building' | 'storage' | 'stable' | 'carriage' | 'horse'

/** What a planned step asks for on the card once its places are picked. */
export type PlanAsk = 'goods' | 'buildingKind' | 'makes' | 'horses' | 'haul' | 'script'

export type PlanStepId =
  | 'walk'
  | 'work'
  | 'build'
  | 'tearDown'
  | 'store'
  | 'fetch'
  | 'pickUp'
  | 'drop'
  | 'feedStable'
  | 'breed'
  | 'haul'
  | 'drive'
  | 'road'
  | 'wall'
  | 'mount'
  | 'dismount'
  | 'runScript'

/** One kind of step Add step offers. */
export interface PlanKind {
  id: PlanStepId
  label: string
  /** The places picked on the map, in order, each with what the banner asks for. */
  picks: readonly { pick: PlanPick; prompt: string }[]
  /** What the card asks for after the picks, if anything. */
  ask?: PlanAsk
}

/** Every kind of step Add step offers, grouped as the Orders tab groups them. */
export const PLAN_STEPS: readonly PlanKind[] = [
  { id: 'walk', label: 'Walk to', picks: [{ pick: 'tile', prompt: 'where to walk' }] },
  {
    id: 'drive',
    label: 'Drive the carriage',
    picks: [
      { pick: 'carriage', prompt: 'the carriage to drive' },
      { pick: 'tile', prompt: 'where to drive it' },
    ],
  },
  { id: 'mount', label: 'Mount a horse', picks: [{ pick: 'horse', prompt: 'the horse to mount' }] },
  { id: 'dismount', label: 'Dismount', picks: [] },
  { id: 'work', label: 'Work', picks: [{ pick: 'workplace', prompt: 'the workplace to work' }] },
  {
    id: 'build',
    label: 'Build',
    picks: [{ pick: 'tile', prompt: 'where to build, or a site to join' }],
    ask: 'buildingKind',
  },
  {
    id: 'tearDown',
    label: 'Tear down',
    picks: [{ pick: 'building', prompt: 'the building or site to tear down' }],
  },
  {
    id: 'road',
    label: 'Build a road',
    picks: [
      { pick: 'tile', prompt: 'where the road starts' },
      { pick: 'tile', prompt: 'where the road ends' },
    ],
  },
  {
    id: 'wall',
    label: 'Build a wall',
    picks: [
      { pick: 'tile', prompt: 'where the wall starts' },
      { pick: 'tile', prompt: 'where the wall ends' },
    ],
  },
  {
    id: 'feedStable',
    label: 'Feed the stable',
    picks: [{ pick: 'stable', prompt: 'the stable to feed' }],
  },
  {
    id: 'breed',
    label: 'Breed horses',
    picks: [{ pick: 'stable', prompt: 'the stable to breed in' }],
    ask: 'horses',
  },
  {
    id: 'store',
    label: 'Store what they carry',
    picks: [{ pick: 'storage', prompt: 'the storage, stable or carriage to store at' }],
  },
  {
    id: 'fetch',
    label: 'Fetch',
    picks: [{ pick: 'storage', prompt: 'the storage, stable or carriage to fetch from' }],
    ask: 'goods',
  },
  {
    id: 'pickUp',
    label: 'Pick up',
    picks: [{ pick: 'spot', prompt: 'where to pick goods up' }],
    ask: 'goods',
  },
  {
    id: 'drop',
    label: 'Put down',
    picks: [{ pick: 'spot', prompt: 'where to put goods down' }],
    ask: 'goods',
  },
  {
    id: 'haul',
    label: 'Haul route',
    picks: [
      { pick: 'carriage', prompt: 'the carriage to haul with' },
      { pick: 'tile', prompt: 'where the haul route’s other stop is' },
    ],
    ask: 'haul',
  },
  { id: 'runScript', label: 'Run script', picks: [], ask: 'script' },
]

export function planKind(id: PlanStepId): PlanKind {
  return PLAN_STEPS.find((k) => k.id === id)!
}

/** A place picked on the map: the tile, and what was picked there. */
export interface Picked {
  x: number
  y: number
  /** The building, carriage or horse picked. */
  id?: string
  /** The building's kind, for a building picked or a construction site on the tile. */
  building?: BuildingKind
  /** Where goods go or come from on the tile, for a spot. */
  spot?: GoodsSpot
}

/** A step being planned: its kind and the places picked so far. */
export interface Plan {
  kind: PlanStepId
  picked: Picked[]
  /** Why the last tap picked nothing, said under the banner. */
  error?: string
}

/** The next place the plan picks on the map, if it still needs one. */
export function nextPick(plan: Plan): PlanKind['picks'][number] | undefined {
  return planKind(plan.kind).picks[plan.picked.length]
}

/** What the card asks for once every place is picked; undefined when the step needs nothing. */
export function planAsk(plan: Plan): PlanAsk | undefined {
  const { ask } = planKind(plan.kind)
  if (nextPick(plan)) return undefined
  // A smithy says what to make; other workplaces make what they make.
  if (plan.kind === 'work') return makesAt(plan.picked[0]!).length > 1 ? 'makes' : undefined
  // A site to join is built as what it is.
  if (plan.kind === 'build' && plan.picked[0]?.building) return undefined
  return ask
}

/** The goods a picked workplace can make, more than one at a smithy. */
export function makesAt(p: Picked): Good[] {
  return (p.building && RECIPES[p.building]?.map(recipeGood)) ?? []
}

/** What picking places needs of the world: what is where and whose. */
export interface PlanWorld {
  buildings: readonly Building[]
  carriages: readonly Pick<Carriage, 'id' | 'x' | 'y' | 'realmId'>[]
  horses: readonly Pick<SeenHorse, 'id' | 'x' | 'y' | 'realmId'>[]
  cities: readonly Pick<City, 'id' | 'realmId'>[]
  realmId: string
  size: number
}

/**
 * What a tap on the tile picks for `pick`, or why nothing, as a string: only that it could make
 * sense (the place is there, and the realm's where it must be). Whether the step can start is
 * checked when its turn comes.
 */
export function planPickAt(
  w: PlanWorld,
  pick: PlanPick,
  at: { x: number; y: number },
): Picked | string {
  const tile = { x: at.x, y: at.y }
  const here = w.buildings.filter((b) => isAt(at, b, w.size))
  const building = here.find((b) => b.kind !== 'road') ?? here[0]
  const own = (b: Building) => buildingRealm(w, b) === w.realmId
  const ownCarriage = w.carriages.find(
    (k) => k.x === at.x && k.y === at.y && k.realmId === w.realmId,
  )
  const named = (b: Building): Picked => ({ ...tile, id: b.id, building: b.kind })
  switch (pick) {
    case 'tile':
      return building?.site ? { ...tile, building: building.kind } : tile
    case 'spot': {
      if (ownCarriage) return { ...tile, spot: { kind: 'carriage', carriageId: ownCarriage.id } }
      if (!building) return { ...tile, spot: { kind: 'ground' } }
      if (building.site) return { ...tile, spot: { kind: 'site', siteId: building.id } }
      if (['storage', 'stable'].includes(building.kind))
        return { ...tile, spot: { kind: 'storage', storageId: building.id } }
      return { ...tile, spot: { kind: 'ground' } }
    }
    case 'workplace': {
      const b = here.find((x) => !x.site && MAX_WORKERS[x.kind] !== undefined)
      return b ? named(b) : 'no workplace there'
    }
    case 'building':
      return building && own(building) ? named(building) : 'no building of yours there'
    case 'stable': {
      const b = here.find((x) => x.kind === 'stable' && !x.site && own(x))
      return b ? named(b) : 'no stable of yours there'
    }
    case 'storage': {
      const b = here.find((x) => ['storage', 'stable'].includes(x.kind) && !x.site)
      if (b) return named(b)
      return ownCarriage ? { ...tile, id: ownCarriage.id } : 'no storage, stable or carriage there'
    }
    case 'carriage':
      return ownCarriage ? { ...tile, id: ownCarriage.id } : 'no carriage of yours there'
    case 'horse': {
      const h = w.horses.find((x) => x.x === at.x && x.y === at.y && x.realmId === w.realmId)
      return h ? { ...tile, id: h.id } : 'no horse of yours there'
    }
  }
}

/** The plan with a tap on the map picked into it, or why the tap picked nothing. */
export function pickInto(w: PlanWorld, plan: Plan, at: { x: number; y: number }): Plan {
  const next = nextPick(plan)
  if (!next) return plan
  const picked = planPickAt(w, next.pick, at)
  if (typeof picked === 'string') return { ...plan, error: picked }
  return { kind: plan.kind, picked: [...plan.picked, picked] }
}

/** What the card's ask answered: goods with units, a kind to build, two horses, and so on. */
export type PlanAnswer =
  | { ask: 'goods'; goods: Stock }
  | { ask: 'buildingKind'; building: BuildingKind }
  | { ask: 'makes'; makes: Good }
  | { ask: 'horses'; horseIds: [string, string] }
  | { ask: 'haul'; setup: HaulSetup }
  | { ask: 'script'; scriptId: number }

/** Where a step acts, for the walk put before it (`appendRequest`'s `at`). */
type At = { x: number; y: number }

/**
 * The order a planned step becomes, and the tile it acts on when it needs the resident standing
 * there; a walk there goes before it. Steps that go to their place themselves (walk, store,
 * fetch, build, a road or wall) have no `at`. Undefined while a place is still to be picked or
 * the card's ask isn't answered.
 */
export function planOrder(
  plan: Plan,
  answer?: PlanAnswer,
): { order: OrderRequest; at?: At } | undefined {
  const ask = planAsk(plan)
  if (nextPick(plan) || (ask && answer?.ask !== ask)) return undefined
  const [p, q] = plan.picked as [Picked, Picked]
  const at = { x: p?.x, y: p?.y }
  const a = answer
  switch (plan.kind) {
    case 'walk':
      return { order: { kind: 'walkTo', x: p.x, y: p.y } }
    case 'drive':
      return { order: { kind: 'drive', carriageId: p.id, x: q.x, y: q.y }, at }
    case 'mount':
      return { order: { kind: 'mount', horseId: p.id }, at }
    case 'dismount':
      return { order: { kind: 'dismount' } }
    case 'work': {
      const makes = a?.ask === 'makes' ? { makes: a.makes } : {}
      return { order: { kind: 'task', task: 'work', workplaceId: p.id, ...makes }, at }
    }
    case 'build': {
      const building = a?.ask === 'buildingKind' ? a.building : p.building
      return { order: { kind: 'task', task: 'build', building, at } }
    }
    case 'tearDown':
      return { order: { kind: 'task', task: 'tearDown', buildingId: p.id }, at }
    case 'road':
    case 'wall': {
      const kind = plan.kind === 'road' ? 'roadLine' : 'wallLine'
      return { order: { kind, from: at, to: { x: q.x, y: q.y } } }
    }
    case 'feedStable':
      return { order: { kind: 'task', task: 'feedStable', stableId: p.id }, at }
    case 'breed': {
      const horseIds = a?.ask === 'horses' ? a.horseIds : []
      return { order: { kind: 'task', task: 'breed', stableId: p.id, horseIds }, at }
    }
    case 'store':
      return { order: { kind: 'store', goods: [...GOODS], to: p.id } }
    case 'fetch':
      return { order: { kind: 'fetch', goods: a?.ask === 'goods' ? a.goods : {}, from: p.id } }
    case 'pickUp':
    case 'drop': {
      const goods = a?.ask === 'goods' ? a.goods : {}
      return { order: { kind: plan.kind, spot: p.spot, goods }, at }
    }
    case 'haul': {
      const setup = a?.ask === 'haul' ? a.setup : {}
      const order = { kind: 'task', task: 'haul', carriageId: p.id, x: q.x, y: q.y, ...setup }
      return { order, at }
    }
    case 'runScript':
      return { order: { kind: 'runScript', scriptId: a?.ask === 'script' ? a.scriptId : null } }
  }
}

/** The realm's horses in sight standing in the stable picked, to pick two to breed. */
export function horsesIn(
  w: Pick<PlanWorld, 'buildings' | 'size' | 'realmId'>,
  horses: readonly SeenHorse[],
  stableId: string | undefined,
): SeenHorse[] {
  const stable = w.buildings.find((b) => b.id === stableId)
  return stable ? horses.filter((h) => h.realmId === w.realmId && isAt(h, stable, w.size)) : []
}
