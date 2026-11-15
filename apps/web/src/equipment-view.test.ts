import { describe, expect, it } from 'vitest'
import {
  GEAR,
  equipmentLine,
  equipmentSlots,
  groupSwapChoices,
  slotOf,
  swapChoices,
} from './equipment-view.js'

describe('equipment slots', () => {
  it('shows the three slots, weapon first, with what is equipped', () => {
    expect(equipmentSlots({ weapon: 'steelSword', armour: 'armour' })).toEqual([
      { slot: 'weapon', label: 'Weapon', item: 'Steel sword' },
      { slot: 'shield', label: 'Shield' },
      { slot: 'armour', label: 'Armour', item: 'Armour' },
    ])
  })

  it('says what is equipped in one line, or that nothing is', () => {
    expect(equipmentLine(undefined)).toBe('Nothing equipped')
    expect(equipmentLine({ weapon: 'spear', shield: 'shield' })).toBe('Spear · Shield · no armour')
  })
})

describe('swapping gear', () => {
  it('knows the slot each good goes into', () => {
    expect(slotOf('steelSword')).toBe('weapon')
    expect(slotOf('steelShield')).toBe('shield')
    expect(slotOf('armour')).toBe('armour')
    expect(slotOf('wood')).toBeUndefined()
    expect(GEAR).toEqual(expect.arrayContaining(['spear', 'sword', 'shield', 'steelArmour']))
    expect(GEAR).not.toContain('food')
  })

  it('offers what is carried for the slot, but what is on already', () => {
    const carried = { spear: 1, sword: 1, shield: 1, wood: 3 }
    expect(swapChoices('weapon', carried, { weapon: 'sword' })).toEqual([
      { good: 'spear', label: 'Spear' },
    ])
    expect(swapChoices('shield', carried, {})).toEqual([{ good: 'shield', label: 'Shield' }])
    expect(swapChoices('armour', carried, {})).toEqual([])
  })

  it('offers a group what any of them could put on', () => {
    const rs = [
      { carried: { sword: 1 }, equipped: { weapon: 'sword' as const } },
      { carried: { spear: 1, armour: 1 }, equipped: { armour: 'armour' as const } },
    ]
    expect(groupSwapChoices(rs).map((c) => c.good)).toEqual(['spear'])
  })
})
