import { describe, expect, it } from 'vitest'
import { equipmentLine, equipmentSlots } from './equipment-view.js'

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
