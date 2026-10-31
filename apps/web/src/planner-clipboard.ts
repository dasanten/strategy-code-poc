import { useSyncExternalStore } from 'react'
import type { QueueStepRequest } from '@csp/shared'

/**
 * The planner clipboard (`CONTEXT.md`: Planner clipboard): steps picked in a queue planner (tap;
 * Shift for a range) and copied, to paste after the picked step in the same planner, another
 * resident's or a group's. It lives in this module while the page is open, so it survives
 * switching cards and is lost on a reload: nothing goes to localStorage, and the server never
 * sees it.
 */

/** A step as the clipboard holds it: its order (places included) and duration, with no id. */
export type ClipStep = Pick<QueueStepRequest, 'order' | 'minutes'>

let held: readonly ClipStep[] = []
const listeners = new Set<() => void>()

/** Puts copies of these steps on the clipboard, in place of whatever was there. */
export function copy(steps: readonly QueueStepRequest[]): void {
  held = steps.map(clipStep)
  for (const notify of listeners) notify()
}

/**
 * Fresh copies of the clipboard's steps, without ids: the planner they go into gives them new
 * ones (the server's `nextStepId` for a resident's queue, the plan's own for a group's). The
 * clipboard keeps its steps, so they can be pasted again.
 */
export function paste(): QueueStepRequest[] {
  return held.map(clipStep)
}

export function isEmpty(): boolean {
  return held.length === 0
}

/** Empties the clipboard, as a reload does. */
export function clear(): void {
  held = []
  for (const notify of listeners) notify()
}

/** A copy of the step as the clipboard holds it, sharing nothing with the original. */
function clipStep(s: ClipStep): ClipStep {
  return {
    order: structuredClone(s.order),
    ...(s.minutes === undefined ? {} : { minutes: s.minutes }),
  }
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

/**
 * Where a paste goes: the index of the last picked step, after which the pasted steps are put,
 * or the last step's with none picked, so they go at the end.
 */
export function pastePosition(ids: readonly number[], picked: readonly number[]): number {
  const indexes = picked.map((p) => ids.indexOf(p)).filter((i) => i >= 0)
  return indexes.length === 0 ? ids.length - 1 : Math.max(...indexes)
}

/**
 * The ids the pasted steps get, to pick them afterwards so a second paste goes after them:
 * `count` ids from the planner's `nextStepId` on, as the server (`editQueue`) and a group's plan
 * (`editPlan`) both hand them out, in the order of the steps without one.
 */
export function pastedIds(nextStepId: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => nextStepId + i)
}
