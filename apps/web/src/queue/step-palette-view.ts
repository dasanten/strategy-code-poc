import { createContext } from 'react'
import { ORDER_GROUP_LABELS } from '../screen/selection-view.js'
import type { Condition, OrderRequest } from '@csp/shared-types'
import { PLAN_STEPS, type Plan, type PlanKind, type PlanStepId } from './plan-step.js'
import { stepGroup, type StepGroup } from './queue-view.js'

/**
 * The queue planner's Add step palette (`CONTEXT.md`: Planner blocks): every kind of step grouped
 * as the Orders tab groups orders (Move, Work & build, Goods, Scripts), each with an icon, plus
 * Flow for what shapes the queue rather than being a step (Repeat).
 */

/** The palette's groups of step kinds, in the Orders tab's order. */
type PaletteGroupId = 'move' | 'work' | 'goods' | 'scripts'

export interface PaletteGroup {
  id: PaletteGroupId
  label: string
  steps: readonly PlanStepId[]
}

/** The group a kind of step is under: that of the order it becomes, by its kind's facts. */
function groupOf(k: PlanKind): StepGroup {
  return k.makes ? stepGroup(k.makes as OrderRequest) : 'flow'
}

/** Every Add step kind in the group the Orders tab shows its order under, in `PLAN_STEPS` order. */
export const PALETTE_GROUPS: readonly PaletteGroup[] = (
  ['move', 'work', 'goods', 'scripts'] as const
).map((id) => ({
  id,
  label: ORDER_GROUP_LABELS[id],
  steps: PLAN_STEPS.filter((k) => groupOf(k) === id).map((k) => k.id),
}))

/** The step kinds in Flow, beside Repeat: shaping the queue rather than an order (`CONTEXT.md`: Wait until). */
export const FLOW_STEPS: readonly PlanStepId[] = PLAN_STEPS.filter(
  (k) => groupOf(k) === 'flow',
).map((k) => k.id)

/** Each step kind's icon in the palette. */
export const PLAN_STEP_ICONS = Object.fromEntries(
  PLAN_STEPS.map((k) => [k.id, k.icon]),
) as Readonly<Record<PlanStepId, string>>

/** The Flow group's Repeat's icon. */
export const REPEAT_ICON = '🔁'

/**
 * What the planner the palette sits under offers it (`QueueBlock`): Repeat on the picked steps,
 * when some are picked in a row, and the insert point new steps go after, if one is set.
 */
export interface PlannerFlow {
  repeat?: () => void
  /** Plans an If block around the picked steps: its condition is set first. */
  wrapIf?: () => void
  /** Puts the If block planned into the plan with its condition: the picked steps wrapped, or a block's condition changed. */
  ifDone?: (plan: Plan, condition: Condition) => void
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
  start?: (kind: PlanStepId, after: number | undefined, extra?: Partial<Plan>) => void
}

/** What a step kind dragged from the palette carries (`DataTransfer` type). */
export const STEP_KIND_TYPE = 'application/x-csp-step-kind'

/** The insert point the card keeps; without one, the planner keeps its own. */
export const InsertPointContext = createContext<InsertPoint | undefined>(undefined)

/** The open planner's flow, for the palette right under its steps; none outside a planner. */
export const PlannerFlowContext = createContext<PlannerFlow | undefined>(undefined)
