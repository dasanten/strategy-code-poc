import { useSyncExternalStore } from 'react'
import { copyItems, type PlanItem } from './plan-blocks.js'

/**
 * The planner clipboard (`CONTEXT.md`: Planner clipboard): steps picked in a queue planner (tap;
 * Shift for a range) and copied, to paste after the picked step in the same planner, another
 * resident's or a group's. It lives in this module while the page is open, so it survives
 * switching cards and is lost on a reload: nothing goes to localStorage, and the server never
 * sees it.
 */

/**
 * What the clipboard holds: steps (each its order, places included, and duration) and repeat
 * blocks of them (`CONTEXT.md`: Repeat block), with no ids.
 */
export type ClipItem = PlanItem

let held: readonly ClipItem[] = []
const listeners = new Set<() => void>()

/** Puts copies of these steps and blocks on the clipboard, in place of whatever was there. */
export function copy(items: readonly PlanItem[]): void {
  held = copyItems(items, false)
  for (const notify of listeners) notify()
}

/**
 * Fresh copies of the clipboard's steps and blocks, without ids: the planner they go into gives
 * them new ones (`withIds`). The clipboard keeps them, so they can be pasted again.
 */
export function paste(): PlanItem[] {
  return copyItems(held, false)
}

export function isEmpty(): boolean {
  return held.length === 0
}

/** Empties the clipboard, as a reload does. */
export function clear(): void {
  held = []
  for (const notify of listeners) notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether the clipboard is empty, re-rendering when that changes. */
export function useClipboardEmpty(): boolean {
  return useSyncExternalStore(subscribe, isEmpty, isEmpty)
}

/**
 * The steps picked after a tap on step `id`, with the planner's steps `ids` in order: a tap picks
 * that step alone; a tap on the one step picked unpicks it; a tap with Shift (`range`) picks the
 * range from the picked steps to it, all of them in between included. The result is in the
 * planner's order.
 */
export function pickStep(
  picked: readonly number[],
  ids: readonly number[],
  id: number,
  range: boolean,
): number[] {
  const at = ids.indexOf(id)
  if (at < 0) return [...picked]
  const indexes = picked.map((p) => ids.indexOf(p)).filter((i) => i >= 0)
  if (!range || indexes.length === 0) {
    return picked.length === 1 && picked[0] === id ? [] : [id]
  }
  const from = Math.min(at, ...indexes)
  const to = Math.max(at, ...indexes)
  return ids.slice(from, to + 1)
}
