/**
 * The panel an order opens (`OrderPanel` in `CommandBar.tsx`; `CONTEXT.md`: Screen, ADR 0044):
 * its title, width and where it sits above the command bar.
 */

/** How wide an order's panel opens: a short form, the usual, or a long list such as Goods. */
export type PanelSize = 'sm' | 'md' | 'lg'

/** Each size's width in px, as `.opanel-sm`, `.opanel-md` and `.opanel-lg` in card.css set it. */
export const PANEL_WIDTHS: Record<PanelSize, number> = { sm: 340, md: 420, lg: 560 }

/** The orders whose panel is a short form, and those that list a lot side by side. */
const SMALL = new Set(['rename', 'makeLeader', 'board', 'feed', 'equip', 'script', 'pair', 'fetch'])
const LARGE = new Set(['goods', 'build'])

/** How wide the panel of this order (a resident's or a group's action id) opens. */
export function panelSize(order: string): PanelSize {
  return LARGE.has(order) ? 'lg' : SMALL.has(order) ? 'sm' : 'md'
}

/** An order's label as its panel's title: "Feed…" opens the panel "Feed". */
export function panelTitle(label: string): string {
  return label.replace(/\s*(…|\.\.\.)$/, '')
}

/**
 * Where the panel's left edge goes, in px from the command bar's left edge: over the order that
 * opened it (`orderLeft`), kept inside the bar's width (`room`); at the left end without one.
 */
export function panelLeft(orderLeft: number | undefined, width: number, room: number): number {
  if (orderLeft === undefined) return 0
  return Math.max(0, Math.min(Math.round(orderLeft), Math.floor(room - width)))
}
