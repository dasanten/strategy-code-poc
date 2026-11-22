import { QUEUE_MAX_STEPS, SCRIPT_STEP_BUDGET } from '@csp/balance'
import type { ScriptRunSteps } from '@csp/shared-types'

/**
 * What the Queue and Script tabs of the command bar show beside their controls (ADR 0044:
 * Pixel frontier): the planner toolbar's count and the step budget's meter.
 */

/**
 * The count at the end of the planner's toolbar (`CONTEXT.md`: Planner blocks): how many steps
 * are picked, and, once the queue has blocks, how many steps and blocks it holds as written out of
 * what a queue holds, or why it is too long. "2 picked · 9 of 50 steps and blocks."
 */
export function toolbarCount(
  picked: number,
  blocks?: { written: number; over?: string | undefined },
): string {
  const parts: string[] = []
  if (picked > 0) parts.push(`${picked} picked`)
  if (blocks)
    parts.push(
      blocks.over
        ? `Too long: ${blocks.over}.`
        : `${blocks.written} of ${QUEUE_MAX_STEPS} steps and blocks.`,
    )
  return parts.join(' · ')
}

/**
 * How much of its step budget a script used the last tick it ran (`CONTEXT.md`: Step budget), as
 * a share for the Script tab's meter: 0 to 1, full when it ran out.
 */
export function stepsShare(run: ScriptRunSteps): number {
  if (run.outOfSteps) return 1
  return Math.max(0, Math.min(1, run.steps / SCRIPT_STEP_BUDGET))
}
