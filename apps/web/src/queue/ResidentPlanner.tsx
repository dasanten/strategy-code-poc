import type { ReactNode } from 'react'
import type { Building, City, Queue, ScriptSummary, Waypoint } from '@csp/shared-types'
import type { PlanItem } from './plan-blocks.js'
import { branchesOf, editPlan, planOf, roundsOf, type QueuePlan } from './queue-view.js'
import { QueueBlock } from './QueueBlock.js'
import { GivePlan, PasteSteps } from './PlanFoot.js'
import { SavedQueueTools } from './SavedQueueTools.js'

/**
 * The queue planner on a resident's card, its Queue tab (`CONTEXT.md`: Queue, Queue draft): the
 * draft waiting for Start queue when one is open, else their running queue, edited step by step,
 * else an empty planner to plan, paste or load steps into. Add step (`addStep`) sits beside it.
 */
export function ResidentPlanner({
  queue,
  doing,
  queuePlan,
  onPlanQueue,
  onGivePlan,
  onEditQueue,
  onDraftQueue,
  addStep,
  scripts,
  buildings,
  lastSeen,
  waypoints,
  cities,
  realm,
}: {
  /** The resident's running queue, if they have one. */
  queue: Queue | undefined
  /** The resident's Doing line, under the current step. */
  doing: string
  /** The resident's queue draft waiting for Start queue, if one is open. */
  queuePlan?: QueuePlan
  /** Edits or discards (undefined) that draft. */
  onPlanQueue?: (plan: QueuePlan | undefined) => void
  /** Start queue: gives the resident the draft, its repeat blocks as they are, as their queue. */
  onGivePlan?: () => void
  /** Edits the running queue, or with none gives the steps as one (`ResidentCard`'s `onEditQueue`). */
  onEditQueue?: (items: PlanItem[], loop?: boolean) => void
  /** Edit as draft: copies the running queue into a draft; the queue runs on. */
  onDraftQueue?: () => void
  /** The queue planner's Add step (`AddStep`), beside the steps. */
  addStep?: ReactNode
  scripts: ScriptSummary[]
  buildings: Building[]
  /** The buildings remembered out of sight, to name queue steps acting there. */
  lastSeen?: Building[]
  /** The Player's waypoints, to name steps at one (`CONTEXT.md`: Waypoint). */
  waypoints?: readonly Waypoint[]
  /** The cities the Player knows, to name where a Relocate step goes. */
  cities: readonly Pick<City, 'id' | 'name'>[]
  /** The Player's realm, whose saved queues Save and Load keep (`CONTEXT.md`: Saved queue). */
  realm: string
}) {
  const names = { scripts, buildings, lastSeen, waypoints, cities }
  if (queuePlan && onPlanQueue)
    return (
      <QueueBlock
        title="Draft"
        mark={
          <>
            <span className="chip y">Draft, not started</span>
            {queue && <span className="small muted">the queue runs on until you start it.</span>}
          </>
        }
        queue={queuePlan}
        currentId={queue?.current}
        doing={doing}
        {...names}
        onEdit={(items, loop) => onPlanQueue(editPlan(queuePlan, items, loop))}
        realm={realm}
        palette={addStep}
        foot={
          <GivePlan
            plan={queuePlan}
            give="Start queue"
            discard="Discard draft"
            note="Start queue makes their queue this draft, repeat blocks and all; the step they are on keeps going if it is still in it."
            onGive={() => onGivePlan?.()}
            onDiscard={() => onPlanQueue(undefined)}
          />
        }
      />
    )
  if (queue && onEditQueue)
    return (
      <QueueBlock
        title={queue.name ?? 'Queue'}
        queue={planOf(queue)}
        currentId={queue.current}
        rounds={roundsOf(queue)}
        branches={branchesOf(queue)}
        running
        doing={doing}
        {...names}
        onEdit={onEditQueue}
        realm={realm}
        palette={addStep}
        foot={
          onDraftQueue && (
            <div className="queue-foot">
              <span className="grow" />
              <button type="button" className="btn sm" onClick={onDraftQueue}>
                Edit as draft
              </button>
            </div>
          )
        }
      />
    )
  return (
    <section className="queue-planner" aria-label="Queue">
      <div className="queue-list">
        <div className="queue-tools">
          <span className="px t16">Queue</span>
          <span className="grow" />
          {onEditQueue && <PasteSteps onPaste={(steps) => onEditQueue(steps)} />}
          {onEditQueue && (
            <SavedQueueTools realm={realm} steps={[]} onLoad={(steps) => onEditQueue(steps)} />
          )}
        </div>
        <p className="muted small">
          Nothing queued. Plan steps with Add step, paste copied ones or load a saved queue: they
          wait as a draft until you press Start queue. Hold Shift with any order to queue it at
          once.
        </p>
      </div>
      {addStep && <div className="queue-palette">{addStep}</div>}
    </section>
  )
}
