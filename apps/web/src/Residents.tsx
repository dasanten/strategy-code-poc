import {
  BUILD_MATERIALS,
  BUILDING_PURPOSE,
  LINE_BUILDING,
  isLineOrder,
  BUILD_WORK,
  BUILDABLE,
  BATCHES_PER_DAY,
  CARRIAGE_CAPACITY,
  CARRYING_DAYS,
  CARRYING_TICKS,
  GOODS,
  HAUL_KEEP_FOOD,
  buildMenu,
  buildingWork,
  workFactor,
  MAX_HEALTH,
  MAX_HUNGER,
  MAX_WORKERS,
  NODE_GOOD,
  RECIPES,
  WORK_OUTPUT_PER_DAY,
  WORKPLACE_SKILL,
  STAT_NAMES,
  STAT_BASE_MAX,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  TICKS_PER_GAME_YEAR,
  TRAINED_CAP_SHARE,
  ageInYears,
  bestWeapon,
  canWork,
  wrapDelta,
  wrapDistance,
  wallStrength,
  wallStrengthLeft,
  carryCapacity,
  materialsNeeded,
  putAwayUnits,
  recipeGood,
  teardownReturns,
  teardownWork,
  stockWeight,
  trainedCap,
  nameProblem,
  REALM_NAME_MAX_LENGTH,
  RESIDENT_NAME_MAX_LENGTH,
  type Building,
  type Carriage,
  type BuildingKind,
  type Good,
  type GoodsSpot,
  type KnownNode,
  type Pile,
  type Queue,
  type QueueStepRequest,
  type Resident,
  type ScriptSummary,
  type SkillName,
  type StatName,
  type Stock,
  type SeenResident,
  type SeenHorse,
  FOAL_STAT_SPREAD,
  STABLE_BREED_DAYS,
  STABLE_BREED_TICKS,
  breedProblem,
  horsesIn,
} from '@csp/shared'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  CARD_TAB_LABELS,
  CARD_TABS,
  carriedShort,
  carryLine,
  GROUP_TABS,
  groupCard,
  rememberedTabOf,
  rememberTabOf,
  scriptsRun,
  TAB_LABELS,
  type GroupTab,
  type CardSections,
  type ResidentGroup,
} from './residents-view.js'
import { doingLine } from './doing-view.js'
import {
  dropStep,
  moveStep,
  queueRows,
  realMinutes,
  removeStep,
  stepsOf,
  timeStep,
  type QueueRow,
} from './queue-view.js'
import { groupNumberParams, groupSentLine, type GroupOrder, type Skipped } from './group-orders.js'
import { NumberField, foodParamsHint } from './ScriptParams.js'
import { BUILDING_NAMES, NODE_NAMES } from './map/palette.js'
import { horseFaresKnown } from './seen.js'
import { ActionRows, CardTabs, SelectionCard, useActionKeys } from './SelectionCard.js'
import {
  horseDetail,
  groupOrders,
  residentActions,
  type ActionId,
  type CardAction,
} from './selection-view.js'

/** Good names as the UI shows them. */
export const GOOD_LABELS: Record<Good, string> = {
  food: 'Food',
  wood: 'Wood',
  stone: 'Stone',
  ironOre: 'Iron ore',
  iron: 'Iron',
  goldOre: 'Gold ore',
  coins: 'Coins',
  spear: 'Spear',
  sword: 'Sword',
  shield: 'Shield',
  armour: 'Armour',
}

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

const STAT_LABELS: Record<StatName, string> = {
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
}

/** The longest a stat bar can be: the highest base plus the most training could add to it. */
const STAT_SCALE = STAT_BASE_MAX * (1 + TRAINED_CAP_SHARE)

/** Meter colour by how full it is: low is a warning, half-empty a caution. */
function meterClass(share: number): string {
  return share < 0.25 ? 'low' : share < 0.5 ? 'mid' : 'ok'
}

const pct = (share: number) => `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`

/** Work in ticks as a span of game time: "2 game days", "1.5 game hours". */
const workSpan = (ticks: number) => {
  const [n, unit] =
    ticks >= TICKS_PER_GAME_DAY
      ? [ticks / TICKS_PER_GAME_DAY, 'game day']
      : [ticks / TICKS_PER_GAME_HOUR, 'game hour']
  const rounded = Math.round(n * 10) / 10
  return `${rounded} ${unit}${rounded === 1 ? '' : 's'}`
}

/**
 * What the map is waiting for a tile for: to walk or drive there, a haul route's other stop, or
 * the far end of a road along a line.
 */
export type Picking = false | 'walk' | 'drive' | 'haul' | 'road' | 'wall'

/** What a haul route carries, picked before its other stop (`CONTEXT.md`: Haul route). */
export interface HaulSetup {
  goods: Good[]
  returnGoods: Good[]
  keepFood: number
}

/**
 * A resident's pair and the child they carry (`CONTEXT.md`: Pairing, Carrying): who carries, and
 * how many game days are left until it is born; undefined for one who is neither.
 */
export function familyLine(r: Resident, residents: Resident[], tick: number): string | undefined {
  const days = (until: number) => Math.max(0, Math.ceil((until - tick) / TICKS_PER_GAME_DAY))
  if (r.carrying) {
    const left = days(r.carrying.since + CARRYING_TICKS)
    return `Carrying ${r.carrying.partnerName}’s child · born in ${left} game day${left === 1 ? '' : 's'}`
  }
  if (!r.pair) return undefined
  const partnerId = r.pair.partnerId
  const partner = residents.find((x) => x.id === partnerId)
  const name = partner?.name ?? 'someone out of sight'
  if (partner?.carrying) {
    const left = days(partner.carrying.since + CARRYING_TICKS)
    return `${name} is carrying their child · born in ${left} game day${left === 1 ? '' : 's'}`
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
    <div className="task-script goods-row">
      <span className="small">
        Runs <strong>{script?.name ?? 'a script'}</strong>
      </span>
      <span className="muted small">{note}</span>
      <button type="button" onClick={() => onEdit(scriptId)} disabled={!script}>
        Edit
      </button>
    </div>
  )
}

/**
 * The resident's queue (`CONTEXT.md`: Queue): its steps in order, the current one with its Doing
 * line. Steps are reordered by dragging or the arrows, removed, given a duration or none, and the
 * queue looped; each change is an edit-queue order.
 */
function QueueBlock({
  queue: q,
  doing,
  scripts,
  buildings,
  onEdit,
}: {
  queue: Queue
  doing: string
  scripts: ScriptSummary[]
  buildings: Building[]
  onEdit: (steps: QueueStepRequest[], loop?: boolean) => void
}) {
  const [dragged, setDragged] = useState<number>()
  const rows = queueRows(q, { scripts, buildings })
  return (
    <section className="inspector-block" aria-label="Queue">
      <div className="panel-head">
        <h3>Queue</h3>
        <label className="small queue-loop">
          <input
            type="checkbox"
            checked={q.loop}
            onChange={(e) => onEdit(stepsOf(q), e.target.checked)}
          />{' '}
          Loop
        </label>
      </div>
      <ol className="queue-steps">
        {rows.map((row, i) => (
          <li
            key={row.id}
            className={`queue-step${row.current ? ' current' : ''}`}
            aria-current={row.current ? 'step' : undefined}
            draggable
            onDragStart={() => setDragged(row.id)}
            onDragEnd={() => setDragged(undefined)}
            onDragOver={(e) => dragged !== undefined && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (dragged !== undefined && dragged !== row.id) onEdit(dropStep(q, dragged, row.id))
              setDragged(undefined)
            }}
          >
            <div className="queue-step-head">
              <span className="small">
                {i + 1}. {row.label}
              </span>
              <span className="buttons">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => onEdit(moveStep(q, row.id, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === rows.length - 1}
                  onClick={() => onEdit(moveStep(q, row.id, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => onEdit(removeStep(q, row.id))}
                >
                  ✕
                </button>
              </span>
            </div>
            {row.current && <span className="small muted">{doing}</span>}
            <StepMinutes row={row} onSet={(minutes) => onEdit(timeStep(q, row.id, minutes))} />
          </li>
        ))}
      </ol>
      <p className="muted small">
        Drag a step or use the arrows to reorder. Working and hauling never end on their own, so
        they need a duration unless they are last.
      </p>
    </section>
  )
}

/** A step's duration in game minutes, with real time beside; set on Enter or leaving the field. */
function StepMinutes({
  row,
  onSet,
}: {
  row: QueueRow
  onSet: (minutes: number | undefined) => void
}) {
  const [text, setText] = useState(row.minutes === undefined ? '' : String(row.minutes))
  useEffect(() => setText(row.minutes === undefined ? '' : String(row.minutes)), [row.minutes])
  const typed = Math.floor(Number(text))
  const commit = () => {
    const minutes = text.trim() === '' || !(typed > 0) ? undefined : typed
    if (minutes !== row.minutes) onSet(minutes)
  }
  return (
    <label className="small queue-step-minutes">
      Duration{' '}
      <input
        type="number"
        min={1}
        step={1}
        placeholder="none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        style={{ width: '5em' }}
      />{' '}
      game min
      {typed > 0 && <span className="muted"> · {realMinutes(typed)} real</span>}
      {row.minutes !== undefined && (
        <button type="button" onClick={() => onSet(undefined)}>
          Clear
        </button>
      )}
    </label>
  )
}

/** What a resident's built-in order has them doing. */
export function orderDoing(r: Pick<Resident, 'order'>): string {
  const o = r.order
  if (o?.kind === 'walkTo') {
    if (!o.path) return `Finding a way to ${o.target.x}, ${o.target.y}`
    return `Walking to ${o.target.x}, ${o.target.y} · ${o.path.length} tiles to go`
  }
  if (o?.kind === 'drive') {
    if (!o.path) return `Finding a way for the carriage to ${o.target.x}, ${o.target.y}`
    return `Driving to ${o.target.x}, ${o.target.y} · ${o.path.length} tiles to go`
  }
  if (o?.kind === 'haul') {
    const what = o.goods.map((g) => GOOD_LABELS[g].toLowerCase()).join(', ')
    const { x, y } = o[o.stop]
    if (o.phase === 'loading') {
      return o.stop === 'from' ? `Loading ${what} at ${x}, ${y}` : `Unloading ${what} at ${x}, ${y}`
    }
    const back = o.returnGoods.map((g) => GOOD_LABELS[g].toLowerCase()).join(', ')
    const leg =
      o.stop === 'to' ? `Hauling ${what} to` : back ? `Hauling ${back} back to` : 'Driving back to'
    return o.path ? `${leg} ${x}, ${y} · ${o.path.length} tiles to go` : `${leg} ${x}, ${y}`
  }
  if (o?.kind === 'pickUp') return 'Picking up goods'
  if (o?.kind === 'drop') return 'Putting down goods'
  if (o?.kind === 'store') return o.phase === 'refilling' ? 'Taking food along' : 'Storing goods'
  if (o?.kind === 'fetch') return 'Fetching goods'
  if (o?.kind === 'tearDown') return 'Tearing down'
  if (o?.kind === 'breed') return 'Breeding horses'
  if (o?.kind === 'build') {
    const what = BUILDING_NAMES[o.building].toLowerCase()
    return o.siteId === null ? `Laying out a ${what}` : `Building a ${what}`
  }
  if (o?.kind === 'workAt')
    return o.makes ? `Making ${GOOD_LABELS[o.makes].toLowerCase()}` : 'Working'
  if (o?.kind === 'pay') return 'Paying for mercenaries'
  if (o?.kind === 'buyCity') return 'Buying a city'
  if (o?.kind === 'buyOff') return 'Buying off a directive'
  if (o?.kind === 'trade')
    return o.side === 'buy' ? 'Buying at a warehouse' : 'Selling at a warehouse'
  if (o?.kind === 'attack') return o.path ? 'Going after their target' : 'Fighting'
  if (o?.kind === 'climb') return `Climbing a wall · ${pct(o.progress)}`
  if (isLineOrder(o)) {
    const [x, y] = o.tiles[0]!
    const what = LINE_BUILDING[o.kind]
    const left = `${o.tiles.length} ${what} tile${o.tiles.length === 1 ? '' : 's'} to go`
    return o.phase === 'walking'
      ? `Walking to lay ${what} at ${x}, ${y} · ${left}`
      : `Building ${what} at ${x}, ${y} · ${left}`
  }
  return 'Idle'
}

/**
 * The Player's residents, one row each under the city they live in (see `groupResidents`); click
 * a row to inspect that resident and show them on the map. Picking one elsewhere, such as on the
 * map, scrolls their row into view.
 */
export function ResidentsList({
  groups,
  leaderId,
  tick,
  scripts = [],
  buildings = [],
  selectedId,
  onSelect,
}: {
  groups: ResidentGroup<Resident>[]
  leaderId: string
  tick: number
  /** The Player's script library, to name the script each runs and the task it is for. */
  scripts?: ScriptSummary[]
  /** The buildings in sight, to name where residents store or fetch goods. */
  buildings?: Building[]
  selectedId: string | undefined
  onSelect: (id: string) => void
}) {
  const tableRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const row = tableRef.current?.querySelector(`[data-resident="${CSS.escape(selectedId)}"]`)
    // Its heading first, then the row itself, which wins when both don't fit.
    row?.closest('.residents-group')?.firstElementChild?.scrollIntoView({ block: 'nearest' })
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  const count = groups.reduce((n, g) => n + g.residents.length, 0)
  return (
    <section className="residents" aria-label="Residents">
      <div className="panel-head">
        <h2>Residents</h2>
        <span>{count} in sight</span>
      </div>
      <div className="residents-scroll">
        <div className="residents-table" ref={tableRef}>
          <div className="residents-row heading" aria-hidden="true">
            <span>Name</span>
            <span>Age</span>
            <span>Doing</span>
            <span>Hunger</span>
            <span>Carrying</span>
          </div>
          {groups.map((g) => (
            <div className="residents-group" key={g.key} role="group" aria-label={g.label}>
              <h3>
                {g.label} <span>· {g.residents.length}</span>
              </h3>
              {g.residents.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  data-resident={r.id}
                  className={`residents-row${r.id === selectedId ? ' selected' : ''}`}
                  aria-pressed={r.id === selectedId}
                  onClick={() => onSelect(r.id)}
                >
                  <span className="name">
                    {r.name}
                    {r.id === leaderId && <span className="leader-mark"> · Leader</span>}
                  </span>
                  <span className="mono">{Math.floor(ageInYears(r, tick))}</span>
                  <span className="doing" title={doingLine(r, { scripts, buildings })}>
                    {doingLine(r, { scripts, buildings })}
                    {r.script && <small className="muted">{scriptName(r, scripts)}</small>}
                  </span>
                  <span className="meter" aria-label={`Hunger ${pct(r.hunger / MAX_HUNGER)} fed`}>
                    <span
                      className={meterClass(r.hunger / MAX_HUNGER)}
                      style={{ width: pct(r.hunger / MAX_HUNGER) }}
                    />
                  </span>
                  <span className="mono">
                    {carryLine(stockWeight(r.carried), carryCapacity(r, tick))}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * The selection card for several of the Player's residents picked at once on the map (ADR 0012;
 * `CONTEXT.md`: Group, Resident card): a header with how many and who, then one open tab. Orders
 * gives each of them the same order, grouped by kind; Members lists what each is doing, a click
 * picking just that one; Script says what they run and gives them all one.
 */
export function GroupCard({
  residents,
  scripts,
  buildings,
  picking,
  onPicking,
  buildAt,
  onOrder,
  report,
  orderError,
  onPick,
  onClose,
  collapsed = false,
}: {
  residents: Resident[]
  scripts: ScriptSummary[]
  buildings: Building[]
  /** The map is waiting for a tile for the group's walk-to, work or build order. */
  picking: GroupPicking
  /** Starts (or cancels) picking a tile for the group. */
  onPicking: (picking: GroupPicking) => void
  /** The tile picked to build on: the site there to join, or the kinds that may go there. */
  buildAt: GroupBuildTile | undefined
  /** Gives each resident of the group the order (`CONTEXT.md`: Group). */
  onOrder: (order: GroupOrder) => void
  /** What the last group order did: how many it went to, and who was skipped and why. */
  report: { sent: number; of: number; skipped: Skipped[] } | undefined
  /** Why the last group order couldn't go out at all, such as no workplace on the tile. */
  orderError: string | undefined
  onPick: (id: string) => void
  onClose: () => void
  /** Shrunk to its head while the map waits for a target (ADR 0012: pick mode). */
  collapsed?: boolean
}) {
  const card = groupCard(residents)
  const [tab, setTab] = useState<GroupTab>(() => rememberedTabOf('group', GROUP_TABS))
  const [fetching, setFetching] = useState(false)
  const [good, setGood] = useState<Good>('food')
  const numberParams = groupNumberParams(residents, scripts)
  const foodHint = foodParamsHint(numberParams.map((p) => p.name))
  const showTab = (t: GroupTab) => {
    setTab(t)
    rememberTabOf('group', t)
  }
  const toggle = (p: Exclude<GroupPicking, false>) => {
    setFetching(false)
    onPicking(picking === p ? false : p)
  }
  const pickButton = (p: Exclude<GroupPicking, false>, label: string) => (
    <button type="button" aria-pressed={picking === p} onClick={() => toggle(p)}>
      {label}
    </button>
  )
  const idle = residents.filter((r) => !r.order && !r.script).length
  return (
    <SelectionCard
      rel="own"
      title={card.title}
      lines={[
        card.names,
        <strong key="doing">
          {idle === residents.length ? 'All idle' : `${residents.length - idle} busy, ${idle} idle`}
        </strong>,
      ]}
      onClose={onClose}
      collapsed={collapsed}
    >
      <CardTabs tabs={GROUP_TABS} labels={TAB_LABELS} tab={tab} onTab={showTab} />

      {tab === 'orders' && (
        <>
          <div className="sel-order-group">
            <h3>Move</h3>
            <div className="order-buttons" aria-label="Move">
              {pickButton('walk', 'Walk to')}
              <button type="button" onClick={() => onOrder({ kind: 'stop' })}>
                Stop
              </button>
            </div>
          </div>
          <div className="sel-order-group">
            <h3>Work &amp; build</h3>
            <div className="order-buttons" aria-label="Work & build">
              {pickButton('work', 'Work')}
              {pickButton('build', 'Build')}
            </div>
          </div>
          <div className="sel-order-group">
            <h3>Goods</h3>
            <div className="order-buttons" aria-label="Goods">
              <button type="button" onClick={() => onOrder({ kind: 'store' })}>
                Store
              </button>
              <button
                type="button"
                aria-pressed={fetching}
                onClick={() => {
                  onPicking(false)
                  setFetching(!fetching)
                }}
              >
                Fetch
              </button>
            </div>
          </div>
        </>
      )}
      {tab === 'orders' && buildAt && !picking && (
        <section className="inspector-block" aria-label="Build">
          <div className="panel-head">
            <h3>Build</h3>
            <span className="small muted">
              at {buildAt.x}, {buildAt.y}
            </span>
          </div>
          {buildAt.site ? (
            <div className="order-buttons">
              <button
                type="button"
                className="primary"
                onClick={() =>
                  onOrder({
                    kind: 'build',
                    building: buildAt.site!.kind,
                    at: { x: buildAt.site!.x, y: buildAt.site!.y },
                  })
                }
              >
                All help build the {BUILDING_NAMES[buildAt.site.kind].toLowerCase()}
              </button>
            </div>
          ) : (
            buildAt.kinds.map(({ kind, problem }) => (
              <div key={kind}>
                <div className="order-buttons">
                  <button
                    type="button"
                    className="primary"
                    disabled={problem !== undefined}
                    onClick={() => onOrder({ kind: 'build', building: kind, at: buildAt })}
                  >
                    Build {BUILDING_NAMES[kind].toLowerCase()}
                  </button>
                </div>
                {problem && <p className="muted small">Not here: {problem}.</p>}
              </div>
            ))
          )}
          <p className="muted small">
            Each walks there; the first lays out the site and the others join it.
          </p>
        </section>
      )}
      {tab === 'orders' && fetching && (
        <section className="inspector-block" aria-label="Fetch">
          <div className="order-buttons">
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
            <button type="button" onClick={() => onOrder({ kind: 'fetch', good })}>
              Fetch
            </button>
          </div>
          <p className="muted small">
            Each fetches as much as fits from the nearest storage or carriage holding it.
          </p>
        </section>
      )}
      {tab === 'members' && (
        <ul className="sel-facts sel-group" aria-label="Selected residents">
          {card.rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)}>
                <strong>{r.name}</strong> · {doingLine(r, { scripts, buildings })}
              </button>
            </li>
          ))}
          {card.more > 0 && <li>and {card.more} more</li>}
        </ul>
      )}
      {tab === 'script' && (
        <>
          <ul className="sel-facts" aria-label="Scripts they run">
            {scriptsRun(residents.map((r) => scriptName(r, scripts))).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <section className="inspector-block" aria-label="Run script">
            <RunScript
              script={undefined}
              scripts={scripts}
              label="Script for all of them to run"
              onRunScript={(scriptId) => onOrder({ kind: 'runScript', scriptId })}
            />
          </section>
          {numberParams.length > 0 && (
            <section className="inspector-block" aria-label="Script params">
              <div className="script-params">
                {numberParams.map(({ name, scriptIds }) => (
                  <div key={name} className="goods-row">
                    <span className="small">
                      <strong>{name}</strong> <span className="muted">(number)</span>
                    </span>
                    <NumberField
                      name={name}
                      value={undefined}
                      onSet={(v) =>
                        onOrder({ kind: 'setNumber', name, value: v ?? null, scriptIds })
                      }
                    />
                    <span className="buttons">
                      <button
                        type="button"
                        onClick={() => onOrder({ kind: 'setNumber', name, value: null, scriptIds })}
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
          )}
        </>
      )}

      {(orderError || picking || tab === 'orders') && (
        <p className="muted small" role="status">
          {orderError
            ? `Order turned down: ${orderError}`
            : picking
              ? `${GROUP_PICKING_HINTS[picking]} Tap a tile on the map.`
              : 'Right-click the map to walk them there. Hold Shift with any order to queue it.'}
        </p>
      )}
      {report && (
        <div className="small" aria-label="Last group order">
          <p>{groupSentLine(report.sent, report.of)}</p>
          {report.skipped.length > 0 && (
            <ul className="sel-facts">
              {report.skipped.map((s) => (
                <li key={s.id}>
                  Skipped <strong>{s.name}</strong>: {s.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SelectionCard>
  )
}

/** What the map waits for while a group order is being given. */
export type GroupPicking = false | 'walk' | 'work' | 'build'

/** The tile a group is to build on, with the site there or the kinds that may go there. */
export interface GroupBuildTile {
  x: number
  y: number
  site: Building | undefined
  kinds: { kind: BuildingKind; problem: string | undefined }[]
}

/** What picking a tile does for a group, said while the map waits for it. */
const GROUP_PICKING_HINTS: Record<Exclude<GroupPicking, false>, string> = {
  walk: 'They spread over free tiles around it, nearest first.',
  work: 'Those standing at the workplace there work it.',
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
  leaderId,
  cityName,
  tick,
  picking,
  onWalkTo,
  orderError,
  pile,
  storage,
  onPickUp,
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
  onTearDown,
  horses,
  onBreed,
  residents,
  onPair,
  others,
  mapSize,
  onAttack,
  walls,
  onClimb,
  carriage,
  onDriveTo,
  onHaulTo,
  onRoadTo,
  onWallTo,
  onStop,
  horseToRide,
  onRide,
  scripts,
  buildings = [],
  onRunScript,
  onEditScript,
  makeLeader,
  leaderName,
  onMakeLeader,
  rename,
  onRename,
  onClose,
  sections,
  onSections,
  scriptParams,
  onStore,
  onEditQueue,
  collapsed = false,
}: {
  resident: Resident
  leaderId: string
  cityName: string | undefined
  tick: number
  /** The map is waiting for a tile to walk or drive to, or for a haul route's other stop. */
  picking: Picking
  /** Starts (or cancels) picking a tile to walk to. */
  onWalkTo: () => void
  /** A carriage on the resident's tile, if one is in sight. */
  carriage: Carriage | undefined
  /** Starts (or cancels) picking a tile to drive the carriage to. */
  onDriveTo: () => void
  /** Starts (or cancels) picking the other stop of a haul route carrying these goods. */
  onHaulTo: (setup: HaulSetup) => void
  /** Starts (or cancels) picking the far end of a road to build along a line from here. */
  onRoadTo: () => void
  /** Starts (or cancels) picking the far end of a wall to build along a line from here. */
  onWallTo: () => void
  /** Orders the resident to stop what they are doing. */
  onStop: () => void
  /**
   * A horse of the realm on the resident's tile that pulls no carriage and nobody rides, if one is
   * in sight (`CONTEXT.md`: Riding).
   */
  horseToRide: { id: string } | undefined
  /** Orders the resident to mount that horse, or with none to dismount. */
  onRide: (horseId?: string) => void
  /** The Player's script library, to pick a script to run. */
  scripts: ScriptSummary[]
  /** The buildings in sight, to name where the resident stores or fetches goods. */
  buildings?: Building[]
  /** Orders the resident to run a script (`CONTEXT.md`: Running a script). */
  onRunScript: (scriptId: number) => void
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
  onBuild: (kind: BuildingKind) => void
  /** Why a kind can't be laid out from the resident's tile, as far as the Player knows. */
  buildProblem?: (kind: BuildingKind) => string | undefined
  /** Residents in sight working the building on the resident's tile. */
  workers: number
  /** Realms whose residents in sight work it: who holds it (`CONTEXT.md`: Holding a workplace). */
  holders: string[]
  /** The Player's realm. */
  realmId: string
  /** Orders the resident to work the workplace on their tile, making `makes` at a smithy. */
  onWork: (makes?: Good) => void
  /** Gives the resident the Feed the stable task for the stable they stand in. */
  onFeedStable: (stableId: string) => void
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
  /** Finished walls and gates in sight of other realms' cities, or of none. */
  walls: Building[]
  /** Orders the resident to climb over a wall or gate next to them. */
  onClimb: (wallId: string) => void
  /**
   * For one of the Player's own residents who isn't their Leader: why they can't be made Leader
   * now, if they can't (`makeLeaderProblem`). Undefined for the Leader and others' residents.
   */
  makeLeader: { problem: string | undefined } | undefined
  /** The Player's Leader's name, for the handover's confirm. */
  leaderName: string | undefined
  /** Orders the Leader to hand the realm over to this resident (`CONTEXT.md`: Leader handover). */
  onMakeLeader: () => void
  /**
   * For one of the Player's own residents: whether renaming them needs a realm name too (the
   * Leader of an unnamed realm). Undefined for others' residents, who can't be renamed.
   */
  rename: { needsRealmName: boolean } | undefined
  /** Renames the resident (`CONTEXT.md`: Renaming a resident), naming the realm when it asks. */
  onRename: (name: string, realmName?: string) => void
  /** Closes the card. */
  onClose: () => void
  /** The open tab and panel, kept by the caller so they stay from one selected unit to the next. */
  sections: CardSections<ActionId>
  onSections: (sections: CardSections<ActionId>) => void
  /** The fields for the params of the script they run (`ScriptParamFields`), if any. */
  scriptParams?: ReactNode
  /** Orders the resident to store what they carry at the nearest storage (`STORE_ALL`). */
  onStore?: () => void
  /** Edits the resident's queue to these steps, and loop when given (`CONTEXT.md`: Queue). */
  onEditQueue?: (steps: QueueStepRequest[], loop?: boolean) => void
  /** Shrunk to its header while the map waits for a target (ADR 0012: pick mode). */
  collapsed?: boolean
}) {
  const setPanel = (panel: ActionId | undefined) => onSections({ ...sections, panel })
  const age = Math.floor(ageInYears(r, tick))
  const skills = (Object.keys(SKILL_LABELS) as SkillName[]).filter((s) => (r.skills[s] ?? 0) > 0)
  const carried = goodsIn(r.carried)
  // Children can't pick up or put down goods (`CONTEXT.md`: Child).
  const child = !canWork(r, tick)
  const family = familyLine(r, residents, tick)
  const ground: GoodsSpot = { kind: 'ground' }
  const inStorage: GoodsSpot = { kind: 'storage', storageId: storage?.id ?? '' }
  const site = building?.site ? building : undefined
  const atSite: GoodsSpot = { kind: 'site', siteId: site?.id ?? '' }
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage?.id ?? '' }
  const needed = site ? materialsNeeded(site) : {}
  const roadSite = road?.site ? road : undefined
  const atRoadSite: GoodsSpot = { kind: 'site', siteId: roadSite?.id ?? '' }
  const roadNeeded = roadSite ? materialsNeeded(roadSite) : {}
  const atCarriageSite: GoodsSpot = { kind: 'site', siteId: carriageSite?.id ?? '' }
  const carriageNeeded = carriageSite ? materialsNeeded(carriageSite) : {}
  const actions = residentActions({
    adult: !child,
    busy: !!(r.order || r.script),
    inCity: r.cityId !== null,
    carriage,
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
    renamable: !!rename,
    riding: r.riding !== undefined,
    horseToRide: !!horseToRide,
    carrying: !!r.carrying,
    carries: carried.length > 0,
  })
  const tab = sections.tab
  const shown = actions.some((a) => a.id === sections.panel) ? sections.panel : undefined
  const act = (a: CardAction) => {
    // An order's key opens its panel from any tab, on the Orders tab.
    if (a.opens) {
      const open = tab === 'orders' && shown === a.id ? undefined : a.id
      return onSections({ ...sections, tab: 'orders', panel: open })
    }
    if (a.id === 'walk') onWalkTo()
    if (a.id === 'drive') onDriveTo()
    if (a.id === 'roadTo') onRoadTo()
    if (a.id === 'wallTo') onWallTo()
    if (a.id === 'stop') onStop()
    if (a.id === 'ride') onRide(r.riding === undefined ? horseToRide?.id : undefined)
    if (a.id === 'feedStable' && building) onFeedStable(building.id)
  }
  useActionKeys(actions, act)
  return (
    <SelectionCard
      rel={r.owner === realmId ? 'own' : 'alliance'}
      title={r.name}
      badge={r.id === leaderId ? 'Leader' : undefined}
      lines={[
        <strong key="doing">{doingLine(r, { scripts, buildings })}</strong>,
        `${carriedShort(r.carried, GOOD_LABELS)} · ${carryLine(stockWeight(r.carried), carryCapacity(r, tick))}`,
      ]}
      head={
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
      }
      onClose={onClose}
      collapsed={collapsed}
    >
      <div className="tabs sel-tabs" role="tablist" aria-label="Card">
        {CARD_TABS.map((t) => (
          <button
            type="button"
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => onSections({ ...sections, tab: t })}
          >
            {CARD_TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'orders' &&
        groupOrders(actions).map((g) => (
          <div className="sel-order-group" key={g.group}>
            <h3>{g.label}</h3>
            <ActionRows
              actions={g.actions}
              open={shown}
              onAction={act}
              label={g.label}
              keys={false}
            />
          </div>
        ))}
      {tab === 'queue' &&
        (r.queue && onEditQueue ? (
          <QueueBlock
            queue={r.queue}
            doing={doingLine(r, { scripts, buildings })}
            scripts={scripts}
            buildings={buildings}
            onEdit={onEditQueue}
          />
        ) : (
          <p className="muted small">Nothing queued. Hold Shift with any order to queue it.</p>
        ))}
      {tab === 'script' &&
        (r.script ? (
          <>
            <TaskScript scriptId={r.script.scriptId} scripts={scripts} onEdit={onEditScript} />
            {scriptParams}
          </>
        ) : (
          <p className="muted small">Runs no script. Give them one with Run script under Orders.</p>
        ))}
      {tab === 'orders' && shown && (
        <div className="sel-panel">
          {shown === 'haul' && carriage && (
            <HaulBlock resident={r} tick={tick} picking={picking === 'haul'} onHaulTo={onHaulTo} />
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
          {shown === 'build' && (
            <>
              <BuildBlock
                resident={r}
                tick={tick}
                building={building}
                node={node}
                buildProblem={buildProblem}
                onBuild={onBuild}
              />
              <CarriageBlock
                resident={r}
                tick={tick}
                building={building}
                carriageSite={carriageSite}
                buildProblem={buildProblem}
                onBuild={onBuild}
              />
              <RoadBlock resident={r} tick={tick} road={road} terrain={terrain} onBuild={onBuild} />
            </>
          )}
          {shown === 'tearDown' && (
            <>
              <TearDownBlock resident={r} tick={tick} building={building} onTearDown={onTearDown} />
              <TearDownBlock
                resident={r}
                tick={tick}
                building={carriageSite}
                onTearDown={onTearDown}
              />
              <TearDownBlock resident={r} tick={tick} building={road} onTearDown={onTearDown} />
            </>
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
              <section className="inspector-block" aria-label="Carrying">
                <div className="panel-head">
                  <h3>Carrying</h3>
                  <span className="mono small">
                    {carryLine(stockWeight(r.carried), carryCapacity(r, tick))}
                  </span>
                </div>
                {carried.length === 0 && (
                  <p className="muted small">
                    Nothing. Residents eat only what they carry; at home they take meals from
                    storage.
                  </p>
                )}
                {onStore && carried.length > 0 && (
                  <div className="order-buttons">
                    <button type="button" disabled={child} onClick={onStore}>
                      Store all
                    </button>
                    <span className="muted small">
                      at the nearest storage, keeping their own Food
                    </span>
                  </div>
                )}
                {carried.map(([good, units]) => (
                  <GoodsRow
                    key={good}
                    good={good}
                    units={units}
                    byDefault={putAwayUnits(good, units)}
                    disabled={child}
                    actions={[
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
                    ]}
                    onAct={onDrop}
                  />
                ))}
              </section>
              {(pile || storage || site || carriageSite || roadSite || carriage) && (
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
                    disabled={child}
                  />
                  {storage && (
                    <TileGoods
                      title={storage.kind === 'stable' ? 'In the stable' : 'In the storage'}
                      stock={storage.stock}
                      spot={inStorage}
                      onPickUp={onPickUp}
                      disabled={child}
                    />
                  )}
                  {site && (
                    <TileGoods
                      title="Delivered to the site"
                      stock={site.site!.delivered}
                      spot={atSite}
                      onPickUp={onPickUp}
                      disabled={child}
                    />
                  )}
                  {carriageSite && (
                    <TileGoods
                      title="Delivered to the carriage site"
                      stock={carriageSite.site!.delivered}
                      spot={atCarriageSite}
                      onPickUp={onPickUp}
                      disabled={child}
                    />
                  )}
                  {roadSite && (
                    <TileGoods
                      title="Delivered to the road site"
                      stock={roadSite.site!.delivered}
                      spot={atRoadSite}
                      onPickUp={onPickUp}
                      disabled={child}
                    />
                  )}
                  {carriage && (
                    <TileGoods
                      title={`On the carriage · ${kg(stockWeight(carriage.load))} / ${kg(CARRIAGE_CAPACITY)}${carriage.horseId ? '' : ' · no horse hitched'}`}
                      stock={carriage.load}
                      spot={onCarriage}
                      onPickUp={onPickUp}
                      disabled={child}
                    />
                  )}
                </section>
              )}
            </>
          )}
          {shown === 'pair' && (
            <PairBlock resident={r} tick={tick} residents={residents} onPair={onPair} />
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
              <div className="panel-head">
                <h3>Run script</h3>
              </div>
              <RunScript script={r.script} scripts={scripts} onRunScript={onRunScript} />
            </section>
          )}
          {shown === 'makeLeader' && makeLeader && (
            <section className="inspector-block" aria-label="Make Leader">
              <div className="panel-head">
                <h3>Make Leader</h3>
              </div>
              <p className="small">
                Hand your realm to {r.name}? {leaderName ?? 'Your Leader'} stays on as an ordinary
                resident.
              </p>
              {makeLeader.problem && <p className="muted small">{makeLeader.problem}.</p>}
              <div className="order-buttons">
                <button
                  type="button"
                  className="primary"
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
              </div>
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
      )}

      {tab === 'stats' && (
        <>
          <ul className="sel-facts">
            <li>
              {child ? 'Child' : 'Adult'} · {age} years{cityName ? ` · ${cityName}` : ''}
              {r.riding ? ' · on horseback' : ''}
            </li>
            {family && <li>{family}</li>}
          </ul>
          <section className="inspector-block" aria-label="Stats">
            <div className="panel-head">
              <h3>Stats</h3>
              <span className="small muted">base + trained (cap)</span>
            </div>
            {STAT_NAMES.map((s) => {
              const { base, trained } = r.stats[s]
              const cap = trainedCap(base)
              return (
                <div className="stat" key={s}>
                  <span>{STAT_LABELS[s]}</span>
                  <span className="stat-bar" aria-hidden="true">
                    <span className="base" style={{ width: pct(base / STAT_SCALE) }} />
                    <span className="trained" style={{ width: pct(trained / STAT_SCALE) }} />
                    <span className="cap" style={{ width: pct((cap - trained) / STAT_SCALE) }} />
                  </span>
                  <span className="mono right">
                    {base} + {trained} ({cap})
                  </span>
                </div>
              )
            })}
          </section>
          <section className="inspector-block" aria-label="Skills">
            <h3>Skills</h3>
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
        </>
      )}
      {(orderError || tab === 'orders') && (
        <p className="muted small" role="status">
          {orderError
            ? `Order turned down: ${orderError}`
            : 'Right-click the map to walk there. Hold Shift with any order to queue it.'}
        </p>
      )}
    </SelectionCard>
  )
}

/**
 * Setting up a haul route with the carriage on the resident's tile (`CONTEXT.md`: Haul route):
 * which goods go from here to the other stop, which come back, and how much Food stays on board
 * for the horse, then the other stop on the map.
 */
function HaulBlock({
  resident,
  tick,
  picking,
  onHaulTo,
}: {
  resident: Resident
  tick: number
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
  const o = resident.order
  return (
    <section className="inspector-block" aria-label="Haul route">
      <div className="panel-head">
        <h3>Haul route</h3>
        {o?.kind === 'haul' && <span className="small muted">on a route</span>}
      </div>
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
          className={picking ? 'primary' : ''}
          aria-pressed={picking}
          disabled={!canWork(resident, tick) || goods.length === 0}
          onClick={() => onHaulTo({ goods, returnGoods, keepFood })}
        >
          {picking ? 'Pick a tile…' : 'Pick the other stop'}
        </button>
      </div>
      <p className="muted small">
        The driver loads the picked goods here, drives them to the other stop and unloads them,
        brings the goods picked to come back, again and again until stopped. A stop with a storage
        loads and unloads there, else on the ground. The horse eats from the carriage’s load; its
        Food is topped up wherever there is some.
      </p>
    </section>
  )
}

/**
 * Building on the resident's tile (`CONTEXT.md`: Building): on a resource node with nothing on it,
 * build its workplace; on any other empty tile, whatever goes off a node (`buildMenu`), saying why
 * a kind can't go here; on a construction site, see what it still needs and help build it.
 */
function BuildBlock({
  resident,
  tick,
  building,
  node,
  terrain,
  buildProblem = () => undefined,
  onBuild,
}: {
  resident: Resident
  tick: number
  building: Building | undefined
  node: KnownNode | undefined
  /** The explored terrain beneath the site, if known (`buildingWork`). */
  terrain?: number
  /** Why a kind can't be laid out from the resident's tile, as far as the Player knows. */
  buildProblem?: (kind: BuildingKind) => string | undefined
  onBuild: (kind: BuildingKind) => void
}) {
  const adult = canWork(resident, tick)
  const o = resident.order
  if (building?.site) {
    const name = BUILDING_NAMES[building.kind]
    const work = BUILD_WORK[building.kind] ?? 0
    const materials = goodsIn(BUILD_MATERIALS[building.kind])
    const joined = o?.kind === 'build' && o.siteId === building.id
    return (
      <section className="inspector-block" aria-label="Build">
        <div className="panel-head">
          <h3>Construction site</h3>
          <span className="small muted">{name}</span>
        </div>
        <Meter
          label="Work"
          value={pct(work > 0 ? building.site.work / work : 1)}
          share={work > 0 ? building.site.work / work : 1}
        />
        {materials.length === 0 && <p className="muted small">Needs no materials.</p>}
        {materials.map(([good, units]) => (
          <div className="goods-row" key={good}>
            <span>{GOOD_LABELS[good]}</span>
            <span className="mono">
              {building.site!.delivered[good] ?? 0} / {units}
            </span>
            <span />
          </div>
        ))}
        <div className="order-buttons">
          <button type="button" disabled={!adult || joined} onClick={() => onBuild(building.kind)}>
            {joined ? 'Building…' : 'Help build'}
          </button>
        </div>
        <p className="muted small">
          It becomes a {name.toLowerCase()} once its materials are delivered and the work is done:
          about {workSpan(buildingWork(building.kind, terrain))} of one resident’s work in all
          {workFactor(building.kind, terrain) > 1 &&
            `, on Mountain ${workFactor(building.kind, terrain)} times as much as elsewhere`}
          .
        </p>
      </section>
    )
  }
  if (!building) {
    // On a node its workplace; anywhere else every kind that goes off a node. One that can't go
    // here says why rather than being left out.
    const kinds = buildMenu(node)
    return (
      <section className="inspector-block" aria-label="Build">
        <div className="panel-head">
          <h3>Build</h3>
          <span className="small muted">
            {node ? `${NODE_NAMES[node.kind]} node` : 'off any node'}
          </span>
        </div>
        {kinds.map((kind) => {
          const materials = goodsIn(BUILD_MATERIALS[kind])
          const problem = buildProblem(kind)
          return (
            <div key={kind}>
              <p className="muted small">
                {BUILDING_PURPOSE[kind]} Needs{' '}
                {materials.length === 0
                  ? 'no materials'
                  : materials
                      .map(([g, n]) => `${n} ${GOOD_LABELS[g].toLowerCase()}`)
                      .join(', ')}{' '}
                and about {workSpan(BUILD_WORK[kind] ?? 0)} of one resident’s work.
              </p>
              <div className="order-buttons">
                <button
                  type="button"
                  className="primary"
                  disabled={!adult || problem !== undefined}
                  onClick={() => onBuild(kind)}
                >
                  Build {BUILDING_NAMES[kind].toLowerCase()}
                </button>
              </div>
              {problem && <p className="muted small">Not here: {problem}.</p>}
            </div>
          )
        })}
      </section>
    )
  }
  return null
}

/**
 * A carriage at the stable the resident stands at (`CONTEXT.md`: Carriage): on a tile with no
 * carriage site, lay one out there; on a carriage site, see what it still needs and help build it.
 */
function CarriageBlock({
  resident,
  tick,
  building,
  carriageSite,
  buildProblem = () => undefined,
  onBuild,
}: {
  resident: Resident
  tick: number
  building: Building | undefined
  carriageSite: Building | undefined
  buildProblem?: (kind: BuildingKind) => string | undefined
  onBuild: (kind: BuildingKind) => void
}) {
  if (carriageSite?.site) {
    return (
      <BuildBlock
        resident={resident}
        tick={tick}
        building={carriageSite}
        node={undefined}
        onBuild={onBuild}
      />
    )
  }
  if (building?.kind !== 'stable' || building.site) return null
  const materials = goodsIn(BUILD_MATERIALS.carriage)
  const problem = buildProblem('carriage')
  return (
    <section className="inspector-block" aria-label="Carriage">
      <div className="panel-head">
        <h3>Carriage</h3>
        <span className="small muted">at the stable</span>
      </div>
      <p className="muted small">
        {BUILDING_PURPOSE.carriage} Needs{' '}
        {materials.map(([g, n]) => `${n} ${GOOD_LABELS[g].toLowerCase()}`).join(', ')} and about{' '}
        {workSpan(BUILD_WORK.carriage ?? 0)} of one resident’s work.
      </p>
      <div className="order-buttons">
        <button
          type="button"
          className="primary"
          disabled={!canWork(resident, tick) || problem !== undefined}
          onClick={() => onBuild('carriage')}
        >
          Build carriage
        </button>
      </div>
      {problem && <p className="muted small">Not here: {problem}.</p>}
    </section>
  )
}

/**
 * A road on the resident's tile (`CONTEXT.md`: Road): with none, lay one out, next to any
 * building there; on a road site, see what it still needs and help build it.
 */
function RoadBlock({
  resident,
  tick,
  road,
  terrain,
  onBuild,
}: {
  resident: Resident
  tick: number
  road: Building | undefined
  /** The explored terrain beneath the resident's tile, if known (`buildingWork`). */
  terrain?: number
  onBuild: (kind: BuildingKind) => void
}) {
  if (road?.site) {
    return (
      <BuildBlock
        resident={resident}
        tick={tick}
        building={road}
        node={undefined}
        terrain={terrain}
        onBuild={onBuild}
      />
    )
  }
  if (road) return null
  const materials = goodsIn(BUILD_MATERIALS.road)
  return (
    <section className="inspector-block" aria-label="Road">
      <div className="panel-head">
        <h3>Road</h3>
      </div>
      <p className="muted small">
        {BUILDING_PURPOSE.road} Needs{' '}
        {materials.map(([g, n]) => `${n} ${GOOD_LABELS[g].toLowerCase()}`).join(', ')} and about{' '}
        {workSpan(buildingWork('road', terrain))} of one resident’s work
        {workFactor('road', terrain) > 1 && ' here on Mountain'}.
      </p>
      <div className="order-buttons">
        <button type="button" disabled={!canWork(resident, tick)} onClick={() => onBuild('road')}>
          Build road
        </button>
      </div>
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
  onWork: (makes?: Good) => void
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
      <div className="panel-head">
        <h3>{BUILDING_NAMES[building.kind]}</h3>
        <span className="mono small">
          {workers} / {max} workers
        </span>
      </div>
      <p className="small">{holding(holders, realmId)}</p>
      {recipes.length > 1 ? (
        // A smithy: each worker says what they make (`CONTEXT.md`: Smithy).
        recipes.map((r) => {
          const made = recipeGood(r)
          const making = working && o.makes === made
          return (
            <div key={made} className="goods-row">
              <span>{GOOD_LABELS[made]}</span>
              <span className="muted small">{stockText(r.input)}</span>
              <button type="button" disabled={blocked || making} onClick={() => onWork(made)}>
                {making ? 'Making…' : working ? 'Make instead' : 'Make'}
              </button>
            </div>
          )
        })
      ) : (
        <div className="order-buttons">
          <button
            type="button"
            className="primary"
            disabled={blocked || working}
            onClick={() => onWork()}
          >
            {working ? 'Working…' : 'Work here'}
          </button>
        </div>
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
  onTearDown,
}: {
  resident: Resident
  tick: number
  building: Building | undefined
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
      <div className="panel-head">
        <h3>Tear down</h3>
        <span className="small muted">{what}</span>
      </div>
      {building.teardown !== undefined && (
        <Meter label="Torn down" value={pct(share)} share={share} />
      )}
      <p className="muted small">
        Takes about {Math.ceil((work / TICKS_PER_GAME_DAY) * 10) / 10} game days of one resident’s
        work and leaves{' '}
        {leaves.length === 0
          ? 'nothing'
          : leaves.map(([g, n]) => `${n} ${GOOD_LABELS[g].toLowerCase()}`).join(', ')}{' '}
        on the tile.
      </p>
      <div className="order-buttons">
        <button
          type="button"
          disabled={!canWork(resident, tick) || joined}
          onClick={() => onTearDown(building.id)}
        >
          {joined ? 'Tearing down…' : `Tear down ${what}`}
        </button>
      </div>
    </section>
  )
}

/**
 * Breeding (`CONTEXT.md`: Breeding): pick two of the Player's horses in the stable on the
 * resident's tile for them to breed, or see how far their breeding has come.
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
  const pair = picked.length === 2 ? ([picked[0]!, picked[1]!] as [string, string]) : undefined
  // The Player knows how their own horses fare (`CONTEXT.md`: Seeing how someone fares).
  const seen = { horses: horses.filter(horseFaresKnown), residents }
  const problem = !canWork(resident, tick)
    ? 'children can’t breed horses'
    : pair
      ? breedProblem(seen, stable, { realmId }, resident, pair)
      : 'pick two horses'
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)))
  return (
    <section className="inspector-block" aria-label="Breed horses">
      <div className="panel-head">
        <h3>Breed horses</h3>
        <span className="small muted">{own.length} of yours here</span>
      </div>
      {breeding && (
        <Meter
          label="Foal"
          value={pct(breeding.progress / STABLE_BREED_TICKS)}
          share={breeding.progress / STABLE_BREED_TICKS}
        />
      )}
      <p className="muted small">
        Tending two fed horses for {STABLE_BREED_DAYS} game days brings a foal with their average
        stats, give or take {FOAL_STAT_SPREAD}. It stops, and starts over, if the resident or a
        horse leaves.
      </p>
      {own.length === 0 && <p className="muted small">No horses of yours in this stable.</p>}
      {own.map((h) => (
        <label key={h.id} className="small" style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={picked.includes(h.id)}
            onChange={() => toggle(h.id)}
            disabled={!!breeding}
          />{' '}
          {horseDetail(h, tick)}
        </label>
      ))}
      <div className="order-buttons">
        <button
          type="button"
          disabled={!!breeding || !pair || problem !== undefined}
          title={problem}
          onClick={() => pair && onBreed(stable.id, pair)}
        >
          {breeding ? 'Breeding…' : 'Breed these two'}
        </button>
      </div>
      {!breeding && pair && problem && <p className="muted small">{problem}</p>}
    </section>
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
  const choices = residents.filter(
    (x) => x.id !== resident.id && x.cityId === resident.cityId && canWork(x, tick) && !x.carrying,
  )
  const days = o
    ? Math.max(0, Math.ceil((o.since + TICKS_PER_GAME_YEAR - tick) / TICKS_PER_GAME_DAY))
    : 0
  const expecting = resident.carrying || partner?.carrying
  return (
    <section className="inspector-block" aria-label="Pairing">
      <div className="panel-head">
        <h3>Pairing</h3>
        <span className="small muted">one child a year at most</span>
      </div>
      {expecting ? (
        <p className="muted small">{familyLine(resident, residents, tick)}.</p>
      ) : (
        o && (
          <p className="muted small">
            Paired with {partner?.name ?? 'someone out of sight'}.{' '}
            {days > 0 ? `In about ${days} game days` : 'Now'}, once the city has free housing and a
            food surplus, one of them starts carrying a child for {CARRYING_DAYS} game days; the
            other keeps working.
          </p>
        )
      )}
      <div className="order-buttons">
        <select
          aria-label="Partner"
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
        >
          <option value="">Pick a partner…</option>
          {choices.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!partnerId || !!resident.carrying}
          onClick={() => onPair(partnerId)}
        >
          Pair
        </button>
      </div>
    </section>
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
      <div className="panel-head">
        <h3>Rename</h3>
        <span className="small muted">free, at once</span>
      </div>
      <form onSubmit={submit}>
        <div className="order-buttons">
          <input
            value={name}
            maxLength={RESIDENT_NAME_MAX_LENGTH}
            aria-label="New name"
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        {needsRealmName && (
          <>
            <p className="small">
              Your realm has no name yet: name it now. Others will know it by this name, and it
              never changes.
            </p>
            <div className="order-buttons">
              <input
                value={realmName}
                maxLength={REALM_NAME_MAX_LENGTH}
                placeholder="Realm name"
                aria-label="Realm name"
                onChange={(e) => setRealmName(e.target.value)}
                required
              />
            </div>
          </>
        )}
        <div className="order-buttons">
          <button type="submit" className="primary" disabled={!!problem}>
            Rename
          </button>
        </div>
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
      <div className="panel-head">
        <h3>Walls</h3>
        <span className="small muted">break or climb</span>
      </div>
      {breaking && (
        <Meter
          label={`Breaking the ${label(breaking).toLowerCase()} at ${breaking.x}, ${breaking.y}`}
          value={`${Math.round(wallStrengthLeft(breaking))} / ${wallStrength(breaking)}`}
          share={wallStrengthLeft(breaking) / wallStrength(breaking)}
        />
      )}
      <div className="order-buttons">
        <select aria-label="Wall" value={wallId} onChange={(e) => setWallId(e.target.value)}>
          <option value="">Pick a wall or gate…</option>
          {choices.map(({ w, d }) => (
            <option key={w.id} value={w.id}>
              {label(w)} at {w.x}, {w.y} · {Math.round(d)} tiles
              {w.damage ? ` · ${pct(w.damage / wallStrength(w))} broken` : ''}
            </option>
          ))}
        </select>
        <button type="button" disabled={!picked} onClick={() => onBreak(wallId)}>
          Break
        </button>
        <button type="button" disabled={!beside} onClick={() => onClimb(wallId)}>
          Climb
        </button>
      </div>
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
  const weapon = bestWeapon(resident)
  const choices = others
    .map((x) => ({ x, d: wrapDistance(mapSize, resident, x) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, ATTACK_CHOICES)
  return (
    <section className="inspector-block" aria-label="Attack">
      <div className="panel-head">
        <h3>Attack</h3>
        <span className="small muted">
          {weapon ? `fights with a ${GOOD_LABELS[weapon].toLowerCase()}` : 'unarmed'}
        </span>
      </div>
      {o?.kind === 'attack' && !walls.some((w) => w.id === o.targetId) && (
        <p className="muted small">Attacking {target?.name ?? 'someone out of sight'}.</p>
      )}
      {choices.length === 0 ? (
        <p className="muted small">Nobody of another realm in sight.</p>
      ) : (
        <div className="order-buttons">
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
          <button type="button" disabled={!targetId} onClick={() => onAttack(targetId)}>
            Attack
          </button>
        </div>
      )}
    </section>
  )
}

/** Goods at one spot on the resident's tile, each with a button to pick it up. */
function TileGoods({
  title,
  stock,
  spot,
  onPickUp,
  disabled,
}: {
  title: string
  stock: Stock | undefined
  spot: GoodsSpot
  onPickUp: (from: GoodsSpot, goods: Stock) => void
  disabled: boolean
}) {
  const goods = goodsIn(stock)
  return (
    <>
      <div className="small muted">{title}</div>
      {goods.length === 0 && <p className="muted small">Nothing.</p>}
      {goods.map(([good, units]) => (
        <GoodsRow
          key={good}
          good={good}
          units={units}
          byDefault={units}
          disabled={disabled}
          actions={[{ label: 'Pick up', spot }]}
          onAct={onPickUp}
        />
      ))}
    </>
  )
}

/**
 * One good with an amount and buttons that act on that many: `byDefault` until the Player types
 * an exact amount, which is honoured as typed (`CONTEXT.md`: Own food).
 */
function GoodsRow({
  good,
  units,
  byDefault,
  disabled,
  actions,
  onAct,
}: {
  good: Good
  units: number
  byDefault: number
  disabled: boolean
  actions: { label: string; spot: GoodsSpot }[]
  onAct: (spot: GoodsSpot, goods: Stock) => void
}) {
  const [typed, setTyped] = useState<number>()
  const amount = Math.min(typed ?? byDefault, units)
  return (
    <div className="goods-row">
      <span>{GOOD_LABELS[good]}</span>
      <span className="mono">{units}</span>
      <span className="buttons">
        <input
          className="amount"
          type="number"
          min={0}
          max={units}
          step={1}
          aria-label={`${GOOD_LABELS[good]} amount`}
          value={amount}
          disabled={disabled}
          onChange={(e) => setTyped(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
        {actions.map(({ label, spot }) => (
          <button
            key={label}
            type="button"
            disabled={disabled || amount === 0}
            onClick={() => {
              onAct(spot, { [good]: amount })
              setTyped(undefined)
            }}
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  )
}

function Meter({ label, value, share }: { label: string; value: string; share: number }) {
  return (
    <div className="vital">
      <div className="vital-head">
        <span className="muted">{label}</span>
        <span className="mono">{value}</span>
      </div>
      <span className="meter big">
        <span className={meterClass(share)} style={{ width: pct(share) }} />
      </span>
    </div>
  )
}

/** Who holds a workplace, in the Player's words (`CONTEXT.md`: Holding a workplace). */
function holding(holders: string[], realmId: string): string {
  const others = holders.filter((h) => h !== realmId).length
  if (holders.length === 0) return 'Nobody holds it: whoever works it gets its output.'
  if (others === 0) return 'Held by your realm.'
  if (others === holders.length) return 'Held by another realm: its workers get the output.'
  return 'Held by your realm and another: their workers share the output.'
}

/**
 * Gives a resident or an army the run-script order with one of the Player's scripts
 * (`CONTEXT.md`: Running a script). Only scripts with an active version can run; any other
 * order ends it.
 */
export function RunScript({
  script,
  scripts,
  onRunScript,
  label = 'Script to run',
}: {
  /** The script the resident or army runs now, if any. */
  script: { scriptId: number } | undefined
  scripts: ScriptSummary[]
  onRunScript: (scriptId: number) => void
  label?: string
}) {
  const runnable = scripts.filter((s) => s.activeVersion !== null)
  const [picked, setPicked] = useState<number>()
  const scriptId = runnable.some((s) => s.id === picked) ? picked : runnable[0]?.id
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
            value={scriptId}
            onChange={(e) => setPicked(Number(e.target.value))}
          >
            {runnable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={scriptId === undefined}
            onClick={() => scriptId !== undefined && onRunScript(scriptId)}
          >
            Run script
          </button>
        </div>
      )}
    </div>
  )
}
