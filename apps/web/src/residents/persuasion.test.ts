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
    expect(fighterStrength({ equipped: { armour: 'armour', shield: 'shield' }, skills: {} })).toBe(
      0,
    )
  })

  it('weighs the weapon equipped, Combat skill, shield and armour as combat does', () => {
    const spear = fighterStrength({ equipped: { weapon: 'spear' }, skills: {} })
    expect(spear).toBe(BLOW_BASE + WEAPON_ATTACK.spear)
    const full = COMBAT_SKILL_LIMIT / COMBAT_SKILL_EFFECT
    const trained = fighterStrength({
      equipped: { weapon: 'sword', shield: 'shield', armour: 'armour' },
      skills: { combat: full * 2 },
    })
    expect(trained).toBe(
      (BLOW_BASE + WEAPON_ATTACK.sword) * (1 + COMBAT_SKILL_LIMIT) +
        PROTECTION_DEFENCE.shield +
        PROTECTION_DEFENCE.armour,
    )
  })

  it('weighs steel gear equipped as steel (CONTEXT.md: Equipment)', () => {
    const steel = fighterStrength({
      equipped: { weapon: 'steelSword', shield: 'steelShield', armour: 'armour' },
      skills: {},
    })
    expect(steel).toBe(
      BLOW_BASE +
        WEAPON_ATTACK.steelSword +
        PROTECTION_DEFENCE.steelShield +
        PROTECTION_DEFENCE.armour,
    )
  })
})
