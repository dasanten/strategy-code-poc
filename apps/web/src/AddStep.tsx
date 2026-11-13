import { Fragment, useContext, useState } from 'react'
import { FEED_UNITS, HAUL_KEEP_FOOD } from '@csp/balance'
import { GOODS } from './shared/world.js'
import type {
  BuildingKind,
  Good,
  ResourceNode,
  ScriptSummary,
  SeenHorse,
  Stock,
} from '@csp/shared-types'
import { BuildMenu } from './BuildMenu.js'
import { CustomiseButton, taskStart } from './Customise.js'
import { HorsePick } from './HorsePick.js'
import { GOOD_LABELS, SubjectPicker } from './Residents.js'
import {
  makesAt,
  nextPick,
  PLAN_STEPS,
  PLAN_TASKS,
  planAsk,
  type Plan,
  type PlanAnswer,
  type PlanCity,
  type PlanStepId,
} from './plan-step.js'
import {
  PALETTE_GROUPS,
  PLAN_STEP_ICONS,
  PlannerFlowContext,
  REPEAT_ICON,
} from './step-palette-view.js'

/**
 * The queue planner's Add step on the resident card (`CONTEXT.md`: Queue, Planning ahead, Planner
 * blocks): a palette of every kind of step grouped as the Orders tab is, plus Flow (Repeat); one
 * acting on a place has the map pick it first (pick mode), and one
 * that needs more (goods, what to build, a script, …) asks for it here after. A city (Relocate)
 * can be picked on the map or from the list here.
 */
export function AddStep({
  plan,
  onStart,
  onAnswer,
  onCancel,
  scripts,
  buildTile,
  horses,
  tick,
  cities,
  onPickCity,
  open,
  onOpen,
}: {
  /** The step being planned, if one is. */
  plan: Plan | undefined
  /** Starts planning a step of this kind, to go after `after` (the planner's insert point). */
  onStart: (kind: PlanStepId, after?: number) => void
  /** Adds the step planned with what its ask answered. */
  onAnswer: (answer: PlanAnswer) => void
  onCancel: () => void
  /** The Player's scripts, for Run script. */
  scripts: readonly ScriptSummary[]
  /** The tile picked for Build, as the Build menu needs it. */
  buildTile: {
    node: Pick<ResourceNode, 'kind'> | undefined
    terrain: number | undefined
    problem: (kind: BuildingKind) => string | undefined
  }
  /** The realm's horses in the stable picked for Breed horses, or on the carriage's tile for Hitch. */
  horses: readonly SeenHorse[]
  /** The current tick, for those horses' ages. */
  tick: number
  /** The realm's cities, for a step that picks one (Relocate). */
  cities: readonly PlanCity[]
  /** Picks a city from the list, as a tap in its area on the map would. */
  onPickCity: (cityId: string) => void
  /** Whether the palette is open: kept by the card, so it stays open as the queue appears. */
  open: boolean
  onOpen: (open: boolean) => void
}) {
  // Repeat and the insert point of the planner this palette sits under, if it is in one.
  const flow = useContext(PlannerFlowContext)
  const ask = plan && planAsk(plan)
  if (plan && nextPick(plan)?.pick === 'city') {
    const label = PLAN_STEPS.find((k) => k.id === plan.kind)!.label
    return (
      <section className="inspector-block" aria-label="Add step">
        <div className="panel-head">
          <h3>Add step: {label}</h3>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {cities.length === 0 ? (
          <p className="muted small">Your realm has no city in sight to pick.</p>
        ) : (
          <>
            <p className="muted small">
              Tap one of your cities on the map, or pick it here. Free housing is checked when the
              step’s turn comes.
            </p>
            <div className="order-buttons">
              {cities.map((c) => (
                <button type="button" key={c.id} onClick={() => onPickCity(c.id)}>
                  {c.name} ({c.room} free)
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    )
  }
  if (plan && ask) {
    const label = PLAN_STEPS.find((k) => k.id === plan.kind)!.label
    return (
      <section className="inspector-block" aria-label="Add step">
        <div className="panel-head">
          <h3>Add step: {label}</h3>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {ask === 'goods' && <GoodsAsk onAnswer={(goods) => onAnswer({ ask, goods })} />}
        {ask === 'buildingKind' && (
          <BuildMenu
            node={buildTile.node}
            terrain={buildTile.terrain}
            buildProblem={buildTile.problem}
            planning
            onBuild={(building) => onAnswer({ ask, building })}
          />
        )}
        {ask === 'makes' && (
          <div className="order-buttons">
            {makesAt(plan.picked[0]!).map((makes) => (
              <button type="button" key={makes} onClick={() => onAnswer({ ask, makes })}>
                Make {GOOD_LABELS[makes].toLowerCase()}
              </button>
            ))}
          </div>
        )}
        {ask === 'horses' && (
          <HorsesAsk
            horses={horses}
            tick={tick}
            onAnswer={(horseIds) => onAnswer({ ask, horseIds })}
          />
        )}
        {ask === 'horse' && (
          <HorseAsk
            horses={horses}
            tick={tick}
            onAnswer={(horseId) => onAnswer({ ask, horseId })}
          />
        )}
        {ask === 'haul' && <HaulAsk onAnswer={(setup) => onAnswer({ ask, setup })} />}
        {ask === 'units' && <UnitsAsk onAnswer={(units) => onAnswer({ ask, units })} />}
        {ask === 'subject' && (
          <SubjectPicker action="Add" onPick={(subject) => onAnswer({ ask, subject })} />
        )}
        {ask === 'script' &&
          (scripts.length === 0 ? (
            <p className="muted small">No scripts yet. Write one in the library.</p>
          ) : (
            <div className="order-buttons">
              {scripts.map((s) => (
                <Fragment key={s.id}>
                  <button type="button" onClick={() => onAnswer({ ask, scriptId: s.id })}>
                    {s.name}
                  </button>
                  <CustomiseButton
                    order={{ kind: 'runScript', scriptId: s.id }}
                    of={s.name}
                    give={() => onAnswer({ ask, scriptId: s.id })}
                  />
                </Fragment>
              ))}
            </div>
          ))}
      </section>
    )
  }
  return (
    <section className="inspector-block" aria-label="Add step">
      <div className="order-buttons">
        <button type="button" aria-expanded={open} onClick={() => onOpen(!open)}>
          Add step
        </button>
        {flow?.after !== undefined && (
          <span className="small muted">New steps go where the + is set.</span>
        )}
      </div>
      {open && (
        <div className="step-palette">
          {PALETTE_GROUPS.map((g) => (
            <div className="step-palette-group" key={g.id}>
              <h4 className="small muted">{g.label}</h4>
              <div className="step-palette-items">
                {g.steps.map((id) => {
                  const k = PLAN_STEPS.find((s) => s.id === id)!
                  const task = PLAN_TASKS[id]
                  return (
                    <span className="step-palette-item" key={id}>
                      <button type="button" onClick={() => onStart(id, flow?.after)}>
                        <span aria-hidden="true">{PLAN_STEP_ICONS[id]}</span> {k.label}
                      </button>
                      {task && (
                        <CustomiseButton
                          order={taskStart(task)}
                          of={k.label}
                          give={() => onStart(id, flow?.after)}
                          small
                        />
                      )}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="step-palette-group">
            <h4 className="small muted">Flow</h4>
            <div className="step-palette-items">
              <span className="step-palette-item">
                <button
                  type="button"
                  disabled={!flow?.repeat}
                  title={
                    flow?.repeat
                      ? 'Wrap the picked steps in a repeat block'
                      : 'Pick steps in a row in the planner to repeat them'
                  }
                  onClick={() => flow?.repeat?.()}
                >
                  <span aria-hidden="true">{REPEAT_ICON}</span> Repeat
                </button>
              </span>
            </div>
          </div>
          <p className="muted small">
            A step that acts on a place is picked on the map, with a walk there put before it.
            Whether it can be done is checked when its turn comes; if it can’t, it is skipped and
            noted in the realm log.
          </p>
        </div>
      )}
    </section>
  )
}

/** How many units of Food to Feed with (`CONTEXT.md`: Reviving, Feeding a horse). */
function UnitsAsk({ onAnswer }: { onAnswer: (units: number) => void }) {
  const [units, setUnits] = useState(FEED_UNITS)
  return (
    <div className="order-buttons">
      <input
        type="number"
        min={1}
        step={1}
        value={units}
        aria-label="Units of Food"
        onChange={(e) => setUnits(Number(e.target.value))}
        style={{ width: '5em' }}
      />
      <button
        type="button"
        className="primary"
        disabled={!Number.isInteger(units) || units < 1}
        onClick={() => onAnswer(units)}
      >
        Add
      </button>
    </div>
  )
}

/** Units of each good, for Fetch, Pick up and Put down. */
function GoodsAsk({ onAnswer }: { onAnswer: (goods: Stock) => void }) {
  const [units, setUnits] = useState<Stock>({})
  const picked = Object.values(units).some((n) => (n ?? 0) > 0)
  return (
    <>
      {GOODS.map((g) => (
        <label className="goods-row small" key={g}>
          <span>{GOOD_LABELS[g]}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={units[g] ?? ''}
            placeholder="0"
            onChange={(e) => {
              const n = Math.max(0, Math.floor(Number(e.target.value) || 0))
              setUnits((now) => {
                const next = { ...now }
                if (n > 0) next[g] = n
                else delete next[g]
                return next
              })
            }}
            style={{ width: '5em' }}
          />
        </label>
      ))}
      <div className="order-buttons">
        <button
          type="button"
          className="primary"
          disabled={!picked}
          onClick={() => onAnswer(units)}
        >
          Add
        </button>
      </div>
    </>
  )
}

/** Two of the realm's horses in the stable, to breed. */
function HorsesAsk({
  horses,
  tick,
  onAnswer,
}: {
  horses: readonly SeenHorse[]
  tick: number
  onAnswer: (horseIds: [string, string]) => void
}) {
  const [ids, setIds] = useState<string[]>([])
  if (horses.length < 2)
    return <p className="muted small">Fewer than two horses of yours are in sight there.</p>
  return (
    <>
      {horses.map((h) => (
        <HorsePick
          key={h.id}
          horse={h}
          tick={tick}
          checked={ids.includes(h.id)}
          disabled={!ids.includes(h.id) && ids.length >= 2}
          onToggle={() =>
            setIds((now) => (now.includes(h.id) ? now.filter((x) => x !== h.id) : [...now, h.id]))
          }
        />
      ))}
      <div className="order-buttons">
        <button
          type="button"
          className="primary"
          disabled={ids.length !== 2}
          onClick={() => onAnswer([ids[0]!, ids[1]!])}
        >
          Add
        </button>
      </div>
    </>
  )
}

/** One of the realm's horses on the carriage's tile, to hitch (`CONTEXT.md`: Hitched horse). */
function HorseAsk({
  horses,
  tick,
  onAnswer,
}: {
  horses: readonly SeenHorse[]
  tick: number
  onAnswer: (horseId: string) => void
}) {
  const [id, setId] = useState<string>()
  if (horses.length === 0)
    return <p className="muted small">No horse of yours is in sight on that carriage’s tile.</p>
  return (
    <>
      {horses.map((h) => (
        <HorsePick
          key={h.id}
          horse={h}
          tick={tick}
          checked={id === h.id}
          onToggle={() => setId((now) => (now === h.id ? undefined : h.id))}
        />
      ))}
      <div className="order-buttons">
        <button type="button" className="primary" disabled={!id} onClick={() => onAnswer(id!)}>
          Add
        </button>
      </div>
    </>
  )
}

/** What a haul route carries there and back, and the Food kept for the horse. */
function HaulAsk({
  onAnswer,
}: {
  onAnswer: (setup: { goods: Good[]; returnGoods: Good[]; keepFood: number }) => void
}) {
  const [goods, setGoods] = useState<Good[]>([])
  const [returnGoods, setReturnGoods] = useState<Good[]>([])
  const [keepFood, setKeepFood] = useState(HAUL_KEEP_FOOD)
  // A good goes one way or the other, never both.
  const toggle = (g: Good, back: boolean) => {
    const [set, other] = back ? [setReturnGoods, setGoods] : [setGoods, setReturnGoods]
    set((now) => (now.includes(g) ? now.filter((x) => x !== g) : [...now, g]))
    other((now) => now.filter((x) => x !== g))
  }
  return (
    <>
      {([false, true] as const).map((back) => (
        <div key={String(back)}>
          <span className="small muted">{back ? 'Back from there' : 'To the other stop'}</span>
          <div className="chips">
            {GOODS.map((g) => (
              <label className="chip" key={g}>
                <input
                  type="checkbox"
                  checked={(back ? returnGoods : goods).includes(g)}
                  onChange={() => toggle(g, back)}
                />{' '}
                {GOOD_LABELS[g]}
              </label>
            ))}
          </div>
        </div>
      ))}
      <label className="small">
        Food kept for the horse{' '}
        <input
          type="number"
          min={0}
          step={1}
          value={keepFood}
          onChange={(e) => setKeepFood(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          style={{ width: '4em' }}
        />
      </label>
      <div className="order-buttons">
        <button
          type="button"
          className="primary"
          disabled={goods.length === 0}
          onClick={() => onAnswer({ goods, returnGoods, keepFood })}
        >
          Add
        </button>
      </div>
    </>
  )
}
