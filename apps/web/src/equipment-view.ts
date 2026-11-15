import type { Equipment } from '@csp/shared-types'
import { GOOD_LABELS } from './goods-grid.js'

/** A resident's three equipment slots as a card shows them (`CONTEXT.md`: Equipment). */
export interface SlotView {
  slot: 'weapon' | 'shield' | 'armour'
  /** The slot's name on the card. */
  label: string
  /** What is equipped in it, or `undefined` when empty. */
  item?: string
}

const SLOTS: { slot: SlotView['slot']; label: string }[] = [
  { slot: 'weapon', label: 'Weapon' },
  { slot: 'shield', label: 'Shield' },
  { slot: 'armour', label: 'Armour' },
]

/** Each slot, weapon first, with what is equipped in it. */
export function equipmentSlots(equipped: Equipment | undefined): SlotView[] {
  return SLOTS.map(({ slot, label }) => {
    const good = equipped?.[slot]
    return good ? { slot, label, item: GOOD_LABELS[good] } : { slot, label }
  })
}

/** One line for a card: "Sword · Shield · no armour", or "Nothing equipped". */
export function equipmentLine(equipped: Equipment | undefined): string {
  const slots = equipmentSlots(equipped)
  if (slots.every((s) => !s.item)) return 'Nothing equipped'
  return slots.map((s) => s.item ?? `no ${s.label.toLowerCase()}`).join(' · ')
}
