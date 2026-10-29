/**
 * Bottom sheets on a phone (ADR 0012): every card sits at the bottom of the screen at one of three
 * heights, changed by dragging its handle.
 */

/** Just the card's header, half the screen, or all of it below the top bar. */
export type SheetHeight = 'peek' | 'half' | 'full'

/** A sheet opens at half: the header and the open tab, with the map still in view above. */
export const SHEET_OPENS_AT: SheetHeight = 'half'

/** Where the sheet's height settles between peek and half, and half and full, as screen shares. */
const SNAP = { peekHalf: 0.3, halfFull: 0.72 } as const

/** The screen narrower than a tablet, or one that is mainly touched: cards are bottom sheets. */
export const PHONE_QUERY = '(max-width: 640px), (pointer: coarse)'

/** The height a sheet settles at when the handle is let go at `height` pixels of `screen`. */
export function snapSheet(height: number, screen: number): SheetHeight {
  const share = screen > 0 ? height / screen : 0
  if (share < SNAP.peekHalf) return 'peek'
  if (share < SNAP.halfFull) return 'half'
  return 'full'
}

/** A tap on the handle (or Enter on it) goes one height up, and from full back down to peek. */
export function nextSheet(height: SheetHeight): SheetHeight {
  return height === 'peek' ? 'half' : height === 'half' ? 'full' : 'peek'
}

/** An arrow key on the handle: one height up or down, staying within peek and full. */
export function stepSheet(height: SheetHeight, up: boolean): SheetHeight {
  const order: SheetHeight[] = ['peek', 'half', 'full']
  const i = order.indexOf(height) + (up ? 1 : -1)
  return order[Math.max(0, Math.min(order.length - 1, i))]!
}
