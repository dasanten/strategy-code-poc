import {
  BATCHES_PER_DAY,
  RECIPES,
  WORK_OUTPUT_PER_DAY,
  WORKPLACE_SKILL,
} from './shared/narrowed.js'
import {
  aboutTime,
  bornIn,
  foalLeft,
  grownIn,
  pairingTicksLeft,
  workLeft,
} from './shared/estimates.js'
import { horsesInNeed } from './shared/reviving.js'
import { isDown, GOODS, STAT_NAMES, SKILL_NAMES } from './shared/world.js'
import { inContact } from './shared/combat.js'
import { isVesselId, vesselCapacity, vesselName } from './shared/vessels.js'
import {
  LINE_BUILDING,
  BUILDABLE,
  buildingWork,
  workFactor,
  MAX_WORKERS,
  NODE_GOOD,
  teacherAt,
  traineesOf,
  materialsNeeded,
  recipeGood,
  teardownReturns,
  teardownWork,
  isStone,
  materialsOfKind,
  workOfKind,
} from './shared/building.js'
import {
  CARRIAGE_CAPACITY,
  PASSENGER_WEIGHT,
  CARRYING_DAYS,
  FEED_UNITS,
  HAUL_KEEP_FOOD,
  MAX_HEALTH,
  MAX_HUNGER,
  TRAINING_GROUND_MAX_TRAINEES,
  STAT_BASE_MAX,
  TICKS_PER_GAME_DAY,
  TRAINED_CAP_SHARE,
  carryCapacity,
  trainedCap,
  REALM_NAME_MAX_LENGTH,
  RESIDENT_NAME_MAX_LENGTH,
  QUEUE_MAX_STEPS,
  QUEUE_MAX_REPEAT,
  QUEUE_MAX_DEPTH,
  FOAL_STAT_SPREAD,
  STABLE_BREED_DAYS,
  EQUIP_TICKS,
} from '@csp/balance'
import { ageInYears, bestWeapon, canHandle, canWork, stockWeight } from './shared/stats.js'
import { isAt } from './shared/footprint.js'
import { wrapDelta, wrapDistance } from './shared/terrain.js'
import { wallStrength, wallStrengthLeft } from './shared/walls.js'
import { putAwayUnits } from './shared/goods.js'
import { nameProblem } from './shared/names.js'
import type {
  Branch,
  Condition,
  QueueStepRequest,
  Repeat,
  SeenVessel,
  VesselKind,
  Building,
  Carriage,
  City,
  ResidentOrder,
  BuildingKind,
  GearCondition,
  Good,
  GoodsSpot,
  KnownNode,
  Pile,
  Resident,
  ScriptSummary,
  Task,
  SkillName,
  StatName,
  TrainingSubject,
  Stock,
  SeenResident,
  SeenHorse,
  ResourceNode,
  WallMaterial,
  Waypoint,
} from '@csp/shared-types'
import {
  STABLE_BREED_TICKS,
  breedProblem,
  horsesIn,
  keptBreeding,
  keptPair,
} from './shared/horses.js'
import {
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  busyAndIdle,
  CARD_TAB_LABELS,
  CARD_TABS,
  carryLine,
  GROUP_TABS,
  groupCard,
  rememberedTabOf,
  rememberTabOf,
  residentLines,
  residentsCount,
  scriptsRun,
  statLine,
  TAB_LABELS,
  type GroupTab,
  type CardSections,
  type ResidentGroup,
  type ResidentLines,
} from './residents-view.js'
import { GOOD_LABELS, carriedItems, goodsAmount } from './goods-grid.js'
import {
  equipmentLine,
  equipmentSlots,
  groupSwapChoices,
  MEND,
  swapChoices,
  type SlotView,
} from './equipment-view.js'
import { GoodIcon, GoodsGrid } from './GoodsGrid.js'
import { BuildMenu } from './BuildMenu.js'
import { workSpan } from './build-menu-view.js'
import { doingLine, interruptedLine, scriptLine } from './doing-view.js'
import { type RelocateChoice } from './relocate-view.js'
import {
  clearedItems,
  editPlan,
  planOf,
  branchesOf,
  roundsOf,
  realMinutes,
  showsMinutes,
  stepRow,
  type QueuePlan,
  type QueueRow,
  type StepGroup,
} from './queue-view.js'
import { copy, paste, pickStep, useClipboardEmpty } from './planner-clipboard.js'
import { toolbarCount } from './command-tabs-view.js'
import {
  followInsert,
  InsertPointContext,
  PlannerFlowContext,
  STEP_KIND_TYPE,
} from './step-palette-view.js'
import { canMoveTo, insertPoints, moveItems } from './queue-brackets-view.js'
import type { Plan, PlanStepId } from './plan-step.js'
import { conditionLabel, draftOf, type ConditionNames } from './condition-view.js'
import {
  canMove,
  DEFAULT_REPEAT,
  capProblem,
  dropItem,
  hasBlocks,
  idsOf,
  itemCount,
  inner,
  insertItems,
  intoElse,
  isIf,
  setCondition,
  type IfBlock,
  isBlock,
  lastPicked,
  moveItem,
  planProblem,
  planRows,
  removeItem,
  setRepeat,
  stepCount,
  timeItem,
  topPicked,
  unwrap,
  withIds,
  wrap,
  type PlanItem,
  type RepeatBlock,
} from './plan-blocks.js'
import {
  browserStorage,
  keepGivenQueue,
  list,
  load as loadQueue,
  readQueues,
  remove as removeQueue,
  save as saveQueue,
  storeQueues,
  type SavedQueues,
} from './saved-queues.js'
import {
  groupButtonGroup,
  groupNumberParams,
  groupRows,
  type GroupButton,
  type GroupOrder,
  type GroupSeen,
} from './group-orders.js'
import { GROUP_HINTS } from './pick-mode.js'
import { CustomiseButton, taskStart } from './Customise.js'
import { NumberField, foodParamsHint } from './ScriptParams.js'
import {
  alarmChoices,
  defenceChoices,
  groupAlarmScript,
  groupDefenceScript,
  rememberLastScript,
  rememberedLastScript,
  runScriptPick,
} from './script-run-view.js'
import { BUILDING_NAMES } from './map/palette.js'
import { horseFaresKnown } from './seen.js'
import { PanelHead } from './panel-head.js'
import { labelled } from './name-labels.js'
import {
  CardTabs,
  FeedBlock,
  useActionKeys,
  useInSheet,
  useEscapeClosesPanel,
  useKeptRows,
} from './SelectionCard.js'
import { rallyProblem } from './zeal.js'
import { CommandBar, OrderGrid, PanelFoot, type OrderPanelSpec } from './CommandBar.js'
import { panelSize, panelTitle } from './order-panel-view.js'
import { HorsePick } from './HorsePick.js'
import {
  orderGroupOf,
  residentOrders,
  DOWN_NO_ORDERS,
  rowGroups,
  riddenHorseLine,
  type ActionId,
  type CardAction,
} from './selection-view.js'
import { Icon } from './Icon.js'
import type { UiIconName } from './ui-icons.js'

export { GOOD_LABELS }

/** A weight in kg, to one decimal (coins weigh little). */
const kg = (weight: number) => `${Math.round(weight * 10) / 10} kg`

/** The goods in a stock that are there, in the usual order. */
const goodsIn = (stock: Stock | undefined) =>
  GOODS.filter((g) => (stock?.[g] ?? 0) > 0).map((g) => [g, stock![g]!] as const)

/** Some goods in words, each times `times`: "4 iron ore". */
const stockText = (stock: Stock, times = 1) =>
  goodsIn(stock)
    .map(([g, n]) => `${n * times} ${GOOD_LABELS[g].toLowerCase()}`)
    .join(', ')

export const STAT_LABELS: Record<StatName, string> = {
  strength: 'Strength',
  endurance: 'Endurance',
  agility: 'Agility',
  intellect: 'Intellect',
}

/** Skill names as the UI shows them. */
export const SKILL_LABELS: Record<SkillName, string> = {
  mining: 'Mining',
  woodcutting: 'Woodcutting',
  smelting: 'Smelting',
  smithing: 'Smithing',
  construction: 'Construction',
  farming: 'Farming',
  combat: 'Combat',
  driving: 'Driving',
  seafaring: 'Seafaring',
}

/** A stat or skill a training ground teaches, as the UI names it: "Strength", "Combat". */
export function subjectLabel(subject: TrainingSubject): string {
  return subject in STAT_LABELS
    ? STAT_LABELS[subject as StatName]
    : SKILL_LABELS[subject as SkillName]
}

/**
 * Picks a subject to teach, a stat or a skill (`CONTEXT.md`: Training ground), and gives it with
 * the button `action` names.
 */
export function SubjectPicker({
  action,
  onPick,
  picked,
  disabled = false,
}: {
  action: string
  onPick: (subject: TrainingSubject) => void
  /** The subject chosen to start with, such as what they teach now. */
  picked?: TrainingSubject
  disabled?: boolean
}) {
  const [subject, setSubject] = useState<TrainingSubject>(picked ?? 'strength')
  return (
    <div className="order-buttons subject-pick">
      <select
        aria-label="Subject to teach"
        value={subject}
        disabled={disabled}
        onChange={(e) => setSubject(e.target.value as TrainingSubject)}
      >
        <optgroup label="Stats">
          {STAT_NAMES.map((s) => (
            <option key={s} value={s}>
              {STAT_LABELS[s]}
            </option>
          ))}
        </optgroup>
        <optgroup label="Skills">
          {SKILL_NAMES.map((s) => (
            <option key={s} value={s}>
              {SKILL_LABELS[s]}
            </option>
          ))}
        </optgroup>
      </select>
      <button type="button" className="primary" disabled={disabled} onClick={() => onPick(subject)}>
        {action}
      </button>
    </div>
  )
}

/** The longest a stat bar can be: the highest base plus the most training could add to it. */
const STAT_SCALE = STAT_BASE_MAX * (1 + TRAINED_CAP_SHARE)

/** Meter colour by how full it is: low is a warning, half-empty a caution. */
export function meterClass(share: number): string {
  return share < 0.25 ? 'low' : share < 0.5 ? 'mid' : 'ok'
}

export const pct = (share: number) => `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`

/**
 * What the map is waiting for a tile for: to walk or drive there, a haul route's other stop, or
 * the far end of a road along a line.
 */
/** What the map waits for a tile for: a Build line's start, then its end (`CONTEXT.md`: Build line). */
export type Picking =
  | false
  | 'walk'
  | 'drive'
  | 'row'
  | 'driveOff'
  | 'rowOff'
  | 'push'
  | 'throw'
  | 'hitchOff'
  | 'haul'
  | 'roadFrom'
  | 'roadTo'
  | 'wallFrom'
  | 'wallTo'
  /** Creative mode: where to move them at once (`CONTEXT.md`: Creative mode). */
  | 'creativeMove'

/** What a haul route carries, picked before its other stop (`CONTEXT.md`: Haul route). */
export interface HaulSetup {
  goods: Good[]
  returnGoods: Good[]
  keepFood: number
}

/**
 * A resident's pair and the child they carry (`CONTEXT.md`: Pairing, Carrying): who carries, and
 * about how long until it is born; undefined for one who is neither.
 */
export function familyLine(r: Resident, residents: Resident[], tick: number): string | undefined {
  if (r.carrying) {
    return `Carrying ${r.carrying.partnerName}’s child · ${bornIn(r.carrying.since, tick)}`
  }
  if (!r.pair) return undefined
  const partnerId = r.pair.partnerId
  const partner = residents.find((x) => x.id === partnerId)
  const name = partner?.name ?? 'someone out of sight'
  if (partner?.carrying) {
    return `${name} is carrying their child · ${bornIn(partner.carrying.since, tick)}`
  }
  return `Paired with ${name}`
}

/** The name of the script a resident runs, for the small line under their Doing line. */
function scriptName(r: Resident, scripts: readonly ScriptSummary[]): string | undefined {
  if (!r.script) return undefined
  return scripts.find((s) => s.id === r.script!.scriptId)?.name ?? 'a script'
}

/**
 * The script a resident runs, such as the default script of the task they were given
 * (`CONTEXT.md`: Default script), with a button to open it in the library.
 */
function TaskScript({
  scriptId,
  scripts,
  onEdit,
}: {
  scriptId: number
  scripts: ScriptSummary[]
  onEdit: (scriptId: number) => void
}) {
  const script = scripts.find((s) => s.id === scriptId)
  const note = !script?.task ? '' : script.followsDefault ? 'the game’s default' : 'edited by you'
  return (
    <div className="task-script">
      <span className="grow">
        Runs <strong>{script?.name ?? 'a script'}</strong>
        {script && script.activeVersion !== null && ` · version ${script.activeVersion}`}
        {note && <span className="muted small"> · {note}</span>}
      </span>
      <button type="button" className="btn sm" onClick={() => onEdit(scriptId)} disabled={!script}>
        Edit
      </button>
    </div>
  )
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
  const [dragged, setDragged] = useState<number>()
  // The planner's help, behind its "?".
  const [help, setHelp] = useState(false)
  // The steps and blocks picked for the clipboard, by id; one removed since drops out.
  const [pickedIds, setPicked] = useState<number[]>([])
  const clipboardEmpty = useClipboardEmpty()
  const names = { scripts, buildings, lastSeen, cities, waypoints }
  const rows = planRows(q.items)
  const ids = rows.map((row) => row.id)
  const picked = pickedIds.filter((id) => ids.includes(id))
  // The insert point: the row the next step added goes after ("+" between two steps).
  const kept = useContext(InsertPointContext)
  const [ownAt, setOwnAt] = useState<number>()
  const insertAt = kept ? kept.at : ownAt
  const setInsertAt = kept ? kept.set : setOwnAt
  const seenIds = useRef(ids)
  useEffect(() => {
    // Once a step goes in there, the next follows it.
    const next = followInsert(seenIds.current, ids, insertAt)
    if (next !== insertAt) setInsertAt(next)
    seenIds.current = ids
  }, [ids.join(',')])
  const inserts = insertPoints(q.items)
  const dragging = dragged !== undefined
  const edit = (items: PlanItem[], loop?: boolean) => {
    const given = withIds(items, q.nextStepId)
    onEdit(given.items, loop)
    return given
  }
  // The added items go after `after` (or at the end) and are picked, so a second Paste follows.
  const add = (after: number | undefined, added: PlanItem[]) => {
    if (added.length === 0) return
    const given = edit(insertItems(q.items, after, added))
    setPicked(newIds(q.items, given.items))
  }
  const copyPicked = () => {
    if (picked.length > 0) copy(topPicked(q.items, picked))
  }
  const pasteSteps = () => add(lastPicked(q.items, picked), paste())
  const wrapped = picked.length > 0 ? wrap(q.items, picked) : undefined
  const repeat = () => {
    if (!wrapped) return
    const given = edit(wrapped)
    setPicked(newIds(q.items, given.items))
  }
  // An If planned with Flow's If or a block's Change, its condition set (`CONTEXT.md`: If block):
  // the steps picked when it was started are wrapped, or the block's condition changes.
  const ifDone = (plan: Plan, condition: Condition) => {
    // A repeat block's Until (`CONTEXT.md`: Repeat block): it repeats until the condition holds.
    if (plan.until && plan.blockId !== undefined) {
      edit(setRepeat(q.items, plan.blockId, { until: condition }))
      return
    }
    if (plan.blockId !== undefined) {
      edit(setCondition(q.items, plan.blockId, condition))
      return
    }
    const into = wrap(q.items, plan.wrap ?? [], condition)
    if (!into) return
    const given = edit(into)
    setPicked(newIds(q.items, given.items))
  }
  // Clear (`CONTEXT.md`: Clear): empties a draft or a group's plan; on a running queue, asked
  // once, keeps only the current step with loop off, so the queue ends after it.
  const clear = () => {
    if (!running) {
      edit([])
      return
    }
    const ok = window.confirm(
      'Clear the queue? They finish the step they are on, then the queue ends. Stop halts them at once.',
    )
    if (ok) edit(clearedItems(q.items, currentId), false)
  }
  // Ctrl+C and Ctrl+V while the list has focus, not while typing in a field.
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const tag = (e.target as HTMLElement).tagName
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
    const key = e.key.toLowerCase()
    if (key !== 'c' && key !== 'v') return
    e.preventDefault()
    if (key === 'c') copyPicked()
    else pasteSteps()
  }
  const written = itemCount(q.items)
  const over = capProblem(q.items)
  const lastStepId = rows.filter((row) => row.kind === 'step').at(-1)?.id
  // Alt+↑ and Alt+↓ move the focused step or block (drag does too).
  const onRowKey = (e: KeyboardEvent, id: number) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    const by = e.key === 'ArrowUp' ? -1 : 1
    e.preventDefault()
    e.stopPropagation()
    if (canMove(q.items, id, by)) edit(moveItem(q.items, id, by))
  }
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
              ...(wrapped && kept?.start
                ? { wrapIf: () => kept.start?.('if', undefined, { wrap: picked }) }
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

  // What a row does when something is dropped on it or on a point: a step or block dragged in
  // the planner moves there; a step kind dragged from the palette is planned there.
  function dropAt(e: DragEvent, after: number | undefined, onto?: number) {
    e.preventDefault()
    e.stopPropagation()
    const kind = e.dataTransfer.getData(STEP_KIND_TYPE)
    if (kind && kept?.start) kept.start(kind as PlanStepId, after)
    else if (dragged !== undefined && onto !== undefined && dragged !== onto)
      edit(dropItem(q.items, dragged, onto))
    else if (dragged !== undefined && onto === undefined) edit(moveItems(q.items, [dragged], after))
    setDragged(undefined)
  }
  function accepts(e: DragEvent) {
    if (dragged !== undefined || e.dataTransfer.types.includes(STEP_KIND_TYPE)) e.preventDefault()
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
          onClick={() => {
            if (moving) {
              edit(moveItems(q.items, picked, after))
              setPicked([])
            } else if (after !== undefined) setInsertAt(set ? undefined : after)
          }}
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
        setPicked(pickStep(picked, ids, id, e.shiftKey))
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
            {...(kept?.start
              ? {
                  onUntil: (until?: Condition) =>
                    kept.start?.('if', undefined, {
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
            {kept?.start && (
              <button
                type="button"
                className="btn sm"
                title="Change the condition"
                onClick={() =>
                  kept.start?.('if', undefined, { blockId: id, condition: draftOf(block.if) })
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

/** The ids in `after` that `before` didn't have, the outermost of each new item only. */
function newIds(before: readonly PlanItem[], after: readonly PlanItem[]): number[] {
  const had = new Set(idsOf(before))
  const fresh = (items: readonly PlanItem[]): number[] =>
    items.flatMap((item) => {
      if (item.id !== undefined && !had.has(item.id)) return [item.id]
      return isBlock(item) ? fresh(inner(item)) : []
    })
  return fresh(after)
}

/**
 * A repeat block's head (`CONTEXT.md`: Repeat block): how it repeats, a count (set on Enter or
 * leaving the field), forever, or until a condition holds (set on the card's condition editor,
 * `onUntil`), with how many steps it repeats; in a running queue, the round the block is on
 * ("round 2 of 3").
 */
function RepeatCount({
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
 * Save and Load for a queue planner (`CONTEXT.md`: Saved queue): Save keeps `steps` in this
 * browser under a name, asking before it overwrites one saved under the same name; Load lists the
 * saved queues, each with its step count as written and date, to load (`onLoad` gets fresh
 * copies of its steps and blocks) or delete. With no steps, only Load shows.
 */
export function SavedQueueTools({
  realm,
  steps,
  onLoad,
  oneButton = false,
}: {
  realm: string
  steps: readonly PlanItem[]
  onLoad: (steps: PlanItem[]) => void
  /** One "Saved…" button opening both, for the planner's one-row toolbar. */
  oneButton?: boolean
}) {
  const [open, setOpen] = useState<'save' | 'load' | 'both'>()
  const [name, setName] = useState('')
  const [queues, setQueues] = useState(() => readQueues(browserStorage(), realm))
  const keep = (next: SavedQueues) => {
    storeQueues(browserStorage(), realm, next)
    setQueues(next)
  }
  const toggle = (panel: 'save' | 'load' | 'both') => {
    // Read again: another planner may have saved since.
    setQueues(readQueues(browserStorage(), realm))
    setOpen(open === panel ? undefined : panel)
  }
  const saved = list(queues)
  const taken = name.trim() in queues
  const onSave = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    keep(saveQueue(queues, name, steps, Date.now()))
    setName('')
    setOpen(undefined)
  }
  return (
    <div className="saved-queues">
      <div className="order-buttons">
        {oneButton && (
          <button
            type="button"
            className="btn sm"
            title="Save these steps under a name, or load saved ones"
            aria-expanded={open === 'both'}
            onClick={() => toggle('both')}
          >
            Saved…
          </button>
        )}
        {!oneButton && steps.length > 0 && (
          <button
            type="button"
            className="btn sm"
            aria-expanded={open === 'save'}
            onClick={() => toggle('save')}
          >
            Save…
          </button>
        )}
        {!oneButton && (
          <button
            type="button"
            className="btn sm"
            aria-expanded={open === 'load'}
            onClick={() => toggle('load')}
          >
            Load…
          </button>
        )}
      </div>
      {(open === 'save' || (open === 'both' && steps.length > 0)) && (
        <form className="saved-queues-save well" onSubmit={onSave}>
          <input
            aria-label="Name to save the queue under"
            placeholder="Name, such as Mine run"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn sm" disabled={!name.trim()}>
            {taken ? 'Overwrite' : 'Save'}
          </button>
          {taken && (
            <span className="small muted">A queue is saved as “{name.trim()}”: overwrite it?</span>
          )}
        </form>
      )}
      {(open === 'load' || open === 'both') &&
        (saved.length === 0 ? (
          <p className="muted small saved-queues-none">No queues saved in this browser yet.</p>
        ) : (
          <ul className="saved-queues-list well">
            {saved.map((s) => (
              <li key={s.name}>
                <span className="small">
                  {s.name}{' '}
                  <span className="muted">
                    {stepCount(s.steps)} step{stepCount(s.steps) === 1 ? '' : 's'},{' '}
                    {new Date(s.savedAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="buttons">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      onLoad(loadQueue(queues, s.name))
                      setOpen(undefined)
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`Delete ${s.name}`}
                    onClick={() => keep(removeQueue(queues, s.name))}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

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

/** A step's UI icon by the kind of order it is, as the Orders tab groups them. */
const STEP_ICONS: Record<StepGroup, UiIconName> = {
  move: 'walk',
  work: 'build',
  goods: 'goods',
  scripts: 'script',
  flow: 'clock',
}

/**
 * A step's duration as a chip (`CONTEXT.md`: Planner blocks): "10 min · 10 s", or "Duration?"
 * flagged while a step that never ends has none; tapped, it turns into a field of game minutes,
 * set on Enter or leaving it, cleared when emptied.
 */
function DurationChip({
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
    const minutes = text.trim() === '' || !(typed > 0) ? undefined : typed
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

/** What `ORDER_DOING`'s texts read besides the order: how far the way is, how they go, the cities. */
interface DoingContext {
  /** What is left of a way: about how long, or tiles to go without an estimate. */
  left: (path: readonly unknown[]) => string
  /** "Walking", or "Riding" on a horse (`CONTEXT.md`: Riding). */
  walking: string
  cities: readonly Pick<City, 'id' | 'name'>[]
}

/** An order of one kind. */
type OrderOf<K extends ResidentOrder['kind']> = Extract<ResidentOrder, { kind: K }>

/**
 * What each kind of order has a resident doing (T121.8): one entry per kind of `ResidentOrder`,
 * so a new kind fails typecheck until it says.
 */
const ORDER_DOING: { [K in ResidentOrder['kind']]: (o: OrderOf<K>, c: DoingContext) => string } = {
  relocate: (o, { left, cities }) => {
    const city = cities.find((c) => c.id === o.cityId)?.name ?? 'another city'
    return o.path ? `Relocating to ${city} · ${left(o.path)}` : `Relocating to ${city}`
  },
  walkTo: (o, { left, walking }) => {
    if (!o.path) return `Finding a way to ${o.target.x}, ${o.target.y}`
    return `${walking} to ${o.target.x}, ${o.target.y} · ${left(o.path)}`
  },
  drive: (o, { left }) => {
    if (!o.path) return `Finding a way for the carriage to ${o.target.x}, ${o.target.y}`
    return `Driving to ${o.target.x}, ${o.target.y} · ${left(o.path)}`
  },
  row: (o, { left }) => {
    // `CONTEXT.md`: Rowing.
    if (!o.path) return `Finding a way over the water to ${o.target.x}, ${o.target.y}`
    return `Rowing to ${o.target.x}, ${o.target.y} · ${left(o.path)}`
  },
  crew: (o, { left, walking }) => {
    // `CONTEXT.md`: Siege machine.
    if (!o.path) return 'Finding a way to the ram to crew it'
    return `${walking} to the ram to crew it · ${left(o.path)}`
  },
  // `CONTEXT.md`: Ram: its crew under its roof.
  ram: () => 'Ramming with the crew',
  // `CONTEXT.md`: Catapult.
  throw: () => 'Throwing Stone with the crew',
  // `CONTEXT.md`: Rallying the crew.
  rally: () => 'Rallying the crew',
  push: (o, { left }) => {
    if (!o.path) return `Finding a way for the ram to ${o.target.x}, ${o.target.y}`
    return `Pushing the ram to ${o.target.x}, ${o.target.y} · ${left(o.path)}`
  },
  sail: (o, { left }) => {
    // `CONTEXT.md`: Sailing.
    if (!o.path) return `Finding a way over the Sea to ${o.target.x}, ${o.target.y}`
    return `Sailing to ${o.target.x}, ${o.target.y} · ${left(o.path)}`
  },
  haul: (o, { left }) => {
    const what = o.goods.map((g) => GOOD_LABELS[g].toLowerCase()).join(', ')
    const { x, y } = o[o.stop]
    if (o.phase === 'loading') {
      return o.stop === 'from' ? `Loading ${what} at ${x}, ${y}` : `Unloading ${what} at ${x}, ${y}`
    }
    const back = o.returnGoods.map((g) => GOOD_LABELS[g].toLowerCase()).join(', ')
    const leg =
      o.stop === 'to' ? `Hauling ${what} to` : back ? `Hauling ${back} back to` : 'Driving back to'
    return o.path ? `${leg} ${x}, ${y} · ${left(o.path)}` : `${leg} ${x}, ${y}`
  },
  haulByWater: (o, { left }) => {
    // `CONTEXT.md`: Haul route by water.
    const what = o.goods.map((g) => GOOD_LABELS[g].toLowerCase()).join(', ')
    const { x, y } = o[o.stop]
    if (o.phase === 'loading') {
      return o.stop === 'from' ? `Loading ${what} at ${x}, ${y}` : `Unloading ${what} at ${x}, ${y}`
    }
    const back = o.returnGoods.map((g) => GOOD_LABELS[g].toLowerCase()).join(', ')
    // A ship's captain sails it (`CONTEXT.md`: Sailing); the server names its id after its kind.
    const doing = o.vesselId.startsWith('ship') ? 'Sailing' : 'Rowing'
    const leg =
      o.stop === 'to'
        ? `${doing} ${what} to`
        : back
          ? `${doing} ${back} back to`
          : `${doing} back to`
    return o.path ? `${leg} ${x}, ${y} · ${left(o.path)}` : `${leg} ${x}, ${y}`
  },
  pickUp: () => 'Picking up goods',
  drop: () => 'Putting down goods',
  feed: () => 'Feeding',
  equip: (o) =>
    o.good ? `Putting on ${GOOD_LABELS[o.good].toLowerCase()}` : `Taking off their ${o.slot}`,
  store: (o) => (o.phase === 'refilling' ? 'Taking food along' : 'Storing goods'),
  fetch: () => 'Fetching goods',
  tearDown: () => 'Tearing down',
  repair: () => 'Repairing',
  gather: (o) => `Gathering ${GOOD_LABELS[o.good].toLowerCase()}`,
  breed: () => 'Breeding horses',
  build: (o) => {
    const what = BUILDING_NAMES[o.building].toLowerCase()
    return o.siteId === null ? `Laying out a ${what}` : `Building a ${what}`
  },
  workAt: (o) => {
    if (o.mends) return 'Mending worn gear'
    return o.makes ? `Making ${GOOD_LABELS[o.makes].toLowerCase()}` : 'Working'
  },
  teach: (o) => `Teaching ${subjectLabel(o.subject)}`,
  train: (o) => (o.learning ? `Training ${subjectLabel(o.learning)}` : 'Waiting to train'),
  pay: () => 'Paying for mercenaries',
  buyCity: () => 'Buying a city',
  buyOff: () => 'Buying off a directive',
  payDebt: () => 'Paying the debt',
  acceptOffer: () => 'Accepting an offer',
  trade: (o) => (o.side === 'buy' ? 'Buying at a warehouse' : 'Selling at a warehouse'),
  swap: (o) => `Swapping for ${GOOD_LABELS[o.want].toLowerCase()}`,
  buyHorse: () => 'Buying a horse',
  sellHorse: () => 'Selling a horse',
  // As it always was: handing in a transfer had no text of its own (#BUG).
  handIn: () => 'Idle',
  attack: (o) => (o.path ? 'Going after their target' : 'Fighting'),
  climb: (o) => `Climbing a wall · ${pct(o.progress)}`,
  roadLine: (o, c) => lineDoing(o, c),
  wallLine: (o, c) => lineDoing(o, c),
}

/** A road or wall order along its line. */
function lineDoing(o: OrderOf<'roadLine' | 'wallLine'>, { walking }: DoingContext): string {
  const [x, y] = o.tiles[0]!
  const what = LINE_BUILDING[o.kind]
  const left = `${o.tiles.length} ${what} tile${o.tiles.length === 1 ? '' : 's'} to go`
  return o.phase === 'walking'
    ? `${walking} to lay ${what} at ${x}, ${y} · ${left}`
    : `Building ${what} at ${x}, ${y} · ${left}`
}

/**
 * What a resident's built-in order has them doing (`ORDER_DOING`). A rider rides where others walk
 * (`CONTEXT.md`: Riding): "Riding to 4, 5 · about 3 min (3 game hours)", or tiles to go without an
 * estimate (`arrivalTicks`). A relocating resident names their new city from `cities`
 * (`CONTEXT.md`: Relocate).
 */
export function orderDoing(
  r: Pick<Resident, 'order' | 'riding'>,
  arrives?: number,
  cities: readonly Pick<City, 'id' | 'name'>[] = [],
): string {
  const o = r.order
  if (!o) return 'Idle'
  const left = (path: readonly unknown[]) =>
    arrives === undefined ? `${path.length} tiles to go` : aboutTime(arrives)
  const walking = r.riding === undefined ? 'Walking' : 'Riding'
  const doing = ORDER_DOING[o.kind] as (o: ResidentOrder, c: DoingContext) => string
  return doing(o, { left, walking, cities })
}

/**
 * The Player's residents, one row each under the city they live in (see `groupResidents`); click
 * a row to inspect that resident and show them on the map. Picking one elsewhere, such as on the
 * map, scrolls their row into view. Each row is two lines (`residentLines`), on a phone as on a
 * desktop: name with the Leader or Heir mark, age and what they carry; then Doing, with the script
 * they run under it, and the hunger meter. `onOpenFull` opens the full list in its place
 * (`ResidentsFullList`).
 */
export function ResidentsList({
  groups,
  leaderId,
  heirId,
  tick,
  scripts = [],
  buildings = [],
  inSight = [],
  cities = [],
  horses = [],
  arrivesIn,
  selectedId,
  onSelect,
  onOpenFull,
}: {
  groups: ResidentGroup<Resident>[]
  leaderId: string
  /** The realm's heir, marked in their row (`CONTEXT.md`: Heir). */
  heirId?: string | null
  tick: number
  /** The Player's script library, to name the script each runs and the task it is for. */
  scripts?: ScriptSummary[]
  /** The buildings in sight, to name where residents store or fetch goods. */
  buildings?: Building[]
  /** Everyone in sight, to say where a passenger's carriage is heading (`doingLine`). */
  inSight?: readonly SeenResident[]
  /** The cities the Player knows, to name where a resident relocates to (`doingLine`). */
  cities?: readonly Pick<City, 'id' | 'name'>[]
  /** The horses the Player knows, to name the two being bred (`doingLine`). */
  horses?: readonly SeenHorse[]
  /** About how many ticks until a resident arrives where they walk, ride or drive (`arrivalTicks`). */
  arrivesIn?: (r: Resident) => number | undefined
  selectedId: string | undefined
  onSelect: (id: string) => void
  onOpenFull: () => void
  /** A phone's narrow screen: the rows are the same two lines there. */
  phone?: boolean
}) {
  const tableRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const row = tableRef.current?.querySelector(`[data-resident="${CSS.escape(selectedId)}"]`)
    // Its heading first, then the row itself, which wins when both don't fit.
    row?.closest('.residents-group')?.firstElementChild?.scrollIntoView({ block: 'nearest' })
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  return (
    <section className="residents" aria-label="Residents">
      <PanelHead title="Residents">{residentsCount(groups.flatMap((g) => g.residents))}</PanelHead>
      <div className="residents-tools fx">
        <span className="grow" />
        <button type="button" className="btn sm" onClick={onOpenFull}>
          Open full list
        </button>
      </div>
      <div className="residents-table" ref={tableRef}>
        {groups.map((g) => (
          <div className="residents-group" key={g.key} role="group" aria-label={g.label}>
            <div className="rw grp">
              <span className="lb grow">{g.label}</span>
              <span className="mono">{g.residents.length}</span>
            </div>
            {g.residents.map((r) => (
              <ResidentLinesRow
                key={r.id}
                id={r.id}
                lines={residentLines(r, {
                  leaderId,
                  heirId,
                  tick,
                  doing: doingLine(r, {
                    scripts,
                    buildings,
                    residents: inSight,
                    horses,
                    cities,
                    arrives: arrivesIn?.(r),
                  }),
                })}
                under={
                  interruptedLine(r, { scripts, buildings, residents: inSight, horses }) ??
                  scriptLine(r, scripts)
                }
                carrying={carryLine(stockWeight(r.carried), carryCapacity(r, tick))}
                selected={r.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * A resident's row in the Residents tab: name, Leader or Heir mark, age and what they carry; then
 * Doing, with the script they run under it, and the hunger meter.
 */
function ResidentLinesRow({
  id,
  lines,
  under,
  carrying,
  selected,
  onSelect,
}: {
  id: string
  lines: ResidentLines
  /** The script they run or the order waiting behind a defence script, under Doing. */
  under: string | undefined
  /** "12 / 30 kg" (`carryLine`). */
  carrying: string
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      data-resident={id}
      className={`rw people-row${selected ? ' sel' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(id)}
    >
      <span className="fx">
        <span className="b grow">
          {lines.name}
          {lines.leader && <span className="chip y">Leader</span>}
          {lines.heir && <span className="chip bl">Heir</span>}
        </span>
        <span className="mono mu">
          {lines.age} · {carrying}
        </span>
      </span>
      <span className="fx">
        <span className="grow doing">
          {lines.doing}
          {under && <span className="mu under">{under}</span>}
        </span>
        <span className="mt" aria-label={`Hunger ${pct(lines.fed)} fed`}>
          <i className={meterClass(lines.fed)} style={{ width: pct(lines.fed) }} />
        </span>
      </span>
    </button>
  )
}

/**
 * The selection card for several of the Player's residents picked at once on the map (ADR 0012;
 * `CONTEXT.md`: Group, Resident card): a header with how many and who, then one open tab. Orders
 * gives each of them the same order, in rows as on a resident card (`groupRows`), each
 * to those who can take it; Queue plans a queue to give them all; Members lists what each is doing,
 * a click picking just that one; Script says what they run and gives them all one.
 */
/**
 * The rows that give a task with no panel of their own to hold its Customise button
 * (`CONTEXT.md`: Before it starts), beside the row instead.
 */
const ROW_TASKS: Partial<Record<ActionId, Task>> = {
  roadTo: 'buildLine',
  wallTo: 'buildLine',
  feedStable: 'feedStable',
  train: 'train',
  explore: 'explore',
  gather: 'gather',
}

/** The same on the group card, whose Work and Tear down pick the place on the map. */
const GROUP_ROW_TASKS: Partial<Record<GroupButton, Task>> = {
  work: 'work',
  tearDown: 'tearDown',
  roadTo: 'buildLine',
  wallTo: 'buildLine',
  feedStable: 'feedStable',
  train: 'train',
  explore: 'explore',
  gather: 'gather',
}

export function GroupCard({
  residents,
  scripts,
  buildings,
  carriages = [],
  boats = [],
  inSight = [],
  cities,
  arrivesIn,
  horses = [],
  realmId,
  tick,
  picking,
  onPicking,
  buildAt,
  onOrder,
  orderError,
  onPick,
  onClose,
  planner,
  collapsed = false,
  relocate,
  seen = {},
  mapSize,
  creative,
}: {
  residents: Resident[]
  scripts: ScriptSummary[]
  buildings: Building[]
  /**
   * The realm's carriages someone of the group stands on, with how many more passengers fit on
   * each, to board (`CONTEXT.md`: Passenger).
   */
  carriages?: { carriage: Pick<Carriage, 'id' | 'x' | 'y' | 'realmId' | 'cityId'>; seats: number }[]
  /**
   * The realm's boats someone of the group stands beside, with how many more passengers fit in
   * each, to board (`CONTEXT.md`: Beside a vessel).
   */
  boats?: {
    vessel: Pick<SeenVessel, 'id' | 'x' | 'y'> & Partial<Pick<SeenVessel, 'kind' | 'dockedAt'>>
    seats: number
  }[]
  /** Everyone in sight, to say where a passenger's carriage is heading (`doingLine`). */
  inSight?: readonly SeenResident[]
  /** The cities the Player knows, to name where a resident relocates to (`doingLine`). */
  cities?: readonly Pick<City, 'id' | 'name'>[]
  /** About how many ticks until a resident arrives where they walk, ride or drive (`arrivalTicks`). */
  arrivesIn?: (r: Resident) => number | undefined
  /** The queue planner (`GroupPlanner`), on the Queue tab (`CONTEXT.md`: Planning for a group). */
  planner?: ReactNode
  /** Horses in sight, to pick two in a stable where some of them stand to breed. */
  horses?: SeenHorse[]
  /** The Player's realm, whose horses they breed. */
  realmId?: string
  tick?: number
  /** The map is waiting for a tile for one of the group's orders. */
  picking: GroupPicking
  /** Starts (or cancels) picking a tile for the group, with what the order needs besides. */
  onPicking: (picking: GroupPicking, with_?: GroupPickWith) => void
  /** The tile picked to build on: the site there to join, or the kinds that may go there. */
  buildAt: GroupBuildTile | undefined
  /** Gives each resident of the group the order (`CONTEXT.md`: Group). */
  onOrder: (order: GroupOrder) => void
  /** Why the last group order couldn't go out at all, such as no workplace on the tile. */
  orderError: string | undefined
  onPick: (id: string) => void
  onClose: () => void
  /** Shrunk to its head while the map waits for a target (ADR 0012: pick mode). */
  collapsed?: boolean
  /**
   * The realm's cities to relocate the group to (`groupRelocateChoices`) and why they can't be
   * told to at all, if they can't.
   */
  relocate?: { choices: RelocateChoice[]; problem: string | undefined }
  /**
   * The realm's free horses and carriages and the buildings in sight, to tell which orders some
   * of them can take where they stand (`groupRows`).
   */
  seen?: GroupSeen
  /** Tiles along each side of the map. */
  mapSize?: number
  /** The Creative section, for an admin on a creative server (`CreativeGroupMove`). */
  creative?: ReactNode
}) {
  // Two of one name are told apart by age and city (`CONTEXT.md`: Game-given names).
  const card = groupCard(tick === undefined ? residents : labelled(residents, tick, cities))
  const [tab, setTab] = useState<GroupTab>(() => rememberedTabOf('group', GROUP_TABS))
  // The order whose panel is open under the rows: what it needs before it goes out.
  const [panel, setPanel] = useState<
    'haul' | 'fetch' | 'breed' | 'teach' | 'relocate' | 'board' | 'feed' | 'equip'
  >()
  const [feedUnits, setFeedUnits] = useState(FEED_UNITS)
  const [good, setGood] = useState<Good>('food')
  const numberParams = groupNumberParams(residents, scripts)
  const foodHint = foodParamsHint(numberParams.map((p) => p.name))
  const showTab = (t: GroupTab) => {
    setTab(t)
    rememberTabOf('group', t)
  }
  // A line's far end is still the line's button.
  const picked = picking === 'roadTo' ? 'roadFrom' : picking === 'wallTo' ? 'wallFrom' : picking
  const toggle = (p: Exclude<GroupPicking, false>, with_?: GroupPickWith) => {
    if (!with_) setPanel(undefined)
    onPicking(picked === p ? false : p, with_)
  }
  // The buttons that start picking a tile on the map, and what for.
  const picks: Partial<Record<GroupButton, Exclude<GroupPicking, false>>> = {
    walk: 'walk',
    drive: 'drive',
    row: 'row',
    work: 'work',
    build: 'build',
    roadTo: 'roadFrom',
    wallTo: 'wallFrom',
    tearDown: 'tearDown',
    storeAt: 'storeAt',
    attack: 'attack',
    climb: 'climb',
  }
  // The orders that go out as they are.
  const at_once: Partial<Record<GroupButton, GroupOrder>> = {
    stop: { kind: 'stop' },
    mount: { kind: 'mount' },
    dismount: { kind: 'dismount' },
    feedStable: { kind: 'feedStable' },
    train: { kind: 'train' },
    explore: { kind: 'explore' },
    gather: { kind: 'gather' },
    store: { kind: 'store' },
    drop: { kind: 'drop' },
    getOff: { kind: 'getOff' },
    unhitch: { kind: 'unhitch' },
  }
  const { actions, missing } = groupRows({
    residents,
    tick: tick ?? 0,
    size: mapSize ?? 0,
    seen,
    carriages: carriages.length,
    boats: boats.length,
    relocateProblem: relocate ? relocate.problem : 'your realm has no other city',
  })
  // Each row keeps its slot while the card is open (ADR 0019); a row picking a tile shows it.
  const rows = useKeptRows(actions, missing, groupButtonGroup).map((a) => {
    const p = picks[a.id]
    return p && picked === p ? { ...a, active: true as const } : a
  })
  const shown = actions.some((a) => a.id === panel) ? panel : undefined
  // The block opens under the orders, out of sight on all but the tallest card.
  const buildBlock = useRef<HTMLElement>(null)
  useEffect(() => {
    buildBlock.current?.scrollIntoView({ block: 'nearest' })
  }, [buildAt?.x, buildAt?.y, picking])
  const closePanel = () => {
    setPanel(undefined)
    if (buildAt) onPicking(false)
  }
  useEscapeClosesPanel(
    tab === 'orders' && (shown !== undefined || (!!buildAt && !picking)),
    closePanel,
  )
  const phone = useInSheet()
  const act = (a: CardAction<GroupButton>) => {
    if (tab !== 'orders' && a.id !== 'script') showTab('orders')
    // With one carriage or boat to board they board that; with several, or a ship (as crew or as
    // passengers, `CONTEXT.md`: Crew), a panel lists them.
    const ship = boats.some((b) => b.vessel.kind === 'ship')
    if (a.id === 'board' && carriages.length + boats.length === 1 && !ship) {
      if (boats[0]) return onOrder({ kind: 'boardBoat', ...boats[0] })
      const { carriage, seats } = carriages[0]!
      return onOrder({ kind: 'board', carriage, seats })
    }
    const p = picks[a.id]
    if (p) return toggle(p)
    const order = at_once[a.id]
    if (order) return onOrder(order)
    if (a.id === 'script') return showTab('script')
    const opens = a.id as NonNullable<typeof panel>
    onPicking(false)
    setPanel(shown === opens ? undefined : opens)
  }
  useActionKeys(rows, act)
  // The finished stables some of them stand in, to breed horses in.
  const stables = buildings.filter(
    (b) => b.kind === 'stable' && !b.site && residents.some((r) => isAt(r, b)),
  )
  const { busy, idle } = busyAndIdle(residents)
  // The open order's panel, above the command bar or on a phone under its order (`CommandBar`).
  const openPanel = shown && (
    <>
      {shown === 'board' && (
        <section className="inspector-block" aria-label="Board carriage">
          <div className="opanel-choices">
            {carriages.map(({ carriage, seats }) => (
              <button
                type="button"
                key={carriage.id}
                onClick={() => {
                  setPanel(undefined)
                  onOrder({ kind: 'board', carriage, seats })
                }}
              >
                Board at {carriage.x}, {carriage.y}
              </button>
            ))}
            {boats.flatMap(({ vessel, seats }) => {
              const board = (asCrew: boolean, label: string) => (
                <button
                  type="button"
                  key={`${vessel.id}-${asCrew}`}
                  onClick={() => {
                    setPanel(undefined)
                    onOrder({ kind: 'boardBoat', vessel, seats, ...(asCrew ? { asCrew } : {}) })
                  }}
                >
                  {label}
                </button>
              )
              const at = `${vessel.x}, ${vessel.y}`
              return vessel.kind === 'ship'
                ? [board(true, `Crew the ship at ${at}`), board(false, `Board the ship at ${at}`)]
                : [board(false, `Board the boat at ${at}`)]
            })}
          </div>
          <p className="muted small">
            Those standing on the carriage, or beside the boat, board it, until it is full; a ship's
            from the haven it is docked at, as its crew (who take no room) or as passengers.
          </p>
        </section>
      )}
      {shown === 'feed' && (
        <section className="inspector-block" aria-label="Feed">
          <PanelFoot>
            <label className="opanel-units">
              Units each
              <input
                className="amount mono"
                type="number"
                min={1}
                step={1}
                value={feedUnits}
                aria-label="Units of Food each"
                onChange={(e) => setFeedUnits(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className="primary"
              disabled={!Number.isInteger(feedUnits) || feedUnits < 1}
              onClick={() => {
                setPanel(undefined)
                onOrder({ kind: 'feed', units: feedUnits })
              }}
            >
              Feed
            </button>
          </PanelFoot>
          {(!Number.isInteger(feedUnits) || feedUnits < 1) && (
            <span className="muted small">Units: a whole number, 1 or more.</span>
          )}
          <p className="muted small">
            Each with Food in hand next to someone Down or a horse that isn’t full feeds them, one
            for each: someone Down eats a unit at once and wakes at low health, a horse eats until
            it is full.
          </p>
        </section>
      )}
      {shown === 'equip' && (
        <section className="inspector-block" aria-label="Equip">
          <div className="opanel-choices">
            {groupSwapChoices(residents).map((c) => (
              <button
                key={c.good}
                type="button"
                onClick={() => {
                  setPanel(undefined)
                  onOrder({ kind: 'equip', good: c.good })
                }}
              >
                <GoodIcon good={c.good} />
                {c.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            Each who carries it puts it on in its slot, the one there staying carried. It takes{' '}
            {EQUIP_TICKS} ticks, and they strike no blows meanwhile.
          </p>
        </section>
      )}
      {shown === 'fetch' && (
        <section className="inspector-block" aria-label="Fetch">
          <label className="fld">
            <span className="lb">Good</span>
            <select
              aria-label="Good to fetch"
              value={good}
              onChange={(e) => setGood(e.target.value as Good)}
            >
              {GOODS.map((g) => (
                <option key={g} value={g}>
                  {GOOD_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <PanelFoot>
            <button
              type="button"
              className="primary"
              onClick={() => onOrder({ kind: 'fetch', good })}
            >
              Fetch
            </button>
            <button
              type="button"
              aria-pressed={picking === 'fetchFrom'}
              onClick={() => toggle('fetchFrom', { good })}
            >
              Fetch from…
            </button>
          </PanelFoot>
          <p className="muted small">
            Each fetches as much as fits from the nearest storage or carriage holding it, or from
            the storage, stable or carriage picked on the map.
          </p>
        </section>
      )}
      {shown === 'relocate' && (
        <GroupRelocateBlock
          count={residents.length}
          choices={relocate?.choices ?? []}
          problem={relocate ? relocate.problem : 'your realm has no other city'}
          onRelocate={(cityId) => {
            setPanel(undefined)
            onOrder({ kind: 'relocate', cityId })
          }}
        />
      )}
      {shown === 'haul' && (
        <HaulBlock
          adult
          onRoute={false}
          picking={picking === 'haul'}
          onHaulTo={(haul) => toggle('haul', { haul })}
        />
      )}
      {shown === 'teach' && (
        <section className="inspector-block" aria-label="Teach">
          <SubjectPicker action="Teach" onPick={(subject) => onOrder({ kind: 'teach', subject })} />
          <p className="muted small">
            The first of them on each training ground teaches it there; one teacher per ground.
          </p>
        </section>
      )}
      {shown === 'breed' && (
        <section className="inspector-block" aria-label="Breed horses">
          {stables.length === 0 && (
            <p className="muted small">None of them stands in a finished stable.</p>
          )}
          {stables.map((s) => (
            <GroupBreed
              key={s.id}
              stable={s}
              horses={horsesIn(horses, s).filter((h) => h.realmId === realmId)}
              tick={tick ?? 0}
              onBreed={(horseIds) => onOrder({ kind: 'breed', stable: s, horseIds })}
            />
          ))}
          <p className="muted small">
            One of them standing there who isn’t breeding yet tends the two; pick two more for the
            next one.
          </p>
        </section>
      )}
    </>
  )
  const shownRow = rows.find((a) => a.id === shown)
  // The open order's panel as the shell shows it (`OrderPanel`).
  const shownSpec: OrderPanelSpec | undefined =
    shown && openPanel
      ? {
          title: panelTitle(shownRow?.label ?? ''),
          ...(shownRow ? { keyCap: shownRow.key } : {}),
          size: panelSize(shown),
          body: openPanel,
          onClose: closePanel,
        }
      : undefined
  // Build's tile picked: its menu opens where an order's panel does (`CommandBar`).
  const buildPanel = tab === 'orders' && buildAt && !picking && (
    <section className="inspector-block" aria-label="Build" ref={buildBlock}>
      {buildAt.site ? (
        <PanelFoot>
          <button
            type="button"
            className="primary"
            onClick={() =>
              onOrder({
                kind: 'build',
                building: buildAt.site!.kind,
                at: { x: buildAt.site!.x, y: buildAt.site!.y },
                ...(buildAt.site!.material === 'stone' ? { material: 'stone' as const } : {}),
              })
            }
          >
            All help build the {BUILDING_NAMES[buildAt.site.kind].toLowerCase()}
          </button>
          <CustomiseButton
            order={taskStart('build')}
            of="Build"
            give={() =>
              onOrder({
                kind: 'build',
                building: buildAt.site!.kind,
                at: { x: buildAt.site!.x, y: buildAt.site!.y },
                ...(buildAt.site!.material === 'stone' ? { material: 'stone' as const } : {}),
              })
            }
          />
        </PanelFoot>
      ) : (
        <BuildMenu
          // Another tile starts with nothing tapped.
          key={`${buildAt.x},${buildAt.y}`}
          node={buildAt.node}
          terrain={buildAt.terrain}
          buildProblem={buildAt.problem}
          onBuild={(kind, material) =>
            onOrder({
              kind: 'build',
              building: kind,
              at: { x: buildAt.x, y: buildAt.y },
              ...(material ? { material } : {}),
            })
          }
        />
      )}
      <p className="muted small">
        Each walks there; the first lays out the site and the others join it.
      </p>
    </section>
  )
  return (
    <CommandBar
      rel="own"
      title={card.title}
      lines={[
        card.names,
        <strong key="doing">{busy === 0 ? 'All idle' : `${busy} busy, ${idle} idle`}</strong>,
      ]}
      onClose={onClose}
      collapsed={collapsed}
      tall={tab === 'queue'}
      tabs={<CardTabs tabs={GROUP_TABS} labels={TAB_LABELS} tab={tab} onTab={showTab} />}
      panel={
        tab === 'orders' && ((shown && openPanel) || buildPanel)
          ? {
              ...(buildPanel
                ? {
                    title: 'Build',
                    note: `at ${buildAt!.x}, ${buildAt!.y}`,
                    size: panelSize('build'),
                  }
                : (shownSpec ?? { title: '' })),
              body: (
                <>
                  {shown && openPanel}
                  {buildPanel}
                </>
              ),
              onClose: closePanel,
            }
          : undefined
      }
      status={
        (orderError || picking || tab === 'orders') && (
          <p className="muted small" role="status">
            {orderError
              ? `Order turned down: ${orderError}`
              : picking
                ? `${GROUP_PICKING_HINTS[picking]} Tap a tile on the map.`
                : 'Right-click the map to walk them there. Hold Shift with any order to queue it.'}
          </p>
        )
      }
    >
      {tab === 'orders' && (
        <OrderGrid
          groups={rowGroups(rows, groupButtonGroup)}
          open={shown}
          onAction={act}
          panel={shownSpec}
          beside={(a) => {
            const task = GROUP_ROW_TASKS[a.id]
            return (
              task && (
                <CustomiseButton
                  order={taskStart(task)}
                  of={a.label}
                  disabled={a.disabled}
                  give={() => act(a)}
                  small
                />
              )
            )
          }}
        />
      )}
      {phone && buildPanel}
      {tab === 'queue' && planner}
      {tab === 'members' && (
        <ul className="sel-facts sel-group" aria-label="Selected residents">
          {card.rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)}>
                <strong>{r.name}</strong> ·{' '}
                {doingLine(r, {
                  scripts,
                  buildings,
                  residents: inSight,
                  horses,
                  cities,
                  arrives: arrivesIn?.(r),
                })}
              </button>
            </li>
          ))}
          {card.more > 0 && <li>and {card.more} more</li>}
        </ul>
      )}
      {tab === 'script' && (
        <div className="script-tab">
          <div className="script-col">
            <section className="sec script-runs" aria-label="Run script">
              <ul className="sel-facts" aria-label="Scripts they run">
                {scriptsRun(residents.map((r) => scriptName(r, scripts))).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <RunScript
                script={undefined}
                scripts={scripts}
                label="Script for all of them to run"
                customisable
                onRunScript={(scriptId) => onOrder({ kind: 'runScript', scriptId })}
              />
            </section>
          </div>
          <div className="script-col">
            <DefenceScript
              picked={groupDefenceScript(residents)}
              scripts={scripts}
              label="Defence script for all of them"
              onPick={(scriptId) => onOrder({ kind: 'setDefenceScript', scriptId })}
            />
            <AlarmScript
              picked={groupAlarmScript(residents)}
              scripts={scripts}
              label="Alarm script for all of them"
              onPick={(scriptId) => onOrder({ kind: 'setAlarmScript', scriptId })}
            />
          </div>
          {numberParams.length > 0 && (
            <div className="script-col">
              <section className="sec" aria-label="Script params">
                <div className="script-params">
                  <h3 className="px t16">Params</h3>
                  {numberParams.map(({ name, scriptIds, default: fallback }) => (
                    <div key={name} className="script-param">
                      <span className="script-param-name">
                        <strong className="mono">{name}</strong>{' '}
                        <span className="chip">number</span>
                      </span>
                      <span className="buttons">
                        <NumberField
                          name={name}
                          value={undefined}
                          fallback={fallback}
                          onSet={(v) =>
                            onOrder({ kind: 'setNumber', name, value: v ?? null, scriptIds })
                          }
                        />
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() =>
                            onOrder({ kind: 'setNumber', name, value: null, scriptIds })
                          }
                        >
                          Clear
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="muted small">
                  Sets it for each one running a script with it. Type a number and press Enter.
                </p>
                {foodHint && <p className="muted small">{foodHint}</p>}
              </section>
            </div>
          )}
        </div>
      )}
      {creative}
    </CommandBar>
  )
}

/** What the map waits for while a group order is being given. */
export type GroupPicking =
  | false
  | 'walk'
  | 'work'
  | 'build'
  | 'drive'
  | 'row'
  | 'haul'
  | 'roadFrom'
  | 'roadTo'
  | 'wallFrom'
  | 'wallTo'
  | 'tearDown'
  | 'storeAt'
  | 'fetchFrom'
  | 'attack'
  | 'climb'
  /** Creative mode: where to move them at once (`CONTEXT.md`: Creative mode). */
  | 'creativeMove'

/** What a group order picked on the map needs besides the tile: a haul route's goods, a good. */
export interface GroupPickWith {
  haul?: HaulSetup
  good?: Good
}

/** The tile a group is to build on, with the site there or what the Build menu needs of it. */
export interface GroupBuildTile {
  x: number
  y: number
  site: Building | undefined
  /** The resource node on this tile, if the Player knows one. */
  node: Pick<ResourceNode, 'kind'> | undefined
  /** The explored terrain beneath this tile, if known. */
  terrain: number | undefined
  /** Why a kind can't be laid out on this tile, as far as the Player knows. */
  problem: (kind: BuildingKind, material?: WallMaterial) => string | undefined
}

/** What picking a tile does for a group, said while the map waits for it. */
const GROUP_PICKING_HINTS: Record<Exclude<GroupPicking, false>, string> = {
  ...GROUP_HINTS,
  build: 'Where to build, or a site to join.',
}

/**
 * The selection card for one of the Player's residents (ADRs 0008, 0012; `CONTEXT.md`: Resident, Stats,
 * Skill, Resident card): a header that always shows who they are, what they do, their
 * health, hunger and what they carry, then one open tab. Orders lists the orders they can take
 * now, grouped by kind, as rows with keys; one that needs more (goods, a partner, a target, a
 * script) opens its panel. Queue, Stats and Script show the rest.
 */
export function ResidentCard({
  resident: r,
  arrivesIn,
  leaderId,
  cities,
  tick,
  picking,
  onWalkTo,
  orderError,
  pile,
  storage,
  onPickUp,
  onLoad,
  onDrop,
  building,
  road,
  terrain,
  carriageSite,
  node,
  onBuild,
  buildProblem,
  workers,
  holders,
  realmId,
  onWork,
  onFeedStable,
  onTrain,
  onExplore,
  onGather,
  onTeach,
  onTearDown,
  horses,
  onBreed,
  residents,
  onPair,
  others,
  mapSize,
  onAttack,
  onFeed,
  onEquip,
  walls,
  onClimb,
  carriage,
  boat,
  carriageTheirs,
  onDriveTo,
  driveOff,
  onDriveOff,
  hitchOff,
  onHitchOff,
  stealHorse,
  onStealHorse,
  onHaulTo,
  onRoadTo,
  onWallTo,
  onStop,
  onRally,
  zeal,
  horseToRide,
  carriageToBoard,
  boatToBoard,
  boatToRow,
  rowOff,
  onRowOff,
  onRowTo,
  onBoard,
  carriageToUnhitch,
  onUnhitch,
  toHitch,
  onHitch,
  onRide,
  scripts,
  buildings = [],
  lastSeen,
  waypoints,
  onRunScript,
  onSetDefenceScript,
  onSetAlarmScript,
  onEditScript,
  makeLeader,
  leaderName,
  onMakeLeader,
  heirName,
  onNameHeir,
  onClearHeir,
  relocate,
  onRelocate,
  rename,
  onRename,
  onClose,
  sections,
  onSections,
  scriptParams,
  scriptRun,
  scriptMemory,
  scriptLog,
  onStore,
  onEditQueue,
  queuePlan,
  onPlanQueue,
  onGivePlan,
  onDraftQueue,
  addStep,
  creative,
  collapsed = false,
}: {
  /** The condition of their gear comes for your own residents only (`CONTEXT.md`: Wear). */
  resident: Resident & { condition?: GearCondition }
  /** About how many ticks until they arrive where they walk, ride or drive (`arrivalTicks`). */
  arrivesIn?: (r: Resident) => number | undefined
  leaderId: string
  /**
   * The cities the Player knows, in sight or remembered: to name the city the resident lives in
   * and the one they relocate to.
   */
  cities: readonly Pick<City, 'id' | 'name'>[]
  tick: number
  /** The map is waiting for a tile to walk or drive to, or for a haul route's other stop. */
  picking: Picking
  /** Starts (or cancels) picking a tile to walk to. */
  onWalkTo: () => void
  /** A boat of their realm beside them, to load and unload (`CONTEXT.md`: Beside a vessel). */
  boat?: SeenVessel
  /** A carriage on the resident's tile, if one is in sight. */
  carriage: Carriage | undefined
  /** That carriage is another organization's, not theirs to drive or haul with. */
  carriageTheirs?: boolean
  /** Starts (or cancels) picking a tile to drive the carriage to. */
  onDriveTo: () => void
  /**
   * Another organization's carriage on the resident's tile, and why it can't be taken now, if so
   * (`CONTEXT.md`: Stealing a carriage or horse).
   */
  driveOff?: { problem: string | undefined }
  /** Starts (or cancels) picking a tile to drive that carriage off to. */
  onDriveOff?: () => void
  /**
   * The realm's carriage on their tile with no horse of the realm's and another organization's
   * horse to steal for it, and why it can't be taken now, if so.
   */
  hitchOff?: { problem: string | undefined }
  /** Starts (or cancels) picking a tile to drive that carriage to with that horse. */
  onHitchOff?: () => void
  /** Another organization's free horse on their tile, and why it can't be taken now, if so. */
  stealHorse?: { problem: string | undefined }
  /** Orders them to steal that horse by mounting it. */
  onStealHorse?: () => void
  /** Starts (or cancels) picking the other stop of a haul route carrying these goods. */
  onHaulTo: (setup: HaulSetup) => void
  /** Starts (or cancels) picking the two ends of a road to build along a line (Build line). */
  onRoadTo: () => void
  /** Starts (or cancels) picking the two ends of a wall to build along a line (Build line). */
  onWallTo: () => void
  /** Orders the resident to stop what they are doing. */
  onStop: () => void
  /** Orders the Player's Leader to rally the crew where they stand (`CONTEXT.md`: Rallying the crew). */
  onRally?: () => void
  /** The Player's Zeal (`CONTEXT.md`: Zeal), for the Leader's Rally the crew row. */
  zeal?: number
  /**
   * A horse of the realm on the resident's tile that pulls no carriage and nobody rides, if one is
   * in sight (`CONTEXT.md`: Riding).
   */
  horseToRide: { id: string } | undefined
  /** A carriage of the realm on the resident's tile (`CONTEXT.md`: Passenger), to board. */
  carriageToBoard: { id: string } | undefined
  /** A boat of the realm beside the resident with room (`CONTEXT.md`: Beside a vessel), to board. */
  boatToBoard?: { id: string; kind?: VesselKind } | undefined
  /** A boat of the realm the resident is aboard or beside, to row, and why they can't now (`CONTEXT.md`: Rowing). */
  boatToRow?: { id: string; problem?: string; ship?: boolean }
  /**
   * Another organization's boat (or nobody's) beside the resident, to row off, and why it can't be
   * taken now, if so (`CONTEXT.md`: Stealing a carriage or horse, its vessel part).
   */
  rowOff?: { problem: string | undefined }
  /** Starts (or cancels) picking a tile to row that boat off to. */
  onRowOff?: () => void
  /** Starts (or cancels) picking a tile to row the boat to. */
  onRowTo?: () => void
  /** Orders the resident to board that carriage, or with none to get off the one they are on. */
  onBoard: (carriageId?: string, asCrew?: boolean) => void
  /**
   * A carriage of the realm on the resident's tile with a horse hitched to it, to unhitch
   * (`CONTEXT.md`: Hitched horse).
   */
  carriageToUnhitch: { id: string } | undefined
  /** Orders the resident to unhitch the horse from that carriage. */
  onUnhitch: (carriageId: string) => void
  /** The carriage on the resident's tile and the horses that can pull it (`hitchChoice`). */
  toHitch: { carriageId: string; horses: SeenHorse[] } | undefined
  /** Orders the resident to hitch that horse to that carriage. */
  onHitch: (carriageId: string, horseId: string) => void
  /** Orders the resident to mount that horse, or with none to dismount. */
  onRide: (horseId?: string) => void
  /** The Player's script library, to pick a script to run. */
  scripts: ScriptSummary[]
  /** The buildings in sight, to name where the resident stores or fetches goods. */
  buildings?: Building[]
  /** The buildings remembered out of sight, to name queue steps acting there. */
  lastSeen?: Building[]
  /** The Player's waypoints, to name steps at one (`CONTEXT.md`: Waypoint). */
  waypoints?: readonly Waypoint[]
  /** Orders the resident to run a script (`CONTEXT.md`: Running a script). */
  onRunScript: (scriptId: number) => void
  /**
   * Picks the script one of the Player's own residents runs when struck, null for Defend
   * (`CONTEXT.md`: Defence script); without it the card offers no picker.
   */
  onSetDefenceScript?: (scriptId: number | null) => void
  /**
   * Picks what one of the Player's own residents runs when an alarm reaches them, `none` for
   * nothing, null for Alarm (default) (`CONTEXT.md`: Alarm script).
   */
  onSetAlarmScript?: (scriptId: number | 'none' | null) => void
  /** Opens a script in the library, such as the one the resident's task runs. */
  onEditScript: (scriptId: number) => void
  /** Why the last order was turned down, if it was. */
  orderError: string | undefined
  /** Goods lying on the resident's tile, if any are in sight. */
  pile: Pile | undefined
  /** The storage on the resident's tile, if there is one: a storage, or a stable's. */
  storage: Building | undefined
  /** Orders the resident to take goods from a spot on their tile. */
  onPickUp: (from: GoodsSpot, goods: Stock) => void
  /**
   * Moves goods straight between the haven's storage and the ship docked there, onto the ship or
   * with `unload` off it (`CONTEXT.md`: Docked).
   */
  onLoad?: (vesselId: string, goods: Stock, unload: boolean) => void
  /** Orders the resident to put carried goods at a spot on their tile. */
  onDrop: (to: GoodsSpot, goods: Stock) => void
  /** The building or construction site on the resident's tile, if one is in sight. */
  building: Building | undefined
  /** The road or road site on the resident's tile, if one is in sight; it may share the tile. */
  road: Building | undefined
  /** The explored terrain beneath the resident's tile, if known: a road on Mountain takes more work. */
  terrain?: number
  /** The carriage site on the resident's tile, if one is in sight; it may share a stable's tile. */
  carriageSite: Building | undefined
  /** The resource node on the resident's tile, if the Player knows of one. */
  node: KnownNode | undefined
  /** Orders the resident to build on their tile, or to join the site there. */
  onBuild: (kind: BuildingKind, material?: WallMaterial) => void
  /** Why a kind can't be laid out from the resident's tile, as far as the Player knows. */
  buildProblem?: (kind: BuildingKind, material?: WallMaterial) => string | undefined
  /** Residents in sight working the building on the resident's tile. */
  workers: number
  /** Realms whose residents in sight work it: who holds it (`CONTEXT.md`: Holding a workplace). */
  holders: string[]
  /** The Player's realm. */
  realmId: string
  /** Orders the resident to work the workplace on their tile, making `makes` at a smithy. */
  onWork: (makes?: Good | typeof MEND) => void
  /** Gives the resident the Feed the stable task for the stable they stand in. */
  onFeedStable: (stableId: string) => void
  /** Gives the resident the Train task for the training ground they stand on. */
  onTrain: (groundId: string) => void
  /** Gives the resident the Explore task. */
  onExplore: () => void
  /** Gives the resident the Gather task, its form first (`CONTEXT.md`: Gather). */
  onGather: () => void
  /** Orders the resident to teach `subject` at the training ground they stand on. */
  onTeach: (groundId: string, subject: TrainingSubject) => void
  /** Orders the resident to tear down the building or site on their tile. */
  onTearDown: (buildingId: string) => void
  /** Horses in sight, to pick two in the stable on the resident's tile to breed. */
  horses: SeenHorse[]
  /** Orders the resident to breed two horses at the stable on their tile. */
  onBreed: (stableId: string, horseIds: [string, string]) => void
  /** The Player's residents in sight, to pick a partner from. */
  residents: Resident[]
  /** Orders the resident to pair with another of the Player's residents. */
  onPair: (partnerId: string) => void
  /** Residents of other realms, or of none, in sight: whom the resident can attack. */
  others: SeenResident[]
  /** Tiles along each side of the map, to tell who is nearest. */
  mapSize: number
  /** Orders the resident to attack another realm's resident, or to break a wall or gate. */
  onAttack: (targetId: string) => void
  /** Orders the resident to Feed someone Down or a horse next to them. */
  onFeed?: (targetId: string, units: number) => void
  /**
   * Orders the resident to swap a good they carry into a slot, or with `null` to take the slot's
   * item off (`CONTEXT.md`: Equipment).
   */
  onEquip?: (slot: SlotView['slot'], good: Good | null) => void
  /** Finished walls and gates in sight of other realms' cities, or of none. */
  walls: Building[]
  /** Orders the resident to climb over a wall or gate next to them. */
  onClimb: (wallId: string) => void
  /**
   * For one of the Player's own residents who isn't their Leader: why they can't be made Leader
   * now, if they can't (`makeLeaderProblem`). Undefined for the Leader and others' residents.
   */
  makeLeader:
    | { problem: string | undefined; heir?: { problem: string | undefined; named: boolean } }
    | undefined
  /** The Player's Leader's name, for the handover's confirm. */
  leaderName: string | undefined
  /** Orders the Leader to hand the realm over to this resident (`CONTEXT.md`: Leader handover). */
  onMakeLeader: () => void
  /** The name of the realm's heir, if it has one other than this resident (`CONTEXT.md`: Heir). */
  heirName?: string
  /** Names this resident the realm's heir (`CONTEXT.md`: Heir). */
  onNameHeir?: () => void
  /** Clears the realm's heir, this resident (`CONTEXT.md`: Heir). */
  onClearHeir?: () => void
  /**
   * For one of the Player's own residents: the realm's other cities to relocate them to
   * (`relocateChoices`) and why they can't be told to at all, if they can't
   * (`CONTEXT.md`: Relocate). Undefined for others' residents.
   */
  relocate?: { choices: RelocateChoice[]; problem: string | undefined }
  /** Orders the resident to relocate to another city of the realm (`CONTEXT.md`: Relocate). */
  onRelocate?: (cityId: string) => void
  /**
   * For one of the Player's own residents: whether renaming them needs a realm name too (the
   * Leader of an unnamed realm). Undefined for others' residents, who can't be renamed.
   */
  rename: { needsRealmName: boolean } | undefined
  /** Renames the resident (`CONTEXT.md`: Renaming a resident), naming the realm when it asks. */
  onRename: (name: string, realmName?: string) => void
  /** Closes the card. */
  onClose: () => void
  /** The Creative section, for an admin on a creative server (`CreativeResidentActions`). */
  creative?: ReactNode
  /** The open tab and panel, kept by the caller so they stay from one selected unit to the next. */
  sections: CardSections<ActionId>
  onSections: (sections: CardSections<ActionId>) => void
  /** The fields for the params of the script they run (`ScriptParamFields`), if any. */
  scriptParams?: ReactNode
  /** How the script they run last ran (`ScriptRunInfo`), for the Player running it. */
  scriptRun?: ReactNode
  /** The memory of the script they run (`ScriptMemoryTree`), for the Player running it. */
  scriptMemory?: ReactNode
  /** Their script log (`ScriptLog`), for the Player owning them, running a script or not. */
  scriptLog?: ReactNode
  /** Orders the resident to store what they carry at the nearest storage (`STORE_ALL`). */
  onStore?: () => void
  /**
   * Edits the resident's queue to these steps, and loop when given (`CONTEXT.md`: Queue); for a
   * resident with no queue, or with a repeat block among them, opens a draft of them instead
   * (`CONTEXT.md`: Queue draft).
   */
  onEditQueue?: (items: PlanItem[], loop?: boolean) => void
  /** The resident's queue draft waiting for Start queue, if one is open. */
  queuePlan?: QueuePlan
  /** Edits or discards (undefined) that draft. */
  onPlanQueue?: (plan: QueuePlan | undefined) => void
  /** Start queue: gives the resident the draft, its repeat blocks as they are, as their queue. */
  onGivePlan?: () => void
  /** Edit as draft: copies the running queue into a draft; the queue runs on. */
  onDraftQueue?: () => void
  /** The queue planner's Add step (`AddStep`), under the queue. */
  addStep?: ReactNode
  /** Shrunk to its header while the map waits for a target (ADR 0012: pick mode). */
  collapsed?: boolean
}) {
  const setPanel = (panel: ActionId | undefined) => onSections({ ...sections, panel })
  const age = Math.floor(ageInYears(r, tick))
  const skills = (Object.keys(SKILL_LABELS) as SkillName[]).filter((s) => (r.skills[s] ?? 0) > 0)
  const carried = goodsIn(r.carried)
  const child = !canWork(r, tick)
  // Children pick up and put down only Food (`CONTEXT.md`: Child).
  const refused = (good: Good) => !canHandle(r, tick, [good])
  const childWhy = child ? 'Children handle Food only.' : undefined
  const family = familyLine(r, residents, tick)
  // A queue the game gave under a name (the stable hand's "Farm and feed") goes into the saved
  // queues once (`CONTEXT.md`: Starting city, Saved queue).
  const given = r.owner === realmId && r.queue?.name ? r.queue : undefined
  useEffect(() => {
    if (given?.name && realmId) {
      keepGivenQueue(browserStorage(), realmId, given.name, planOf(given).items, Date.now())
    }
    // Once a name, not every tick: the steps are read when it first shows.
  }, [given?.name, realmId])
  // Only the owning Player picks it (`CONTEXT.md`: Defence script).
  const defenceScript = onSetDefenceScript && r.owner === realmId && (
    <DefenceScript
      picked={r.defenceScriptId ?? null}
      scripts={scripts}
      onPick={onSetDefenceScript}
    />
  )
  // Only the owning Player picks it (`CONTEXT.md`: Alarm script).
  const alarmScript = onSetAlarmScript && r.owner === realmId && (
    <AlarmScript picked={r.alarmScriptId ?? null} scripts={scripts} onPick={onSetAlarmScript} />
  )
  const grown = grownIn(r, tick)
  const at: OnSite = { residents, mapSize }
  const ground: GoodsSpot = { kind: 'ground' }
  const inStorage: GoodsSpot = { kind: 'storage', storageId: storage?.id ?? '' }
  const site = building?.site ? building : undefined
  const atSite: GoodsSpot = { kind: 'site', siteId: site?.id ?? '' }
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage?.id ?? '' }
  const inBoat: GoodsSpot = { kind: 'vessel', vesselId: boat?.id ?? '' }
  const needed = site ? materialsNeeded(site) : {}
  const roadSite = road?.site ? road : undefined
  const atRoadSite: GoodsSpot = { kind: 'site', siteId: roadSite?.id ?? '' }
  const roadNeeded = roadSite ? materialsNeeded(roadSite) : {}
  // Anyone in sight Down on or next to their tile, and any horse there that isn't full, of any
  // realm, to Feed (`CONTEXT.md`: Reviving, Feeding a horse).
  const toFeedNear = [
    ...[...residents, ...others].filter(
      (x) => x.id !== r.id && isDown(x) && inContact(mapSize, r, x),
    ),
    ...horsesInNeed(horses.filter((h) => inContact(mapSize, r, h))).map((h) => ({
      id: h.id,
      name: h.name,
      horse: true as const,
      ...(isDown(h) ? { down: true as const } : {}),
    })),
  ]
  const atCarriageSite: GoodsSpot = { kind: 'site', siteId: carriageSite?.id ?? '' }
  const carriageNeeded = carriageSite ? materialsNeeded(carriageSite) : {}
  // Anyone Down on their tile, whose goods they can take as from a pile (`CONTEXT.md`: Down).
  const downHere = [...residents, ...others].filter(
    (d) =>
      d.id !== r.id && isDown(d) && d.x === r.x && d.y === r.y && goodsIn(d.carried).length > 0,
  )
  const { actions, missing } = residentOrders({
    adult: !child,
    busy: !!(r.order || r.script),
    inCity: r.cityId !== null,
    carriage,
    carriageHorseDown: horses.some((h) => h.id === carriage?.horseId && isDown(h)),
    ...(carriageTheirs ? { carriageTheirs } : {}),
    ...(driveOff ? { driveOff } : {}),
    ...(rowOff ? { rowOff } : {}),
    ...(hitchOff ? { hitchOff } : {}),
    ...(stealHorse ? { stealHorse } : {}),
    pile,
    storage,
    building,
    road,
    carriageSite,
    node,
    othersInSight: others.length,
    wallsInSight: walls.length,
    picking,
    makeLeader,
    ...(relocate ? { relocate: { problem: relocate.problem } } : {}),
    renamable: !!rename,
    // Only the Player's own Leader rallies the crew (`CONTEXT.md`: Rallying the crew).
    ...(r.id === leaderId && r.owner === realmId && zeal !== undefined
      ? { rally: { problem: rallyProblem(building, zeal, r.order) } }
      : {}),
    riding: r.riding !== undefined,
    horseToRide: !!horseToRide,
    aboard: r.aboard !== undefined,
    driving: r.order?.kind === 'drive' || r.order?.kind === 'haul',
    carriageToBoard: !!carriageToBoard,
    boatToBoard: !!boatToBoard,
    shipToBoard: boatToBoard?.kind === 'ship',
    ...(boatToRow
      ? {
          boatToRow: {
            ...(boatToRow.problem ? { problem: boatToRow.problem } : {}),
            ...(boatToRow.ship ? { ship: true } : {}),
          },
        }
      : {}),
    carriageToUnhitch: !!carriageToUnhitch,
    horseToHitch: !!toHitch,
    carrying: !!r.carrying,
    carries: carried.length > 0,
    down: isDown(r),
    toFeedNear: toFeedNear.length,
    carriesFood: (r.carried.food ?? 0) > 0,
    downCarrying: downHere.map((d) => d.carried),
  })
  // Each row keeps its slot while the card is open (ADR 0019).
  const rows = useKeptRows(actions, missing, orderGroupOf)
  const tab = sections.tab
  const shown = actions.some((a) => a.id === sections.panel) ? sections.panel : undefined
  useEscapeClosesPanel(tab === 'orders' && shown !== undefined, () => setPanel(undefined))
  const act = (a: CardAction) => {
    // An order's key opens its panel from any tab, on the Orders tab.
    if (a.opens) {
      const open = tab === 'orders' && shown === a.id ? undefined : a.id
      return onSections({ ...sections, tab: 'orders', panel: open })
    }
    if (a.id === 'walk') onWalkTo()
    if (a.id === 'drive') onDriveTo()
    if (a.id === 'row') onRowTo?.()
    if (a.id === 'driveOff') onDriveOff?.()
    if (a.id === 'rowOff') onRowOff?.()
    if (a.id === 'hitchOff') onHitchOff?.()
    if (a.id === 'stealHorse') onStealHorse?.()
    if (a.id === 'roadTo') onRoadTo()
    if (a.id === 'wallTo') onWallTo()
    if (a.id === 'stop') onStop()
    if (a.id === 'rally') onRally?.()
    if (a.id === 'ride') onRide(r.riding === undefined ? horseToRide?.id : undefined)
    if (a.id === 'unhitch' && carriageToUnhitch) onUnhitch(carriageToUnhitch.id)
    if (a.id === 'board')
      onBoard(r.aboard === undefined ? (carriageToBoard ?? boatToBoard)?.id : undefined)
    if (a.id === 'feedStable' && building) onFeedStable(building.id)
    if (a.id === 'train' && building) onTrain(building.id)
    if (a.id === 'explore') onExplore()
    if (a.id === 'gather') onGather()
  }
  useActionKeys(rows, act)
  // Run script later starts on the script they were last seen running (`runScriptPick`).
  const running = r.script?.scriptId
  useEffect(() => {
    if (running) rememberLastScript(r.id, running)
  }, [r.id, running])
  const ridden = riddenHorseLine(r, horses, tick)
  // The script they run, or what they go on with after their defence script, under Doing.
  const under =
    interruptedLine(r, { scripts, buildings, residents, horses }) ?? scriptLine(r, scripts)
  // The city they live in, or none (`CONTEXT.md`: Homeless).
  const home =
    r.cityId === null
      ? 'Homeless'
      : (cities.find((c) => c.id === r.cityId)?.name ?? 'a city out of sight')
  // The open order's panel, above the command bar or on a phone under its order (`CommandBar`).
  const openPanel = shown && (
    <div className="sel-panel">
      {shown === 'haul' && (carriage || boatToRow) && (
        <HaulBlock
          adult={!child}
          onRoute={r.order?.kind === 'haul' || r.order?.kind === 'haulByWater'}
          byWater={!carriage}
          ship={!carriage && !!boatToRow?.ship}
          picking={picking === 'haul'}
          onHaulTo={onHaulTo}
        />
      )}
      {shown === 'work' && (
        <WorkBlock
          resident={r}
          tick={tick}
          building={building}
          node={node}
          workers={workers}
          holders={holders}
          realmId={realmId}
          onWork={onWork}
        />
      )}
      {shown === 'gather' && (
        // Gather's own form picks the good (`CONTEXT.md`: Gather): the panel says what it does and
        // opens that form.
        <section className="inspector-block" aria-label="Gather">
          <p className="small">
            Wood or Food from a Forest tile, Stone from a Hills tile, by hand: they walk to the
            nearest tile that gives it and isn’t picked over, and gather until their hands are full.
          </p>
          <p className="muted small">The form picks the good and where the load goes.</p>
          <PanelFoot>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setPanel(undefined)
                onGather()
              }}
            >
              Gather…
            </button>
          </PanelFoot>
        </section>
      )}
      {shown === 'build' && (
        <>
          {[building, carriageSite, road].map(
            (site) =>
              site?.site && (
                <SiteBlock
                  key={site.id}
                  resident={r}
                  tick={tick}
                  site={site}
                  terrain={terrain}
                  at={at}
                  onBuild={onBuild}
                />
              ),
          )}
          <section className="inspector-block" aria-label="Build">
            <BuildMenu
              key={r.id}
              node={node}
              terrain={terrain}
              buildProblem={buildProblem ?? (() => undefined)}
              blocked={!canWork(r, tick)}
              onBuild={onBuild}
            />
          </section>
        </>
      )}
      {shown === 'tearDown' && (
        <>
          <TearDownBlock
            resident={r}
            tick={tick}
            building={building}
            at={at}
            onTearDown={onTearDown}
          />
          <TearDownBlock
            resident={r}
            tick={tick}
            building={carriageSite}
            at={at}
            onTearDown={onTearDown}
          />
          <TearDownBlock
            resident={r}
            tick={tick}
            building={road}
            at={{ ...at, terrain }}
            onTearDown={onTearDown}
          />
        </>
      )}
      {shown === 'teach' && building && (
        <TeachBlock
          resident={r}
          ground={building}
          residents={residents}
          mapSize={mapSize}
          onTeach={(subject) => onTeach(building.id, subject)}
        />
      )}
      {shown === 'board' && boatToBoard && (
        <section className="inspector-block" aria-label="Board ship">
          <p className="muted small">
            Crew sail the ship and take no room; a passenger rides along and counts against its
            load.
          </p>
          <PanelFoot>
            <button
              type="button"
              className="primary"
              disabled={child}
              title={child ? 'children can’t crew a ship' : undefined}
              onClick={() => onBoard(boatToBoard.id, true)}
            >
              As crew
            </button>
            <button type="button" onClick={() => onBoard(boatToBoard.id, false)}>
              As passenger
            </button>
          </PanelFoot>
          {child && <p className="muted small">A child can’t crew a ship.</p>}
        </section>
      )}
      {shown === 'hitch' && toHitch && (
        <HitchBlock
          key={r.id}
          horses={toHitch.horses}
          tick={tick}
          onHitch={(horseId) => onHitch(toHitch.carriageId, horseId)}
        />
      )}
      {shown === 'breed' && building && (
        <BreedBlock
          resident={r}
          tick={tick}
          stable={building}
          horses={horses}
          residents={residents}
          realmId={realmId}
          onBreed={onBreed}
        />
      )}
      {shown === 'goods' && (
        <>
          <section className="inspector-block" aria-label="Equipped">
            <div className="panel-head">
              <h3>Equipped</h3>
              {r.order?.kind === 'equip' && (
                <span className="muted small">
                  {r.order.good ? `Putting on ${GOOD_LABELS[r.order.good]}…` : 'Taking off…'}
                </span>
              )}
            </div>
            <ul className="equipment-slots">
              {equipmentSlots(r.equipped, r.condition).map((s) => {
                const choices = onEquip ? swapChoices(s.slot, r.carried, r.equipped) : []
                const worn = r.equipped?.[s.slot]
                return (
                  <li key={s.slot}>
                    <span className="equipment-icon">{worn && <GoodIcon good={worn} />}</span>
                    <span className="grow">
                      <strong>{s.label}</strong> ·{' '}
                      <span className={s.item ? undefined : 'muted'}>{s.item ?? 'empty'}</span>
                      {s.condition && <span className="muted small"> ({s.condition})</span>}
                    </span>
                    {choices.length > 0 && (
                      <select
                        aria-label={`Swap into the ${s.label.toLowerCase()} slot`}
                        value=""
                        onChange={(e) => onEquip?.(s.slot, e.target.value as Good)}
                      >
                        <option value="">{s.item ? 'Swap for…' : 'Put on…'}</option>
                        {choices.map((c) => (
                          <option key={c.good} value={c.good}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {onEquip && s.item && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => onEquip(s.slot, null)}
                      >
                        Take off
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {onEquip && (
              <p className="muted small">
                Swapping or taking off takes {EQUIP_TICKS} ticks, and they strike no blows
                meanwhile. What comes off stays carried.
              </p>
            )}
          </section>
          <section className="inspector-block" aria-label="Carrying">
            <div className="panel-head">
              <h3>Carrying</h3>
              {onStore && carried.length > 0 && (
                <button type="button" className="btn sm" onClick={onStore}>
                  Store all
                </button>
              )}
            </div>
            {onStore && carried.length > 0 && (
              <p className="muted small">
                Store all: at the nearest storage, keeping their own Food.
              </p>
            )}
            {carried.length === 0 && (
              <p className="muted small">
                Nothing. Residents eat only what they carry; at home they take meals from storage.
              </p>
            )}
            <GoodsPick
              label="Carrying"
              goods={carried}
              byDefault={putAwayUnits}
              refused={refused}
              refusedWhy={childWhy}
              actions={(good) => [
                { label: 'Drop', spot: ground },
                ...(storage ? [{ label: 'Store', spot: inStorage }] : []),
                ...((needed[good] ?? 0) > 0 ? [{ label: 'Deliver', spot: atSite }] : []),
                ...((carriageNeeded[good] ?? 0) > 0
                  ? [{ label: 'Deliver to carriage site', spot: atCarriageSite }]
                  : []),
                ...((roadNeeded[good] ?? 0) > 0
                  ? [{ label: 'Deliver to road', spot: atRoadSite }]
                  : []),
                ...(carriage ? [{ label: 'Load', spot: onCarriage }] : []),
                ...(boat ? [{ label: 'Load into boat', spot: inBoat }] : []),
              ]}
              onAct={onDrop}
            />
          </section>
          {(pile ||
            storage ||
            site ||
            carriageSite ||
            roadSite ||
            carriage ||
            boat ||
            downHere.length > 0) && (
            <section className="inspector-block" aria-label="On this tile">
              <div className="panel-head">
                <h3>Here</h3>
                <span className="small muted">takes as much as fits</span>
              </div>
              <TileGoods
                title="On the ground"
                stock={pile?.goods}
                spot={ground}
                onPickUp={onPickUp}
                refused={refused}
                refusedWhy={childWhy}
              />
              {storage && (
                <TileGoods
                  title={
                    storage.kind === 'stable' || storage.kind === 'haven'
                      ? `In the ${storage.kind}`
                      : 'In the storage'
                  }
                  stock={storage.stock}
                  spot={inStorage}
                  onPickUp={onPickUp}
                  refused={refused}
                  refusedWhy={childWhy}
                />
              )}
              {site && (
                <TileGoods
                  title="Delivered to the site"
                  stock={site.site!.delivered}
                  spot={atSite}
                  onPickUp={onPickUp}
                  refused={refused}
                  refusedWhy={childWhy}
                />
              )}
              {carriageSite && (
                <TileGoods
                  title="Delivered to the carriage site"
                  stock={carriageSite.site!.delivered}
                  spot={atCarriageSite}
                  onPickUp={onPickUp}
                  refused={refused}
                  refusedWhy={childWhy}
                />
              )}
              {roadSite && (
                <TileGoods
                  title="Delivered to the road site"
                  stock={roadSite.site!.delivered}
                  spot={atRoadSite}
                  onPickUp={onPickUp}
                  refused={refused}
                  refusedWhy={childWhy}
                />
              )}
              {carriage && (
                <TileGoods
                  title={`On the carriage · ${kg(stockWeight(carriage.load))} / ${kg(CARRIAGE_CAPACITY)}${carriage.horseId ? '' : ' · no horse hitched'}`}
                  stock={carriage.load}
                  spot={onCarriage}
                  onPickUp={onPickUp}
                  refused={refused}
                  refusedWhy={childWhy}
                />
              )}
              {boat?.load && (
                // From beside it, a ship's from its haven; its passengers count against what it
                // holds (`CONTEXT.md`: Beside a vessel, Docked).
                <TileGoods
                  title={`In the ${vesselName(boat)} · ${kg(stockWeight(boat.load) + boat.passengerIds.length * PASSENGER_WEIGHT)} / ${kg(vesselCapacity(boat.kind))}`}
                  stock={boat.load}
                  spot={inBoat}
                  onPickUp={onPickUp}
                  refused={refused}
                  refusedWhy={childWhy}
                />
              )}
              {storage && boat?.kind === 'ship' && storage.id === boat.dockedAt && onLoad && (
                // Straight between the haven's storage and the ship (`CONTEXT.md`: Docked).
                <>
                  <TileGoods
                    title="From the haven onto the ship"
                    stock={storage.stock}
                    spot={inStorage}
                    label="Load ship"
                    onPickUp={(_, goods) => onLoad(boat.id, goods, false)}
                    refused={refused}
                    refusedWhy={childWhy}
                  />
                  <TileGoods
                    title="From the ship into the haven"
                    stock={boat.load}
                    spot={inBoat}
                    label="Unload"
                    onPickUp={(_, goods) => onLoad(boat.id, goods, true)}
                    refused={refused}
                    refusedWhy={childWhy}
                  />
                </>
              )}
              {downHere.map((d) => (
                <TileGoods
                  key={d.id}
                  title={`Carried by ${d.name}, Down`}
                  stock={d.carried}
                  spot={{ kind: 'resident', residentId: d.id }}
                  onPickUp={onPickUp}
                  refused={refused}
                  refusedWhy={childWhy}
                />
              ))}
            </section>
          )}
        </>
      )}
      {shown === 'pair' && (
        <PairBlock resident={r} tick={tick} residents={residents} onPair={onPair} />
      )}
      {shown === 'feed' && onFeed && (
        <FeedBlock
          titled={false}
          targets={toFeedNear}
          food={r.carried.food ?? 0}
          onFeed={(targetId, units) => {
            setPanel(undefined)
            onFeed(targetId, units)
          }}
        />
      )}
      {shown === 'attack' && (
        <AttackBlock
          resident={r}
          others={others}
          walls={walls}
          mapSize={mapSize}
          onAttack={onAttack}
        />
      )}
      {shown === 'walls' && (
        <WallsBlock
          resident={r}
          walls={walls}
          mapSize={mapSize}
          onBreak={onAttack}
          onClimb={onClimb}
        />
      )}
      {shown === 'script' && (
        <section className="inspector-block" aria-label="Run script">
          <RunScript
            script={r.script}
            scripts={scripts}
            onRunScript={onRunScript}
            of={r.id}
            customisable
          />
        </section>
      )}
      {shown === 'relocate' && relocate && onRelocate && (
        <RelocateBlock
          resident={r}
          choices={relocate.choices}
          onRelocate={(cityId) => {
            setPanel(undefined)
            onRelocate(cityId)
          }}
        />
      )}
      {shown === 'makeLeader' && makeLeader && (
        <section className="inspector-block" aria-label="Make Leader">
          {makeLeader.heir && (
            <div className="panel-head">
              <h3>Make Leader</h3>
            </div>
          )}
          <p className="small">
            Hand your realm to {r.name}? {leaderName ?? 'Your Leader'} stays on as an ordinary
            resident.
          </p>
          <PanelFoot>
            <button
              type="button"
              className="btn gold"
              disabled={!!makeLeader.problem}
              onClick={() => {
                setPanel(undefined)
                onMakeLeader()
              }}
            >
              Make {r.name} Leader
            </button>
            <button type="button" onClick={() => setPanel(undefined)}>
              Cancel
            </button>
          </PanelFoot>
          {makeLeader.problem && <p className="muted small">{makeLeader.problem}.</p>}
        </section>
      )}
      {shown === 'makeLeader' && makeLeader?.heir && (
        <section className="inspector-block" aria-label="Heir">
          <div className="panel-head">
            <h3>Heir</h3>
          </div>
          {makeLeader.heir.named ? (
            <>
              <p className="small">{r.name} is your realm’s heir.</p>
              <PanelFoot>
                <button
                  type="button"
                  onClick={() => {
                    setPanel(undefined)
                    onClearHeir?.()
                  }}
                >
                  Clear heir
                </button>
              </PanelFoot>
            </>
          ) : (
            <>
              <p className="small">
                Name {r.name} your realm’s heir, to carry it on
                {heirName ? ` in place of ${heirName}` : ''}? Free and at once, from anywhere.
              </p>
              <PanelFoot>
                <button
                  type="button"
                  className="primary"
                  disabled={!!makeLeader.heir.problem}
                  onClick={() => {
                    setPanel(undefined)
                    onNameHeir?.()
                  }}
                >
                  Name {r.name} heir
                </button>
              </PanelFoot>
              {makeLeader.heir.problem && <p className="muted small">{makeLeader.heir.problem}.</p>}
            </>
          )}
        </section>
      )}
      {shown === 'rename' && rename && (
        <RenameBlock
          // Starts again from the new name once the rename comes back.
          key={r.name}
          resident={r}
          needsRealmName={rename.needsRealmName}
          onRename={(name, realmName) => {
            setPanel(undefined)
            onRename(name, realmName)
          }}
        />
      )}
    </div>
  )
  const shownRow = rows.find((a) => a.id === shown)
  const weapon = bestWeapon(r)
  // What the panel's header says beside its title.
  const notes: Partial<Record<ActionId, ReactNode>> = {
    goods: (
      <span className="mono">{carryLine(stockWeight(r.carried), carryCapacity(r, tick))}</span>
    ),
    feed: `${r.carried.food ?? 0} Food in hand`,
    hitch: toHitch && `${toHitch.horses.length} free here`,
    relocate: `from ${home}`,
    rename: 'free, at once',
    walls: 'break or climb',
    attack: weapon ? `fights with a ${GOOD_LABELS[weapon].toLowerCase()}` : 'unarmed',
    work: building && !building.site && MAX_WORKERS[building.kind] !== undefined && (
      <span className="mono">
        {workers} / {MAX_WORKERS[building.kind]} workers
      </span>
    ),
    teach: shown === 'teach' && building && (
      <span className="mono">
        {traineesOf(building, residents, mapSize).length} / {TRAINING_GROUND_MAX_TRAINEES} trainees
      </span>
    ),
    breed:
      shown === 'breed' &&
      building &&
      `${horsesIn(horses, building).filter((h) => h.realmId === realmId).length} of yours here`,
  }
  const panelSpec: OrderPanelSpec | undefined =
    tab === 'orders' && shown && openPanel
      ? {
          title:
            shown === 'makeLeader' && makeLeader?.heir
              ? 'Leader and heir'
              : panelTitle(shownRow?.label ?? ''),
          note: notes[shown] || undefined,
          ...(shownRow ? { keyCap: shownRow.key } : {}),
          size: panelSize(shown),
          body: openPanel,
          onClose: () => setPanel(undefined),
        }
      : undefined
  return (
    <CommandBar
      rel={r.owner === realmId ? 'own' : 'alliance'}
      title={r.name}
      badge={r.id === leaderId ? 'Leader' : makeLeader?.heir?.named ? 'Heir' : undefined}
      lines={[
        <strong key="doing">
          {doingLine(r, {
            scripts,
            buildings,
            residents,
            horses,
            cities,
            arrives: arrivesIn?.(r),
            tick,
          })}
        </strong>,
        ...(under
          ? [
              <span key="under" className="muted">
                {under}
              </span>,
            ]
          : []),
      ]}
      head={
        <>
          <div className="vitals">
            <Meter
              label="Health"
              value={`${Math.round(r.health)} / ${MAX_HEALTH}`}
              share={r.health / MAX_HEALTH}
            />
            <Meter
              label="Hunger"
              value={r.hunger / MAX_HUNGER < 0.25 ? 'hungry' : `${pct(r.hunger / MAX_HUNGER)} fed`}
              share={r.hunger / MAX_HUNGER}
            />
          </div>
          <div className="carried-line">
            <GoodsGrid label="Carried" {...carriedItems(r.carried)} />
            <span className="mono">
              {carryLine(stockWeight(r.carried), carryCapacity(r, tick))}
            </span>
          </div>
          <div className="sel-line muted">{equipmentLine(r.equipped, r.condition)}</div>
          {ridden && <div className="sel-line">{ridden}</div>}
        </>
      }
      onClose={onClose}
      collapsed={collapsed}
      tall={tab === 'queue'}
      tabs={
        <div className="tabs sel-tabs" role="tablist" aria-label="Card">
          {CARD_TABS.map((t) => (
            <button
              type="button"
              className="tab"
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => onSections({ ...sections, tab: t })}
            >
              {CARD_TAB_LABELS[t]}
            </button>
          ))}
        </div>
      }
      panel={panelSpec}
      status={
        (orderError || tab === 'orders') && (
          <p className="muted small" role="status">
            {orderError
              ? `Order turned down: ${orderError}`
              : isDown(r)
                ? `${DOWN_NO_ORDERS}.`
                : 'Right-click the map to walk there. Hold Shift with any order to queue it.'}
          </p>
        )
      }
    >
      {tab === 'orders' && (
        <OrderGrid
          groups={rowGroups(rows, orderGroupOf)}
          open={shown}
          onAction={act}
          panel={panelSpec}
          beside={(a) => {
            const task = ROW_TASKS[a.id]
            return (
              task && (
                <CustomiseButton
                  order={taskStart(task)}
                  of={a.label}
                  disabled={a.disabled}
                  give={() => act(a)}
                  small
                />
              )
            )
          }}
        />
      )}
      {tab === 'queue' &&
        (queuePlan && onPlanQueue ? (
          <QueueBlock
            title="Draft"
            mark={
              <>
                <span className="chip y">Draft, not started</span>
                {r.queue && (
                  <span className="small muted">the queue runs on until you start it.</span>
                )}
              </>
            }
            queue={queuePlan}
            currentId={r.queue?.current}
            doing={doingLine(r, {
              scripts,
              buildings,
              residents,
              horses,
              cities,
              arrives: arrivesIn?.(r),
            })}
            scripts={scripts}
            buildings={buildings}
            lastSeen={lastSeen}
            waypoints={waypoints}
            cities={cities}
            onEdit={(items, loop) => onPlanQueue(editPlan(queuePlan, items, loop))}
            realm={realmId}
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
        ) : r.queue && onEditQueue ? (
          <QueueBlock
            title={r.queue.name ?? 'Queue'}
            queue={planOf(r.queue)}
            currentId={r.queue.current}
            rounds={roundsOf(r.queue)}
            branches={branchesOf(r.queue)}
            running
            doing={doingLine(r, {
              scripts,
              buildings,
              residents,
              horses,
              cities,
              arrives: arrivesIn?.(r),
            })}
            scripts={scripts}
            buildings={buildings}
            lastSeen={lastSeen}
            waypoints={waypoints}
            cities={cities}
            onEdit={onEditQueue}
            realm={realmId}
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
        ) : (
          <section className="queue-planner" aria-label="Queue">
            <div className="queue-list">
              <div className="queue-tools">
                <span className="px t16">Queue</span>
                <span className="grow" />
                {onEditQueue && <PasteSteps onPaste={(steps) => onEditQueue(steps)} />}
                {onEditQueue && (
                  <SavedQueueTools
                    realm={realmId}
                    steps={[]}
                    onLoad={(steps) => onEditQueue(steps)}
                  />
                )}
              </div>
              <p className="muted small">
                Nothing queued. Plan steps with Add step, paste copied ones or load a saved queue:
                they wait as a draft until you press Start queue. Hold Shift with any order to queue
                it at once.
              </p>
            </div>
            {addStep && <div className="queue-palette">{addStep}</div>}
          </section>
        ))}
      {tab === 'script' && (
        <div className="script-tab">
          <div className="script-col">
            <section className="sec script-runs" aria-label="Script they run">
              {r.script ? (
                <>
                  <TaskScript
                    scriptId={r.script.scriptId}
                    scripts={scripts}
                    onEdit={onEditScript}
                  />
                  {scriptRun}
                </>
              ) : (
                <>
                  <p className="muted small">Runs no script.</p>
                  {actions.some((a) => a.id === 'script') && (
                    <div className="order-buttons">
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => onSections({ ...sections, tab: 'orders', panel: 'script' })}
                      >
                        Run script…
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
            {defenceScript}
            {alarmScript}
          </div>
          {r.script && <div className="script-col">{scriptParams}</div>}
          <div className="script-col">
            {r.script && scriptMemory}
            {scriptLog}
          </div>
        </div>
      )}
      {tab === 'stats' && (
        <div className="stats-tab">
          <section className="sec" aria-label="About them">
            <ul className="sel-facts">
              <li className="b">
                {child ? 'Child' : 'Adult'} · {age} years · {home}
                {r.riding ? ' · on horseback' : ''}
                {r.aboard
                  ? isVesselId(r.aboard)
                    ? ' · aboard a boat'
                    : ' · aboard a carriage'
                  : ''}
              </li>
              {grown && <li>{capitalised(grown)}</li>}
              {family && <li>{family}</li>}
            </ul>
          </section>
          <section className="sec" aria-label="Stats">
            <div className="fx">
              <h3 className="px t16 grow">Stats</h3>
              <span className="small muted">base + trained (cap)</span>
            </div>
            {STAT_NAMES.map((s) => {
              const { base, trained } = r.stats[s]
              const cap = trainedCap(base)
              return (
                <div className="stat" key={s}>
                  <span>{STAT_LABELS[s]}</span>
                  <span className="mt stat-bar" aria-hidden="true">
                    <i className="stat-base" style={{ width: pct(base / STAT_SCALE) }} />
                    <i className="stat-trained" style={{ width: pct(trained / STAT_SCALE) }} />
                    <i className="stat-room" style={{ width: pct((cap - trained) / STAT_SCALE) }} />
                  </span>
                  <span className="mono">{statLine(base, trained, cap)}</span>
                </div>
              )
            })}
            <div className="stat-legend small muted" aria-hidden="true">
              <span>
                <span className="dot stat-base" /> base
              </span>
              <span>
                <span className="dot stat-trained" /> trained
              </span>
              <span>
                <span className="dot stat-room" /> room to the cap
              </span>
            </div>
          </section>
          <section className="sec" aria-label="Skills">
            <h3 className="px t16">Skills</h3>
            <div className="chips">
              {skills.length === 0 && <span className="chip">None yet</span>}
              {skills.map((s) => (
                <span className="chip" key={s}>
                  {SKILL_LABELS[s]}{' '}
                  <span className="mono accent">{Math.floor(r.skills[s]! * 10) / 10}</span>
                </span>
              ))}
            </div>
          </section>
        </div>
      )}
      {creative}
    </CommandBar>
  )
}

/**
 * Setting up a haul route with the carriage on the resident's tile (`CONTEXT.md`: Haul route), or
 * the boat beside them (Haul route by water): which goods go from here to the other stop, which
 * come back, and how much Food stays on board for the horse or the rower, then the other stop on
 * the map.
 */
export function HaulBlock({
  adult,
  onRoute,
  byWater = false,
  ship = false,
  picking,
  onHaulTo,
}: {
  /** Grown up, so they can drive (`CONTEXT.md`: Child). */
  adult: boolean
  /** Already hauling on a route. */
  onRoute: boolean
  /** With the boat beside them, rowed between shores or havens. */
  byWater?: boolean
  /** With a ship docked at their haven, sailed between havens by its crew. */
  ship?: boolean
  /** The map is waiting for the route's other stop. */
  picking: boolean
  onHaulTo: (setup: HaulSetup) => void
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
    <section className="inspector-block" aria-label="Haul route">
      {onRoute && <span className="chip y haul-on-route">on a route</span>}
      {([false, true] as const).map((back) => (
        <div className="haul-goods" key={String(back)}>
          <span className="lb">{back ? 'Back from there' : 'To the other stop'}</span>
          <div
            className="haul-goods-grid"
            role="group"
            aria-label={back ? 'Goods back from there' : 'Goods to the other stop'}
          >
            {GOODS.map((g) => {
              const on = (back ? returnGoods : goods).includes(g)
              const other = (back ? goods : returnGoods).includes(g)
              return (
                <button
                  type="button"
                  className="btn sm"
                  key={g}
                  aria-pressed={on}
                  title={other ? `${GOOD_LABELS[g]} goes the other way; tap to swap it` : undefined}
                  onClick={() => toggle(g, back)}
                >
                  <GoodIcon good={g} />
                  {GOOD_LABELS[g]}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <span className="muted small">A good goes one way only.</span>
      <label className="haul-keep">
        {ship
          ? 'Food kept for the crew'
          : byWater
            ? 'Food kept for the rower'
            : 'Food kept for the horse'}
        <input
          className="amount mono"
          type="number"
          min={0}
          step={1}
          value={keepFood}
          onChange={(e) => setKeepFood(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
      </label>
      <PanelFoot>
        <button
          type="button"
          className="primary"
          aria-pressed={picking}
          disabled={!adult || goods.length === 0}
          onClick={() => onHaulTo({ goods, returnGoods, keepFood })}
        >
          {picking ? 'Pick a tile…' : 'Pick the other stop'}
        </button>
        <CustomiseButton
          order={taskStart('haul')}
          of="Haul route"
          disabled={!adult || goods.length === 0}
          give={() => onHaulTo({ goods, returnGoods, keepFood })}
        />
      </PanelFoot>
      {!adult ? (
        <span className="muted small">A child can’t drive.</span>
      ) : (
        goods.length === 0 && (
          <span className="muted small">Pick at least one good to take to the other stop.</span>
        )
      )}
      {ship ? (
        <p className="muted small">
          The captain moves the picked goods straight from this haven onto the ship, sails it with
          the crew to the other haven, gets off and unloads them there, brings the goods picked to
          come back, again and again until stopped; the rest of the crew stays aboard. The crew take
          meals from the ship’s Food, topped up at any haven with some.
        </p>
      ) : byWater ? (
        <p className="muted small">
          The rower loads the picked goods into the boat from this shore, rows them to the other
          stop (a shore tile or a haven, with free water beside it), gets off and unloads them,
          brings the goods picked to come back, again and again until stopped. A haven loads and
          unloads at its storage, a shore on the ground. The rower takes meals from the boat’s Food,
          topped up wherever there is some.
        </p>
      ) : (
        <p className="muted small">
          The driver loads the picked goods here, drives them to the other stop and unloads them,
          brings the goods picked to come back, again and again until stopped. A stop with a storage
          loads and unloads there, else on the ground. The horse eats from the carriage’s load; its
          Food is topped up wherever there is some.
        </p>
      )}
    </section>
  )
}

/**
 * Who works on a building or site as far as the Player sees, for how long it has left
 * (`workLeft`), and the terrain beneath it where that slows the work.
 */
interface OnSite {
  residents: readonly Resident[]
  mapSize: number
  terrain?: number
}

/**
 * A construction site on the resident's tile (`CONTEXT.md`: Construction site): see what it still
 * needs and help build it. A tile can hold a building's site, a carriage site and a road site.
 */
function SiteBlock({
  resident,
  tick,
  site,
  terrain,
  at,
  onBuild,
}: {
  resident: Resident
  tick: number
  site: Building
  /** The explored terrain beneath the site, if known (`buildingWork`). */
  terrain?: number
  at: OnSite
  onBuild: (kind: BuildingKind, material?: WallMaterial) => void
}) {
  const adult = canWork(resident, tick)
  const o = resident.order
  const name = BUILDING_NAMES[site.kind]
  const work = workOfKind(site.kind, site.material)
  const materials = goodsIn(materialsOfKind(site.kind, site.material))
  const stone = isStone(site.kind, site.material)
  const help = () => onBuild(site.kind, stone ? 'stone' : undefined)
  const joined = o?.kind === 'build' && o.siteId === site.id
  return (
    <section className="inspector-block" aria-label="Construction site">
      <div className="panel-head">
        <h3>Construction site</h3>
        <span className="small muted">{name}</span>
      </div>
      <Meter
        label="Work"
        value={pct(work > 0 ? site.site!.work / work : 1)}
        share={work > 0 ? site.site!.work / work : 1}
        left={workLeft(site, at.residents, tick, { under: terrain, size: at.mapSize })}
      />
      {materials.length === 0 && <p className="muted small">Needs no materials.</p>}
      {materials.map(([good, units]) => (
        <div className="fx site-material-row" key={good}>
          <GoodIcon good={good} />
          <span className="grow">{GOOD_LABELS[good]}</span>
          <span className="mono">
            {site.site!.delivered[good] ?? 0} / {units}
          </span>
        </div>
      ))}
      <PanelFoot>
        <button type="button" className="primary" disabled={!adult || joined} onClick={help}>
          {joined ? 'Building…' : 'Help build'}
        </button>
        <CustomiseButton
          order={taskStart('build')}
          of="Help build"
          disabled={!adult || joined}
          give={help}
        />
      </PanelFoot>
      <p className="muted small">
        It becomes a {stone ? 'stone ' : ''}
        {name.toLowerCase()} once its materials are delivered and the work is done: about{' '}
        {workSpan(buildingWork(site.kind, terrain, site.material))} of one resident’s work in all
        {workFactor(site.kind, terrain) > 1 &&
          `, on Mountain ${workFactor(site.kind, terrain)} times as much as elsewhere`}
        .
      </p>
    </section>
  )
}

/**
 * Working the workplace on the resident’s tile (`CONTEXT.md`: Workplace): how
 * many work it, who holds it (`CONTEXT.md`: Holding a workplace), and a button to join them.
 * The output goes into the workers’ hands.
 */
function WorkBlock({
  resident,
  tick,
  building,
  node,
  workers,
  holders,
  realmId,
  onWork,
}: {
  resident: Resident
  tick: number
  building: Building | undefined
  node: KnownNode | undefined
  workers: number
  holders: string[]
  realmId: string
  onWork: (makes?: Good | typeof MEND) => void
}) {
  const max = building && !building.site ? MAX_WORKERS[building.kind] : undefined
  const skill = building && WORKPLACE_SKILL[building.kind]
  const recipes = (building && RECIPES[building.kind]) ?? []
  const recipe = recipes.length === 1 ? recipes[0] : undefined
  const good = building?.kind === 'farm' ? 'food' : node && NODE_GOOD[node.kind]
  if (!building || max === undefined || !skill || (!good && recipes.length === 0)) return null
  const batches = BATCHES_PER_DAY[building.kind] ?? 0
  const o = resident.order
  // Working by the task's script; one working by a bare order (as the starting residents do) can
  // still be given the task, and so can one working as a queue step, to queue it again.
  const working =
    o?.kind === 'workAt' && o.buildingId === building.id && !!resident.script && !resident.queue
  const blocked = !canWork(resident, tick) || (!working && workers >= max)
  return (
    <section className="inspector-block" aria-label="Work">
      <p className="small">{holding(holders, realmId)}</p>
      {recipes.length > 1 ? (
        // A smithy: each worker says what they make (`CONTEXT.md`: Smithy), or mends (Mending).
        <div className="work-recipes">
          {recipes.map((r) => {
            const made = recipeGood(r)
            const making = working && !o.mends && o.makes === made
            return (
              <div key={made} className="fx work-recipe">
                <GoodIcon good={made} />
                <span className="grow">
                  <strong>{GOOD_LABELS[made]}</strong>{' '}
                  <span className="muted small">· {stockText(r.input)}</span>
                </span>
                <button
                  type="button"
                  className="btn sm"
                  disabled={blocked || making}
                  onClick={() => onWork(made)}
                >
                  {making ? 'Making…' : working ? 'Make instead' : 'Make'}
                </button>
                <CustomiseButton
                  order={taskStart('work', building.id)}
                  of={`Make ${GOOD_LABELS[made].toLowerCase()}`}
                  disabled={blocked || making}
                  give={() => onWork(made)}
                />
              </div>
            )
          })}
          <div className="fx work-recipe">
            <Icon name="build" size={16} />
            <span className="grow">
              <strong>Mend</strong>{' '}
              <span className="muted small">· worn gear here, for a share of its recipe</span>
            </span>
            <button
              type="button"
              className="btn sm"
              disabled={blocked || (working && !!o.mends)}
              onClick={() => onWork(MEND)}
            >
              {working && o.mends ? 'Mending…' : working ? 'Mend instead' : 'Mend'}
            </button>
            <CustomiseButton
              order={taskStart('work', building.id)}
              of="Mend"
              disabled={blocked || (working && !!o.mends)}
              give={() => onWork(MEND)}
            />
          </div>
        </div>
      ) : (
        <PanelFoot>
          <button
            type="button"
            className="primary"
            disabled={blocked || working}
            onClick={() => onWork()}
          >
            {working ? 'Working…' : 'Work here'}
          </button>
          <CustomiseButton
            order={taskStart('work', building.id)}
            of="Work here"
            disabled={blocked || working}
            give={() => onWork()}
          />
        </PanelFoot>
      )}
      <p className="muted small">
        {recipes.length > 1 ? (
          <>
            A worker of average Strength makes about {batches} of them a game day, more with{' '}
            {SKILL_LABELS[skill]} skill. They use what the workers carry, then what lies on the
            ground here; without it they stand idle. The output goes
          </>
        ) : recipe ? (
          <>
            A worker of average Strength turns about {stockText(recipe.input, batches)} into{' '}
            {stockText(recipe.output, batches)} a game day, more with {SKILL_LABELS[skill]} skill.
            It uses what the workers carry, then what lies on the ground here; without it they stand
            idle. The output goes
          </>
        ) : (
          <>
            A worker of average Strength makes about {WORK_OUTPUT_PER_DAY[good!] ?? 0}{' '}
            {GOOD_LABELS[good!].toLowerCase()} a game day, more with {SKILL_LABELS[skill]} skill. It
            goes
          </>
        )}{' '}
        into the workers’ hands as far as they can carry; the rest is left on the ground here.
      </p>
    </section>
  )
}

/**
 * Tearing down the building or construction site on the resident's tile (`CONTEXT.md`: Tearing
 * down): how far it has come, what it leaves on the tile, and a button to start or join.
 */
function TearDownBlock({
  resident,
  tick,
  building,
  at,
  onTearDown,
}: {
  resident: Resident
  tick: number
  building: Building | undefined
  at: OnSite
  onTearDown: (buildingId: string) => void
}) {
  if (!building || !BUILDABLE.includes(building.kind)) return null
  const name = BUILDING_NAMES[building.kind].toLowerCase()
  const what = building.site ? `${name} site` : name
  const work = teardownWork(building)
  const share = work > 0 ? (building.teardown ?? 0) / work : 0
  const leaves = goodsIn(teardownReturns(building))
  const o = resident.order
  const joined = o?.kind === 'tearDown' && o.buildingId === building.id
  return (
    <section className="inspector-block" aria-label="Tear down">
      {/* The panel's header says Tear down; each section names what it tears down, as up to
          three can stand on one tile (a building, a carriage site, a road). */}
      <div className="panel-head">
        <h3>{capitalised(what)}</h3>
      </div>
      {building.teardown !== undefined && (
        <Meter
          label="Torn down"
          value={pct(share)}
          share={share}
          left={workLeft(building, at.residents, tick, {
            tearingDown: true,
            under: at.terrain,
            size: at.mapSize,
          })}
        />
      )}
      <p className="muted small">
        Takes about {Math.ceil((work / TICKS_PER_GAME_DAY) * 10) / 10} game days of one resident’s
        work and leaves{' '}
        {leaves.length === 0
          ? 'nothing'
          : leaves.map(([g, n]) => `${n} ${GOOD_LABELS[g].toLowerCase()}`).join(', ')}{' '}
        on the tile.
      </p>
      <PanelFoot>
        <button
          type="button"
          className="btn dng"
          disabled={!canWork(resident, tick) || joined}
          onClick={() => onTearDown(building.id)}
        >
          {joined ? 'Tearing down…' : `Tear down ${what}`}
        </button>
        <CustomiseButton
          order={taskStart('tearDown')}
          of={`Tear down ${what}`}
          disabled={!canWork(resident, tick) || joined}
          give={() => onTearDown(building.id)}
        />
      </PanelFoot>
    </section>
  )
}

/**
 * Teaching (`CONTEXT.md`: Teacher): pick the subject the training ground on the resident's tile
 * teaches, or switch it while they teach there. One teacher per ground: with another there, it
 * says who and teaches nothing.
 */
function TeachBlock({
  resident,
  ground,
  residents,
  mapSize,
  onTeach,
}: {
  resident: Resident
  ground: Building
  residents: readonly Resident[]
  mapSize: number
  onTeach: (subject: TrainingSubject) => void
}) {
  const teacher = teacherAt(ground, residents, mapSize)
  const other = teacher && teacher.id !== resident.id ? teacher : undefined
  const o = resident.order
  const teaching = o?.kind === 'teach' && o.buildingId === ground.id ? o.subject : undefined
  const otherTeaches = other?.order?.kind === 'teach' ? other.order.subject : undefined
  return (
    <section className="inspector-block" aria-label="Teach">
      <p className="small">
        {otherTeaches
          ? `${other!.name} teaches ${subjectLabel(otherTeaches)} here: one teacher per ground.`
          : teaching
            ? `Teaching ${subjectLabel(teaching)}. Pick another subject to switch.`
            : 'Trainees here learn the subject while you teach, never past your own value.'}
      </p>
      <SubjectPicker
        key={teaching}
        action={teaching ? 'Teach instead' : 'Teach'}
        picked={teaching}
        disabled={!!other}
        onPick={onTeach}
      />
    </section>
  )
}

/**
 * Hitching (`CONTEXT.md`: Hitched horse): pick which of the realm's free horses on the resident's
 * tile pulls the carriage there, also when only one stands there.
 */
function HitchBlock({
  horses,
  tick,
  onHitch,
}: {
  horses: SeenHorse[]
  tick: number
  onHitch: (horseId: string) => void
}) {
  const [picked, setPicked] = useState<string>()
  // A horse picked may have gone or been hitched since.
  const chosen = horses.some((h) => h.id === picked) ? picked : undefined
  return (
    <section className="inspector-block" aria-label="Hitch horse">
      <p className="muted small">
        The horse you pick pulls the carriage at once; one already hitched stands free on the tile.
      </p>
      {horses.map((h) => (
        <HorsePick
          key={h.id}
          horse={h}
          tick={tick}
          checked={chosen === h.id}
          onToggle={() => setPicked(chosen === h.id ? undefined : h.id)}
        />
      ))}
      {!chosen && <span className="muted small">Tick the horse to hitch.</span>}
      <PanelFoot>
        <button
          type="button"
          className="primary"
          disabled={!chosen}
          onClick={() => chosen && onHitch(chosen)}
        >
          Hitch
        </button>
      </PanelFoot>
    </section>
  )
}

/**
 * Breeding (`CONTEXT.md`: Breeding): pick two of the Player's horses in the stable on the
 * resident's tile for them to breed, or see how far their breeding has come. A pair whose
 * breeding the stable kept comes first (`keptPair`): it is picked, with how far along it is.
 */
function BreedBlock({
  resident,
  tick,
  stable,
  horses,
  residents,
  realmId,
  onBreed,
}: {
  resident: Resident
  tick: number
  stable: Building
  horses: SeenHorse[]
  residents: Resident[]
  realmId: string
  onBreed: (stableId: string, horseIds: [string, string]) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const own = horsesIn(horses, stable).filter((h) => h.realmId === realmId)
  const o = resident.order
  const breeding = o?.kind === 'breed' && o.stableId === stable.id ? o : undefined
  // The Player knows how their own horses fare (`CONTEXT.md`: Seeing how someone fares).
  const seen = { horses: horses.filter(horseFaresKnown), residents }
  const kept = breeding ? undefined : keptPair(seen, stable, { realmId }, resident)
  const keptShare = kept ? keptBreeding(stable, kept)!.progress / STABLE_BREED_TICKS : 0
  const chosen = kept ?? picked
  const pair = chosen.length === 2 ? ([chosen[0]!, chosen[1]!] as [string, string]) : undefined
  const problem = !canWork(resident, tick)
    ? 'children can’t breed horses'
    : pair
      ? breedProblem(seen, stable, { realmId }, resident, pair)
      : 'pick two horses'
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)))
  return (
    <section className="inspector-block" aria-label="Breed horses">
      {breeding && (
        <Meter
          label="Foal"
          value={pct(breeding.progress / STABLE_BREED_TICKS)}
          share={breeding.progress / STABLE_BREED_TICKS}
          left={foalLeft(breeding.progress)}
        />
      )}
      {kept && (
        <>
          <Meter
            label="Paused"
            value={pct(keptShare)}
            share={keptShare}
            left={`${foalLeft(keptShare * STABLE_BREED_TICKS)} once tended`}
          />
          <p className="muted small">
            The stable kept this pair&apos;s breeding: they carry on with it first.
          </p>
        </>
      )}
      <p className="muted small">
        Tending two fed horses for {STABLE_BREED_DAYS} game days brings a foal with their average
        stats, give or take {FOAL_STAT_SPREAD}. If the resident leaves, the stable keeps how far the
        two have come; it is lost if one of them leaves the stable or dies.
      </p>
      {own.length === 0 && <p className="muted small">No horses of yours in this stable.</p>}
      {own.map((h) => (
        <HorsePick
          key={h.id}
          horse={h}
          tick={tick}
          checked={chosen.includes(h.id)}
          disabled={!!breeding || !!kept}
          onToggle={() => toggle(h.id)}
        />
      ))}
      <PanelFoot>
        <button
          type="button"
          className="primary"
          disabled={!!breeding || !pair || problem !== undefined}
          title={problem}
          onClick={() => pair && onBreed(stable.id, pair)}
        >
          {breeding ? 'Breeding…' : kept ? 'Carry on with these two' : 'Breed these two'}
        </button>
        <CustomiseButton
          order={taskStart('breed')}
          of="Breed horses"
          disabled={!!breeding || !pair || problem !== undefined}
          give={() => pair && onBreed(stable.id, pair)}
        />
      </PanelFoot>
      {!breeding && pair && problem && <p className="muted small">{problem}</p>}
    </section>
  )
}

/**
 * Breeding for a group (`CONTEXT.md`: Breeding, Group): pick two of the Player's horses in a
 * stable some of them stand in; one of them there tends the pair.
 */
export function GroupBreed({
  stable,
  horses,
  tick,
  onBreed,
}: {
  stable: Building
  /** The Player's horses in the stable. */
  horses: SeenHorse[]
  tick: number
  onBreed: (horseIds: [string, string]) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const pair = picked.length === 2 ? ([picked[0]!, picked[1]!] as [string, string]) : undefined
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)))
  return (
    <div className="group-breed" aria-label={`Stable at ${stable.x}, ${stable.y}`}>
      <span className="lb">
        Stable at {stable.x}, {stable.y} · {horses.length} of yours
      </span>
      {horses.map((h) => (
        <HorsePick
          key={h.id}
          horse={h}
          tick={tick}
          checked={picked.includes(h.id)}
          onToggle={() => toggle(h.id)}
        />
      ))}
      <PanelFoot>
        <button
          type="button"
          className="primary"
          disabled={!pair}
          onClick={() => {
            if (!pair) return
            setPicked([])
            onBreed(pair)
          }}
        >
          Breed these two
        </button>
        <CustomiseButton
          order={taskStart('breed')}
          of="Breed horses"
          disabled={!pair}
          give={() => {
            if (!pair) return
            setPicked([])
            onBreed(pair)
          }}
        />
      </PanelFoot>
    </div>
  )
}

/**
 * Pairing (`CONTEXT.md`: Pairing): pick another adult of the resident's city to pair with, or see
 * whom they are paired with and when their next child can come.
 */
function PairBlock({
  resident,
  tick,
  residents,
  onPair,
}: {
  resident: Resident
  tick: number
  residents: Resident[]
  onPair: (partnerId: string) => void
}) {
  const [partnerId, setPartnerId] = useState('')
  if (!canWork(resident, tick) || resident.cityId === null) return null
  const o = resident.pair
  const partner = o ? residents.find((x) => x.id === o.partnerId) : undefined
  const choices = labelled(
    residents.filter(
      (x) =>
        x.id !== resident.id && x.cityId === resident.cityId && canWork(x, tick) && !x.carrying,
    ),
    tick,
  )
  const wait = o ? pairingTicksLeft(o.since, tick) : 0
  const expecting = resident.carrying || partner?.carrying
  return (
    <section className="inspector-block" aria-label="Pairing">
      <p className="muted small">One child per pair; pair again for another.</p>
      {expecting ? (
        <p className="muted small">{familyLine(resident, residents, tick)}.</p>
      ) : (
        o && (
          <p className="muted small">
            Paired with {partner?.name ?? 'someone out of sight'}.{' '}
            {wait > 0 ? `In ${aboutTime(wait)}` : 'Now'}, once the city has free housing and a food
            surplus, one of them starts carrying a child for {CARRYING_DAYS} game days; the other
            keeps working.
          </p>
        )
      )}
      <select aria-label="Partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
        <option value="">Pick a partner…</option>
        {choices.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <PanelFoot>
        <button
          type="button"
          className="primary"
          disabled={!partnerId || !!resident.carrying}
          onClick={() => onPair(partnerId)}
        >
          Pair
        </button>
      </PanelFoot>
      {resident.carrying ? (
        <span className="muted small">Not while carrying a child.</span>
      ) : (
        !partnerId && <span className="muted small">Pick a partner first.</span>
      )}
    </section>
  )
}

/**
 * Relocating a resident (`CONTEXT.md`: Relocate): the realm's other cities with their free housing,
 * counting those already on their way there; a city the order can't go to is greyed out with the
 * reason. They walk there and move in on stepping into its area.
 */
function RelocateBlock({
  resident,
  choices,
  onRelocate,
}: {
  resident: Resident
  choices: RelocateChoice[]
  onRelocate: (cityId: string) => void
}) {
  const o = resident.order
  const going = o?.kind === 'relocate' ? choices.find((c) => c.id === o.cityId) : undefined
  return (
    <section className="inspector-block" aria-label="Relocate">
      {going && <p className="muted small">Relocating to {going.name}.</p>}
      <p className="small">
        {resident.name} walks there and moves in on stepping into its area, if it still has free
        housing then. Moving ends a pair.
      </p>
      <CityPicker choices={choices} onRelocate={onRelocate} />
    </section>
  )
}

/**
 * Relocating a group from the group card (`CONTEXT.md`: Group, Relocate): the same picker, a city
 * counting as full unless all of them fit; or why none of them can relocate.
 */
function GroupRelocateBlock({
  count,
  choices,
  problem,
  onRelocate,
}: {
  count: number
  choices: RelocateChoice[]
  problem: string | undefined
  onRelocate: (cityId: string) => void
}) {
  return (
    <section className="inspector-block" aria-label="Relocate">
      {problem ? (
        <p className="muted small">Can’t relocate: {problem}.</p>
      ) : (
        <>
          <p className="small">
            All {count} walk there and move in on stepping into its area, while it still has free
            housing; anyone left over keeps their old city. Moving ends a pair.
          </p>
          <CityPicker choices={choices} onRelocate={onRelocate} />
        </>
      )}
    </section>
  )
}

/** The realm's cities to relocate to, each with its free housing or why it can't be picked. */
export function CityPicker({
  choices,
  onRelocate,
}: {
  choices: RelocateChoice[]
  onRelocate: (cityId: string) => void
}) {
  const [cityId, setCityId] = useState('')
  const picked = choices.find((c) => c.id === cityId && !c.problem)
  return (
    <div className="order-buttons">
      <select aria-label="City" value={cityId} onChange={(e) => setCityId(e.target.value)}>
        <option value="">Pick a city…</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id} disabled={!!c.problem}>
            {c.name} · {c.problem ?? `${c.room} free housing`}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="primary"
        disabled={!picked}
        onClick={() => picked && onRelocate(picked.id)}
      >
        Relocate
      </button>
    </div>
  )
}

/**
 * Renaming a resident (`CONTEXT.md`): a new name for one of the Player's own, and with it the
 * realm name when this is the Leader of a realm that has none yet (`CONTEXT.md`: Realm name).
 */
function RenameBlock({
  resident,
  needsRealmName,
  onRename,
}: {
  resident: Resident
  needsRealmName: boolean
  onRename: (name: string, realmName?: string) => void
}) {
  const [name, setName] = useState(resident.name)
  const [realmName, setRealmName] = useState('')
  const problem =
    nameProblem(name, RESIDENT_NAME_MAX_LENGTH) ??
    (needsRealmName ? nameProblem(realmName, REALM_NAME_MAX_LENGTH) : undefined)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (problem) return
    onRename(name.trim(), needsRealmName ? realmName.trim() : undefined)
  }
  return (
    <section className="inspector-block" aria-label="Rename">
      <form className="opanel-form" onSubmit={submit}>
        <label className="fld">
          <span className="lb">New name</span>
          <input
            value={name}
            maxLength={RESIDENT_NAME_MAX_LENGTH}
            aria-label="New name"
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        {needsRealmName && (
          <>
            <p className="small">
              Your realm has no name yet: name it now. Others will know it by this name, and it
              never changes.
            </p>
            <label className="fld">
              <span className="lb">Realm name</span>
              <input
                value={realmName}
                maxLength={REALM_NAME_MAX_LENGTH}
                placeholder="Realm name"
                aria-label="Realm name"
                onChange={(e) => setRealmName(e.target.value)}
                required
              />
            </label>
          </>
        )}
        <PanelFoot>
          <button type="submit" className="primary" disabled={!!problem}>
            Rename
          </button>
        </PanelFoot>
        {problem && <span className="muted small">Can’t rename yet: {problem}.</span>}
      </form>
    </section>
  )
}

/** Most walls and gates the walls list offers, nearest first. */
const WALL_CHOICES = 8

/**
 * Walls in combat (`CONTEXT.md`): pick a wall or gate of another realm in sight, nearest first,
 * to break (strike it until it falls) or, standing next to it, to climb over.
 */
function WallsBlock({
  resident,
  walls,
  mapSize,
  onBreak,
  onClimb,
}: {
  resident: Resident
  walls: Building[]
  mapSize: number
  onBreak: (wallId: string) => void
  onClimb: (wallId: string) => void
}) {
  const [wallId, setWallId] = useState('')
  const choices = walls
    .map((w) => ({ w, d: wrapDistance(mapSize, resident, w) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, WALL_CHOICES)
  if (choices.length === 0) return null
  const o = resident.order
  const breaking = o?.kind === 'attack' ? walls.find((w) => w.id === o.targetId) : undefined
  const picked = choices.find(({ w }) => w.id === wallId)?.w
  const beside =
    picked &&
    Math.abs(wrapDelta(resident.x, picked.x, mapSize)) +
      Math.abs(wrapDelta(resident.y, picked.y, mapSize)) ===
      1
  const label = (w: Building) => (w.kind === 'gate' ? 'Gate' : 'Wall')
  return (
    <section className="inspector-block" aria-label="Walls">
      {breaking && (
        <Meter
          label={`Breaking the ${label(breaking).toLowerCase()} at ${breaking.x}, ${breaking.y}`}
          value={`${Math.round(wallStrengthLeft(breaking))} / ${wallStrength(breaking)}`}
          share={wallStrengthLeft(breaking) / wallStrength(breaking)}
        />
      )}
      <select aria-label="Wall" value={wallId} onChange={(e) => setWallId(e.target.value)}>
        <option value="">Pick a wall or gate…</option>
        {choices.map(({ w, d }) => (
          <option key={w.id} value={w.id}>
            {label(w)} at {w.x}, {w.y} · {Math.round(d)} tiles
            {w.damage ? ` · ${pct(w.damage / wallStrength(w))} broken` : ''}
          </option>
        ))}
      </select>
      <PanelFoot>
        <button
          type="button"
          className="btn dng"
          disabled={!picked}
          onClick={() => onBreak(wallId)}
        >
          Break
        </button>
        <button type="button" disabled={!beside} onClick={() => onClimb(wallId)}>
          Climb
        </button>
      </PanelFoot>
      {!picked ? (
        <span className="muted small">Pick a wall or gate first.</span>
      ) : (
        !beside && <span className="muted small">Climb: stand next to it first.</span>
      )}
      <p className="muted small">
        Climbing takes a while, and a climber can’t dodge or strike back. Stand next to the wall to
        climb it.
      </p>
    </section>
  )
}

/** Most residents of other realms the attack list offers, nearest first. */
const ATTACK_CHOICES = 12

/**
 * Attacking (`CONTEXT.md`: Combat): pick a resident of another realm in sight, nearest first, to
 * go after and strike; see whom the resident is fighting.
 */
function AttackBlock({
  resident,
  others,
  walls,
  mapSize,
  onAttack,
}: {
  resident: Resident
  others: SeenResident[]
  walls: Building[]
  mapSize: number
  onAttack: (targetId: string) => void
}) {
  const [targetId, setTargetId] = useState('')
  const o = resident.order
  const target = o?.kind === 'attack' ? others.find((x) => x.id === o.targetId) : undefined
  const choices = others
    .map((x) => ({ x, d: wrapDistance(mapSize, resident, x) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, ATTACK_CHOICES)
  return (
    <section className="inspector-block" aria-label="Attack">
      {o?.kind === 'attack' && !walls.some((w) => w.id === o.targetId) && (
        <p className="muted small">Attacking {target?.name ?? 'someone out of sight'}.</p>
      )}
      {choices.length === 0 ? (
        <p className="muted small">Nobody of another realm in sight.</p>
      ) : (
        <>
          <select
            aria-label="Target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">Pick someone to attack…</option>
            {choices.map(({ x, d }) => (
              <option key={x.id} value={x.id}>
                {x.name} · {Math.round(d)} tiles{bestWeapon(x) ? ' · armed' : ''}
              </option>
            ))}
          </select>
          <PanelFoot>
            <button
              type="button"
              className="btn dng"
              disabled={!targetId}
              onClick={() => onAttack(targetId)}
            >
              Attack
            </button>
          </PanelFoot>
          {!targetId && <span className="muted small">Pick someone to attack first.</span>}
        </>
      )}
    </section>
  )
}

/** Goods at one spot on the resident's tile, each with a button to pick it up. */
export function TileGoods({
  title,
  stock,
  spot,
  onPickUp,
  refused,
  refusedWhy,
  label = 'Pick up',
}: {
  title: string
  stock: Stock | undefined
  spot: GoodsSpot
  onPickUp: (from: GoodsSpot, goods: Stock) => void
  /** The button's label: "Pick up", or what else takes them. */
  label?: string
  /** Whether the resident may not pick up this good, as a child anything but Food. */
  refused: (good: Good) => boolean
  /** Why a refused good's buttons are greyed, said under them. */
  refusedWhy?: string
}) {
  const goods = goodsIn(stock)
  return (
    <div className="goods-spot">
      <span className="b">{title}</span>
      {goods.length === 0 && <span className="muted small">Nothing.</span>}
      <GoodsPick
        label={title}
        goods={goods}
        byDefault={(_, units) => units}
        refused={refused}
        refusedWhy={refusedWhy}
        actions={() => [{ label, spot }]}
        onAct={onPickUp}
      />
    </div>
  )
}

/**
 * An inventory in an order's panel as a goods grid (`CONTEXT.md`: Goods on cards): a cell per
 * good with its icon and amount, its name on hover. The good tapped (the first until one is) gets
 * a line under the grid with an amount and the buttons that act on that many: `byDefault` until
 * the Player types an exact amount, which is honoured as typed (`CONTEXT.md`: Own food).
 */
function GoodsPick({
  label,
  goods,
  byDefault,
  refused,
  refusedWhy,
  actions,
  onAct,
}: {
  /** What the inventory is, for screen readers. */
  label: string
  goods: readonly (readonly [Good, number])[]
  byDefault: (good: Good, units: number) => number
  /** Whether the resident may not handle this good, as a child anything but Food. */
  refused: (good: Good) => boolean
  /** Why a refused good's buttons are greyed, said under them. */
  refusedWhy?: string
  actions: (good: Good) => { label: string; spot: GoodsSpot }[]
  onAct: (spot: GoodsSpot, goods: Stock) => void
}) {
  const [picked, setPicked] = useState<Good>()
  const [typed, setTyped] = useState<number>()
  // A good picked may have gone since; the first stands in for it.
  const entry = goods.find(([g]) => g === picked) ?? goods[0]
  if (!entry) return null
  const [good, units] = entry
  const amount = Math.min(typed ?? byDefault(good, units), units)
  const disabled = refused(good)
  return (
    <div className="goods-pick">
      <ul className="goods-grid" aria-label={label}>
        {goods.map(([g, n]) => (
          <li key={g}>
            <button
              type="button"
              className="btn sm goods-pick-cell"
              aria-pressed={g === good}
              aria-label={`${GOOD_LABELS[g]}: ${goodsAmount(n)}`}
              title={GOOD_LABELS[g]}
              onClick={() => {
                setPicked(g)
                setTyped(undefined)
              }}
            >
              <GoodIcon good={g} />
              <span className="mono">{goodsAmount(n)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="goods-pick-line well">
        <GoodIcon good={good} />
        <span className="grow">
          <strong>{GOOD_LABELS[good]}</strong> · {goodsAmount(units)}
        </span>
        <input
          className="amount mono"
          type="number"
          min={0}
          max={units}
          step={1}
          aria-label={`${GOOD_LABELS[good]} amount`}
          value={amount}
          disabled={disabled}
          onChange={(e) => setTyped(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
        {actions(good).map(({ label: act, spot }) => (
          <button
            key={act}
            type="button"
            className="btn sm"
            disabled={disabled || amount === 0}
            onClick={() => {
              onAct(spot, { [good]: amount })
              setTyped(undefined)
            }}
          >
            {act}
          </button>
        ))}
      </div>
      {disabled && refusedWhy && <span className="muted small">{refusedWhy}</span>}
    </div>
  )
}

function Meter({
  label,
  value,
  share,
  left,
}: {
  label: string
  value: string
  share: number
  /** About how long is left at the current pace (`CONTEXT.md`: Estimates). */
  left?: string
}) {
  return (
    <div className="vital">
      <div className="vital-head">
        <span className="muted">{label}</span>
        <span className="mono">{value}</span>
      </div>
      <span className="meter big">
        <span className={meterClass(share)} style={{ width: pct(share) }} />
      </span>
      {left && <span className="small muted">{capitalised(left)}</span>}
    </div>
  )
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Who holds a workplace, in the Player's words (`CONTEXT.md`: Holding a workplace). */
function holding(holders: string[], realmId: string): string {
  const others = holders.filter((h) => h !== realmId).length
  if (holders.length === 0) return 'Nobody holds it: whoever works it gets its output.'
  if (others === 0) return 'Held by your realm.'
  if (others === holders.length) return 'Held by another realm: its workers get the output.'
  return 'Held by your realm and another: their workers share the output.'
}

/**
 * Picks the script a resident runs when struck (`CONTEXT.md`: Defence script): Defend (default)
 * first, then the Player's scripts. For a group, `picked` is the one all of them keep, or
 * undefined while they differ; picking sets it for all of them.
 */
export function DefenceScript({
  picked,
  scripts,
  onPick,
  label = 'Defence script',
}: {
  picked: number | null | undefined
  scripts: readonly ScriptSummary[]
  onPick: (scriptId: number | null) => void
  label?: string
}) {
  const choices = defenceChoices(scripts, picked)
  const value = picked === undefined ? '' : picked === null ? 'defend' : String(picked)
  return (
    <section className="sec script-pick" aria-label="Defence script">
      <label className="fld">
        <span className="lb">Defence script</span>
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onPick(e.target.value === 'defend' ? null : Number(e.target.value))}
        >
          {picked === undefined && (
            <option value="" disabled>
              They differ
            </option>
          )}
          <option value="defend">Defend (default)</option>
          {choices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        What they run when struck. Once it ends, they go on with what they were doing.
      </p>
    </section>
  )
}

/**
 * Picks what a resident runs when an alarm reaches them (`CONTEXT.md`: Alarm script): Alarm
 * (default) first, then None, then the Player's scripts. For a group, `picked` is the one all of
 * them keep, or undefined while they differ; picking sets it for all of them.
 */
export function AlarmScript({
  picked,
  scripts,
  onPick,
  label = 'Alarm script',
}: {
  picked: number | 'none' | null | undefined
  scripts: readonly ScriptSummary[]
  onPick: (scriptId: number | 'none' | null) => void
  label?: string
}) {
  const choices = alarmChoices(scripts, picked)
  const value = picked === undefined ? '' : picked === null ? 'alarm' : String(picked)
  const pick = (v: string) => onPick(v === 'alarm' ? null : v === 'none' ? 'none' : Number(v))
  return (
    <section className="sec script-pick" aria-label="Alarm script">
      <label className="fld">
        <span className="lb">Alarm script</span>
        <select aria-label={label} value={value} onChange={(e) => pick(e.target.value)}>
          {picked === undefined && (
            <option value="" disabled>
              They differ
            </option>
          )}
          <option value="alarm">Alarm (default)</option>
          <option value="none">None</option>
          {choices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        What they run when an alarm reaches them at home. Alarm (default) is for the armed. Once it
        ends, they go on with what they were doing.
      </p>
    </section>
  )
}

/**
 * Gives a resident or an army the run-script order with one of the Player's scripts
 * (`CONTEXT.md`: Running a script). Only scripts with an active version can run; any other
 * order ends it. The picker starts on the script they run now or last ran (`runScriptPick`).
 */
export function RunScript({
  script,
  scripts,
  onRunScript,
  label = 'Script to run',
  of,
  customisable = false,
}: {
  /** The script the resident or army runs now, if any. */
  script: { scriptId: number } | undefined
  scripts: ScriptSummary[]
  onRunScript: (scriptId: number) => void
  label?: string
  /** The resident's or army's id, to start on the script they last ran. */
  of?: string
  /** Offers Customise beside it (`CONTEXT.md`: Before it starts); an army's scripts have no form. */
  customisable?: boolean
}) {
  const runnable = scripts.filter((s) => s.activeVersion !== null)
  const [picked, setPicked] = useState<number>()
  const scriptId = runScriptPick(runnable, {
    picked,
    running: script?.scriptId,
    last: of === undefined ? undefined : rememberedLastScript(of),
  })
  const running = script && scripts.find((s) => s.id === script.scriptId)
  return (
    <div className="run-script">
      {script && (
        <div className="small">
          Runs {running ? <strong>{running.name}</strong> : 'a script'}
          {running && ` · version ${running.activeVersion}`}
        </div>
      )}
      {runnable.length === 0 ? (
        <p className="muted small">Save a script without errors in the library to run it here.</p>
      ) : (
        <div className="order-buttons">
          <select
            aria-label={label}
            value={scriptId ?? ''}
            onChange={(e) => setPicked(Number(e.target.value))}
          >
            {scriptId === undefined && (
              <option value="" disabled>
                Pick a script…
              </option>
            )}
            {runnable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={scriptId === undefined}
            onClick={() => {
              if (scriptId === undefined) return
              if (of !== undefined) rememberLastScript(of, scriptId)
              onRunScript(scriptId)
            }}
          >
            Run script
          </button>
          {customisable && scriptId !== undefined && (
            <CustomiseButton
              order={{ kind: 'runScript', scriptId }}
              of="Run script"
              give={() => {
                if (of !== undefined) rememberLastScript(of, scriptId)
                onRunScript(scriptId)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
