/**
 * Telling a tap from a pan and a long-press on the map (`CONTEXT.md`: Picking a target). One
 * finger pans, two pinch, a press that hardly moves is a tap, and one held still long enough is a
 * long-press, which does what right-click does.
 */

/** How far (in screen pixels) a press may wander and still count as a tap or a long-press. */
export const TAP_SLOP = 6

/** How long (in ms) a finger has to rest before the press becomes a long-press. */
export const LONG_PRESS_MS = 500

/** What a press on the map turned out to be. */
export type PressKind = 'tap' | 'long-press' | 'drag'

/** A press so far: how far it wandered, how long it has been held, and the most fingers down. */
export interface Press {
  moved: number
  heldMs: number
  fingers: number
}

/**
 * What a press is, judged when it ends or while it is still held. A second finger makes it a
 * pinch, never a tap; mice right-click instead, so only touch and pen presses become long-presses.
 */
export function pressKind(press: Press, longPresses: boolean): PressKind {
  if (press.fingers > 1 || press.moved >= TAP_SLOP) return 'drag'
  if (longPresses && press.heldMs >= LONG_PRESS_MS) return 'long-press'
  return 'tap'
}

/** Whether a pointer type takes long-presses: touch and pen, not a mouse with a right button. */
export function longPresses(pointerType: string): boolean {
  return pointerType !== 'mouse'
}
