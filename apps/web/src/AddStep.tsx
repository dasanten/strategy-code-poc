import { useState } from 'react'
import {
  GOODS,
  HAUL_KEEP_FOOD,
  type BuildingKind,
  type Good,
  type ScriptSummary,
  type SeenHorse,
  type Stock,
} from '@csp/shared'
import { BUILDING_NAMES } from './city-view.js'
import { GOOD_LABELS } from './Residents.js'
import {
  makesAt,
  PLAN_STEPS,
  planAsk,
  type Plan,
  type PlanAnswer,
  type PlanStepId,
} from './plan-step.js'

/**
 * The queue planner's Add step on the resident card (`CONTEXT.md`: Queue, Planning ahead): a list
 * of every kind of step; one acting on a place has the map pick it first (pick mode), and one
 * that needs more (goods, what to build, a script, …) asks for it here after.
 */
export function AddStep({
  plan,
  onStart,
  onAnswer,
  onCancel,
  scripts,
  buildKinds,
  horses,
}: {
  /** The step being planned, if one is. */
  plan: Plan | undefined
  /** Starts planning a step of this kind. */
  onStart: (kind: PlanStepId) => void
  /** Adds the step planned with what its ask answered. */
  onAnswer: (answer: PlanAnswer) => void
  onCancel: () => void
  /** The Player's scripts, for Run script. */
  scripts: readonly ScriptSummary[]
  /** What can be built on the tile picked for Build. */
  buildKinds: readonly BuildingKind[]
  /** The realm's horses in the stable picked for Breed horses. */
  horses: readonly SeenHorse[]
}) {
  const [open, setOpen] = useState(false)
  const ask = plan && planAsk(plan)
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
          <div className="order-buttons">
            {buildKinds.map((building) => (
              <button type="button" key={building} onClick={() => onAnswer({ ask, building })}>
                {BUILDING_NAMES[building]}
              </button>
            ))}
          </div>
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
          <HorsesAsk horses={horses} onAnswer={(horseIds) => onAnswer({ ask, horseIds })} />
        )}
        {ask === 'haul' && <HaulAsk onAnswer={(setup) => onAnswer({ ask, setup })} />}
        {ask === 'script' &&
          (scripts.length === 0 ? (
            <p className="muted small">No scripts yet. Write one in the library.</p>
          ) : (
            <div className="order-buttons">
              {scripts.map((s) => (
                <button type="button" key={s.id} onClick={() => onAnswer({ ask, scriptId: s.id })}>
                  {s.name}
                </button>
              ))}
            </div>
          ))}
      </section>
    )
  }
  return (
    <section className="inspector-block" aria-label="Add step">
      <div className="order-buttons">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          Add step
        </button>
      </div>
      {open && (
        <>
          <div className="chips">
            {PLAN_STEPS.map((k) => (
              <button type="button" className="chip" key={k.id} onClick={() => onStart(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            A step that acts on a place is picked on the map, with a walk there put before it.
            Whether it can be done is checked when its turn comes; if it can’t, it is skipped and
            noted in the realm log.
          </p>
        </>
      )}
    </section>
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
  onAnswer,
}: {
  horses: readonly SeenHorse[]
  onAnswer: (horseIds: [string, string]) => void
}) {
  const [ids, setIds] = useState<string[]>([])
  if (horses.length < 2)
    return <p className="muted small">Fewer than two horses of yours are in sight there.</p>
  return (
    <>
      <div className="chips">
        {horses.map((h, i) => (
          <label className="chip" key={h.id}>
            <input
              type="checkbox"
              checked={ids.includes(h.id)}
              disabled={!ids.includes(h.id) && ids.length >= 2}
              onChange={() =>
                setIds((now) =>
                  now.includes(h.id) ? now.filter((x) => x !== h.id) : [...now, h.id],
                )
              }
            />{' '}
            Horse {i + 1}
          </label>
        ))}
      </div>
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
