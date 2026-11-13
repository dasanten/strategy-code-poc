import {
  find,
  idsOf,
  inner,
  insertItems,
  isBlock,
  partsOf,
  removeItem,
  topPicked,
  type PlanItem,
} from './plan-blocks.js'

/**
 * The planner's brackets (`CONTEXT.md`: Planner blocks): loop is the outermost bracket around the
 * steps, each repeat block a bracket nested in it. Steps and blocks move within and between
 * brackets, by drag or, on a phone, by picking them and tapping where they go.
 */

/**
 * Where the planner's "+" points sit: after every step and block but the last one in the queue.
 * One after a block's last step is inside the block, at its end; one after the block is after it.
 */
export function insertPoints(items: readonly PlanItem[]): number[] {
  const after = (list: readonly PlanItem[]): number[] =>
    list.flatMap((item) => [...(isBlock(item) ? partsOf(item).flatMap(after) : []), item.id!])
  return after(items).filter((id) => id !== items.at(-1)?.id)
}

/**
 * Whether the picked steps and blocks (`ids`) can go after `after`: not after one of themselves
 * or into a block being moved. `after` undefined is the end of the queue.
 */
export function canMoveTo(
  items: readonly PlanItem[],
  ids: readonly number[],
  after: number | undefined,
): boolean {
  const moved = topPicked(items, ids)
  if (moved.length === 0) return false
  if (after === undefined) return true
  return !moved.some((m) => m.id === after || (isBlock(m) && idsOf(inner(m)).includes(after)))
}

/**
 * The items with the picked steps and blocks (each block as one, with its steps) taken out and
 * put after `after`, in the order they were listed: into a block when `after` is one of its
 * steps, out of it when `after` is outside; at the end when `after` is undefined.
 */
export function moveItems(
  items: readonly PlanItem[],
  ids: readonly number[],
  after: number | undefined,
): PlanItem[] {
  if (!canMoveTo(items, ids, after)) return [...items]
  const moved = topPicked(items, ids)
  const rest = moved.reduce((left, m) => removeItem(left, m.id!), [...items])
  if (after !== undefined && !find(rest, after)) return [...items]
  return insertItems(rest, after, moved)
}
