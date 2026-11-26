// Admin directives in words, for the admin panel and Players.

import type { DirectiveGoalView } from '@csp/shared-types'

/**
 * World queries about admin directives (`CONTEXT.md`: Admin directive), for the game API (ADR
 * 0002). Every Player sees each directive's target, reason and goals; who gave it and how far its
 * goals have come stay with admins.
 */

/** A directive's goal in words, for the admin panel and Players. */
export function describeGoal(goal: DirectiveGoalView): string {
  if (goal.kind === 'city') return `${goal.city} destroyed`
  const soldiers = `${goal.count} soldier${goal.count === 1 ? '' : 's'}`
  return goal.percent === undefined
    ? `${soldiers} killed`
    : `${goal.percent}% of its soldiers killed (${soldiers})`
}
