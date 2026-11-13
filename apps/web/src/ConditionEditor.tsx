import { useState } from 'react'
import type { Condition } from '@csp/shared-types'
import { GOODS } from './shared/world.js'
import { CONDITION_KINDS, LAST_HOUR, conditionProblem } from './shared/condition.js'
import { GOOD_LABELS } from './goods-grid.js'
import {
  CONDITION_KIND_LABELS,
  NEW_DRAFT,
  conditionLabel,
  conditionOf,
  placeName,
  type ConditionDraft,
  type ConditionNames,
} from './condition-view.js'

/**
 * The condition editor (`CONTEXT.md`: Condition, Planner blocks): the kind first, then its
 * fields; the place a stock condition asks about is picked on the map, which folds the card away
 * and opens it here again with the draft kept.
 */
export function ConditionEditor({
  draft: initial,
  names,
  action,
  lead = 'Wait until',
  onPickPlace,
  onDone,
}: {
  /** The draft kept while the map picked a place, if it did. */
  draft: ConditionDraft | undefined
  names: ConditionNames
  /** The button's word: "Add". */
  action: string
  /** What the condition is read after: "Wait until", "If". */
  lead?: string
  /** Has the map pick the place to ask about, the draft kept. */
  onPickPlace: (draft: ConditionDraft) => void
  onDone: (condition: Condition) => void
}) {
  const [d, setD] = useState<ConditionDraft>(initial ?? NEW_DRAFT)
  const set = (patch: Partial<ConditionDraft>) => setD({ ...d, ...patch })
  const condition = conditionOf(d)
  const problem = condition ? conditionProblem(condition) : undefined
  const number = (label: string, value: number, onChange: (n: number) => void, max?: number) => (
    <input
      type="number"
      min={0}
      max={max}
      step={1}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: '5em' }}
    />
  )
  const goodPick = (
    <select
      aria-label="Good"
      value={d.good}
      onChange={(e) => set({ good: e.target.value as never })}
    >
      {GOODS.map((g) => (
        <option key={g} value={g}>
          {GOOD_LABELS[g]}
        </option>
      ))}
    </select>
  )
  const comparePick = (
    <select
      aria-label="At least or less than"
      value={d.compare}
      onChange={(e) => set({ compare: e.target.value as ConditionDraft['compare'] })}
    >
      <option value="atLeast">at least</option>
      <option value="lessThan">less than</option>
    </select>
  )
  const whoPick = (
    <select
      aria-label="Who"
      value={d.vehicle ? 'vehicle' : 'self'}
      onChange={(e) => set({ vehicle: e.target.value === 'vehicle' })}
    >
      <option value="self">They</option>
      <option value="vehicle">The carriage or boat they drive</option>
    </select>
  )
  const isPick = (
    <select
      aria-label="Or not"
      value={String(d.is)}
      onChange={(e) => set({ is: e.target.value === 'true' })}
    >
      <option value="true">are</option>
      <option value="false">are not</option>
    </select>
  )
  return (
    <div className="condition-editor">
      <div className="order-buttons">
        <select
          aria-label="Condition"
          value={d.kind}
          onChange={(e) => set({ kind: e.target.value as ConditionDraft['kind'] })}
        >
          {CONDITION_KINDS.map((k) => (
            <option key={k} value={k}>
              {CONDITION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="order-buttons">
        {d.kind === 'carries' && (
          <>
            {whoPick} carry {comparePick} {number('Units', d.amount, (amount) => set({ amount }))}{' '}
            {goodPick}
          </>
        )}
        {d.kind === 'load' && (
          <>
            {whoPick}
            <select
              aria-label="Full or empty"
              value={d.load}
              onChange={(e) => set({ load: e.target.value as ConditionDraft['load'] })}
            >
              <option value="full">full</option>
              <option value="empty">empty</option>
            </select>
          </>
        )}
        {d.kind === 'stock' && (
          <>
            <button type="button" onClick={() => onPickPlace(d)}>
              {d.placeId ? placeName(d.placeId, names) : 'Pick the place on the map'}
            </button>{' '}
            holds {comparePick} {number('Units', d.amount, (amount) => set({ amount }))} {goodPick}
          </>
        )}
        {d.kind === 'need' && (
          <>
            Their
            <select
              aria-label="Hunger or health"
              value={d.need}
              onChange={(e) => set({ need: e.target.value as ConditionDraft['need'] })}
            >
              <option value="hunger">hunger meter</option>
              <option value="health">health</option>
            </select>
            is
            <select
              aria-label="Above or below"
              value={d.needSide}
              onChange={(e) => set({ needSide: e.target.value as ConditionDraft['needSide'] })}
            >
              <option value="above">above</option>
              <option value="below">below</option>
            </select>
            {number('Percent', Math.round(d.share * 100), (p) => set({ share: p / 100 }), 100)} %
          </>
        )}
        {(d.kind === 'mounted' || d.kind === 'aboard') && (
          <>
            They {isPick} {d.kind}
          </>
        )}
        {d.kind === 'hour' && (
          <>
            It is
            <select
              aria-label="Before or after"
              value={d.hourSide}
              onChange={(e) => set({ hourSide: e.target.value as ConditionDraft['hourSide'] })}
            >
              <option value="before">before</option>
              <option value="after">at or after</option>
            </select>
            {number('Hour', d.hour, (hour) => set({ hour }), LAST_HOUR)}:00
          </>
        )}
      </div>
      <p className="muted small">
        {condition
          ? problem
            ? `Can’t add it yet: ${problem}.`
            : `${lead} ${conditionLabel(condition, names)}.`
          : 'Pick the storage, workplace or site of yours to ask about.'}
      </p>
      <div className="order-buttons">
        <button
          type="button"
          className="primary"
          disabled={!condition || problem !== undefined}
          onClick={() => condition && onDone(condition)}
        >
          {action}
        </button>
      </div>
    </div>
  )
}
