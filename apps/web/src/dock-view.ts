/**
 * The dock on the right (ADR 0044; `CONTEXT.md`: Screen): tile cards, the who-list and realm order
 * cards, beside the command bar along the bottom (`Dock`).
 */

/**
 * The command bar of a picked resident or group while a tile card is open. On a desktop the tile
 * card is in the dock and the bar stays (`shows`), so a tile and a resident are open together;
 * on a phone both would be the bottom sheet, so the tile card takes it until it closes, as before.
 * Either way the tile card's keys win: the bar's order keys are off while it is open (`keys`);
 * its buttons still work.
 */
export function barBesideTile(
  phone: boolean,
  tileOpen: boolean,
): { shows: boolean; keys: boolean } {
  return { shows: !phone || !tileOpen, keys: !tileOpen }
}

/**
 * How many pixels of a `width` wide map the dock covers from the right: up to the left edge of
 * its widest card shown, 0 with none (`mapCovered`).
 */
export function dockCovers(cardLefts: readonly number[], width: number): number {
  return cardLefts.length > 0 ? Math.max(0, width - Math.min(...cardLefts)) : 0
}
