import type { Equipment, GearCondition, Good, PieceCondition, Stock } from '@csp/shared-types'
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
  /**
   * Its condition in words (`CONTEXT.md`: Wear): only for the realm carrying it, `undefined`
   * otherwise.
   */
  condition?: string
}

/** A piece's condition as a card says it. */
export const CONDITION_WORDS: Record<PieceCondition, string> = {
  good: 'good',
  worn: 'worn',
  nearlyBroken: 'nearly broken',
}

const SLOTS: { slot: SlotView['slot']; label: string }[] = [
  { slot: 'weapon', label: 'Weapon' },
  { slot: 'shield', label: 'Shield' },
  { slot: 'armour', label: 'Armour' },
]

/**
 * Each slot, weapon first, with what is equipped in it and, for the realm carrying it, its
 * condition.
 */
export function equipmentSlots(
  equipped: Equipment | undefined,
  condition?: GearCondition,
): SlotView[] {
  return SLOTS.map(({ slot, label }) => {
    const good = equipped?.[slot]
    if (!good) return { slot, label }
    const c = condition?.[slot]
    return c
      ? { slot, label, item: GOOD_LABELS[good], condition: CONDITION_WORDS[c] }
      : { slot, label, item: GOOD_LABELS[good] }
  })
}

/**
 * One line for a card: "Sword (worn) · Shield (good) · no armour", or "Nothing equipped"; the
 * condition only where it is known. The realm's own resident carrying Tools adds their set's
 * condition, "· Tools (worn)" (`CONTEXT.md`: Tools): not equipped, but worn with work like gear.
 */
export function equipmentLine(equipped: Equipment | undefined, condition?: GearCondition): string {
  const slots = equipmentSlots(equipped, condition)
  const tools = condition?.tools ? ` · ${GOOD_LABELS.tools} (${CONDITION_WORDS[condition.tools]})` : ''
  if (slots.every((s) => !s.item)) return `Nothing equipped${tools}`
  const named = (s: SlotView) => (s.condition ? `${s.item} (${s.condition})` : s.item)
  return slots.map((s) => named(s) ?? `no ${s.label.toLowerCase()}`).join(' · ') + tools
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
