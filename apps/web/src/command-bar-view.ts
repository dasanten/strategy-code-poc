/**
 * How the Orders tab of the command bar lays out its kinds of order (`CONTEXT.md`: Screen,
 * Resident card; ADR 0044): side by side in columns, so the whole set shows without scrolling.
 */

/** How many lines of buttons a column of the command bar holds, a kind's heading counting as one. */
export const ORDER_LINES = 6

/** A column of the Orders grid: the kinds in it, top to bottom, and whether it is two buttons wide. */
export interface OrderColumn<G> {
  groups: G[]
  /** Two buttons to a row: a kind with more orders than one column holds. */
  wide: boolean
}

/**
 * The Orders grid's columns, the kinds in their order (`rowGroups`). A kind with more orders than
 * a column holds gets a column two buttons wide to itself; smaller kinds stack in one column while
 * they fit, each with its heading. A kind too big even for that still gets its column, and the
 * grid scrolls inside the bar.
 */
export function orderColumns<G extends { actions: readonly unknown[] }>(
  groups: readonly G[],
  lines = ORDER_LINES,
): OrderColumn<G>[] {
  const columns: OrderColumn<G>[] = []
  // Lines used in the last column, while it is a stack of narrow kinds.
  let used = 0
  for (const g of groups) {
    const tall = 1 + g.actions.length
    if (tall > lines) {
      columns.push({ groups: [g], wide: true })
      used = lines
      continue
    }
    const last = columns.at(-1)
    if (last && !last.wide && used + tall <= lines) {
      last.groups.push(g)
      used += tall
      continue
    }
    columns.push({ groups: [g], wide: false })
    used = tall
  }
  return columns
}
