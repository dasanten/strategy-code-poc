import type { Equipment, Good, Stock } from '@csp/shared-types'
import { WEAPON_ATTACK } from './shared/narrowed.js'
import { GOODS, PROTECTION_KINDS } from './shared/world.js'
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

/** The slot a good goes into, or `undefined` for a good that is no gear (`CONTEXT.md`: Equipment). */
export function slotOf(good: Good): SlotView['slot'] | undefined {
  if (good in WEAPON_ATTACK) return 'weapon'
  if ((PROTECTION_KINDS[0] as readonly Good[]).includes(good)) return 'shield'
  if ((PROTECTION_KINDS[1] as readonly Good[]).includes(good)) return 'armour'
  return undefined
}

/** Every good that goes into a slot, weapons first (`CONTEXT.md`: Equipment). */
export const GEAR: readonly Good[] = (['weapon', 'shield', 'armour'] as const).flatMap((slot) =>
  GOODS.filter((g) => slotOf(g) === slot),
)

/** A good a resident carries that they can swap into a slot, with its name on the card. */
export interface SwapChoice {
  good: Good
  label: string
}

/**
 * What a resident can swap into `slot`: the goods they carry that fit it, but the one equipped
 * there, best known first by name.
 */
export function swapChoices(
  slot: SlotView['slot'],
  carried: Stock,
  equipped: Equipment | undefined,
): SwapChoice[] {
  return (Object.keys(carried) as Good[])
    .filter((g) => (carried[g] ?? 0) > 0 && slotOf(g) === slot && equipped?.[slot] !== g)
    .map((good) => ({ good, label: GOOD_LABELS[good] }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The goods that some of a group carry and could swap in (`CONTEXT.md`: Equipment): each gear good
 * carried by at least one of them who doesn't have it equipped already.
 */
export function groupSwapChoices(
  residents: readonly { carried: Stock; equipped?: Equipment }[],
): SwapChoice[] {
  const goods = new Set<Good>()
  for (const r of residents) {
    for (const g of Object.keys(r.carried) as Good[]) {
      const slot = slotOf(g)
      if (slot && (r.carried[g] ?? 0) > 0 && r.equipped?.[slot] !== g) goods.add(g)
    }
  }
  return [...goods]
    .map((good) => ({ good, label: GOOD_LABELS[good] }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
