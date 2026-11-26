// Respect (`CONTEXT.md`: Respect) as the Wiki shows it. Its rules with a Rust original are twins of
// it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the client asks them per
// frame or per row.

import { bestWeapon, protectionValue } from './stats.js'
import { BLOW_BASE, COMBAT_SKILL_EFFECT, COMBAT_SKILL_LIMIT, WEAPON_ATTACK } from '@csp/balance'
import type { Resident } from '@csp/shared-types'

/*
 * Respect and persuading a city (`CONTEXT.md`: Respect, Persuading a city). Queries here are the
 * game API that orders, scripts and the game's own NPC behaviour share (ADR 0002).
 */

/**
 * How much an armed resident counts for in respect (`CONTEXT.md`: Respect): as combat weighs
 * them, from their gear and training, not their body: the blow of their best weapon, harder with
 * Combat skill, and what their shield and armour take off each blow struck at them. Nothing for
 * the unarmed.
 */
export function fighterStrength(r: Pick<Resident, 'equipped' | 'skills'>): number {
  const weapon = bestWeapon(r)
  if (weapon === undefined) return 0
  const skill = Math.min(COMBAT_SKILL_LIMIT, (r.skills.combat ?? 0) * COMBAT_SKILL_EFFECT)
  return (BLOW_BASE + WEAPON_ATTACK[weapon]) * (1 + skill) + protectionValue(r)
}
