import { useContext, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { Condition } from '@csp/shared-types'
import { copy, paste, pickStep, useClipboardEmpty } from './planner-clipboard.js'
import { followInsert, InsertPointContext, STEP_KIND_TYPE } from './step-palette-view.js'
import { moveItems } from './queue-brackets-view.js'
import type { Plan, PlanStepId } from './plan-step.js'
import { clearedItems, type QueuePlan } from './queue-view.js'
import {
  canMove,
  dropItem,
  insertItems,
  lastPicked,
  moveItem,
  planRows,
  setCondition,
  setRepeat,
  topPicked,
  withIds,
  wrap,
  type PlanItem,
} from './plan-blocks.js'
import { newIds } from './planner-view.js'

/**
 * The queue planner's state (`QueueBlock`) and what changes it: the steps and blocks picked for
 * the clipboard (`CONTEXT.md`: Planner clipboard), the one being dragged, the insert point (kept
 * by the card's `InsertPointContext` where there is one), and its help. Every change to the steps
 * goes out through `onEdit`, with every step and block given an id (`withIds`); the planner holds
 * no steps of its own.
 */
export function useQueuePlanner({
  queue: q,
  currentId,
  running,
  onEdit,
}: {
  queue: Pick<QueuePlan, 'items' | 'loop' | 'nextStepId'>
  /** The id of the step being done, in a running queue. */
  currentId: number | undefined
  /** The resident's running queue: Clear asks and keeps the current step. */
  running: boolean
  onEdit: (items: PlanItem[], loop?: boolean) => void
}) {
  const [dragged, setDragged] = useState<number>()
  // The planner's help, behind its "?".
  const [help, setHelp] = useState(false)
  // The steps and blocks picked for the clipboard, by id; one removed since drops out.
  const [pickedIds, setPicked] = useState<number[]>([])
  const clipboardEmpty = useClipboardEmpty()
  const rows = planRows(q.items)
  const ids = rows.map((row) => row.id)
  const picked = pickedIds.filter((id) => ids.includes(id))
  // The insert point: the row the next step added goes after ("+" between two steps).
  const kept = useContext(InsertPointContext)
  const [ownAt, setOwnAt] = useState<number>()
  const insertAt = kept ? kept.at : ownAt
  const setInsertAt = kept ? kept.set : setOwnAt
  const seenIds = useRef(ids)
  useEffect(() => {
    // Once a step goes in there, the next follows it.
    const next = followInsert(seenIds.current, ids, insertAt)
    if (next !== insertAt) setInsertAt(next)
    seenIds.current = ids
  }, [ids.join(',')])
  const edit = (items: PlanItem[], loop?: boolean) => {
    const given = withIds(items, q.nextStepId)
    onEdit(given.items, loop)
    return given
  }
  // The added items go after `after` (or at the end) and are picked, so a second Paste follows.
  const add = (after: number | undefined, added: PlanItem[]) => {
    if (added.length === 0) return
    const given = edit(insertItems(q.items, after, added))
    setPicked(newIds(q.items, given.items))
  }
  const copyPicked = () => {
    if (picked.length > 0) copy(topPicked(q.items, picked))
  }
  const pasteSteps = () => add(lastPicked(q.items, picked), paste())
  const wrapped = picked.length > 0 ? wrap(q.items, picked) : undefined
  const repeat = () => {
    if (!wrapped) return
    const given = edit(wrapped)
    setPicked(newIds(q.items, given.items))
  }
  // An If planned with Flow's If or a block's Change, its condition set (`CONTEXT.md`: If block):
  // the steps picked when it was started are wrapped, or the block's condition changes.
  const ifDone = (plan: Plan, condition: Condition) => {
    // A repeat block's Until (`CONTEXT.md`: Repeat block): it repeats until the condition holds.
    if (plan.until && plan.blockId !== undefined) {
      edit(setRepeat(q.items, plan.blockId, { until: condition }))
      return
    }
    if (plan.blockId !== undefined) {
      edit(setCondition(q.items, plan.blockId, condition))
      return
    }
    const into = wrap(q.items, plan.wrap ?? [], condition)
    if (!into) return
    const given = edit(into)
    setPicked(newIds(q.items, given.items))
  }
  // Clear (`CONTEXT.md`: Clear): empties a draft or a group's plan; on a running queue, asked
  // once, keeps only the current step with loop off, so the queue ends after it.
  const clear = () => {
    if (!running) {
      edit([])
      return
    }
    const ok = window.confirm(
      'Clear the queue? They finish the step they are on, then the queue ends. Stop halts them at once.',
    )
    if (ok) edit(clearedItems(q.items, currentId), false)
  }
  // Ctrl+C and Ctrl+V while the list has focus, not while typing in a field.
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const tag = (e.target as HTMLElement).tagName
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
    const key = e.key.toLowerCase()
    if (key !== 'c' && key !== 'v') return
    e.preventDefault()
    if (key === 'c') copyPicked()
    else pasteSteps()
  }
  // Alt+↑ and Alt+↓ move the focused step or block (drag does too).
  const onRowKey = (e: KeyboardEvent, id: number) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    const by = e.key === 'ArrowUp' ? -1 : 1
    e.preventDefault()
    e.stopPropagation()
    if (canMove(q.items, id, by)) edit(moveItem(q.items, id, by))
  }
  // What a row does when something is dropped on it or on a point: a step or block dragged in
  // the planner moves there; a step kind dragged from the palette is planned there.
  const dropAt = (e: DragEvent, after: number | undefined, onto?: number) => {
    e.preventDefault()
    e.stopPropagation()
    const kind = e.dataTransfer.getData(STEP_KIND_TYPE)
    if (kind && kept?.start) kept.start(kind as PlanStepId, after)
    else if (dragged !== undefined && onto !== undefined && dragged !== onto)
      edit(dropItem(q.items, dragged, onto))
    else if (dragged !== undefined && onto === undefined) edit(moveItems(q.items, [dragged], after))
    setDragged(undefined)
  }
  const accepts = (e: DragEvent) => {
    if (dragged !== undefined || e.dataTransfer.types.includes(STEP_KIND_TYPE)) e.preventDefault()
  }
  // A "+" tapped: with steps picked they move there; without, the next step goes there, or at
  // the end again when it was already set there.
  const pointTapped = (after: number | undefined) => {
    if (picked.length > 0) {
      edit(moveItems(q.items, picked, after))
      setPicked([])
    } else if (after !== undefined) setInsertAt(insertAt === after ? undefined : after)
  }
  // A row tapped: it is picked (Shift: a range).
  const rowTapped = (id: number, shift: boolean) => setPicked(pickStep(picked, ids, id, shift))
  return {
    rows,
    picked,
    dragged,
    setDragged,
    help,
    setHelp,
    clipboardEmpty,
    insertAt,
    /** Starts planning a step or an If's condition on the card (`InsertPointContext`), if it can. */
    start: kept?.start,
    edit,
    add,
    copyPicked,
    pasteSteps,
    wrapped,
    repeat,
    ifDone,
    clear,
    onKey,
    onRowKey,
    dropAt,
    accepts,
    pointTapped,
    rowTapped,
  }
}
