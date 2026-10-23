import type { Carriage, Horse, Resident, SeenCarriage, SeenHorse, SeenResident } from '@csp/shared'

/**
 * Whether the Player knows how a resident fares: one of their realm's or an ally's, or one they
 * command (`CONTEXT.md`: Seeing how someone fares). Only then are hunger and health sent.
 */
export function faresKnown(r: SeenResident): r is Resident {
  return r.hunger !== undefined && r.health !== undefined
}

/** Whether the Player knows how a horse fares, as `faresKnown`. */
export function horseFaresKnown(h: SeenHorse): h is Horse {
  return h.hunger !== undefined && h.health !== undefined
}

/**
 * Whether the Player sees a carriage's load (`CONTEXT.md`: Seeing inside a storage): theirs or an
 * ally's, or one with a resident of theirs on its tile.
 */
export function loadKnown(k: SeenCarriage): k is SeenCarriage & Carriage {
  return k.load !== undefined
}
