// Ported from packages/shared/src/balance.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { WEAPON_ATTACK } from './narrowed.js'
import { PROTECTION_DEFENCE } from '@csp/balance'
import type { Equipment, Good, Weapon } from '@csp/shared-types'

/** What an NPC city is placed with, by its size: a walled square like a starting city's. */
export interface NpcCitySize {
  /** Tiles along each side, wall included: an odd number, so its storage has a middle tile. */
  size: number
  /** Adult residents, with random stats like a starting city's. */
  residents: number
  /** Houses inside the wall, in a row north of the storage; room for everyone and a little more. */
  houses: number
  /** Farms outside the wall, by the gate; the residents start on them, working them. */
  farms: number
  /** Food in its storage, in units. */
  food: number
}

/**
 * A resident as far as their gear goes: what they have equipped, which anyone who sees them sees
 * (`CONTEXT.md`: Equipment, Seeing it). The server sends each slot as the rules count it, filled at
 * once or kept empty, so the client reads the slots and never what is carried.
 */
export type Geared = { equipped?: Equipment }

/** The weapon a resident fights with: the one equipped, if any (`CONTEXT.md`: Equipment). */
export function bestWeapon(resident: Geared): Weapon | undefined {
  const equipped = resident.equipped?.weapon
  return equipped !== undefined && equipped in WEAPON_ATTACK ? (equipped as Weapon) : undefined
}

/** The protection that counts for a resident (`CONTEXT.md`: Equipment): the shield and armour equipped. */
export function wornProtection(resident: Geared): Good[] {
  const { shield, armour } = resident.equipped ?? {}
  return [shield, armour].filter((g): g is Good => g !== undefined)
}

/** Damage a resident's protection takes off each blow (`CONTEXT.md`: Combat): `wornProtection`'s. */
export function protectionValue(resident: Geared): number {
  const defence = PROTECTION_DEFENCE as Record<string, number>
  return wornProtection(resident).reduce((sum, p) => sum + (defence[p] ?? 0), 0)
}

/** Whether a resident is armed: has a weapon equipped (`CONTEXT.md`: Soldier). */
export function isArmed(resident: Geared): boolean {
  return bestWeapon(resident) !== undefined
}
