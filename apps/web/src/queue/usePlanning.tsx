import { useState } from 'react'
import type {
  Building,
  OrderRequest,
  Resident,
  ScriptSummary,
  StartParamValues,
} from '@csp/shared-types'
import {
  appendRequest,
  appendToEach,
  draftEdit,
  draftFor,
  givePlan,
  giveToAll,
  planOf,
  planStep,
  type QueuePlan,
} from './queue-view.js'
import { AddStep } from './AddStep.js'
import { type InsertPoint } from './step-palette-view.js'
import { type PlanItem } from './plan-blocks.js'
import {
  planHorses,
  nextPick,
  pickCity,
  planAsk,
  planCities,
  planOrder,
  type Plan,
  type PlanAnswer,
  type PlanStepId,
} from './plan-step.js'
import { type Skipped } from '../residents/group-orders.js'
import type { usePick } from '../pick/usePick.js'
import { useWorld } from '../world/useWorld.js'
import { planWorld } from '../world/seen-world.js'
import type { useKnownGround } from '../map/useKnownGround.js'
import type { SeenCity } from '@csp/shared-types'
import type { useStartForm } from '../script/useStartForm.js'

/** What planning a queue needs of the game around it (`usePlanning`). */
export interface PlanningNeeds {
  world: ReturnType<typeof useWorld>['world']
  group: Resident[]
  selected: Resident | undefined
  /** The step being planned with Add step, which the map picks the places of (`usePick`). */
  picker: Pick<ReturnType<typeof usePick>, 'plan'>
  scripts: ScriptSummary[]
  knownCities: SeenCity[]
  knownBuildings: Building[]
  ground: Pick<ReturnType<typeof useKnownGround>, 'nodeAt' | 'terrainAt' | 'buildProblemAt'>
  opensForm: ReturnType<typeof useStartForm>['opensForm']
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
  sendToGroup: (requests: OrderRequest[], skipped: Skipped[]) => Promise<void>
  setOrderError: (error: string | undefined) => void
}

/**
 * Planning queues on the resident and group cards (`CONTEXT.md`: Queue, Planning ahead, Queue
 * draft, Planning for a group): the drafts and the group's plan, the planner's insert point and
 * palette, and what a step planned with Add step goes onto.
 */
export function usePlanning(needs: PlanningNeeds) {
  const { group, selected, picker, scripts, knownCities, knownBuildings, opensForm } = needs
  const { sendOrder, sendToGroup, setOrderError } = needs
  const { nodeAt, terrainAt, buildProblemAt } = needs.ground
  const plan = picker.plan.plan
  // Whether the Add step palette is open; kept here so it stays open as a draft appears.
  const [paletteOpen, setPaletteOpen] = useState(false)
  // The planner's insert point, by whose planner it is (a resident's id, or the group's), kept
  // here so it lasts while the card folds away for a pick (`CONTEXT.md`: Planner blocks).
  const [insertPoint, setInsertPoint] = useState<{ owner: string; at: number | undefined }>()
  const insertFor = (owner: string): InsertPoint => ({
    at: insertPoint?.owner === owner ? insertPoint.at : undefined,
    set: (at) => setInsertPoint({ owner, at }),
    start: (kind, after, extra) => void startPlan(kind, after, extra),
  })
  // The queue planned on the group card, held here until given to all (`CONTEXT.md`: Planning
  // for a group); with none open, a step planned for a group goes onto each one's own queue.
  const [groupPlan, setGroupPlan] = useState<QueuePlan>()
  // Queue drafts waiting for Start queue, by resident (`CONTEXT.md`: Queue draft): they stay
  // while other cards are open, until started or discarded, and are lost on reloading the page.
  const [queuePlans, setQueuePlans] = useState<Record<string, QueuePlan>>({})
  const planQueue = (id: string, plan: QueuePlan | undefined) =>
    setQueuePlans((plans) => {
      const next = { ...plans }
      if (plan) next[id] = plan
      else delete next[id]
      return next
    })
  /**
   * Starts planning a step with Add step (`CONTEXT.md`: Queue, Planning ahead): the map picks its
   * places first; one that needs neither is added at once.
   */
  async function startPlan(kind: PlanStepId, after?: number, extra?: Partial<Plan>) {
    picker.plan.starting()
    const fresh: Plan = { kind, picked: [], ...(after === undefined ? {} : { after }), ...extra }
    if (nextPick(fresh) || planAsk(fresh)) picker.plan.set(fresh)
    else await addPlanned(fresh)
  }
  /**
   * Appends the step planned to the picked resident's queue, or starts one with it, after a walk
   * to where it acts (`appendRequest`). The server checks that it could make sense; whether it can
   * start is checked when its turn comes. For a group it goes onto the plan open on the group card,
   * or, with none open, onto each one's own queue (`CONTEXT.md`: Planning for a group).
   */
  async function addPlanned(planned: Plan, answer?: PlanAnswer) {
    picker.plan.set(undefined)
    const step = planOrder(planned, answer)
    if (!step) return
    const { order, at } = step
    const keptBy = (group.length > 1 ? group : selected ? [selected] : []).map(
      (r) => r.scriptParams,
    )
    // Customise on a step, or a param it can't go without (`CONTEXT.md`: Before it starts).
    // What the step gives itself (Feed the stable once's `once`) stays beside what is picked.
    const given = order.params as StartParamValues | undefined
    const add = (params?: StartParamValues) =>
      addStepOrder(
        { ...order, ...(params && { params: { ...params, ...given } }) },
        at,
        planned.after,
      )
    if (!opensForm(order, keptBy, add)) await add()
  }
  /**
   * Appends a planned step's order to the open plan or queue (`addPlanned`), or puts it after
   * `after`, the planner's insert point (`CONTEXT.md`: Planner blocks).
   */
  async function addStepOrder(
    order: OrderRequest,
    at: { x: number; y: number } | undefined,
    after?: number,
  ) {
    if (group.length > 1) {
      if (groupPlan) setGroupPlan(planStep(groupPlan, order, at, after))
      else await sendToGroup(appendToEach(group, order, at), [])
      return
    }
    if (!selected) return
    // A resident with no queue, or with a draft open, gets the step onto the draft
    // (`CONTEXT.md`: Queue draft); a running queue gets it at once.
    const draft = draftFor(selected, queuePlans[selected.id])
    if (draft) {
      planQueue(selected.id, planStep(draft, order, at, after))
      return
    }
    // Into a running queue between two steps: an edit of it with the step in place.
    if (after !== undefined && selected.queue) {
      const placed = planStep(planOf(selected.queue), order, at, after)
      setOrderError(await sendOrder(givePlan(selected, placed)))
      return
    }
    const request = { ...order, residentId: selected.id }
    setOrderError(await sendOrder(appendRequest(selected, request, at) ?? request))
  }
  /** The queue planner's Add step, on the resident card and the group card. */
  function addStep(w: NonNullable<PlanningNeeds['world']>) {
    const seen = { cities: knownCities, buildings: knownBuildings, residents: w.residents }
    const cities = plan && nextPick(plan)?.pick === 'city' ? planCities(seen, w.home.realmId) : []
    const tile = plan?.kind === 'build' ? plan.picked[0] : undefined
    return (
      <AddStep
        plan={plan}
        onStart={(kind, after) => void startPlan(kind, after)}
        open={paletteOpen}
        onOpen={setPaletteOpen}
        onPlan={picker.plan.set}
        conditionNames={{
          buildings: w.buildings,
          lastSeen: w.lastSeen.buildings,
          cities: knownCities,
        }}
        onAnswer={(answer) => plan && void addPlanned(plan, answer)}
        onCancel={() => picker.plan.set(undefined)}
        scripts={scripts}
        buildTile={{
          node: tile && nodeAt?.(tile.x, tile.y),
          terrain: tile && terrainAt?.(tile.x, tile.y),
          problem: tile ? buildProblemAt(w, tile.x, tile.y) : () => undefined,
        }}
        horses={planHorses(planWorld(w), w.horses, plan)}
        tick={w.tick}
        cities={cities}
        onPickCity={(cityId) => {
          const city = cities.find((c) => c.id === cityId)
          if (plan && city) void addPlanned(pickCity(plan, city))
        }}
      />
    )
  }
  /** Give to all: each one's queue becomes a copy of the plan; then the plan closes. */
  async function giveGroupPlan() {
    if (!groupPlan) return
    setGroupPlan(undefined)
    await sendToGroup(giveToAll(groupPlan, group), [])
  }
  /**
   * The resident card's queue: their draft, and what its planner's edits do. A paste or load for
   * a resident with no queue, or steps wrapped in a repeat block, opens a draft (`CONTEXT.md`:
   * Queue draft); other edits change the running queue.
   */
  const queueOf = (r: Resident) => ({
    queuePlan: queuePlans[r.id],
    onPlanQueue: (plan: QueuePlan | undefined) => planQueue(r.id, plan),
    onGivePlan: async () => {
      const plan = queuePlans[r.id]
      if (!plan) return
      planQueue(r.id, undefined)
      setOrderError(await sendOrder(givePlan(r, plan)))
    },
    onEditQueue: async (items: PlanItem[], loop?: boolean) => {
      const draft = draftEdit(r, items, loop)
      if (draft) return planQueue(r.id, draft)
      setOrderError(await sendOrder(givePlan(r, { items, loop })))
    },
    onDraftQueue: () => r.queue && planQueue(r.id, planOf(r.queue)),
  })
  return {
    insertFor,
    groupPlan,
    setGroupPlan,
    addPlanned,
    addStep,
    giveGroupPlan,
    queueOf,
  }
}
