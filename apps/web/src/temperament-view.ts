import type { Temperament } from '@csp/shared-types'

/**
 * What an NPC city is like (`CONTEXT.md`: Temperament), as its card and the standing list say
 * it: whoever has traded with it or sees it reads it. Nothing for a city without one.
 */
export function temperamentLine(t: Temperament | undefined): string | undefined {
  return t && `Temperament: ${t}`
}
