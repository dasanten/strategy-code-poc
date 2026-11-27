import { idsOf, inner, isBlock, type PlanItem } from './plan-blocks.js'

/** The ids in `after` that `before` didn't have, the outermost of each new item only. */
export function newIds(before: readonly PlanItem[], after: readonly PlanItem[]): number[] {
  const had = new Set(idsOf(before))
  const fresh = (items: readonly PlanItem[]): number[] =>
    items.flatMap((item) => {
      if (item.id !== undefined && !had.has(item.id)) return [item.id]
      return isBlock(item) ? fresh(inner(item)) : []
    })
  return fresh(after)
}

/**
 * The duration typed into a step's duration field, in whole game minutes (`CONTEXT.md`: Planner
 * blocks): none when it is empty or not above zero.
 */
export function typedMinutes(text: string): number | undefined {
  const typed = Math.floor(Number(text))
  return text.trim() === '' || !(typed > 0) ? undefined : typed
}
