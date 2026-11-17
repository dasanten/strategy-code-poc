import type { Stance } from '@csp/shared-types'

/** The mood each stance reads as (`CONTEXT.md`: Stance); the server has the same words (`mood`). */
const MOODS: Record<Stance, string> = {
  grow: 'growing',
  fortify: 'arming',
  trade: 'busy trading',
  expand: 'looking to expand',
}

/**
 * What an NPC city is after for now (`CONTEXT.md`: Stance), as a mood line on its card: whoever
 * sees it reads it. Nothing for a city without one (a realm's, a trading post).
 */
export function moodLine(s: Stance | undefined): string | undefined {
  return s && `Mood: ${MOODS[s]}`
}
