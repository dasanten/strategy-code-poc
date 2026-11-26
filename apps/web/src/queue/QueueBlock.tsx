import {
  Fragment,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { QUEUE_MAX_DEPTH, QUEUE_MAX_STEPS } from '@csp/balance'
import type {
  Branch,
  Building,
  City,
  Condition,
  QueueStepRequest,
  ScriptSummary,
  Waypoint,
} from '@csp/shared-types'
import { Icon } from '../ui/Icon.js'
import type { UiIconName } from '../ui/ui-icons.js'
import { toolbarCount } from '../screen/command-tabs-view.js'
import { showsMinutes, stepRow, type QueuePlan, type StepGroup } from './queue-view.js'
import { PlannerFlowContext } from './step-palette-view.js'
import { canMoveTo, insertPoints } from './queue-brackets-view.js'
import { conditionLabel, draftOf } from './condition-view.js'
import {
  capProblem,
  hasBlocks,
  intoElse,
  isBlock,
  isIf,
  itemCount,
  removeItem,
  setRepeat,
  stepCount,
  timeItem,
  unwrap,
  type IfBlock,
  type PlanItem,
  type RepeatBlock,
} from './plan-blocks.js'
import { useQueuePlanner } from './useQueuePlanner.js'
import { SavedQueueTools } from './SavedQueueTools.js'
import { DurationChip, RepeatCount } from './StepFields.js'

/** A step's UI icon by the kind of order it is, as the Orders tab groups them. */
const STEP_ICONS: Record<StepGroup, UiIconName> = {
  move: 'walk',
  work: 'build',
  goods: 'goods',
  scripts: 'script',
  flow: 'clock',
}

/**
 * The resident's queue (`CONTEXT.md`: Queue): its steps in order, the current one with its Doing
 * line. Steps are reordered by dragging or the arrows, removed, given a duration or none, and the
 * queue looped; each change is an edit-queue order. The group card lists its plan with it, then
 * titled "Plan", with no current step, as does a resident's card while a plan with repeat blocks
 * waits to be given.
 *
 * It is the queue planner the clipboard works in (`CONTEXT.md`: Planner clipboard): a tap picks
 * a step, Shift+tap a range, and Copy and Paste (or Ctrl+C and Ctrl+V while the list has focus)
 * copy the picked steps and put copies after the last picked one, or at the end with none picked.
 * The pasted steps are picked afterwards, so a second Paste goes after them.
 *
 * Repeat wraps the picked steps in a repeat block (`CONTEXT.md`: Repeat block): its head shows
 * the count, its steps follow indented, and it is picked, moved, copied and removed as one, or
 * unwrapped. `onEdit` gets the items with every step and block given an id (`withIds`).
 */
export function QueueBlock({
  queue: q,
  currentId,
  doing = '',
  scripts,
  buildings,
  lastSeen,
  waypoints,
  cities,
  onEdit,
  title = 'Queue',
  realm,
  running = false,
  palette,
  rounds,
  branches,
  mark,
  foot,
}: {
  queue: Pick<QueuePlan, 'items' | 'loop' | 'nextStepId'>
  /** The Add step palette, beside the steps (`CONTEXT.md`: Planner blocks). */
  palette?: ReactNode
  /** Said after the title at the head of the toolbar: a draft's "not started". */
  mark?: ReactNode
  /** Under the steps: Start queue and Discard draft, Give to all, or Edit as draft. */
  foot?: ReactNode
  /** The id of the step being done, in a running queue. */
  currentId?: number
  /** The round each block around the current step is on, by block id, in a running queue. */
  rounds?: ReadonlyMap<number, number>
  /** The part each If block around the current step runs, by block id, in a running queue. */
  branches?: ReadonlyMap<number, Branch>
  /** The resident's running queue, not a draft or a group's plan: Clear asks and keeps the current step. */
  running?: boolean
  doing?: string
  scripts: ScriptSummary[]
  buildings: Building[]
  /** The buildings remembered out of sight, to name steps acting there. */
  lastSeen?: Building[]
  /** The Player's waypoints, to name steps at one (`CONTEXT.md`: Waypoint). */
  waypoints?: readonly Waypoint[]
  /** The cities the Player knows, to name where a Relocate step goes. */
  cities?: readonly Pick<City, 'id' | 'name'>[]
  onEdit: (items: PlanItem[], loop?: boolean) => void
  title?: string
  /** The realm whose saved queues Save and Load keep (`CONTEXT.md`: Saved queue); none without. */
  realm?: string
}) {
  const {
    rows,
    picked,
    dragged,
    setDragged,
    help,
    setHelp,
    clipboardEmpty,
    insertAt,
    start,
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
  } = useQueuePlanner({ queue: q, currentId, running, onEdit })
  const names = { scripts, buildings, lastSeen, cities, waypoints }
  const inserts = insertPoints(q.items)
  const dragging = dragged !== undefined
  const written = itemCount(q.items)
  const over = capProblem(q.items)
  const lastStepId = rows.filter((row) => row.kind === 'step').at(-1)?.id
  let n = 0
  return (
    <section className="queue-planner" aria-label={title}>
      <div className="queue-list">
        <div className="queue-tools">
          <span className="px t16">{title}</span>
          {mark}
          <span className="grow" />
          <button
            type="button"
            className="btn sm"
            disabled={picked.length === 0}
            onClick={copyPicked}
          >
            Copy
          </button>
          <button type="button" className="btn sm" disabled={clipboardEmpty} onClick={pasteSteps}>
            Paste
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={!wrapped}
            title="Wrap the picked steps, in a row, in a repeat block"
            onClick={repeat}
          >
            Repeat
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={q.items.length === 0}
            title={
              running
                ? 'Remove every step but the current one and turn loop off: the queue ends after it'
                : 'Remove every step'
            }
            onClick={clear}
          >
            Clear
          </button>
          {realm && (
            <SavedQueueTools
              realm={realm}
              steps={q.items}
              onLoad={(loaded) => add(undefined, loaded)}
              oneButton
            />
          )}
          <button
            type="button"
            className="btn sm sq"
            aria-label="How the planner works"
            aria-expanded={help}
            onClick={() => setHelp(!help)}
          >
            ?
          </button>
          {(picked.length > 0 || hasBlocks(q.items)) && (
            <span className={`small ${over ? 'queue-unrolled-over' : 'muted'}`}>
              {toolbarCount(picked.length, hasBlocks(q.items) ? { written, over } : undefined)}
            </span>
          )}
        </div>
        {help && (
          <p className="well small queue-help">
            Tap a step to pick it (Shift for a range), then Copy; Paste puts the copies after the
            picked step. Drag a step or block to move it, into or out of a bracket, or pick it and
            tap Move here; focus it and press Alt+↑ or Alt+↓. Drag a step kind from Add step to put
            it where you drop it. Loop is the outer bracket, its switch in its head. Working,
            hauling, teaching and training never end on their own, so they need a duration unless
            they are last: tap the duration to set it. Repeat wraps the picked steps in a block done
            so many times in a row, or forever; a round in which none of its steps could start ends
            it, and a running queue shows the round it is on. If (in Add step’s Flow) puts the
            picked steps under a condition, checked once when its turn comes; Else moves other
            picked steps into its Else part, run when the condition doesn’t hold. A queue holds up
            to {QUEUE_MAX_STEPS} steps and blocks as written, nested up to {QUEUE_MAX_DEPTH} deep.
            Saved… keeps the steps in this browser under a name, and loads a saved queue’s steps at
            the end. Clear empties a draft; on a running queue it keeps only the current step and
            turns loop off, so the queue ends after it.
          </p>
        )}
        <div className={`queue-bracket queue-loop-bracket${q.loop ? ' on' : ''}`}>
          <div className="queue-bracket-head">
            <label className="small queue-loop">
              <input
                type="checkbox"
                checked={q.loop}
                onChange={(e) => edit(q.items, e.target.checked)}
              />{' '}
              <span aria-hidden="true">⟲</span> Loop
            </label>
            <span className="small muted">
              {q.loop ? 'from the top again after the last step' : 'ends after the last step'}
            </span>
          </div>
          <ol className="queue-steps" tabIndex={-1} onKeyDown={onKey}>
            {renderItems(q.items, 0)}
            {(picked.length > 0 || dragging) && point(undefined)}
          </ol>
        </div>
        {foot}
      </div>
      {palette && (
        <div className="queue-palette">
          <PlannerFlowContext.Provider
            value={{
              ...(wrapped ? { repeat } : {}),
              ...(wrapped && start
                ? { wrapIf: () => start?.('if', undefined, { wrap: picked }) }
                : {}),
              ifDone,
              ...(insertAt === undefined ? {} : { after: insertAt }),
            }}
          >
            {palette}
          </PlannerFlowContext.Provider>
        </div>
      )}
    </section>
  )

  // The items of one bracket, each followed by its "+" point where it has one.
  function renderItems(items: readonly PlanItem[], depth: number): ReactNode[] {
    return items.map((item) => (
      <Fragment key={item.id}>
        {isIf(item)
          ? ifItem(item, depth)
          : isBlock(item)
            ? blockItem(item, depth)
            : stepItem(item, depth)}
        {inserts.includes(item.id!) && point(item.id!)}
      </Fragment>
    ))
  }

  // A "+" between two items: where the next step added goes, or, with steps picked, where they
  // move to (`after` undefined: the end of the queue).
  function point(after: number | undefined) {
    const moving = picked.length > 0
    const set = !moving && after !== undefined && insertAt === after
    const canMove = moving && canMoveTo(q.items, picked, after)
    if (!moving && !palette && !dragging) return null
    if (moving && !canMove) return null
    const label = moving ? 'Move here' : set ? '+ next step goes here' : '+'
    return (
      <li
        key={`point-${after ?? 'end'}`}
        className={`queue-insert${set ? ' set' : ''}${moving ? ' move' : ''}`}
        onDragOver={accepts}
        onDrop={(e) => dropAt(e, after)}
      >
        <button
          type="button"
          className="btn sm"
          aria-label={
            moving
              ? `Move the picked steps ${after === undefined ? 'to the end' : 'here'}`
              : set
                ? 'Add new steps at the end again'
                : 'Add the next step here'
          }
          aria-pressed={moving ? undefined : set}
          onClick={() => pointTapped(after)}
        >
          {moving && after === undefined ? 'Move to the end' : label}
        </button>
      </li>
    )
  }

  // Tapping picks it (Shift+tap a range), dragging moves it, Alt+↑/↓ too.
  function rowProps(id: number) {
    return {
      'aria-selected': picked.includes(id),
      tabIndex: 0,
      onKeyDown: (e: KeyboardEvent) => onRowKey(e, id),
      // Shift+tap picks a range rather than selecting text.
      onMouseDown: (e: MouseEvent) => e.shiftKey && e.preventDefault(),
      onClick: (e: MouseEvent) => {
        // The row's own buttons and fields do their own thing.
        if ((e.target as HTMLElement).closest('button, input, label')) return
        e.stopPropagation()
        rowTapped(id, e.shiftKey)
      },
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation()
        e.dataTransfer.effectAllowed = 'move'
        setDragged(id)
      },
      onDragEnd: () => setDragged(undefined),
      onDragOver: accepts,
      onDrop: (e: DragEvent) => dropAt(e, id, id),
    }
  }

  // A repeat block: a bracket with its count, Unwrap and remove in its head, its items inside.
  function blockItem(block: RepeatBlock, depth: number) {
    const id = block.id!
    const isPicked = picked.includes(id)
    return (
      <li
        className={`queue-bracket queue-repeat-bracket${isPicked ? ' picked' : ''}`}
        data-depth={depth}
      >
        <div className="queue-bracket-head" {...rowProps(id)}>
          <Icon name="loop" size={16} className="queue-step-icon" />
          <RepeatCount
            repeat={block.repeat}
            steps={stepCount(block.items)}
            names={names}
            {...(rounds?.has(id) ? { round: rounds.get(id) } : {})}
            onSet={(count) => edit(setRepeat(q.items, id, count))}
            {...(start
              ? {
                  onUntil: (until?: Condition) =>
                    start?.('if', undefined, {
                      blockId: id,
                      until: true,
                      ...(until ? { condition: draftOf(until) } : {}),
                    }),
                }
              : {})}
          />
          <span className="buttons">
            <button type="button" className="btn sm" onClick={() => edit(unwrap(q.items, id))}>
              Unwrap
            </button>
            <button
              type="button"
              className="btn sm sq"
              aria-label="Remove the block and its steps"
              onClick={() => edit(removeItem(q.items, id))}
            >
              <Icon name="close" size={16} />
            </button>
          </span>
        </div>
        <ol className="queue-steps">{renderItems(block.items, depth + 1)}</ol>
      </li>
    )
  }

  // An If block: a bracket with its condition, Change, Else, Unwrap and remove in its head, its
  // items inside, and its Else part as a second part under its own head. In a running queue the
  // part being run is marked.
  function ifItem(block: IfBlock, depth: number) {
    const id = block.id!
    const isPicked = picked.includes(id)
    const taken = branches?.get(id)
    const toElse = intoElse(q.items, picked, id)
    const runs = <span className="chip g queue-branch">running</span>
    return (
      <li
        className={`queue-bracket queue-if-bracket${isPicked ? ' picked' : ''}`}
        data-depth={depth}
      >
        <div className="queue-bracket-head" {...rowProps(id)}>
          <span className="small queue-step-label">
            <strong>If</strong> {conditionLabel(block.if, names)}
            {taken === 'then' && runs}
          </span>
          <span className="buttons">
            {start && (
              <button
                type="button"
                className="btn sm"
                title="Change the condition"
                onClick={() =>
                  start?.('if', undefined, { blockId: id, condition: draftOf(block.if) })
                }
              >
                Change
              </button>
            )}
            <button
              type="button"
              className="btn sm"
              disabled={!toElse}
              title={
                toElse
                  ? 'Move the picked steps into the Else part'
                  : 'Pick steps outside the block to move them into its Else part'
              }
              onClick={() => toElse && edit(toElse)}
            >
              Else
            </button>
            <button type="button" className="btn sm" onClick={() => edit(unwrap(q.items, id))}>
              Unwrap
            </button>
            <button
              type="button"
              className="btn sm sq"
              aria-label="Remove the block and its steps"
              onClick={() => edit(removeItem(q.items, id))}
            >
              <Icon name="close" size={16} />
            </button>
          </span>
        </div>
        <ol className="queue-steps">{renderItems(block.items, depth + 1)}</ol>
        {block.else && (
          <>
            <div className="queue-bracket-head queue-else-head small">
              <strong>Else</strong>
              {taken === 'else' && runs}
            </div>
            <ol className="queue-steps">{renderItems(block.else, depth + 1)}</ol>
          </>
        )}
      </li>
    )
  }

  function stepItem(item: QueueStepRequest, depth: number) {
    const id = item.id!
    const isPicked = picked.includes(id)
    const step = stepRow({ ...item, id }, id === currentId, names)
    n++
    return (
      <li
        className={`queue-step${step.current ? ' current' : ''}${isPicked ? ' picked' : ''}`}
        data-depth={depth}
        aria-current={step.current ? 'step' : undefined}
        {...rowProps(id)}
      >
        <div className="queue-step-head">
          <Icon name={STEP_ICONS[step.group]} size={16} className="queue-step-icon" />
          <span
            className="small queue-step-label"
            title={step.gone ? `${step.gone}: it will be skipped` : step.label}
          >
            {n}. {step.label}
            {step.gone && <span className="queue-step-gone"> · {step.gone}</span>}
          </span>
          {showsMinutes(step, id === lastStepId) && (
            <DurationChip row={step} onSet={(minutes) => edit(timeItem(q.items, id, minutes))} />
          )}
          <span className="buttons">
            <button
              type="button"
              className="btn sm sq"
              aria-label="Remove"
              onClick={() => edit(removeItem(q.items, id))}
            >
              <Icon name="close" size={16} />
            </button>
          </span>
        </div>
        {step.current && doing && <span className="small muted">{doing}</span>}
      </li>
    )
  }
}
