import { useEffect, useState } from 'react'
import { QUEUE_MAX_REPEAT } from '@csp/balance'
import type { Condition, Repeat } from '@csp/shared-types'
import { conditionLabel, type ConditionNames } from './condition-view.js'
import { DEFAULT_REPEAT } from './plan-blocks.js'
import { realMinutes, type QueueRow } from './queue-view.js'
import { typedMinutes } from './planner-view.js'

/**
 * A repeat block's head (`CONTEXT.md`: Repeat block): how it repeats, a count (set on Enter or
 * leaving the field), forever, or until a condition holds (set on the card's condition editor,
 * `onUntil`), with how many steps it repeats; in a running queue, the round the block is on
 * ("round 2 of 3").
 */
export function RepeatCount({
  repeat,
  steps,
  names,
  round,
  onSet,
  onUntil,
}: {
  repeat: Repeat
  steps: number
  names: ConditionNames
  /** The round it is on, while the resident's current step is inside it. */
  round?: number
  onSet: (repeat: Repeat) => void
  /** Opens the condition editor for its Until, with the condition it has, if any. */
  onUntil?: (until?: Condition) => void
}) {
  const count = typeof repeat === 'number' ? repeat : undefined
  const until = typeof repeat === 'object' ? repeat.until : undefined
  const mode = count !== undefined ? 'times' : until ? 'until' : 'forever'
  // The count the field shows, kept while another mode is on so going back to it keeps it.
  const [last, setLast] = useState(count ?? DEFAULT_REPEAT)
  const [text, setText] = useState(String(last))
  useEffect(() => {
    if (count === undefined) return
    setLast(count)
    setText(String(count))
  }, [count])
  const commit = () => {
    const typed = Math.floor(Number(text))
    if (typed >= 1 && typed !== count) onSet(Math.min(typed, QUEUE_MAX_REPEAT))
    else setText(String(last))
  }
  const pick = (to: string) => {
    if (to === 'times') onSet(last)
    else if (to === 'forever') onSet('forever')
    else onUntil?.()
  }
  return (
    <span className="small queue-step-minutes">
      <label>
        <strong>Repeat</strong>{' '}
        <select aria-label="How it repeats" value={mode} onChange={(e) => pick(e.target.value)}>
          <option value="times">×</option>
          <option value="forever">forever</option>
          <option value="until" disabled={!onUntil}>
            until…
          </option>
        </select>
      </label>{' '}
      {mode === 'times' && (
        <input
          className="queue-block-count"
          aria-label="Times to repeat"
          type="number"
          min={1}
          max={QUEUE_MAX_REPEAT}
          step={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      )}
      {until && (
        <>
          <span className="queue-step-label">{conditionLabel(until, names)}</span>{' '}
          {onUntil && (
            <button
              type="button"
              className="btn sm"
              title="Change the condition"
              onClick={() => onUntil(until)}
            >
              Change
            </button>
          )}
        </>
      )}{' '}
      {round !== undefined && (
        <strong className="queue-block-round">
          round {round}
          {count === undefined ? '' : ` of ${count}`}
        </strong>
      )}{' '}
      <span className="muted">
        {steps} step{steps === 1 ? '' : 's'}
        {count === undefined ? ' each round' : ` each, ${steps * count} in all`}
      </span>
    </span>
  )
}

/**
 * A step's duration as a chip (`CONTEXT.md`: Planner blocks): "10 min · 10 s", or "Duration?"
 * flagged while a step that never ends has none; tapped, it turns into a field of game minutes,
 * set on Enter or leaving it, cleared when emptied.
 */
export function DurationChip({
  row,
  onSet,
}: {
  row: QueueRow
  onSet: (minutes: number | undefined) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(row.minutes === undefined ? '' : String(row.minutes))
  useEffect(() => setText(row.minutes === undefined ? '' : String(row.minutes)), [row.minutes])
  const typed = Math.floor(Number(text))
  const commit = () => {
    setEditing(false)
    const minutes = typedMinutes(text)
    if (minutes !== row.minutes) onSet(minutes)
  }
  if (!editing)
    return (
      <button
        type="button"
        className={`btn sm queue-step-chip${row.minutes === undefined ? ' dng needed' : ''}`}
        title="Duration in game minutes"
        onClick={() => setEditing(true)}
      >
        {row.minutes === undefined ? 'Duration?' : `${row.minutes} min · ${row.real}`}
      </button>
    )
  return (
    <label className="small queue-step-minutes">
      <input
        type="number"
        min={1}
        step={1}
        placeholder="none"
        aria-label="Duration in game minutes"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        style={{ width: '4.5em' }}
      />
      min{typed > 0 && <span className="muted"> · {realMinutes(typed)}</span>}
    </label>
  )
}
