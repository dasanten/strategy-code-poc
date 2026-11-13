import { createContext } from 'react'
import { ORDER_GROUP_LABELS } from './selection-view.js'
import type { PlanStepId } from './plan-step.js'

/**
 * The queue planner's Add step palette (`CONTEXT.md`: Planner blocks): every kind of step grouped
 * as the Orders tab groups orders (Move, Work & build, Goods, Scripts), each with an icon, plus
 * Flow for what shapes the queue rather than being a step (Repeat).
 */

/** The palette's groups of step kinds, in the Orders tab's order. */
export type PaletteGroupId = 'move' | 'work' | 'goods' | 'scripts'

export interface PaletteGroup {
  id: PaletteGroupId
  label: string
  steps: readonly PlanStepId[]
}

/** Every Add step kind in the group the Orders tab shows its order under. */
export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  {
    id: 'move',
    label: ORDER_GROUP_LABELS.move,
    steps: [
      'walk',
      'explore',
      'relocate',
      'mount',
      'dismount',
      'drive',
      'board',
      'boardBoat',
      'boardCrew',
      'row',
      'sail',
      'getOff',
      'hitch',
      'unhitch',
      'haul',
      'haulBoat',
    ],
  },
  {
    id: 'work',
    label: ORDER_GROUP_LABELS.work,
    steps: ['work', 'build', 'road', 'wall', 'tearDown', 'feedStable', 'breed', 'teach', 'train'],
  },
  {
    id: 'goods',
    label: ORDER_GROUP_LABELS.goods,
    steps: ['store', 'fetch', 'pickUp', 'drop', 'feed'],
  },
  { id: 'scripts', label: ORDER_GROUP_LABELS.scripts, steps: ['runScript'] },
]

/** Each step kind's icon in the palette. */
export const PLAN_STEP_ICONS: Record<PlanStepId, string> = {
  walk: '🚶',
  explore: '🧭',
  relocate: '🏠',
  mount: '🐎',
  dismount: '⏬',
  drive: '🛞',
  board: '🚪',
  boardBoat: '⛵',
  boardCrew: '⚓',
  row: '🚣',
  sail: '🚢',
  getOff: '⏏',
  hitch: '🔗',
  unhitch: '✂',
  haul: '🚚',
  haulBoat: '🛶',
  work: '⚒',
  build: '🏗',
  road: '🛤',
  wall: '🧱',
  tearDown: '🪓',
  feedStable: '🌾',
  breed: '🐴',
  teach: '📖',
  train: '🎯',
  store: '📦',
  fetch: '📥',
  pickUp: '✋',
  drop: '📤',
  feed: '🍞',
  runScript: '📜',
}

/** The Flow group's Repeat's icon. */
export const REPEAT_ICON = '🔁'

/**
 * What the planner the palette sits under offers it (`QueueBlock`): Repeat on the picked steps,
 * when some are picked in a row, and the insert point new steps go after, if one is set.
 */
export interface PlannerFlow {
  repeat?: () => void
  after?: number
}

/**
 * Where the insert point goes once the planner's rows change: after the last of the rows just
 * added right after it, so the next step follows the one added; where it was otherwise; none once
 * its row is gone or is last.
 */
export function followInsert(
  before: readonly number[],
  after: readonly number[],
  at: number | undefined,
): number | undefined {
  if (at === undefined) return undefined
  let i = after.indexOf(at)
  if (i < 0) return undefined
  const old = new Set(before)
  while (i + 1 < after.length && !old.has(after[i + 1]!)) i++
  return i === after.length - 1 ? undefined : after[i]
}

/**
 * The planner's insert point, kept by the card's owner so it lasts while the card folds away for
 * a pick on the map: where it is, and how to move or clear it.
 */
export interface InsertPoint {
  at: number | undefined
  set: (at: number | undefined) => void
  /** Plans a step of this kind to go after `after`: a kind dragged from the palette and dropped. */
  start?: (kind: PlanStepId, after: number | undefined) => void
}

/** What a step kind dragged from the palette carries (`DataTransfer` type). */
export const STEP_KIND_TYPE = 'application/x-csp-step-kind'

/** The insert point the card keeps; without one, the planner keeps its own. */
export const InsertPointContext = createContext<InsertPoint | undefined>(undefined)

/** The open planner's flow, for the palette right under its steps; none outside a planner. */
export const PlannerFlowContext = createContext<PlannerFlow | undefined>(undefined)
