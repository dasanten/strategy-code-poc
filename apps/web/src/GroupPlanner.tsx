import type { ReactNode } from 'react'
import { queueStepsProblem, type Building, type ScriptSummary } from '@csp/shared'
import { PasteSteps, QueueBlock, SavedQueueTools } from './Residents.js'
import { editPlan, EMPTY_PLAN, type QueuePlan } from './queue-view.js'

/**
 * The queue planner on the group card (`CONTEXT.md`: Group, Planning for a group). With no plan
 * open, Add step adds the step to each member's own queue. A plan open is a queue held in this
 * browser, edited as a resident's queue is (Add step, reorder, durations, loop); Give to all makes
 * each member's queue a copy of it. Their queues stay their own afterwards.
 */
export function GroupPlanner({
  plan,
  onPlan,
  onGive,
  addStep,
  scripts,
  buildings,
  lastSeen,
  realm,
}: {
  /** The plan open, if one is. */
  plan: QueuePlan | undefined
  /** Opens, edits or closes (undefined) the plan. */
  onPlan: (plan: QueuePlan | undefined) => void
  /** Gives each member a copy of the plan as their queue. */
  onGive: () => void
  /** The queue planner's Add step (`AddStep`): onto the plan when one is open. */
  addStep: ReactNode
  scripts: ScriptSummary[]
  buildings: Building[]
  /** The buildings remembered out of sight, to name steps and flag those whose place is gone. */
  lastSeen: Building[]
  /** The Player's realm, whose saved queues Save and Load keep (`CONTEXT.md`: Saved queue). */
  realm: string
}) {
  if (!plan)
    return (
      <>
        <p className="muted small">
          Each of them has a queue of their own, edited on their card. Add step adds a step to the
          end of each one’s queue; plan a queue to give them all the same one.
        </p>
        <div className="order-buttons">
          <button type="button" onClick={() => onPlan(EMPTY_PLAN)}>
            Plan a queue for all
          </button>
        </div>
        {addStep}
      </>
    )
  const problem = plan.steps.length === 0 ? 'no steps yet' : queueStepsProblem(plan.steps)
  return (
    <>
      {plan.steps.length > 0 ? (
        <QueueBlock
          title="Plan"
          queue={plan}
          scripts={scripts}
          buildings={buildings}
          lastSeen={lastSeen}
          onEdit={(steps, loop) => onPlan(editPlan(plan, steps, loop))}
          realm={realm}
        />
      ) : (
        <>
          <p className="muted small">
            Nothing planned yet. Plan steps with Add step, paste copied ones or load a saved queue.
          </p>
          <PasteSteps onPaste={(steps) => onPlan(editPlan(plan, steps))} />
          <SavedQueueTools
            realm={realm}
            steps={[]}
            onLoad={(steps) => onPlan(editPlan(plan, steps))}
          />
        </>
      )}
      {addStep}
      <div className="order-buttons">
        <button type="button" className="primary" disabled={problem !== undefined} onClick={onGive}>
          Give to all
        </button>
        <button type="button" onClick={() => onPlan(undefined)}>
          Discard plan
        </button>
      </div>
      <p className="muted small">
        {problem && plan.steps.length > 0
          ? `Can’t give it yet: ${problem}.`
          : 'Give to all makes each one’s queue a copy of the plan, ending what they do. One who can’t do a step skips it when its turn comes.'}
      </p>
    </>
  )
}
