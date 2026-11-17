import type { Stance } from '@csp/shared-types'

/** The mood each stance reads as (`CONTEXT.md`: Stance); the server has the same words (`mood`). */
const MOODS: Record<Stance, string> = {
  grow: 'growing',
  fortify: 'arming',
  trade: 'busy trading',
  expand: 'looking to expand',
  retaliate: 'retaliating',
}

/**
 * What an NPC city is after for now (`CONTEXT.md`: Stance), as a mood line on its card: whoever
 * sees it reads it, in Retaliate with whom it turned on (`CONTEXT.md`: Retaliating). Nothing for a
 * city without one (a realm's, a trading post).
 */
export function moodLine(s: Stance | undefined, against?: string): string | undefined {
  if (!s) return undefined
  if (s === 'retaliate' && against) return `Mood: retaliating against ${against}`
  return `Mood: ${MOODS[s]}`
}
