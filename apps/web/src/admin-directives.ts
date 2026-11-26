import type { AdminDirectiveView, DirectiveGoal } from '@csp/shared-types'
import { goalMet } from '@csp/lang-wasm'

/** How far a goal of a directive in force has come, as the admin panel's Directives tab shows it. */
export interface GoalProgress {
  /** In words: "met" or "not yet" for a city, "7 of 12 killed" for soldiers. */
  text: string
  met: boolean
  /** The share done, 0 to 1, for a goal counted in soldiers; a city has no meter. */
  done?: number
}

/** How far `goal` of directive `d` has come (`CONTEXT.md`: Admin directive). */
export function goalProgress(
  d: Pick<AdminDirectiveView, 'soldiersKilled'>,
  goal: DirectiveGoal,
): GoalProgress {
  const met = goalMet(d, goal)
  if (goal.kind === 'city') return { text: met ? 'met' : 'not yet', met }
  const killed = Math.min(d.soldiersKilled, goal.count)
  return {
    text: `${killed} of ${goal.count} killed${met ? ', met' : ''}`,
    met,
    done: goal.count > 0 ? killed / goal.count : 1,
  }
}
