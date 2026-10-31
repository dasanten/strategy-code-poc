import type { Building, OrderRequest } from '@csp/shared'
import { copyItems, type PlanItem } from './plan-blocks.js'

/**
 * Saved queues (`CONTEXT.md`: Saved queue): the planner's steps saved under a name, to load onto
 * any planner later. They are kept per browser, like saved groups, so the server never sees them.
 * Load appends copies of the steps after the planned ones; the planner gives them new ids. A saved
 * step keeps its places, and one whose place is gone is flagged (`gonePlace`) and still given: the
 * server skips it when its turn comes. A repeat block is saved as one (`CONTEXT.md`: Repeat
 * block), so a loaded "Mine run" keeps its Repeat x5.
 */

/**
 * A queue saved under a name: its steps and repeat blocks as the clipboard holds them (no ids),
 * and when it was saved.
 */
export interface SavedQueue {
  name: string
  steps: PlanItem[]
  /** When it was saved, in milliseconds since 1970 (the browser's clock). */
  savedAt: number
}

/** The saved queues, by name. */
export type SavedQueues = Record<string, SavedQueue>

/**
 * The shape the browser keeps them in. A later planner that saves another shape bumps it and reads
 * the old one into the new (`migrate`). 1: plain steps; 2: steps and repeat blocks.
 */
export const SAVED_QUEUES_VERSION = 2

/** Where the browser keeps a realm's saved queues. */
export const queuesKey = (realm: string) => `csp.queues.${realm}`

/** The queues with these steps saved under `name`, in place of any saved under it before. */
export function save(
  queues: SavedQueues,
  name: string,
  steps: readonly PlanItem[],
  savedAt: number,
): SavedQueues {
  const key = name.trim()
  if (!key || steps.length === 0) return queues
  return { ...queues, [key]: { name: key, steps: copyItems(steps, false), savedAt } }
}

/**
 * Fresh copies of the steps and blocks saved under `name`, without ids; none when nothing is
 * saved there.
 */
export function load(queues: SavedQueues, name: string): PlanItem[] {
  return copyItems(queues[name]?.steps ?? [], false)
}

/** The queues without the one saved under `name`. */
export function remove(queues: SavedQueues, name: string): SavedQueues {
  const next = { ...queues }
  delete next[name]
  return next
}

/** The saved queues as the Load list shows them: the latest saved first. */
export function list(queues: SavedQueues): SavedQueue[] {
  return Object.values(queues).sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name))
}

/**
 * The saved queues read back from storage: none when it holds nothing usable, and without any
 * entry that isn't a saved queue (a step that isn't an order, a duration that isn't whole minutes,
 * a block that repeats nothing). An older shape is read into this one.
 */
export function parseQueues(text: string | null): SavedQueues {
  if (!text) return {}
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (!isObject(raw) || !isObject(raw.queues)) return {}
  const stored = migrate(raw.version, raw.queues)
  if (!stored) return {}
  const queues: SavedQueues = {}
  for (const [name, entry] of Object.entries(stored)) {
    const queue = savedQueue(name, entry)
    if (queue) queues[name] = queue
  }
  return queues
}

/**
 * The saved queues of an older shape in this one, or undefined for a shape this planner doesn't
 * know (a later one). 1 → 2: a list of plain steps is already a list of steps and blocks.
 */
export function migrate(
  version: unknown,
  queues: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (version === 1 || version === SAVED_QUEUES_VERSION) return queues
  return undefined
}

function savedQueue(name: string, entry: unknown): SavedQueue | undefined {
  if (!isObject(entry) || entry.name !== name || !Number.isFinite(entry.savedAt)) return undefined
  const { steps } = entry
  if (!Array.isArray(steps) || steps.length === 0 || !steps.every(isItem)) return undefined
  return { name, steps: copyItems(steps as PlanItem[], false), savedAt: entry.savedAt as number }
}

function isItem(s: unknown): s is PlanItem {
  if (isObject(s) && 'repeat' in s) {
    const { repeat, items } = s
    return (
      Number.isInteger(repeat) &&
      (repeat as number) >= 1 &&
      Array.isArray(items) &&
      items.length > 0 &&
      items.every(isItem)
    )
  }
  if (!isObject(s) || !isObject(s.order) || typeof s.order.kind !== 'string') return false
  return s.minutes === undefined || (Number.isInteger(s.minutes) && (s.minutes as number) > 0)
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** The saved queues this browser remembers for a realm; none without storage. */
export function readQueues(
  storage: Pick<Storage, 'getItem'> | undefined,
  realm: string,
): SavedQueues {
  try {
    return parseQueues(storage?.getItem(queuesKey(realm)) ?? null)
  } catch {
    return {}
  }
}

/** Remembers a realm's saved queues in this browser; without storage they last until reload. */
export function storeQueues(
  storage: Pick<Storage, 'setItem'> | undefined,
  realm: string,
  queues: SavedQueues,
) {
  try {
    storage?.setItem(queuesKey(realm), JSON.stringify({ version: SAVED_QUEUES_VERSION, queues }))
  } catch {
    // Without storage they just aren't remembered.
  }
}

/** The browser's storage, if the page may use it. */
export function browserStorage(): Storage | undefined {
  try {
    return localStorage
  } catch {
    return undefined
  }
}

/** What the browser knows of the map: the buildings and sites in sight, and those last seen. */
export interface KnownPlaces {
  buildings: readonly Pick<Building, 'id'>[]
  lastSeen: readonly Pick<Building, 'id'>[]
}

/**
 * Why a step's place is gone, as the planner flags it ("the workplace is gone"): a building or
 * site it names that is neither in sight nor last seen (`CONTEXT.md`: Last seen), as when it was
 * torn down. Tiles are always there. Carriages and horses are only known in sight, so one out of
 * sight is not taken for gone, nor is a store or fetch at a storage or carriage no longer known.
 */
export function gonePlace(order: OrderRequest, known: KnownPlaces): string | undefined {
  const ids = new Set([...known.buildings, ...known.lastSeen].map((b) => b.id))
  const gone = (id: unknown) => typeof id === 'string' && !ids.has(id)
  const spot = order.spot as { kind?: string; storageId?: unknown; siteId?: unknown } | undefined
  if (spot?.kind === 'storage' && gone(spot.storageId)) return 'the storage is gone'
  if (spot?.kind === 'site' && gone(spot.siteId)) return 'the site is gone'
  if (gone(order.workplaceId)) return 'the workplace is gone'
  if (gone(order.stableId)) return 'the stable is gone'
  if (gone(order.buildingId)) return 'the building is gone'
  return undefined
}
