import type { ReactNode } from 'react'
import type { Building, ScriptSummary, Waypoint } from '@csp/shared-types'
import { GivePlan, PasteSteps, QueueBlock, SavedQueueTools } from './Residents.js'
import { editPlan, EMPTY_PLAN, type QueuePlan } from './queue-view.js'

/**
 * The queue planner on the group card (`CONTEXT.md`: Group, Planning for a group). With no plan
 * open, Add step adds the step to each member's own queue. A plan open is a queue held in this
 * browser, edited as a resident's queue is (Add step, reorder, durations, loop, repeat blocks);
 * Give to all makes each member's queue a copy of it, its repeat blocks as they are. Their queues
 * stay their own afterwards.
 */
export function GroupPlanner({
  plan,
  onPlan,
  onGive,
  addStep,
  scripts,
  buildings,
  lastSeen,
  waypoints,
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
  /** The Player's waypoints, to name steps at one. */
  waypoints?: readonly Waypoint[]
  /** The Player's realm, whose saved queues Save and Load keep (`CONTEXT.md`: Saved queue). */
  realm: string
}) {
  const give = (
    <GivePlan
      plan={plan ?? EMPTY_PLAN}
      give="Give to all"
      note="Give to all makes each one’s queue a copy of the plan, ending what they do. One who can’t do a step skips it when its turn comes."
      onGive={onGive}
      onDiscard={() => onPlan(undefined)}
    />
  )
  if (plan && plan.items.length > 0)
    return (
      <QueueBlock
        title="Plan"
        queue={plan}
        scripts={scripts}
        buildings={buildings}
        lastSeen={lastSeen}
        waypoints={waypoints}
        onEdit={(items, loop) => onPlan(editPlan(plan, items, loop))}
        realm={realm}
        palette={addStep}
        foot={give}
      />
    )
  // No plan open, or one with nothing in it yet: the planner's two columns all the same.
  return (
    <section className="queue-planner" aria-label="Plan">
      <div className="queue-list">
        <div className="queue-tools">
          <span className="px t16">Plan</span>
          <span className="grow" />
          {plan ? (
            <>
              <PasteSteps onPaste={(items) => onPlan(editPlan(plan, items))} />
              <SavedQueueTools
                realm={realm}
                steps={[]}
                onLoad={(items) => onPlan(editPlan(plan, items))}
              />
            </>
          ) : (
            <button type="button" className="btn sm" onClick={() => onPlan(EMPTY_PLAN)}>
              Plan a queue for all
            </button>
          )}
        </div>
        <p className="muted small">
          {plan
            ? 'Nothing planned yet. Plan steps with Add step, paste copied ones or load a saved queue.'
            : 'Each of them has a queue of their own, edited on their card. Add step adds a step to the end of each one’s queue; plan a queue to give them all the same one.'}
        </p>
        {plan && give}
      </div>
      <div className="queue-palette">{addStep}</div>
    </section>
  )
}
