import { paste, useClipboardEmpty } from './planner-clipboard.js'
import { planProblem, type PlanItem } from './plan-blocks.js'
import type { QueuePlan } from './queue-view.js'

/**
 * Paste for a planner with no steps yet (`CONTEXT.md`: Planner clipboard): the button, shown only
 * while the clipboard holds steps; `onPaste` gets fresh copies of them.
 */
export function PasteSteps({ onPaste }: { onPaste: (steps: PlanItem[]) => void }) {
  const empty = useClipboardEmpty()
  if (empty) return null
  return (
    <div className="order-buttons">
      <button type="button" className="btn sm" onClick={() => onPaste(paste())}>
        Paste
      </button>
    </div>
  )
}

/**
 * Give and Discard under a plan held in this browser (`QueuePlan`): Start queue and Discard draft
 * under a resident's queue draft, Give to all on the group card. A plan that can't be given (no steps, more steps after
 * repeats than a queue holds, a step that never ends before another) says why, by how much when
 * it is too long, and Give waits.
 */
export function GivePlan({
  plan,
  give,
  discard = 'Discard plan',
  note,
  onGive,
  onDiscard,
}: {
  plan: Pick<QueuePlan, 'items'>
  /** The Give button's label. */
  give: string
  /** The Discard button's label. */
  discard?: string
  /** What giving does, said while it can be given. */
  note: string
  onGive: () => void
  onDiscard: () => void
}) {
  const problem = planProblem(plan.items)
  return (
    <div className="queue-foot">
      <p className={`small ${problem && plan.items.length > 0 ? 'queue-unrolled-over' : 'muted'}`}>
        {problem && plan.items.length > 0 ? `Can’t give it yet: ${problem}.` : note}
      </p>
      <button type="button" className="btn sm" onClick={onDiscard}>
        {discard}
      </button>
      <button
        type="button"
        className="btn sm pri"
        disabled={problem !== undefined}
        onClick={onGive}
      >
        {give}
      </button>
    </div>
  )
}
