import { describe, expect, it } from 'vitest'
import {
  BLOW_BASE,
  COMBAT_SKILL_EFFECT,
  COMBAT_SKILL_LIMIT,
  PROTECTION_DEFENCE,
  WEAPON_ATTACK,
} from '@csp/balance'
import { fighterStrength } from './persuasion.js'

describe('fighterStrength (Respect, ADR 0033)', () => {
  it('is nothing for the unarmed, however armoured', () => {
    expect(fighterStrength({ carried: { armour: 1, shield: 1 }, skills: {} })).toBe(0)
  })

  it('weighs the best weapon, Combat skill, shield and armour as combat does', () => {
    const spear = fighterStrength({ carried: { spear: 1 }, skills: {} })
    expect(spear).toBe(BLOW_BASE + WEAPON_ATTACK.spear)
    const full = COMBAT_SKILL_LIMIT / COMBAT_SKILL_EFFECT
    const trained = fighterStrength({
      carried: { spear: 1, sword: 1, shield: 1, armour: 1 },
      skills: { combat: full * 2 },
    })
    expect(trained).toBe(
      (BLOW_BASE + WEAPON_ATTACK.sword) * (1 + COMBAT_SKILL_LIMIT) +
        PROTECTION_DEFENCE.shield +
        PROTECTION_DEFENCE.armour,
    )
  })
})
