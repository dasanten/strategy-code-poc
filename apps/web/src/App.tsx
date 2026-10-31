import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import {
  BUILDABLE,
  carriagePulledBy,
  holdersOf,
  carriageOfResident,
  horseOfResident,
  riderOf,
  seatsLeft,
  KEEPS_GOODS,
  MAX_WORKERS,
  buildMenu,
  isPassableTerrain,
  isWallOrGate,
  type Account,
  type Building,
  type BuildingKind,
  type Good,
  type GoodsSpot,
  type KnownNode,
  type OrderRequest,
  type Resident,
  type ScriptParam,
  type ScriptSummary,
  type StartParamValues,
  type Stock,
  type TrainingSubject,
  isAt,
  SHARES_A_TILE,
  targetParam,
  covers,
  type SeenResident,
  HORSE_GRANT_HORSES,
  UNEXPLORED,
} from '@csp/shared'
import { AdminPage } from './AdminPanel.js'
import { AlliancePanel } from './Alliance.js'
import { commandsSeen } from './alliance-army.js'
import { ArmiesPanel, type ArmyPick } from './Armies.js'
import { ContractsPanel } from './Contracts.js'
import { StandingPanel } from './Standing.js'
import { api } from './api.js'
import { CityInspector } from './CityInspector.js'
import { keyGoods, showBeside, toggleDrawer, type DrawerId, type OpenDrawer } from './hud-view.js'
import {
  CentredDialog,
  Drawer,
  DrawerEdge,
  HorseOfferNotice,
  PhoneMenu,
  ToolRail,
  TopBar,
  mapCovered,
  useEscapeCloses,
} from './Hud.js'
import type { Covered } from './map/camera.js'
import { groupResidents, rememberedTab, rememberTab, type CardSections } from './residents-view.js'
import { groupHorses } from './horses-view.js'
import { HorsesList } from './Horses.js'
import { Founding } from './Founding.js'
import {
  appendRequest,
  appendToEach,
  editPlan,
  EMPTY_PLAN,
  givePlan,
  giveToAll,
  planOf,
  planStep,
  storeAll,
  useShiftHeld,
  type QueuePlan,
} from './queue-view.js'
import { AddStep } from './AddStep.js'
import { GroupPlanner } from './GroupPlanner.js'
import { hasBlocks, type PlanItem } from './plan-blocks.js'
import {
  horsesIn,
  nextPick,
  pickInto,
  planAsk,
  planOrder,
  type Plan,
  type PlanAnswer,
  type PlanStepId,
  type PlanWorld,
} from './plan-step.js'
import { useSavedGroups } from './saved-groups.js'
import { groupRequests, type GroupOrder, type Place, type Skipped } from './group-orders.js'
import { BUILDING_NAMES } from './map/palette.js'
import { Login } from './Login.js'
import { MapView } from './MapView.js'
import { isWikiPath, pageFor } from './pages.js'
import { Wiki } from './Wiki.js'
import { RealmLog } from './RealmLog.js'
import { realmEnded } from './realm-log.js'
import {
  GOOD_LABELS,
  GroupCard,
  ResidentCard,
  type GroupPicking,
  type GroupPickWith,
  ResidentsList,
  type HaulSetup,
  type Picking,
} from './Residents.js'
import { arrivalOf } from './doing-view.js'
import { CardSheet, PickBanner, TileCard } from './SelectionCard.js'
import { pickHint, pickPrompt, pickTarget, useMediaQuery, useTouchScreen } from './pick-mode.js'
import { PHONE_QUERY } from './sheet-view.js'
import { buildingNodeKind } from './building-info-view.js'
import {
  buildHereProblem,
  describeTile,
  makeLeaderProblem,
  nodeFit,
  type ActionId,
} from './selection-view.js'
import { ScriptLibrary, type ScriptToOpen } from './ScriptLibrary.js'
import { ScriptLog } from './ScriptLog.js'
import { ScriptMemoryTree } from './ScriptMemory.js'
import { ScriptRunInfo } from './ScriptRun.js'
import { ScriptParamFields, StartParamsForm } from './ScriptParams.js'
import {
  groupStartValues,
  startedScript,
  startFormParams,
  startParamValues,
  startValues,
  startValuesValid,
  type StartValues,
} from './start-params.js'
import { paramPickAt, paramValueLabel, type ParamWorld } from './script-params-view.js'
import { faresKnown, loadKnown } from './seen.js'
import { useWorld } from './useWorld.js'

/**
 * The form shown before a script with params starts (`CONTEXT.md`: Script parameter, Before it
 * starts): the script, the values in the form, the param being picked on the map for it, why the
 * last pick picked nothing, and what Start gives with the values.
 */
interface Starting {
  script: ScriptSummary
  /** The params the form shows (`startFormParams`). */
  params: ScriptParam[]
  values: StartValues
  picking?: ScriptParam
  error?: string
  start: (params: StartParamValues) => Promise<void>
}

/** What the resident card's script param fields need of the world (`script-params-view`). */
function paramWorld(world: NonNullable<ReturnType<typeof useWorld>['world']>): ParamWorld {
  const { buildings, carriages, cities } = world
  const [lastSeen, realmId] = [world.lastSeen.buildings, world.home.realmId]
  return { buildings, lastSeen, carriages, cities, realmId, size: world.map.size }
}

/** What the queue planner's map picks need of the world (`plan-step`). */
function planWorld(world: NonNullable<ReturnType<typeof useWorld>['world']>): PlanWorld {
  return { ...paramWorld(world), horses: world.horses }
}

export function App() {
  // The Wiki needs no account, so it shows without asking who is logged in.
  if (isWikiPath(window.location.pathname)) return <Wiki />
  return <Pages />
}

function Pages() {
  const [account, setAccount] = useState<Account | null | 'loading'>('loading')

  useEffect(() => {
    api.me().then(setAccount, () => setAccount(null))
  }, [])

  const loggedOut = useCallback(() => setAccount(null), [])

  if (account === 'loading') return null
  if (!account) return <Login onLoggedIn={setAccount} />
  // The admin page never mounts the game, so it never opens the admin's realm.
  if (pageFor(window.location.pathname, account) !== 'game')
    return <AdminPage account={account} onLoggedOut={loggedOut} />
  return <Game account={account} onLoggedOut={loggedOut} />
}

function Game({ account, onLoggedOut }: { account: Account; onLoggedOut: () => void }) {
  const { world, founding, status, sendOrder, found, memories, runs, scriptLogs, watchScript } =
    useWorld(onLoggedOut)
  // The residents picked on the map or in the list: one shows their card, several a group card.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // A tile picked on the map with no resident of the Player's on it; its card shows over the
  // resident's, who stays picked to be sent there.
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number }>()
  // The horse last picked in the Horses drawer, to mark its row among others on the same tile.
  const [pickedHorseId, setPickedHorseId] = useState<string>()
  // The resident card's open tab and panel, kept here so they stay as the Player picks others;
  // the tab is also remembered in this browser (ADR 0012).
  const [cardSections, setCardSections] = useState<CardSections<ActionId>>(() => ({
    tab: rememberedTab(),
  }))
  const [picking, setPicking] = useState<Picking>(false)
  const [haulSetup, setHaulSetup] = useState<HaulSetup>()
  const [orderError, setOrderError] = useState<string | undefined>()
  const [armyPick, setArmyPick] = useState<ArmyPick>()
  const [armyError, setArmyError] = useState<string | undefined>()
  // The param of the picked resident's script whose value the map is waiting for (`CONTEXT.md`:
  // Script parameter).
  const [paramPick, setParamPick] = useState<ScriptParam>()
  // The step being planned with the queue planner's Add step (`CONTEXT.md`: Queue, Planning
  // ahead): the map picks its places, then the card asks for what more it needs.
  const [plan, setPlan] = useState<Plan>()
  // The queue planned on the group card, held here until given to all (`CONTEXT.md`: Planning
  // for a group); with none open, a step planned for a group goes onto each one's own queue.
  const [groupPlan, setGroupPlan] = useState<QueuePlan>()
  // Plans with repeat blocks waiting to be given, by resident (`CONTEXT.md`: Repeat block): they
  // stay while other cards are open, until given or discarded.
  const [queuePlans, setQueuePlans] = useState<Record<string, QueuePlan>>({})
  const planQueue = (id: string, plan: QueuePlan | undefined) =>
    setQueuePlans((plans) => {
      const next = { ...plans }
      if (plan) next[id] = plan
      else delete next[id]
      return next
    })
  const [starting, setStarting] = useState<Starting>()
  // The param whose value the map is waiting for: of the running script, or for the form.
  const pickingParam = paramPick ?? starting?.picking
  // A group order waiting for a tile, the tile picked to build on, and what the last one did.
  const [groupPicking, setGroupPicking] = useState<GroupPicking>(false)
  // What the group order being picked needs besides the tile, and a line's first end.
  const [groupPickWith, setGroupPickWith] = useState<GroupPickWith>({})
  const [groupLineFrom, setGroupLineFrom] = useState<{ x: number; y: number }>()
  const [groupBuildAt, setGroupBuildAt] = useState<{ x: number; y: number }>()
  const [groupReport, setGroupReport] = useState<{ sent: number; of: number; skipped: Skipped[] }>()
  const [groupError, setGroupError] = useState<string>()
  // The residents the Player gives orders to: their own, less those handed over to their alliance's
  // army or rented out, and, as its alliance leader, the ones handed over (`CONTEXT.md`: Alliance
  // army) and the mercenaries they hired (`CONTEXT.md`: Mercenary contract).
  const own = world
    ? world.residents.filter(
        (r): r is Resident => commandsSeen(world.diplomacy, world.home.realmId, r) && faresKnown(r),
      )
    : []
  const group = selectedIds.flatMap((id) => own.filter((r) => r.id === id))
  const selected = group.length === 1 ? group[0] : undefined
  // The realm's carriages someone of the group stands on, to board with the seats left on each
  // (`CONTEXT.md`: Passenger).
  const groupCarriages = world
    ? world.carriages.flatMap((k) =>
        k.load && group.some((r) => r.x === k.x && r.y === k.y && carriageOfResident(k, r))
          ? [
              {
                carriage: k,
                seats: seatsLeft(world, { ...k, load: k.load }, k.passengerIds?.length ?? 0),
              },
            ]
          : [],
      )
    : []
  const homeCity = world?.cities.find((c) => c.id === world.home.cityId)
  // The script library's list, shared with the resident inspector's run-script order.
  const [scripts, setScripts] = useState<ScriptSummary[]>([])
  // A script to open in the library, such as the one a resident's task runs; `at` reopens it.
  const [scriptToOpen, setScriptToOpen] = useState<ScriptToOpen>()
  // A place to show on the map, such as one from the realm log or a resident picked in the list:
  // asked for, then centred between the open drawer and the selection card once they are drawn.
  const [toShow, setToShow] = useState<{ x: number; y: number }>()
  const [focus, setFocus] = useState<{ x: number; y: number; cover: Covered }>()
  // The drawer open over the map, if any (ADR 0008: one at a time).
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>()
  const closeDrawer = useCallback(() => setOpenDrawer(undefined), [])
  useEscapeCloses(openDrawer, closeDrawer)
  /** Opens a script in the library, at a version and line when given. */
  const openScript = (id: number, where?: Omit<ScriptToOpen, 'id' | 'at'>) => {
    setScriptToOpen({ id, at: Date.now(), ...where })
    setOpenDrawer('scripts')
  }
  /**
   * The Script tab's live view of the script a resident or army runs (`CONTEXT.md`: Debugging a
   * script): how it last ran, and its memory.
   */
  const scriptDebug = (id: string, scriptId: number) => (
    <>
      <ScriptRunInfo
        run={runs.get(id)}
        tick={world?.tick ?? 0}
        onOpenError={({ version, line, column }) => openScript(scriptId, { version, line, column })}
      />
      <ScriptMemoryTree id={id} memory={memories.get(id)} watch={watchScript} />
    </>
  )
  // What the map waits for while an order that needs a target is given (ADR 0012: pick mode).
  const touch = useTouchScreen()
  // Narrow or touch: cards are bottom sheets and the HUD folds into a menu button (ADR 0012).
  const phone = useMediaQuery(PHONE_QUERY)
  const pick = pickTarget({
    picking,
    groupPicking,
    isGroup: group.length > 1,
    armyPick,
    paramPick: pickingParam,
    plan,
  })
  /** Leaves pick mode without giving the order; the card comes back as it was. */
  const cancelPick = useCallback(() => {
    setPicking(false)
    setGroupPicking(false)
    setArmyPick(undefined)
    setParamPick(undefined)
    setPlan(undefined)
    setStarting((s) => s && { ...s, picking: undefined })
  }, [])
  // Escape leaves pick mode first; with no drawer open, it then drops the selection.
  const anySelected = selectedIds.length > 0
  const picked = pick !== undefined
  const formOpen = starting !== undefined
  useEffect(() => {
    if (!picked && !formOpen && (openDrawer || !anySelected)) return
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof Element && e.target.closest('input, textarea, select, .cm-editor')
      if (e.key !== 'Escape' || typing) return
      if (picked) {
        // Ahead of the drawer's own Escape, which would close it too.
        e.stopImmediatePropagation()
        return cancelPick()
      }
      // The form before a script starts is cancelled first.
      if (formOpen) {
        e.stopImmediatePropagation()
        return setStarting(undefined)
      }
      setSelectedIds([])
      setPicking(false)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [openDrawer, anySelected, picked, formOpen, cancelPick])
  useLayoutEffect(() => {
    if (!toShow) return
    const covered = mapCovered()
    const shown = showBeside(window.innerWidth, covered.left, covered.right)
    if (shown.closeDrawer) closeDrawer()
    setFocus({ ...toShow, cover: shown })
  }, [toShow, closeDrawer])
  const showOnMap = (x: number, y: number) => setToShow({ x, y })
  /** Picks residents on the map: one shows their card, several a group card. */
  const select = (ids: string[]) => {
    setSelectedIds(ids)
    setSelectedTile(undefined)
    setPicking(false)
    setArmyPick(undefined)
    setParamPick(undefined)
    setPlan(undefined)
    setGroupPlan(undefined)
    setStarting(undefined)
    setOrderError(undefined)
    setGroupPicking(false)
    setGroupBuildAt(undefined)
    setGroupReport(undefined)
    setGroupError(undefined)
  }
  // Ctrl+1–9 saves the picked residents as a group, 1–9 picks it again (`CONTEXT.md`: Group).
  useSavedGroups(
    world?.home.realmId,
    group.map((r) => r.id),
    own,
    select,
    showOnMap,
  )
  const shift = useShiftHeld()
  /**
   * Gives an order, or, `queued` (Shift held), appends a resident's order to their queue
   * (`CONTEXT.md`: Queue). Orders that can't be queue steps are given as they are. An order
   * starting a script that declares params first shows the form for them (`CONTEXT.md`: Before
   * it starts), filled with the resident's kept values or the defaults; Start gives it with them.
   */
  const giveOrder = (order: OrderRequest, queued = shift.current): Promise<string | undefined> => {
    const r = own.find((x) => x.id === order.residentId)
    const script = order.params === undefined ? startedScript(order, scripts) : undefined
    const params = script ? startFormParams(order, script) : []
    if (script && params.length > 0) {
      setStarting({
        script,
        params,
        values: startValues(params, r?.scriptParams?.[script.id], targetParam(script)),
        start: async (params) => setOrderError(await giveOrder({ ...order, params }, queued)),
      })
      return Promise.resolve(undefined)
    }
    const queuedFor = queued ? r : undefined
    return sendOrder((queuedFor && appendRequest(queuedFor, order)) ?? order)
  }
  // The city picked on the map or opened in the Cities drawer.
  const [openCityId, setOpenCityId] = useState<string>()

  /**
   * Orders the picked resident to walk to a tile, or, while picking where to drive, to drive the
   * carriage on their tile there, or, while picking a haul route's other stop, to haul between
   * their tile and that one, or, while picking a road's or wall's far end, to build it along the
   * line from their tile to that one (ADR 0002: the server checks it).
   */
  async function goTo(x: number, y: number) {
    const mode = picking
    setPicking(false)
    if (starting?.picking) {
      // A value for the form before a script starts, which shows again.
      const param = starting.picking
      if (!world) return
      const got = paramPickAt(paramWorld(world), param.type, { x, y })
      setStarting({
        ...starting,
        picking: undefined,
        ...(typeof got === 'string'
          ? { error: got }
          : { error: undefined, values: { ...starting.values, [param.name]: got.id } }),
      })
      return
    }
    if (paramPick) {
      setParamPick(undefined)
      if (!world) return
      const picked = paramPickAt(paramWorld(world), paramPick.type, { x, y })
      if (typeof picked === 'string') setOrderError(picked)
      else await setScriptParam(paramPick.name, picked.id)
      return
    }
    if (armyPick) {
      setArmyPick(undefined)
      setArmyError(await sendOrder({ kind: armyPick.kind, armyId: armyPick.armyId, x, y }))
      return
    }
    if (plan && nextPick(plan)) {
      if (!world) return
      const next = pickInto(planWorld(world), plan, { x, y })
      if (nextPick(next) || planAsk(next)) setPlan(next)
      else await addPlanned(next)
      return
    }
    if (group.length > 1) {
      await groupTile(x, y)
      return
    }
    if (!selected) return
    const carriage = onTile(world?.carriages)
    if (mode === 'drive' && carriage) {
      const order = { kind: 'drive', residentId: selected.id, carriageId: carriage.id, x, y }
      setOrderError(await giveOrder(order))
      return
    }
    if (mode === 'haul' && carriage && haulSetup) {
      // The Haul task: they run the Player's Haul (default) script (`CONTEXT.md`: Default script).
      const order = { kind: 'task', task: 'haul', residentId: selected.id, carriageId: carriage.id }
      setOrderError(await giveOrder({ ...order, x, y, ...haulSetup }))
      return
    }
    if (mode === 'road' || mode === 'wall') {
      const kind = mode === 'road' ? 'roadLine' : 'wallLine'
      const from = { x: selected.x, y: selected.y }
      setOrderError(await giveOrder({ kind, residentId: selected.id, from, to: { x, y } }))
      return
    }
    setOrderError(await giveOrder({ kind: 'walkTo', residentId: selected.id, x, y }))
  }

  /**
   * Starts planning a step with Add step (`CONTEXT.md`: Queue, Planning ahead): the map picks its
   * places first; one that needs neither is added at once.
   */
  async function startPlan(kind: PlanStepId) {
    setPicking(false)
    setGroupPicking(false)
    setParamPick(undefined)
    const fresh: Plan = { kind, picked: [] }
    if (nextPick(fresh) || planAsk(fresh)) setPlan(fresh)
    else await addPlanned(fresh)
  }
  /**
   * Appends the step planned to the picked resident's queue, or starts one with it, after a walk
   * to where it acts (`appendRequest`). The server checks that it could make sense; whether it can
   * start is checked when its turn comes. For a group it goes onto the plan open on the group card,
   * or, with none open, onto each one's own queue (`CONTEXT.md`: Planning for a group).
   */
  async function addPlanned(planned: Plan, answer?: PlanAnswer) {
    setPlan(undefined)
    const step = planOrder(planned, answer)
    if (!step) return
    if (group.length > 1) {
      if (groupPlan) setGroupPlan(planStep(groupPlan, step.order, step.at))
      else await sendToGroup(appendToEach(group, step.order, step.at), [])
      return
    }
    if (!selected) return
    const open = queuePlans[selected.id]
    if (open) {
      planQueue(selected.id, planStep(open, step.order, step.at))
      return
    }
    const order = { ...step.order, residentId: selected.id }
    setOrderError(await sendOrder(appendRequest(selected, order, step.at) ?? order))
  }
  /** The queue planner's Add step, on the resident card and the group card. */
  function addStep(w: NonNullable<typeof world>) {
    return (
      <AddStep
        plan={plan}
        onStart={(kind) => void startPlan(kind)}
        onAnswer={(answer) => plan && void addPlanned(plan, answer)}
        onCancel={() => setPlan(undefined)}
        scripts={scripts}
        buildKinds={
          plan?.kind === 'build' && plan.picked[0]
            ? buildMenu(nodeAt?.(plan.picked[0].x, plan.picked[0].y))
            : []
        }
        horses={horsesIn(planWorld(w), w.horses, plan?.picked[0]?.id)}
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
   * A tile picked for the group (`CONTEXT.md`: Group): walking there (also by right-click),
   * working the workplace there, where to build, drive or haul to, a line's ends, the building to
   * tear down, the place to store at or fetch from, whom to attack or the wall to climb.
   */
  async function groupTile(x: number, y: number) {
    const mode = groupPicking
    setGroupPicking(false)
    if (!world) return
    if (mode === 'build') {
      setGroupBuildAt({ x, y })
      return
    }
    if (mode === 'roadFrom' || mode === 'wallFrom') {
      // Then the line's other end.
      setGroupLineFrom({ x, y })
      setGroupPicking(mode === 'roadFrom' ? 'roadTo' : 'wallTo')
      return
    }
    setGroupBuildAt(undefined)
    setGroupReport(undefined)
    const fail = (why: string) => setGroupError(why)
    const name = (b: Building) => BUILDING_NAMES[b.kind].toLowerCase()
    const realmId = world.home.realmId
    // A storage, a stable or one of the realm's carriages, to store at or fetch from.
    const place = (): Place | undefined => {
      const b = world.buildings.find(
        (s) => (s.kind === 'storage' || s.kind === 'stable') && !s.site && covers(s, x, y),
      )
      if (b) return { id: b.id, name: name(b) }
      const k = world.carriages.find((c) => c.realmId === realmId && c.x === x && c.y === y)
      return k && { id: k.id, name: 'carriage' }
    }
    // A wall or gate of another realm's city, or of none.
    const foreignWall = world.buildings.find(
      (b) =>
        isWallOrGate(b) &&
        covers(b, x, y) &&
        world.cities.find((c) => c.id === b.cityId)?.realmId !== realmId,
    )
    switch (mode) {
      case 'work': {
        const workplace = world.buildings.find(
          (b) =>
            b.kind !== 'road' && !b.site && covers(b, x, y) && MAX_WORKERS[b.kind] !== undefined,
        )
        if (!workplace) return fail('no workplace there')
        // What a smithy makes is picked for each worker on their own card.
        if (workplace.kind === 'smithy') return fail('pick what to make on each one’s card')
        return sendGroup({ kind: 'work', workplace, name: name(workplace) })
      }
      case 'drive':
        return sendGroup({ kind: 'drive', x, y })
      case 'haul':
        if (!groupPickWith.haul) return
        return sendGroup({ kind: 'haul', x, y, ...groupPickWith.haul })
      case 'roadTo':
      case 'wallTo':
        if (!groupLineFrom) return
        setGroupLineFrom(undefined)
        return sendGroup({
          kind: 'line',
          line: mode === 'roadTo' ? 'roadLine' : 'wallLine',
          from: groupLineFrom,
          to: { x, y },
        })
      case 'tearDown': {
        // A building before a road sharing its tile.
        const there = world.buildings.filter((b) => BUILDABLE.includes(b.kind) && covers(b, x, y))
        const building = there.find((b) => b.kind !== 'road') ?? there[0]
        if (!building) return fail('nothing to tear down there')
        return sendGroup({ kind: 'tearDown', building, name: name(building) })
      }
      case 'storeAt':
      case 'fetchFrom': {
        const at = place()
        if (!at) return fail('no storage, stable or carriage of yours there')
        if (mode === 'storeAt') return sendGroup({ kind: 'store', to: at })
        return sendGroup({ kind: 'fetch', good: groupPickWith.good ?? 'food', from: at })
      }
      case 'attack': {
        const target =
          world.residents.find((r) => r.x === x && r.y === y && !own.some((o) => o.id === r.id)) ??
          foreignWall
        if (!target) return fail('nobody of another realm there, and no wall or gate')
        return sendGroup({ kind: 'attack', targetId: target.id })
      }
      case 'climb':
        if (!foreignWall) return fail('no wall or gate of another realm there')
        return sendGroup({ kind: 'climb', wall: foreignWall })
      default:
        return sendGroup({ kind: 'walkTo', x, y })
    }
  }
  /**
   * Gives each resident of the group the same order request (ADR 0002), skipping those who
   * can't take it, and says on the card who was skipped or turned down and why. One starting a
   * script that declares params first shows the form for them, once for all (`CONTEXT.md`:
   * Before it starts), filled with the values all of them keep or the defaults.
   */
  async function sendGroup(order: GroupOrder, queued = shift.current) {
    if (!world) return
    const starts =
      order.kind === 'runScript' || order.kind === 'setDefenceScript'
        ? { kind: order.kind, scriptId: order.scriptId }
        : order.kind === 'work' || order.kind === 'build'
          ? { kind: 'task', task: order.kind }
          : undefined
    const given = 'params' in order && order.params !== undefined
    const script = starts && !given ? startedScript(starts, scripts) : undefined
    const params = script ? startFormParams(starts!, script) : []
    if (script && params.length > 0) {
      const kept = group.map((r) => r.scriptParams?.[script.id])
      setStarting({
        script,
        params,
        values: groupStartValues(params, kept, targetParam(script)),
        start: (params) => sendGroup({ ...order, params } as GroupOrder, queued),
      })
      return
    }
    const size = world.map.size
    const inGroup = new Set(group.map((r) => r.id))
    // Free: explored land a resident can stand on, with no wall or gate and nobody else on it.
    const free = (x: number, y: number) => {
      const t = terrainAt?.(x, y)
      if (t === undefined || !isPassableTerrain(t)) return false
      if (world.buildings.some((b) => isWallOrGate(b) && covers(b, x, y, size))) return false
      return !world.residents.some((r) => r.x === x && r.y === y && !inGroup.has(r.id))
    }
    // With Shift held, each one's queue gets the order appended (`CONTEXT.md`: Queue).
    const realmId = world.home.realmId
    const { requests, skipped } = groupRequests(order, group, {
      tick: world.tick,
      size,
      free,
      queued,
      seen: {
        // Free horses of the realm, to mount (`CONTEXT.md`: Riding).
        horses: world.horses.filter(
          (h) => h.realmId === realmId && !carriagePulledBy(world, h) && !riderOf(world, h),
        ),
        carriages: world.carriages.filter((k) => k.realmId === realmId),
        buildings: world.buildings,
      },
    })
    if (order.kind === 'build') setGroupBuildAt(undefined)
    await sendToGroup(
      requests.map((q) => q.order),
      skipped,
    )
  }
  /**
   * Sends the group's requests, one per resident, and says on the card how many went out and who
   * was skipped or turned down and why.
   */
  async function sendToGroup(requests: OrderRequest[], skipped: Skipped[]) {
    setGroupError(undefined)
    const answers = await Promise.all(requests.map((o) => sendOrder(o)))
    const turnedDown = requests.flatMap((o, i) => {
      const why = answers[i]
      const r = group.find((g) => g.id === o.residentId)
      return why && r ? [{ id: r.id, name: r.name, why }] : []
    })
    setGroupReport({
      sent: requests.length - turnedDown.length,
      of: group.length,
      skipped: [...skipped, ...turnedDown],
    })
  }

  /** Orders the picked resident to pick up or drop goods on their tile. */
  async function carry(kind: 'pickUp' | 'drop', spot: GoodsSpot, goods: Stock) {
    if (!selected) return
    setOrderError(await giveOrder({ kind, residentId: selected.id, spot, goods }))
  }
  /**
   * Gives the picked resident the Build task on their tile, laying out a site or joining the one
   * there: they run the Player's Build (default) script, which fetches missing materials from
   * the realm's storages (`CONTEXT.md`: Fetching materials).
   */
  async function build(building: BuildingKind) {
    if (!selected) return
    const order = { kind: 'task', task: 'build', residentId: selected.id, building }
    setOrderError(await giveOrder(order))
  }
  /**
   * Gives the picked resident the Work task at the workplace on their tile, making `makes` at a
   * smithy: they run the Player's Work (default) script (`CONTEXT.md`: Default script).
   */
  async function work(makes?: Good) {
    if (!selected) return
    const workplaceId = buildingHere?.id
    const order = { kind: 'task', task: 'work', residentId: selected.id, workplaceId, makes }
    setOrderError(await giveOrder(order))
  }
  /**
   * Gives the picked resident the Tear down task for the building or site on their tile: they
   * run the Player's Tear down (default) script.
   */
  async function tearDown(buildingId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'tearDown', residentId: selected.id, buildingId }
    setOrderError(await giveOrder(order))
  }
  /**
   * Gives the picked resident the Breed horses task for two horses in the stable on their tile:
   * they run the Player's Breed horses (default) script.
   */
  async function breed(stableId: string, horseIds: [string, string]) {
    if (!selected) return
    const order = { kind: 'task', task: 'breed', residentId: selected.id, stableId, horseIds }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Gives the picked resident the Feed the stable task for the stable they stand in: they run the
   * Player's Feed the stable (default) script (`CONTEXT.md`: Feeding the stable).
   */
  async function feedStable(stableId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'feedStable', residentId: selected.id, stableId }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Gives the picked resident the Train task for the training ground they stand on: they run the
   * Player's Train (default) script (`CONTEXT.md`: Trainee).
   */
  async function train(groundId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'train', residentId: selected.id, groundId }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Orders the picked resident to teach `subject` at the training ground they stand on
   * (`CONTEXT.md`: Teacher); with Shift held it goes in their queue.
   */
  async function teach(buildingId: string, subject: TrainingSubject) {
    if (!selected) return
    const order = { kind: 'teach', residentId: selected.id, buildingId, subject }
    setOrderError(await giveOrder(order))
  }
  /** Orders the picked resident to stop what they are doing, such as a haul route. */
  /** Orders the picked resident to run one of the Player's scripts. */
  async function runScript(scriptId: number) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'runScript', residentId: selected.id, scriptId }))
  }
  /**
   * Picks the script the picked resident runs when struck, or with null the Defend default
   * (`CONTEXT.md`: Defence script); its params are picked first, as before a script starts. Never
   * queued: it leaves what they do as it is.
   */
  async function setDefenceScript(scriptId: number | null) {
    if (!selected) return
    const order = { kind: 'setDefenceScript', residentId: selected.id, scriptId }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Picks, or clears with null, the value of a param of the script the picked resident runs
   * (`CONTEXT.md`: Script parameter): the building or carriage's id, or the number typed for a
   * number param. It leaves the script running.
   */
  async function setScriptParam(name: string, picked: string | number | null) {
    if (!selected?.script) return
    const { scriptId } = selected.script
    const value = typeof picked === 'number' ? { value: picked } : { targetId: picked }
    const order = { kind: 'setScriptParam', residentId: selected.id, scriptId, name, ...value }
    setOrderError(await giveOrder(order))
  }
  async function stop() {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'stop', residentId: selected.id }))
  }
  /** Orders the picked resident to pair with another resident of their city. */
  async function pair(partnerId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'pair', residentId: selected.id, partnerId }))
  }
  /**
   * Orders the Player's Leader to hand the realm over to the picked resident (`CONTEXT.md`:
   * Leader handover), the same `handOver` order a script's `handOver` requests.
   */
  async function makeLeader() {
    if (!selected || !world) return
    const order = { kind: 'handOver', residentId: world.home.leaderId, newLeaderId: selected.id }
    setOrderError(await giveOrder(order))
  }
  /**
   * Renames the picked resident (`CONTEXT.md`: Renaming a resident), with the realm name when it
   * is the Leader of an unnamed realm: the same `rename` order a script's `rename` requests.
   */
  async function rename(name: string, realmName?: string) {
    if (!selected) return
    const order = { kind: 'rename', residentId: selected.id, targetId: selected.id, name }
    setOrderError(await giveOrder(realmName === undefined ? order : { ...order, realmName }))
  }
  /** Orders the picked resident to attack a resident of another realm. */
  async function attack(targetId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'attack', residentId: selected.id, targetId }))
  }
  /** Orders the picked resident to mount a horse on their tile, or with none to dismount. */
  async function ride(horseId?: string) {
    if (!selected) return
    const order = horseId
      ? { kind: 'mount', residentId: selected.id, horseId }
      : { kind: 'dismount', residentId: selected.id }
    setOrderError(await sendOrder(order))
  }
  /**
   * Orders the picked resident to board a carriage on their tile, or with none to get off the one
   * they are aboard, onto its tile (`CONTEXT.md`: Passenger); with Shift held, appends it to their
   * queue.
   */
  async function boardCarriage(carriageId?: string) {
    if (!selected) return
    const order = carriageId
      ? { kind: 'board', residentId: selected.id, carriageId }
      : { kind: 'getOff', residentId: selected.id }
    setOrderError(await giveOrder(order))
  }
  /**
   * Orders the picked resident to unhitch the horse from a carriage on their tile (`CONTEXT.md`:
   * Hitched horse); with Shift held, appends it to their queue.
   */
  async function unhitch(carriageId: string, residentId = selected?.id) {
    if (!residentId) return
    setOrderError(await giveOrder({ kind: 'unhitch', residentId, carriageId }))
  }
  /** Orders the picked resident to climb over a wall or gate of another realm next to them. */
  async function climb(wallId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'climb', residentId: selected.id, wallId }))
  }
  const [nodeAt, setNodeAt] = useState<(x: number, y: number) => KnownNode | undefined>()
  const onNodesLoaded = useCallback(
    (lookup: (x: number, y: number) => KnownNode | undefined) => setNodeAt(() => lookup),
    [],
  )
  const [terrainAt, setTerrainAt] = useState<(x: number, y: number) => number | undefined>()
  const onTerrainLoaded = useCallback(
    (lookup: (x: number, y: number) => number | undefined) => setTerrainAt(() => lookup),
    [],
  )
  const arrivesIn =
    world &&
    arrivalOf(
      {
        size: world.map.size,
        tick: world.tick,
        horses: world.horses,
        carriages: world.carriages,
        residents: world.residents,
        buildings: world.buildings,
      },
      terrainAt,
    )
  const onTile = <T extends { x: number; y: number }>(things: T[] | undefined) =>
    selected && things?.find((t) => t.x === selected.x && t.y === selected.y)
  // A road may share its tile with a building (`CONTEXT.md`: Road); a building is wherever its
  // footprint is (`CONTEXT.md`: At a building).
  const buildingHere =
    selected && world?.buildings.find((b) => !SHARES_A_TILE.includes(b.kind) && isAt(selected, b))
  const roadHere = onTile(world?.buildings.filter((b) => b.kind === 'road'))
  const carriageSiteHere = onTile(world?.buildings.filter((b) => b.kind === 'carriage'))

  async function logout() {
    await api.logout().catch(() => {})
    onLoggedOut()
  }

  const leader = world?.residents.find(
    (r): r is Resident => r.id === world.home.leaderId && faresKnown(r),
  )
  const drawer = (id: DrawerId, panel: ReactNode) => (
    <Drawer id={id} open={openDrawer} onClose={closeDrawer}>
      {panel}
    </Drawer>
  )

  // A Player without a realm names it before the world shows (`CONTEXT.md`: Realm name).
  if (founding && !world) return <Founding leaderName={founding.leaderName} onFound={found} />

  return (
    <div className={phone ? 'game phone' : 'game'}>
      <section className="game-map">
        {world ? (
          <MapView
            world={world}
            selectedIds={selectedIds}
            onSelect={(id) => select([id])}
            onSelectMany={select}
            onSelectTile={(x, y) => {
              // A click on the ground drops a group; one resident stays picked to send there.
              if (group.length > 1) setSelectedIds([])
              const size = world.map.size
              setSelectedTile({ x: ((x % size) + size) % size, y: ((y % size) + size) % size })
              setPicking(false)
              setArmyPick(undefined)
              setParamPick(undefined)
              setPlan(undefined)
              setOrderError(undefined)
            }}
            selectedCityId={openCityId}
            onSelectCity={(id) => {
              setOpenCityId(id)
              setOpenDrawer('cities')
            }}
            picking={
              picking !== false ||
              armyPick !== undefined ||
              pickingParam !== undefined ||
              pick?.kind === 'plan' ||
              (group.length > 1 && groupPicking !== false)
            }
            onPickTile={goTo}
            onNodesLoaded={onNodesLoaded}
            onTerrainLoaded={onTerrainLoaded}
            focus={focus}
          />
        ) : (
          <p className="game-waiting">Waiting for the server…</p>
        )}
      </section>
      <TopBar
        realm={account.name}
        cityName={homeCity?.name}
        tick={world?.tick}
        status={status}
        goods={world && homeCity ? keyGoods(world.buildings, homeCity.id) : undefined}
        leader={leader?.name}
        onLogout={logout}
      />
      {world?.horseOffer && (
        <HorseOfferNotice
          horses={HORSE_GRANT_HORSES}
          onClaim={() => sendOrder({ kind: 'claimHorses' })}
        />
      )}
      {phone ? (
        <PhoneMenu
          open={openDrawer}
          onToggle={(id) => setOpenDrawer((open) => toggleDrawer(open, id))}
          goods={world && homeCity ? keyGoods(world.buildings, homeCity.id) : undefined}
          cityName={homeCity?.name}
          leader={leader?.name}
          onLogout={logout}
        />
      ) : (
        <ToolRail
          open={openDrawer}
          onToggle={(id) => setOpenDrawer((open) => toggleDrawer(open, id))}
        />
      )}
      {world &&
        drawer(
          'residents',
          <ResidentsList
            groups={groupResidents(own, {
              cities: world.cities,
              realmId: world.home.realmId,
              homeCityId: world.home.cityId,
              leaderId: world.home.leaderId,
              diplomacy: world.diplomacy,
            })}
            leaderId={world.home.leaderId}
            scripts={scripts}
            buildings={world.buildings}
            inSight={world.residents}
            arrivesIn={arrivesIn || undefined}
            tick={world.tick}
            selectedId={selected?.id}
            onSelect={(id) => {
              setSelectedIds([id])
              setSelectedTile(undefined)
              const r = own.find((x) => x.id === id)
              if (r) showOnMap(Math.floor(r.x), Math.floor(r.y))
            }}
          />,
        )}
      {world &&
        drawer(
          'horses',
          <HorsesList
            groups={groupHorses(
              world.horses.filter((h) => h.realmId === world.home.realmId),
              world.buildings,
              world.carriages,
              world.residents,
              world.cities,
            )}
            tick={world.tick}
            selectedId={(() => {
              // A horse whose tile card is open, the last one picked here first, or the one the
              // picked resident rides.
              const shown = world.horses.filter(
                (h) =>
                  h.realmId === world.home.realmId &&
                  (selectedTile
                    ? Math.floor(h.x) === selectedTile.x && Math.floor(h.y) === selectedTile.y
                    : selected?.riding === h.id),
              )
              return (shown.find((h) => h.id === pickedHorseId) ?? shown[0])?.id
            })()}
            onSelect={(h) => {
              setPickedHorseId(h.id)
              const x = Math.floor(h.x)
              const y = Math.floor(h.y)
              // A ridden horse shows on its rider's card; any other on its tile's card.
              const rider = own.find((r) => r.riding === h.id)
              if (rider) {
                setSelectedIds([rider.id])
                setSelectedTile(undefined)
              } else {
                setSelectedIds([])
                setSelectedTile({ x, y })
              }
              showOnMap(x, y)
            }}
          />,
        )}
      {world &&
        drawer(
          'armies',
          <ArmiesPanel
            armies={world.armies}
            own={own}
            inSight={world.residents}
            carriages={world.carriages}
            realmId={world.home.realmId}
            picking={armyPick}
            onPick={(pick) => {
              setArmyPick(pick)
              setPicking(false)
              setArmyError(undefined)
            }}
            pickError={armyError}
            scripts={scripts}
            sendOrder={sendOrder}
            scriptMemory={(id) =>
              scriptDebug(id, world.armies.find((a) => a.id === id)?.script?.scriptId ?? 0)
            }
          />,
        )}
      {world &&
        drawer(
          'contracts',
          <ContractsPanel
            contracts={world.diplomacy.contracts}
            realmId={world.home.realmId}
            own={own}
            inSight={world.residents}
            buildings={world.buildings}
            cities={world.cities}
            realms={[
              ...(world.diplomacy.alliance?.members ?? []).filter(
                (m) => m.realmId !== world.home.realmId,
              ),
              ...world.diplomacy.realmsInSight,
            ]}
            sendOrder={sendOrder}
          />,
        )}
      {world &&
        drawer(
          'alliance',
          <AlliancePanel
            diplomacy={world.diplomacy}
            residents={world.residents}
            carriages={world.carriages}
            realmId={world.home.realmId}
            sendOrder={sendOrder}
          />,
        )}
      {world &&
        drawer(
          'standing',
          <StandingPanel
            standings={world.diplomacy.standings}
            joinRequests={world.diplomacy.joinRequests}
            directives={world.diplomacy.directives}
            sendOrder={sendOrder}
          />,
        )}
      {world &&
        drawer(
          'cities',
          <CityInspector
            cities={world.cities}
            lastSeen={world.lastSeen}
            residents={world.residents}
            buildings={world.buildings}
            realmId={world.home.realmId}
            realms={world.diplomacy.realmsInSight}
            carriages={world.carriages}
            horses={world.horses}
            tick={world.tick}
            mapSize={world.map.size}
            onSetGate={async (gateId, open) =>
              setOrderError(await giveOrder({ kind: 'setGate', gateId, open }))
            }
            onBuyCity={async (residentId, cityId) =>
              setOrderError(await giveOrder({ kind: 'buyCity', residentId, cityId }))
            }
            onTrade={async ({ side, ...trade }) =>
              setOrderError(await giveOrder({ kind: side, ...trade }))
            }
            onTransfer={async (transfer) =>
              setOrderError(await giveOrder({ kind: 'transfer', ...transfer }))
            }
            directives={world.diplomacy.directives}
            openId={openCityId}
            onOpen={setOpenCityId}
            onBuyOff={async (residentId, directiveId, carriageId) =>
              setOrderError(
                await sendOrder({ kind: 'buyOff', residentId, directiveId, carriageId }),
              )
            }
          />,
        )}
      {/* Mounted before the world arrives too: it loads the scripts the inspector can run. */}
      {drawer('scripts', <ScriptLibrary onScripts={setScripts} toOpen={scriptToOpen} />)}
      {world &&
        drawer(
          'realmLog',
          <RealmLog
            events={world.events}
            realmId={world.home.realmId}
            deliveries={world.diplomacy.deliveries}
            onShowPlace={(p) => showOnMap(p.x, p.y)}
          />,
        )}
      <DrawerEdge open={openDrawer} />
      {pick && (
        <PickBanner prompt={pickPrompt(pick, touch)} hint={pickHint(pick)} onCancel={cancelPick} />
      )}
      {world && selectedTile && (
        <CardSheet phone={phone} pinnedPeek={false}>
          <TileCard
            card={describeTile(
              {
                ...selectedTile,
                buildings: world.buildings,
                carriages: world.carriages,
                horses: world.horses,
                piles: world.piles,
                node: nodeAt?.(selectedTile.x, selectedTile.y),
                nodeAt,
                terrain: terrainAt?.(selectedTile.x, selectedTile.y),
                strangers: world.residents.filter((r) => !own.some((o) => o.id === r.id)),
                residents: world.residents,
                // A building remembered out of sight is named after its city as last seen.
                cities: [...world.cities, ...world.lastSeen.cities],
                lastSeen: { buildings: world.lastSeen.buildings, tick: world.tick },
                tick: world.tick,
                viewer: {
                  realmId: world.home.realmId,
                  allies: new Set(world.diplomacy.alliance?.members.map((m) => m.realmId)),
                },
                workers: (b) => workersHere(world.residents, b),
                nodeFit: (() => {
                  const node = nodeAt?.(selectedTile.x, selectedTile.y)
                  if (!node || !terrainAt) return undefined
                  // Terrain not loaded counts as unexplored: nothing is laid out there.
                  const at = (x: number, y: number) => terrainAt(x, y) ?? UNEXPLORED
                  return nodeFit(node, world, nodeAt!, { size: world.map.size, at })
                })(),
              },
              GOOD_LABELS,
            )}
            tick={world.tick}
            building={[...world.buildings, ...world.lastSeen.buildings].find(
              (b) => !SHARES_A_TILE.includes(b.kind) && covers(b, selectedTile.x, selectedTile.y),
            )}
            nodeKind={nodeAt?.(selectedTile.x, selectedTile.y)?.kind}
            buildingNode={buildingNodeKind(
              world.buildings.find(
                (b) => !SHARES_A_TILE.includes(b.kind) && covers(b, selectedTile.x, selectedTile.y),
              ),
              nodeAt,
            )}
            actor={selected}
            onUnhitch={(carriageId, residentId) => void unhitch(carriageId, residentId)}
            orderError={orderError}
            onClose={() => setSelectedTile(undefined)}
            onSendHere={async () => {
              if (!selected) return
              const order = { kind: 'walkTo', residentId: selected.id, ...selectedTile }
              setOrderError(await giveOrder(order))
            }}
            onBuildHere={async (building, at) => {
              // The Build task, walking to where the node's workplace fits first (ADR 0002).
              if (!selected) return
              const order = { kind: 'task', task: 'build', residentId: selected.id, building, at }
              setOrderError(await giveOrder(order))
            }}
            onSetGate={async (gateId, open) =>
              setOrderError(await giveOrder({ kind: 'setGate', gateId, open }))
            }
            onOpenCity={(id) => {
              setOpenCityId(id)
              setOpenDrawer('cities')
            }}
            // The same `renameCity` order a script's `renameCity` requests, asked by the Leader.
            onRenameCity={async (cityId, name) => {
              const order = { kind: 'renameCity', residentId: world.home.leaderId, cityId, name }
              setOrderError(await giveOrder(order))
            }}
            // The same `renameHorse` order a script's `renameHorse` requests, asked by the Leader.
            onRenameHorse={async (horseId, name) => {
              const order = { kind: 'renameHorse', residentId: world.home.leaderId, horseId, name }
              setOrderError(await giveOrder(order))
            }}
            onSelectResident={(id) => select([id])}
          />
        </CardSheet>
      )}
      {world && selected && !selectedTile && (
        <CardSheet phone={phone} pinnedPeek={pick !== undefined && pick.kind !== 'army'}>
          <ResidentCard
            key={selected.id}
            resident={selected}
            arrivesIn={arrivesIn || undefined}
            leaderId={world.home.leaderId}
            cityName={homeCity?.name}
            tick={world.tick}
            picking={picking}
            onWalkTo={() => setPicking((p) => (p === 'walk' ? false : 'walk'))}
            carriage={onTile(world.carriages.filter(loadKnown))}
            onDriveTo={() => setPicking((p) => (p === 'drive' ? false : 'drive'))}
            onRoadTo={() => setPicking((p) => (p === 'road' ? false : 'road'))}
            onWallTo={() => setPicking((p) => (p === 'wall' ? false : 'wall'))}
            onHaulTo={(setup) => {
              setHaulSetup(setup)
              setPicking((p) => (p === 'haul' ? false : 'haul'))
            }}
            onStop={stop}
            horseToRide={onTile(
              world.horses.filter(
                (h) =>
                  horseOfResident(h, selected) && !carriagePulledBy(world, h) && !riderOf(world, h),
              ),
            )}
            onRide={ride}
            carriageToBoard={onTile(world.carriages.filter((k) => carriageOfResident(k, selected)))}
            onBoard={boardCarriage}
            carriageToUnhitch={onTile(
              world.carriages.filter((k) => carriageOfResident(k, selected) && k.horseId),
            )}
            onUnhitch={unhitch}
            scripts={scripts}
            buildings={world.buildings}
            lastSeen={world.lastSeen.buildings}
            onRunScript={runScript}
            onSetDefenceScript={setDefenceScript}
            onEditScript={(id) => openScript(id)}
            orderError={orderError}
            pile={world.piles.find(
              (p) => p.x === (buildingHere ?? selected).x && p.y === (buildingHere ?? selected).y,
            )}
            storage={
              buildingHere && KEEPS_GOODS.includes(buildingHere.kind) && !buildingHere.site
                ? buildingHere
                : undefined
            }
            building={buildingHere}
            road={roadHere}
            terrain={terrainAt?.(selected.x, selected.y)}
            carriageSite={carriageSiteHere}
            node={nodeAt?.(selected.x, selected.y)}
            onPickUp={(spot, goods) => carry('pickUp', spot, goods)}
            onDrop={(spot, goods) => carry('drop', spot, goods)}
            onBuild={build}
            buildProblem={(kind) =>
              buildHereProblem(
                kind,
                selected.x,
                selected.y,
                world,
                (x, y) => nodeAt?.(x, y),
                // Terrain not loaded counts as unexplored: nothing is laid out there.
                { size: world.map.size, at: (x, y) => terrainAt?.(x, y) ?? UNEXPLORED },
              )
            }
            workers={workersHere(world.residents, buildingHere)}
            holders={heldBy(world.residents, buildingHere)}
            realmId={world.home.realmId}
            onWork={work}
            onFeedStable={feedStable}
            onTrain={train}
            onTeach={teach}
            onTearDown={tearDown}
            horses={world.horses}
            onBreed={breed}
            residents={own}
            onPair={pair}
            others={world.residents.filter((r) => !own.some((o) => o.id === r.id))}
            mapSize={world.map.size}
            onAttack={attack}
            walls={world.buildings.filter(
              (b) =>
                isWallOrGate(b) &&
                world.cities.find((c) => c.id === b.cityId)?.realmId !== world.home.realmId,
            )}
            onClimb={climb}
            makeLeader={
              selected.owner === world.home.realmId && selected.id !== world.home.leaderId
                ? {
                    problem: makeLeaderProblem(
                      {
                        tick: world.tick,
                        diplomacy: world.diplomacy,
                        cities: world.cities,
                        buildings: world.buildings,
                        mapSize: world.map.size,
                      },
                      { id: world.home.realmId, leaderId: world.home.leaderId },
                      leader,
                      selected,
                    ),
                  }
                : undefined
            }
            leaderName={leader?.name}
            onMakeLeader={makeLeader}
            rename={
              selected.owner === world.home.realmId
                ? {
                    needsRealmName:
                      selected.id === world.home.leaderId && world.home.realmName === null,
                  }
                : undefined
            }
            onRename={rename}
            sections={cardSections}
            onSections={(s) => {
              rememberTab(s.tab)
              setCardSections(s)
            }}
            scriptParams={
              selected.script && (
                <ScriptParamFields
                  params={scripts.find((s) => s.id === selected.script!.scriptId)?.params ?? []}
                  // As seen: the values picked for the script they run come with it.
                  values={world.residents.find((r) => r.id === selected.id)?.script?.params ?? {}}
                  label={(id) => paramValueLabel(paramWorld(world), id)}
                  picking={paramPick?.name}
                  onPick={(p) => {
                    setPicking(false)
                    setParamPick((now) => (now?.name === p.name ? undefined : p))
                  }}
                  onNumber={(name, value) => void setScriptParam(name, value)}
                  onClear={(name) => void setScriptParam(name, null)}
                />
              )
            }
            scriptMemory={selected.script && scriptDebug(selected.id, selected.script.scriptId)}
            scriptLog={
              <ScriptLog id={selected.id} lines={scriptLogs.get(selected.id)} watch={watchScript} />
            }
            onStore={async () =>
              setOrderError(
                await giveOrder({ ...storeAll(selected, world.tick), residentId: selected.id }),
              )
            }
            // A paste into the planner of a resident with no queue starts one; steps wrapped in
            // a repeat block open a plan to give instead.
            onEditQueue={async (items: PlanItem[], loop?: boolean) => {
              if (!hasBlocks(items))
                return setOrderError(await sendOrder(givePlan(selected, { items, loop })))
              const from = selected.queue ? planOf(selected.queue) : EMPTY_PLAN
              planQueue(selected.id, editPlan(from, items, loop))
            }}
            queuePlan={queuePlans[selected.id]}
            onPlanQueue={(plan) => planQueue(selected.id, plan)}
            onGivePlan={async () => {
              const plan = queuePlans[selected.id]
              if (!plan) return
              planQueue(selected.id, undefined)
              setOrderError(await sendOrder(givePlan(selected, plan)))
            }}
            addStep={addStep(world)}
            onClose={() => {
              setSelectedIds([])
              setPicking(false)
              setParamPick(undefined)
              setPlan(undefined)
            }}
            collapsed={pick !== undefined && pick.kind !== 'army'}
          />
        </CardSheet>
      )}
      {world && group.length > 1 && !selectedTile && (
        <CardSheet phone={phone} pinnedPeek={pick?.kind === 'group' || pick?.kind === 'plan'}>
          <GroupCard
            residents={group}
            scripts={scripts}
            buildings={world.buildings}
            carriages={groupCarriages}
            inSight={world.residents}
            arrivesIn={arrivesIn || undefined}
            horses={world.horses}
            realmId={world.home.realmId}
            tick={world.tick}
            picking={groupPicking}
            onPicking={(p, with_) => {
              setGroupPicking(p)
              setGroupPickWith(with_ ?? {})
              setGroupLineFrom(undefined)
              setGroupBuildAt(undefined)
            }}
            buildAt={
              groupBuildAt && {
                ...groupBuildAt,
                site: world.buildings.find(
                  (b) => b.kind !== 'road' && b.site && covers(b, groupBuildAt.x, groupBuildAt.y),
                ),
                kinds: buildMenu(nodeAt?.(groupBuildAt.x, groupBuildAt.y)).map((kind) => ({
                  kind,
                  problem: buildHereProblem(
                    kind,
                    groupBuildAt.x,
                    groupBuildAt.y,
                    world,
                    (x, y) => nodeAt?.(x, y),
                    // Terrain not loaded counts as unexplored: nothing is laid out there.
                    { size: world.map.size, at: (x, y) => terrainAt?.(x, y) ?? UNEXPLORED },
                  ),
                })),
              }
            }
            // Picking a defence script is never queued: it leaves what they do as it is.
            onOrder={(order) =>
              void sendGroup(order, order.kind !== 'setDefenceScript' && shift.current)
            }
            report={groupReport}
            orderError={groupError}
            onPick={(id) => select([id])}
            onClose={() => select([])}
            planner={
              <GroupPlanner
                plan={groupPlan}
                onPlan={setGroupPlan}
                onGive={() => void giveGroupPlan()}
                addStep={addStep(world)}
                scripts={scripts}
                buildings={world.buildings}
                lastSeen={world.lastSeen.buildings}
                realm={world.home.realmId}
              />
            }
            collapsed={pick?.kind === 'group' || pick?.kind === 'plan'}
          />
        </CardSheet>
      )}
      {world && starting && !starting.picking && (
        <StartParamsForm
          script={starting.script.name}
          params={starting.params}
          target={targetParam(starting.script)}
          values={starting.values}
          label={(id) => paramValueLabel(paramWorld(world), id)}
          canStart={startValuesValid(starting.params, starting.values)}
          error={starting.error}
          onPick={(p) => {
            setPicking(false)
            setGroupPicking(false)
            setStarting({ ...starting, picking: p, error: undefined })
          }}
          onChange={(name, value) =>
            setStarting({ ...starting, values: { ...starting.values, [name]: value } })
          }
          onStart={() => {
            setStarting(undefined)
            void starting.start(startParamValues(starting.params, starting.values))
          }}
          onCancel={() => setStarting(undefined)}
        />
      )}
      {world && realmEnded(world.events) && (
        <CentredDialog title="Your realm has ended">
          <p>
            Your Leader has died and your realm has ended. The realm log says what became of your
            cities. You start afresh with a new Leader and a new starting city.
          </p>
          <div className="hud-dialog-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Start afresh
            </button>
          </div>
        </CentredDialog>
      )}
    </div>
  )
}

/** How many of the residents in sight work the building, if there is one. */
function workersHere(residents: SeenResident[], building: Building | undefined): number {
  if (!building) return 0
  return residents.filter((r) => r.order?.kind === 'workAt' && r.order.buildingId === building.id)
    .length
}

/** The realms holding the building, as far as the Player sees its workers. */
function heldBy(residents: SeenResident[], building: Building | undefined): string[] {
  return building ? holdersOf({ residents }, building) : []
}
