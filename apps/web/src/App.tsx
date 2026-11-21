import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  BUILDABLE,
  holdersOf,
  KEEPS_GOODS,
  MAX_WORKERS,
  SHARES_A_TILE,
  takesWorkSettings,
  roadTiles,
  stoneOverAt,
} from './shared/building.js'
import { firstDayShown } from './shared/first-day.js'
import {
  flipped,
  flipsControlMode,
  modeAfterPick,
  rememberControlMode,
  rememberedControlMode,
  REALM_BAR_ORDERS,
  type ControlMode,
  type RealmBarOrder,
} from './control-mode.js'
import type {
  ClientFirstDayLine,
  Account,
  Building,
  BuildingKind,
  Good,
  GoodsSpot,
  KnownNode,
  OrderRequest,
  Resident,
  ScriptParam,
  ScriptParamValues,
  ScriptSummary,
  StartParamValues,
  Stock,
  TrainingSubject,
  SeenResident,
  WallMaterial,
} from '@csp/shared-types'
import {
  carriagePulledBy,
  carriageOfResident,
  drivenCarriageId,
  driveOffProblem,
  hitchOffProblem,
  horseToSteal,
  seatsLeft,
} from './shared/carriages.js'
import { mountOffProblem, horseOfResident, riderOf } from './shared/horses.js'
import { horsesInNeed } from './shared/reviving.js'
import { isDown } from './shared/world.js'
import {
  isPassableTerrain,
  isWater,
  UNEXPLORED,
  Terrain,
  tileIndex,
  wrap,
} from './shared/terrain.js'
import { isWallOrGate } from './shared/walls.js'
import { CreativeBar } from './CreativeBar.js'
import { showsCreativeBar } from './creative-bar.js'
import { CreativeSection } from './CreativeSection.js'
import { creativeCities, creativeOffer, offersAnything } from './creative-section.js'
import { CreativeAddSection, CreativeResidentActions } from './CreativeResidents.js'
import { inCityArea } from './shared/city.js'
import { isAt, covers } from './shared/footprint.js'
import { targetParam } from './shared/default-scripts.js'
import { HORSE_GRANT_HORSES, PASSENGER_WEIGHT } from '@csp/balance'
import {
  besideVessel,
  crewShort,
  isVesselId,
  rowOffProblem,
  vesselOfResident,
  vesselRoom,
} from './shared/vessels.js'
import { AdminPage } from './AdminPanel.js'
import { AlliancePanel } from './Alliance.js'
import { commandsSeen } from './alliance-army.js'
import { ArmiesPanel, type ArmyPick } from './Armies.js'
import { ContractsPanel } from './Contracts.js'
import { demandNoticeLine, demandSides } from './demand-view.js'
import { DemandsPanel } from './Demands.js'
import { DirectOffersPanel } from './DirectOffers.js'
import { incomingItems, incomingNoticeLine } from './incoming-view.js'
import {
  NOTHING_SEEN,
  newestLine,
  rememberLogSeen,
  rememberedLogSeen,
  seeTab,
  sentToRealm,
  unseenMarks,
  type SeenIds,
} from './unseen-view.js'
import { StandingPanel } from './Standing.js'
import { TileMenu, WaypointsPanel } from './Waypoints.js'
import { api } from './api.js'
import { clearTerrainCache } from './map/terrain-cache.js'
import { CityInspector } from './CityInspector.js'
import {
  goodsOldText,
  goodsPickCities,
  goodsPickOf,
  keyGoods,
  rememberGoodsPick,
  rememberedGoodsPick,
  showBeside,
  NO_DRAWER,
  openDiplomacy,
  showsTab,
  toggleDrawer,
  withOpen,
  type Drawers,
  type DrawerId,
  type GoodsPick,
  type OpenDrawer,
} from './hud-view.js'
import { cityPlace, cityScale } from './cities-drawer-view.js'
import {
  CentredDialog,
  DiplomacyTabs,
  Drawer,
  DrawerEdge,
  FirstDayCard,
  GroupReportNotice,
  HorseOfferNotice,
  TraderVisitNotice,
  IncomingNotice,
  NoticeLane,
  PhoneMenu,
  RealmBar,
  ToolRail,
  TopBar,
  mapCovered,
  useEscapeCloses,
} from './Hud.js'
import type { Covered } from './map/camera.js'
import { cardHidden, laneNotices, visitKey } from './notices-view.js'
import { ResidentsFullList } from './ResidentsFullList.js'
import { groupResidents, rememberedTab, rememberTab, type CardSections } from './residents-view.js'
import { groupHorses } from './horses-view.js'
import { HorsesList } from './Horses.js'
import { Founding } from './Founding.js'
import {
  appendRequest,
  appendToEach,
  draftEdit,
  draftFor,
  givePlan,
  giveToAll,
  planOf,
  planStep,
  storeAll,
  useShiftHeld,
  type QueuePlan,
} from './queue-view.js'
import { AddStep } from './AddStep.js'
import { InsertPointContext, type InsertPoint } from './step-palette-view.js'
import { GroupPlanner } from './GroupPlanner.js'
import { type PlanItem } from './plan-blocks.js'
import {
  planHorses,
  nextPick,
  pickCity,
  pickInto,
  planAsk,
  planCities,
  planOrder,
  type Plan,
  type PlanAnswer,
  type PlanStepId,
  type PlanWorld,
} from './plan-step.js'
import { useSavedGroups } from './saved-groups.js'
import {
  groupOrderStart,
  groupRequests,
  type GroupOrder,
  type GroupSeen,
  type Place,
  type Skipped,
} from './group-orders.js'
import { BUILDING_NAMES } from './map/palette.js'
import { BuildingOrders } from './BuildingOrders.js'
import { buildingOrderRows, realmRequests, type BuildingGroupOrder } from './building-orders.js'
import { VehicleOrders } from './VehicleOrders.js'
import {
  NO_STAND,
  mostNote,
  onlyThis,
  standAt,
  vehicleMost,
  vehicleOrder,
  vehicleOrderRows,
  vehicleRequests,
  vehicleSuggests,
  type OrderedVehicle,
  type VehicleGroupOrder,
} from './vehicle-orders.js'
import { Login } from './Login.js'
import { MapView } from './MapView.js'
import { isWikiPath, pageFor } from './pages.js'
import { Wiki } from './Wiki.js'
import { RealmLog } from './RealmLog.js'
import {
  heirTakeover,
  realmEnded,
  rememberTakeoverSeen,
  rememberedTakeoverSeen,
} from './realm-log.js'
import { isNewRealm } from './map/legend.js'
import { MEND } from './equipment-view.js'
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
import { arrivalOf, doingLine } from './doing-view.js'
import {
  CardSheet,
  PickBanner,
  SelectionCard,
  TileCard,
  closeOpenPanel,
  panelOpen,
} from './SelectionCard.js'
import { BuildMenu } from './BuildMenu.js'
import { kindProblemOn } from './build-menu-view.js'
import { WhoList } from './WhoList.js'
import {
  WHO_SUGGESTS,
  lineProblem,
  wayTarget,
  whoRows,
  whoTitle,
  whoWhere,
  type WhoAt,
  type WhoLine,
  type WhoOrder,
  type WhoPlaceOrder,
  type WhoWay,
} from './who-list-view.js'
import {
  paramsPlace,
  realmRelocateChoices,
  relocateAt,
  storePlaceAt,
  townHallAt,
} from './realm-orders-view.js'
import { RealmRelocateCard, RealmScriptCard, RealmTileOrders } from './RealmOrders.js'
import { searchPath } from './map/path-preview.js'
import {
  pickHint,
  picksWallLine,
  pickPrompt,
  pickTap,
  pickTarget,
  useMediaQuery,
  useTouchScreen,
  type RealmVehiclePick,
} from './pick-mode.js'
import { pickPreview, previewPickOf, type PreviewWorld } from './pick-preview.js'
import { PHONE_QUERY } from './sheet-view.js'
import { buildingNodeKind } from './building-info-view.js'
import {
  buildHereProblem,
  describeTile,
  escapeStep,
  hitchChoice,
  makeLeaderProblem,
  nameHeirProblem,
  nodeFit,
  type ActionId,
  commandedCarriages,
  strangersCarriage,
} from './selection-view.js'
import {
  groupRelocateActionProblem,
  groupRelocateChoices,
  knownOf,
  relocateActionProblem,
  relocateChoices,
} from './relocate-view.js'
import { ScriptLibrary, type ScriptToOpen } from './ScriptLibrary.js'
import { ScriptLog } from './ScriptLog.js'
import { ScriptMemoryTree } from './ScriptMemory.js'
import { ScriptRunInfo } from './ScriptRun.js'
import { ScriptParamFields, StartParamsForm } from './ScriptParams.js'
import { WorkSettings } from './WorkSettings.js'
import {
  canCustomise,
  groupStartValues,
  isWorkTask,
  overrideParamValues,
  startedScript,
  startFormOpens,
  startFormParams,
  startParamValues,
  startValues,
  startValuesValid,
  type StartValues,
} from './start-params.js'
import { CustomiseContext } from './Customise.js'
import { paramOnTile, paramPickAt, paramValueLabel, type ParamWorld } from './script-params-view.js'
import { faresKnown, loadKnown } from './seen.js'
import { useWorld } from './useWorld.js'
import { useLand } from './useLand.js'
import { landMarks, regionAt } from './map/land.js'

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
  /**
   * For Work, what the form started with, the workplace's settings (`CONTEXT.md`: Workplace
   * settings): Start gives only what was changed from it, the resident's overrides.
   */
  base?: StartValues
  picking?: ScriptParam
  error?: string
  start: (params: StartParamValues) => Promise<void>
}

/**
 * A realm order being given (`CONTEXT.md`: Realm order): Build on the realm bar opens the Build
 * menu, then the kind picks where it goes (with why the last tile would not do), then the
 * who-list says who builds it there. An order about a picked building, from its card, goes
 * straight to the who-list (`about`). Road or Wall picks a line's start and end (with why the
 * last line would not do), then the who-list says who builds it, sharing the line. Build here on
 * a tile's card opens the menu for that tile (`at`). Walk to picks the tile; Run script and
 * Relocate open their own card first; those and the storage card's orders go to the who-list as
 * `place`.
 */
type RealmOrder =
  | { step: 'menu'; at?: { x: number; y: number } }
  | { step: 'where'; building: BuildingKind; material?: WallMaterial; error?: string }
  | { step: 'walkTo' }
  | { step: 'script' }
  | { step: 'relocate' }
  | { step: 'place'; order: WhoPlaceOrder; at: WhoAt; title: string }
  | { step: 'who'; building: BuildingKind; material?: WallMaterial; at: { x: number; y: number } }
  | { step: 'about'; order: BuildingGroupOrder; target: Building }
  | { step: 'line'; building: 'road' | 'wall'; from?: { x: number; y: number }; error?: string }
  | { step: 'lineWho'; line: WhoLine }
  /** A carriage's or boat's order picking its tile: where to drive or row, a route's other stop. */
  | { step: 'vehiclePick'; pick: RealmVehiclePick; vehicle: OrderedVehicle; haul?: HaulSetup }
  /** The who-list of an order about a carriage or vessel, `at` where its taker stands (`standAt`). */
  | {
      step: 'vehicle'
      order: VehicleGroupOrder
      vehicle: OrderedVehicle
      at: { x: number; y: number }
    }

/** What the resident card's script param fields need of the world (`script-params-view`). */
function paramWorld(world: NonNullable<ReturnType<typeof useWorld>['world']>): ParamWorld {
  const { buildings, carriages, cities, waypoints } = world
  const [lastSeen, realmId] = [world.lastSeen.buildings, world.home.realmId]
  return { buildings, lastSeen, carriages, cities, realmId, size: world.map.size, waypoints }
}

/**
 * For a default script's target param (`targetParam`), what it would be on the resident's tile,
 * which the script uses while none is picked; undefined for a script without one.
 */
function targetOnTile(
  world: NonNullable<ReturnType<typeof useWorld>['world']>,
  script: ScriptSummary | undefined,
  at: { x: number; y: number },
): string | null | undefined {
  const name = script && targetParam(script)
  const param = script?.params.find((p) => p.name === name)
  if (!param || param.type === 'number') return undefined
  return paramOnTile(paramWorld(world), param.type, at)
}

/**
 * What the queue planner's map picks need of the world (`plan-step`), with what is known of the
 * terrain to tell the water from the shore.
 */
function planWorld(
  world: NonNullable<ReturnType<typeof useWorld>['world']>,
  terrainAt?: (x: number, y: number) => number | undefined,
): PlanWorld {
  const water = (x: number, y: number) => {
    const t = terrainAt?.(x, y)
    return t !== undefined && isWater(t)
  }
  const { vessels } = world
  return { ...paramWorld(world), vessels, water, horses: world.horses, toFeed: toFeed(world) }
}

/**
 * Anyone Down in sight and any horse that isn't full as far as the Player knows, of any realm, to
 * Feed, most in need first (`CONTEXT.md`: Reviving, Feeding a horse).
 */
function toFeed(world: NonNullable<ReturnType<typeof useWorld>['world']>) {
  return [...world.residents.filter(isDown), ...horsesInNeed(world.horses)]
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
  const {
    world,
    founding,
    status,
    sendOrder,
    found,
    memories,
    runs,
    scriptLogs,
    watchScript,
    setFirstDay,
  } = useWorld(onLoggedOut)
  // The land the Player knows: regions, passes and land bridges (`CONTEXT.md`: Region).
  const land = useLand(world?.map, world?.grownChunks)
  const landShown = useMemo(
    () => (land ? { labels: land.labels, marks: landMarks(land) } : undefined),
    [land],
  )
  // The residents picked on the map or in the list: one shows their card, several a group card.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // Unit or realm control mode (`CONTEXT.md`: Control mode), kept per browser.
  const [controlMode, setControlModeShown] = useState<ControlMode>(() => rememberedControlMode())
  const setControlMode = useCallback((mode: ControlMode) => {
    setControlModeShown(mode)
    rememberControlMode(mode)
  }, [])
  // The first-day lines reported and not turned down, so each goes out once (`reportFirstDay`).
  const firstDayReported = useRef(new Set<ClientFirstDayLine>())
  // A tile picked on the map with no resident of the Player's on it; its card shows over the
  // resident's, who stays picked to be sent there.
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number }>()
  // The map's tile menu (`CONTEXT.md`: Waypoint): the tile right-clicked or long-pressed with
  // nothing else to do there, and where in the window it was pressed.
  const [tileMenu, setTileMenu] = useState<{ x: number; y: number; at: { x: number; y: number } }>()
  const closeTileMenu = useCallback(() => setTileMenu(undefined), [])
  // The horse last picked in the Horses drawer, to mark its row among others on the same tile.
  const [pickedHorseId, setPickedHorseId] = useState<string>()
  // The resident card's open tab and panel, kept here so they stay as the Player picks others;
  // the tab is also remembered in this browser (ADR 0012).
  const [cardSections, setCardSections] = useState<CardSections<ActionId>>(() => ({
    tab: rememberedTab(),
  }))
  const [picking, setPicking] = useState<Picking>(false)
  /** The siege machine the picked resident pushes once a tile is picked (`CONTEXT.md`: Siege machine). */
  const [pushing, setPushing] = useState<string | undefined>()
  const [haulSetup, setHaulSetup] = useState<HaulSetup>()
  const [orderError, setOrderError] = useState<string | undefined>()
  const [armyPick, setArmyPick] = useState<ArmyPick>()
  const [armyError, setArmyError] = useState<string | undefined>()
  // The param of the picked resident's script whose value the map is waiting for (`CONTEXT.md`:
  // Script parameter).
  const [paramPick, setParamPick] = useState<ScriptParam>()
  // The param of a workplace's Work settings whose value the map is waiting for (`CONTEXT.md`:
  // Workplace settings).
  const [workPick, setWorkPick] = useState<{ buildingId: string; param: ScriptParam }>()
  // The step being planned with the queue planner's Add step (`CONTEXT.md`: Queue, Planning
  // ahead): the map picks its places, then the card asks for what more it needs.
  const [plan, setPlan] = useState<Plan>()
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
  const [starting, setStarting] = useState<Starting>()
  // The param whose value the map is waiting for: of the running script, for the form, or of a
  // workplace's Work settings.
  const pickingParam = paramPick ?? starting?.picking ?? workPick?.param
  // A group order waiting for a tile, the tile picked to build on, and what the last one did.
  const [groupPicking, setGroupPicking] = useState<GroupPicking>(false)
  /**
   * Customise was tapped (`CONTEXT.md`: Before it starts): the next order opens the form. It waits
   * through what the order picks on the map first, and goes when that is cancelled.
   */
  const customising = useRef(false)
  // A realm order being given in realm control mode (`CONTEXT.md`: Realm order).
  const [realmOrder, setRealmOrder] = useState<RealmOrder>()
  // A realm order waiting for its place on the map: where the kind goes, where to walk to, or a
  // line's ends.
  const realmPicking =
    realmOrder?.step === 'where' ||
    realmOrder?.step === 'walkTo' ||
    realmOrder?.step === 'line' ||
    realmOrder?.step === 'vehiclePick'
  // The road or wall line the realm order gives, if it gives one.
  const realmLine =
    realmOrder?.step === 'line'
      ? realmOrder.building
      : realmOrder?.step === 'lineWho'
        ? realmOrder.line.building
        : undefined
  // The realm bar's order being given, if one is: its button shows pressed.
  const realmBarOpen: RealmBarOrder | undefined =
    realmOrder === undefined || realmOrder.step === 'about'
      ? undefined
      : realmLine
        ? realmLine
        : realmOrder.step === 'menu' || realmOrder.step === 'where' || realmOrder.step === 'who'
          ? 'build'
          : realmOrder.step === 'script'
            ? 'runScript'
            : realmOrder.step === 'place'
              ? REALM_BAR_ORDERS.find((o) => o.id === realmOrder.order.kind)?.id
              : realmOrder.step === 'walkTo' || realmOrder.step === 'relocate'
                ? realmOrder.step
                : undefined
  const orderPicked =
    picking !== false || groupPicking !== false || plan !== undefined || realmOrder !== undefined
  useEffect(() => {
    if (!orderPicked) customising.current = false
  }, [orderPicked])
  // What the group order being picked needs besides the tile, and a line's first end.
  const [groupPickWith, setGroupPickWith] = useState<GroupPickWith>({})
  const [groupLineFrom, setGroupLineFrom] = useState<{ x: number; y: number }>()
  // The start picked for the picked resident's Build line, while they pick its end.
  const [lineFrom, setLineFrom] = useState<{ x: number; y: number }>()
  /** What a wall line is built of, picked on the banner while its ends are picked (`CONTEXT.md`: Wood or stone). */
  const [wallMaterial, setWallMaterial] = useState<WallMaterial>('wood')
  // Where a pick is previewed: the tile under the pointer, or the one tapped on a touch screen.
  const [pickAt, setPickAt] = useState<{ x: number; y: number; tapped?: boolean }>()
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
  // The other realms (and NPC cities) the Player knows by name: their allies and those in sight.
  const realms = world
    ? [
        ...(world.diplomacy.alliance?.members ?? []).filter(
          (m) => m.realmId !== world.home.realmId,
        ),
        ...world.diplomacy.realmsInSight,
      ]
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
  // The realm's boats someone of the group stands beside, and its ships docked at a haven one of
  // them stands on, to board with the places left in each (`CONTEXT.md`: Beside a vessel, Docked).
  const groupBoats = world
    ? world.vessels.flatMap((v) => {
        const room = vesselRoom(v)
        if (room === undefined) return []
        const beside = (r: SeenResident) =>
          vesselOfResident(v, r) && besideVessel(v, r, world.map.size, world.buildings)
        if (!group.some(beside)) return []
        return [{ vessel: v, seats: Math.max(0, Math.floor(room / PASSENGER_WEIGHT + 1e-9)) }]
      })
    : []
  // What group orders need of what the Player sees (`GroupSeen`).
  const groupSeen: GroupSeen = world
    ? {
        vessels: world.vessels.filter((v) => v.realmId === world.home.realmId),
        // Free horses of the realm, to mount (`CONTEXT.md`: Riding).
        horses: world.horses.filter(
          (h) =>
            h.realmId === world.home.realmId && !carriagePulledBy(world, h) && !riderOf(world, h),
        ),
        carriages: world.carriages.filter((k) => k.realmId === world.home.realmId),
        buildings: world.buildings,
        toFeed: toFeed(world),
      }
    : {}
  const homeCity = world?.cities.find((c) => c.id === world.home.cityId)
  /** The realm's horses standing in a building, to breed (`CONTEXT.md`: Breeding). */
  const realmHorsesIn = (b: Building) =>
    world
      ? world.horses.filter((h) => h.realmId === world.home.realmId && isAt(h, b, world.map.size))
      : []
  // The cities and buildings the Player knows, in sight or remembered (`CONTEXT.md`: Last seen).
  const knownCities = world ? knownOf(world.cities, world.lastSeen.cities) : []
  const knownBuildings = world ? knownOf(world.buildings, world.lastSeen.buildings) : []
  // The goods in the top bar (`CONTEXT.md`: Goods in the top bar). The pick stays remembered while
  // its city is lost, as a city just out of sight can be missing from what the Player knows.
  const [goodsPicked, setGoodsPicked] = useState(() => rememberedGoodsPick())
  const goods = (() => {
    if (!world) return undefined
    const cities = goodsPickCities(knownCities, world.home.realmId)
    const pick = goodsPickOf(goodsPicked, cities)
    const onPick = (next: GoodsPick) => {
      setGoodsPicked(next)
      rememberGoodsPick(next)
    }
    const seen = {
      buildings: world.buildings,
      lastSeen: world.lastSeen.buildings,
      cities: knownCities,
    }
    const { totals, old } = keyGoods(seen, world.home.realmId, pick)
    return { totals, oldText: goodsOldText(old, world.tick), cities, pick, onPick }
  })()
  /**
   * For one of the Player's own residents: the cities to relocate them to and why they can't be
   * told to at all, if they can't (`CONTEXT.md`: Relocate), from what the Player knows.
   */
  function relocateFor(r: Resident) {
    if (!world || r.owner !== world.home.realmId) return undefined
    const seen = { cities: knownCities, buildings: knownBuildings, residents: world.residents }
    const choices = relocateChoices(seen, world.home.realmId, r)
    return { choices, problem: relocateActionProblem(r, choices) }
  }
  /** The same for the group picked, all of them or none (`CONTEXT.md`: Group, Relocate). */
  function relocateForGroup(rs: Resident[]) {
    if (!world) return undefined
    const seen = { cities: knownCities, buildings: knownBuildings, residents: world.residents }
    const choices = groupRelocateChoices(seen, world.home.realmId, rs)
    return { choices, problem: groupRelocateActionProblem(rs, choices) }
  }
  // The script library's list, shared with the resident inspector's run-script order.
  const [scripts, setScripts] = useState<ScriptSummary[]>([])
  // A script to open in the library, such as the one a resident's task runs; `at` reopens it.
  const [scriptToOpen, setScriptToOpen] = useState<ScriptToOpen>()
  // A place to show on the map, such as one from the realm log or a resident picked in the list:
  // asked for, then centred between the open drawer and the selection card once they are drawn.
  // A place to show on the map; `zoom` picks the zoom from the one now (the zoom stays without).
  const [toShow, setToShow] = useState<{ x: number; y: number; zoom?: (scale: number) => number }>()
  const [focus, setFocus] = useState<{
    x: number
    y: number
    zoom?: (scale: number) => number
    cover: Covered
  }>()
  // The drawer open over the map, if any (ADR 0008: one at a time).
  // The Diplomacy drawer's tab is kept with it, and stays while the drawer is closed.
  const [drawers, setDrawers] = useState<Drawers>(NO_DRAWER)
  const openDrawer = drawers.open
  const setOpenDrawer = useCallback(
    (open: OpenDrawer | ((open: OpenDrawer) => OpenDrawer)) =>
      setDrawers((d) => withOpen(d, typeof open === 'function' ? open(d.open) : open)),
    [],
  )
  const demandsShown = showsTab(drawers, 'demands')
  const offersShown = showsTab(drawers, 'directOffers')
  // The notice of demands sent to the realm (`CONTEXT.md`: Demand), until the Player dismisses it
  // or has them in front of them in the drawer.
  const [demandsPutAway, setDemandsPutAway] = useState<ReadonlySet<string>>(new Set())
  const demands = world?.diplomacy.demands
  const homeRealm = world?.home.realmId
  const putDemandsAway = useCallback(() => {
    if (demands && homeRealm) {
      setDemandsPutAway(new Set(demandSides(demands, homeRealm).incoming.map((d) => d.id)))
    }
  }, [demands, homeRealm])
  useEffect(() => {
    if (demandsShown) putDemandsAway()
  }, [demandsShown, putDemandsAway])
  const demandNotice =
    demands && homeRealm
      ? demandNoticeLine(demands, homeRealm, demandsPutAway, demandsShown)
      : undefined
  // The notice of what others sent the realm (`CONTEXT.md`: Notices), until the Player dismisses it
  // or has it in front of them in the drawer.
  const [incomingPutAway, setIncomingPutAway] = useState<ReadonlySet<string>>(new Set())
  const incoming = useMemo(
    () => (world ? incomingItems(world.diplomacy, world.home.realmId) : []),
    [world],
  )
  const putIncomingAway = useCallback(
    () => setIncomingPutAway(new Set(incoming.map((i) => i.id))),
    [incoming],
  )
  useEffect(() => {
    if (offersShown) putIncomingAway()
  }, [offersShown, putIncomingAway])
  const incomingNotice = incomingNoticeLine(incoming, incomingPutAway, offersShown)
  // What the Player hasn't seen in a drawer yet, for the marks on the rail and the Diplomacy tabs
  // (`CONTEXT.md`: Tool rail): what was sent to the realm, seen once its tab was in front of them,
  // and realm log lines newer than the last one they had open.
  const [seenIds, setSeenIds] = useState<SeenIds>(NOTHING_SEEN)
  const sent = useMemo(
    () =>
      world
        ? sentToRealm(world.diplomacy, world.home.realmId)
        : { contracts: [], demands: [], directOffers: [] },
    [world],
  )
  const tabShown = openDrawer === 'diplomacy' ? drawers.tab : undefined
  useEffect(() => {
    if (tabShown === 'contracts' || tabShown === 'demands' || tabShown === 'directOffers') {
      setSeenIds((s) => seeTab(s, tabShown, sent[tabShown]))
    }
  }, [tabShown, sent])
  const [logSeenUpTo, setLogSeenUpTo] = useState<number | null>(null)
  const events = world?.events
  useEffect(() => {
    if (!events || !homeRealm) return
    const newest = newestLine(events)
    if (openDrawer === 'realmLog' && newest !== null) {
      setLogSeenUpTo((upTo) => {
        if (upTo !== null && upTo >= newest) return upTo
        rememberLogSeen(homeRealm, newest)
        return newest
      })
    } else {
      // Until the log was open in this browser, what it held on arrival counts as seen.
      setLogSeenUpTo((upTo) => upTo ?? rememberedLogSeen(homeRealm) ?? newest ?? -1)
    }
  }, [events, homeRealm, openDrawer])
  const marks = unseenMarks(sent, seenIds, events ?? [], logSeenUpTo)
  // The notice that the heir took over (`CONTEXT.md`: Leader death with an heir), until the Player
  // puts it away; remembered in this browser, so it shows at once or on their next login.
  const [takeoverSeen, setTakeoverSeen] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    if (homeRealm) setTakeoverSeen((seen) => seen ?? rememberedTakeoverSeen(homeRealm))
  }, [homeRealm])
  const takeover =
    events && takeoverSeen !== undefined ? heirTakeover(events, takeoverSeen) : undefined
  const putTakeoverAway = () => {
    if (!takeover || !homeRealm) return
    rememberTakeoverSeen(homeRealm, takeover.seq)
    setTakeoverSeen(takeover.seq)
  }
  const closeDrawer = useCallback(() => setOpenDrawer(undefined), [setOpenDrawer])
  // The Residents drawer opened fully (`CONTEXT.md`: Residents list); closing it goes back.
  const [residentsFull, setResidentsFull] = useState(false)
  const fullList = residentsFull && openDrawer === 'residents'
  useEffect(() => {
    if (openDrawer !== 'residents') setResidentsFull(false)
  }, [openDrawer])
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
    realm:
      realmOrder?.step === 'where'
        ? {
            building: realmOrder.building,
            ...(realmOrder.error ? { error: realmOrder.error } : {}),
          }
        : realmOrder?.step === 'walkTo'
          ? {}
          : realmOrder?.step === 'vehiclePick'
            ? { vehicle: realmOrder.pick }
            : undefined,
    realmLine:
      realmOrder?.step === 'line'
        ? {
            building: realmOrder.building,
            ...(realmOrder.from ? { from: realmOrder.from } : {}),
            ...(realmOrder.error ? { error: realmOrder.error } : {}),
          }
        : undefined,
  })
  // The building the tile card is about: in sight, or as last seen.
  const tileBuilding =
    world && selectedTile
      ? [...world.buildings, ...world.lastSeen.buildings].find(
          (b) => !SHARES_A_TILE.includes(b.kind) && covers(b, selectedTile.x, selectedTile.y),
        )
      : undefined
  // A step picking a city keeps the card open: it lists the realm's cities to pick from too.
  const picksCity = plan !== undefined && nextPick(plan)?.pick === 'city'
  // A new pick (or none) previews nothing until the pointer or a tap shows where.
  const pickKey = pick ? pickPrompt(pick, false) : ''
  useEffect(() => setPickAt(undefined), [pickKey])
  /**
   * A tile clicked or tapped while picking (`pickTap`): a click picks it; a tap on a touch screen
   * previews it first, and a second tap there or Confirm picks it. A right-click or long-press
   * (`pressed`) with nothing picked and nobody to send opens the tile menu there instead.
   */
  const pickTile = (
    x: number,
    y: number,
    tap?: { touch: boolean },
    pressed?: { x: number; y: number },
  ) => {
    if (pressed && world && !pick && !starting?.picking && !selected && group.length <= 1) {
      const size = world.map.size
      setSelectedTile(undefined)
      return setTileMenu({ x: wrap(x, size), y: wrap(y, size), at: pressed })
    }
    if (tap && pick) {
      const next = pickTap(pickAt?.tapped ? pickAt : undefined, { x, y }, tap.touch)
      if ('preview' in next) return setPickAt({ ...next.preview, tapped: true })
    }
    setPickAt(undefined)
    void goTo(x, y)
  }
  /** Leaves pick mode without giving the order; the card comes back as it was. */
  const cancelPick = useCallback(() => {
    setPicking(false)
    setGroupPicking(false)
    setArmyPick(undefined)
    setParamPick(undefined)
    setWorkPick(undefined)
    setPlan(undefined)
    setStarting((s) => s && { ...s, picking: undefined })
    // A realm order picking its place goes back to the realm bar.
    setRealmOrder((o) =>
      o?.step === 'where' || o?.step === 'walkTo' || o?.step === 'line' || o?.step === 'vehiclePick'
        ? undefined
        : o,
    )
  }, [])
  /**
   * Switches the control mode (the HUD switch, Tab). Into realm control mode it drops a picked
   * resident, group or army, which are commanded in unit control mode only.
   */
  const switchControlMode = useCallback(
    (mode: ControlMode) => {
      if (mode === 'realm') {
        setSelectedIds([])
        setStarting(undefined)
        cancelPick()
      }
      setControlMode(mode)
    },
    [cancelPick, setControlMode],
  )
  // A realm order is given in realm control mode only: leaving it drops one half given.
  useEffect(() => {
    if (controlMode === 'unit') setRealmOrder(undefined)
  }, [controlMode])
  // Tab flips the control mode, unless the Player is typing or in a dialog, where it moves on
  // as ever (`CONTEXT.md`: Control mode).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof Element &&
        e.target.closest('input, textarea, select, .cm-editor, [aria-modal="true"]') !== null
      const { key, ctrlKey, metaKey, altKey, shiftKey } = e
      if (!flipsControlMode({ key, ctrlKey, metaKey, altKey, shiftKey, typing })) return
      e.preventDefault()
      switchControlMode(flipped(controlMode))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controlMode, switchControlMode])
  // Picking a resident, a group or an army some other way than a map click (the Residents list,
  // a saved group's key, the Armies drawer, a notice) switches to unit control mode.
  const pickedArmy = armyPick !== undefined
  useEffect(() => {
    const next = modeAfterPick(controlMode, { residents: selectedIds.length, army: pickedArmy })
    if (next !== controlMode) setControlMode(next)
  }, [controlMode, selectedIds.length, pickedArmy, setControlMode])
  // Escape leaves the top-most thing first: pick mode, an open panel (the form before a script
  // starts among them), the tile card, the resident or group card, then the drawer. A card
  // hidden behind the wide drawer is passed over, so Escape closes the drawer in front of it.
  const hideCard = cardHidden(openDrawer, fullList)
  const shownCard = !hideCard
  const anySelected = selectedIds.length > 0
  const picked = pick !== undefined
  const formOpen = starting !== undefined
  const tileOpen = selectedTile !== undefined
  // The realm order's Build menu or who-list, which Escape closes as it does a card.
  const realmCard = realmOrder !== undefined && !realmPicking
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof Element && e.target.closest('input, textarea, select, .cm-editor')
      if (e.key !== 'Escape' || typing) return
      const step = escapeStep({
        pick: picked,
        panel: formOpen || (shownCard && panelOpen()),
        tile: shownCard && tileOpen,
        card: shownCard && (anySelected || realmCard),
      })
      // With nothing else open, the drawer's own Escape closes it.
      if (!step) return
      // Ahead of the drawer's own Escape, which would close it too.
      e.stopImmediatePropagation()
      if (step === 'pick') return cancelPick()
      if (step === 'panel') {
        if (formOpen) return setStarting(undefined)
        return closeOpenPanel()
      }
      if (step === 'tile') return setSelectedTile(undefined)
      setSelectedIds([])
      setPicking(false)
      setRealmOrder(undefined)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [anySelected, realmCard, picked, formOpen, tileOpen, shownCard, cancelPick])
  useLayoutEffect(() => {
    if (!toShow) return
    const covered = mapCovered()
    const shown = showBeside(window.innerWidth, covered.left, covered.right)
    if (shown.closeDrawer) closeDrawer()
    setFocus({ ...toShow, cover: shown })
  }, [toShow, closeDrawer])
  const showOnMap = (x: number, y: number) => setToShow({ x, y })
  /**
   * Reports a first-day line only the client sees done, once, while the card shows
   * (`CONTEXT.md`: First day); the server ticks the others itself.
   */
  const reportFirstDay = (line: ClientFirstDayLine) => {
    const card = world?.firstDay
    if (!card || !firstDayShown(card) || card.done.includes(line)) return
    if (firstDayReported.current.has(line)) return
    firstDayReported.current.add(line)
    api.firstDayDone(line).then(setFirstDay, () => firstDayReported.current.delete(line))
  }
  // Picking a resident, however it happened: on the map, in a list, a saved group.
  const residentPicked = selectedIds.length > 0
  useEffect(() => {
    if (residentPicked) reportFirstDay('pickResident')
  })
  /** Hides the first-day card at once; the server keeps it dismissed for good. */
  const dismissFirstDay = () => {
    if (world) setFirstDay({ ...world.firstDay, dismissed: true })
    api.dismissFirstDay().then(setFirstDay, () => {})
  }
  /** Picks residents on the map: one shows their card, several a group card. */
  const select = (ids: string[]) => {
    setSelectedIds(ids)
    setSelectedTile(undefined)
    setPicking(false)
    setArmyPick(undefined)
    setParamPick(undefined)
    setWorkPick(undefined)
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
   * starting a script starts at once (`CONTEXT.md`: Starting at once), unless the form opens
   * (`opensForm`); Start gives it with the values.
   */
  const giveOrder = (order: OrderRequest, queued = shift.current): Promise<string | undefined> => {
    const r = own.find((x) => x.id === order.residentId)
    const asked =
      order.params === undefined &&
      opensForm(order, [r?.scriptParams], async (params) =>
        setOrderError(await giveOrder({ ...order, params }, queued)),
      )
    if (asked) return Promise.resolve(undefined)
    const queuedFor = queued ? r : undefined
    return sendOrder((queuedFor && appendRequest(queuedFor, order)) ?? order)
  }
  /**
   * Opens the form before the script `order` starts, if it should (`startFormOpens`), and says
   * whether it did: filled with what `keptBy` keep for the script or the defaults, for Work with
   * the workplace's settings (`CONTEXT.md`: Workplace settings); Start runs `start`. Asking for it
   * with Customise is used up here, whatever the order.
   */
  function opensForm(
    order: OrderRequest,
    keptBy: readonly (ScriptParamValues | undefined)[],
    start: (params: StartParamValues) => Promise<void>,
  ): boolean {
    const customise = customising.current
    customising.current = false
    const settings = world?.workSettings ?? {}
    const script = startedScript(order, scripts, settings)
    const params = script ? startFormParams(order, script) : []
    if (!script || !startFormOpens(order, params, customise)) return false
    const atWork = isWorkTask(order)
    const values = atWork
      ? startValues(params, settings[order.workplaceId as string]?.params)
      : groupStartValues(
          params,
          keptBy.map((kept) => kept?.[script.id]),
          targetParam(script),
        )
    setStarting({ script, params, values, ...(atWork ? { base: values } : {}), start })
    return true
  }
  // The city picked on the map or opened in the Cities drawer.
  const [openCityId, setOpenCityId] = useState<string>()
  // The warehouse or storage Trade here scrolls the open city to; a new object each press.
  const [tradeAt, setTradeAt] = useState<{ buildingId: string }>()
  // The wandering traders' stops whose notice the Player dismissed (`CONTEXT.md`: Trader stop).
  const [dismissedVisits, setDismissedVisits] = useState<ReadonlySet<string>>(new Set())

  /**
   * Orders the picked resident to walk to a tile, or, while picking where to drive, to drive the
   * carriage on their tile there, or, while picking a haul route's other stop, to haul between
   * their tile and that one, or, while picking a road's or wall's two ends, to build it along the
   * line between them with the Build line task (ADR 0002: the server checks it).
   */
  async function goTo(x: number, y: number) {
    const mode = picking
    setPicking(false)
    if (realmOrder?.step === 'where') return realmTile(x, y, realmOrder)
    if (realmOrder?.step === 'walkTo') return realmWalkTo(x, y)
    if (realmOrder?.step === 'line') return realmLineTile(x, y, realmOrder)
    if (realmOrder?.step === 'vehiclePick') return realmVehicleTile(x, y, realmOrder)
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
      else await setScriptParam(paramPick.name, { targetId: picked.id })
      return
    }
    if (workPick) {
      setWorkPick(undefined)
      if (!world) return
      const picked = paramPickAt(paramWorld(world), workPick.param.type, { x, y })
      if (typeof picked === 'string') setOrderError(picked)
      else await setWorkSettings(workPick.buildingId, { [workPick.param.name]: picked.id })
      return
    }
    if (armyPick) {
      setArmyPick(undefined)
      setArmyError(await sendOrder({ kind: armyPick.kind, armyId: armyPick.armyId, x, y }))
      return
    }
    if (plan && nextPick(plan)) {
      if (!world) return
      const next = pickInto(planWorld(world, terrainAt), plan, { x, y })
      if (nextPick(next) || planAsk(next)) setPlan(next)
      else await addPlanned(next)
      return
    }
    if (group.length > 1) {
      await groupTile(x, y)
      return
    }
    if (!selected) return
    // One of a siege machine's crew pushes it there (`CONTEXT.md`: Siege machine).
    if (mode === 'push' && pushing) {
      const order = { kind: 'push', residentId: selected.id, machineId: pushing, x, y }
      setOrderError(await giveOrder(order, false))
      return
    }
    // One of a catapult's crew aims it at the wall on that tile (`CONTEXT.md`: Catapult).
    if (mode === 'throw' && pushing) {
      const order = { kind: 'throw', residentId: selected.id, machineId: pushing, x, y }
      setOrderError(await giveOrder(order, false))
      return
    }
    // Driving and hauling keep to the realm's; only Drive off takes another's (`CONTEXT.md`:
    // Stealing a carriage or horse), whatever else stands on the tile.
    const carriage = ownCarriageHere
    const rowed = mode === 'row' ? boatToRow : mode === 'rowOff' ? boatToSteal : undefined
    if (rowed) {
      // To the water tile, or the free water beside a land tile (`CONTEXT.md`: Rowing); another
      // organization's boat is stolen by it (Stealing a carriage or horse).
      // A ship is sailed by one of its crew, to Sea or to a haven (`CONTEXT.md`: Sailing).
      const kind = 'ship' in rowed && rowed.ship ? 'sail' : 'row'
      const order = { kind, residentId: selected.id, vesselId: rowed.id, x, y }
      setOrderError(await giveOrder(order))
      return
    }
    const driven = mode === 'driveOff' ? stealableHere : mode === 'drive' ? carriage : undefined
    if (driven) {
      const order = { kind: 'drive', residentId: selected.id, carriageId: driven.id, x, y }
      setOrderError(await giveOrder(order))
      return
    }
    // Only this names a stranger's horse, so only this steals one to pull the realm's carriage.
    if (mode === 'hitchOff' && unhorsedHere && horseToHitch) {
      const order = {
        kind: 'drive',
        residentId: selected.id,
        carriageId: unhorsedHere.id,
        horseId: horseToHitch.id,
        x,
        y,
      }
      setOrderError(await giveOrder(order, false))
      return
    }
    // With no carriage of theirs here, the boat beside them (`CONTEXT.md`: Haul route by water).
    const hauled = carriage ?? boatToRow
    if (mode === 'haul' && hauled && haulSetup) {
      // The Haul task: they run the Player's Haul (default) script (`CONTEXT.md`: Default script).
      const order = { kind: 'task', task: 'haul', residentId: selected.id, carriageId: hauled.id }
      setOrderError(await giveOrder({ ...order, x, y, ...haulSetup }))
      return
    }
    if (mode === 'roadFrom' || mode === 'wallFrom') {
      // Then the line's other end.
      setLineFrom({ x, y })
      setPicking(mode === 'roadFrom' ? 'roadTo' : 'wallTo')
      return
    }
    if ((mode === 'roadTo' || mode === 'wallTo') && lineFrom) {
      // The Build line task: they run the Player's Build line (default) script (`CONTEXT.md`: Build line).
      const building = mode === 'roadTo' ? 'road' : 'wall'
      const order = {
        kind: 'task',
        task: 'buildLine',
        residentId: selected.id,
        building,
        ...(building === 'wall' && wallMaterial === 'stone' ? { material: wallMaterial } : {}),
      }
      setLineFrom(undefined)
      setOrderError(await giveOrder({ ...order, from: lineFrom, to: { x, y } }))
      return
    }
    setOrderError(await giveOrder({ kind: 'walkTo', residentId: selected.id, x, y }))
  }

  /**
   * Starts planning a step with Add step (`CONTEXT.md`: Queue, Planning ahead): the map picks its
   * places first; one that needs neither is added at once.
   */
  async function startPlan(kind: PlanStepId, after?: number, extra?: Partial<Plan>) {
    setPicking(false)
    setGroupPicking(false)
    setParamPick(undefined)
    const fresh: Plan = { kind, picked: [], ...(after === undefined ? {} : { after }), ...extra }
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
  /**
   * Why a kind can't be laid out on a tile, as far as the Player knows (`buildHereProblem`); a
   * stone wall or gate may go on the wooden one of its kind (`CONTEXT.md`: Wood or stone).
   */
  const buildProblemAt =
    (w: NonNullable<typeof world>, x: number, y: number) =>
    (kind: BuildingKind, material?: WallMaterial) =>
      material === 'stone' && stoneOverAt(w, x, y, kind)
        ? undefined
        : buildHereProblem(
            kind,
            x,
            y,
            w,
            (nx, ny) => nodeAt?.(nx, ny),
            // Terrain not loaded counts as unexplored: nothing is laid out there.
            { size: w.map.size, at: (tx, ty) => terrainAt?.(tx, ty) ?? UNEXPLORED },
          )
  /**
   * Why a kind picked before its tile can't go on the tile (`CONTEXT.md`: Realm order), as the
   * Build menu there would say it: the placement rule, a node's workplace off its node.
   */
  const realmBuildProblem = (
    w: NonNullable<typeof world>,
    x: number,
    y: number,
    kind: BuildingKind,
    material?: WallMaterial,
  ) => kindProblemOn(kind, nodeAt?.(x, y), (k) => buildProblemAt(w, x, y)(k, material))
  /**
   * The tile picked for a realm order's Build: a kind that can't go there says why, and the
   * Player picks again; else the who-list opens for it.
   */
  function realmTile(x: number, y: number, o: Extract<RealmOrder, { step: 'where' }>) {
    if (!world) return
    const size = world.map.size
    const at = { x: wrap(x, size), y: wrap(y, size) }
    const problem = realmBuildProblem(world, at.x, at.y, o.building, o.material)
    const material = o.material ? { material: o.material } : {}
    if (problem)
      return setRealmOrder({ step: 'where', building: o.building, ...material, error: problem })
    setRealmOrder({ step: 'who', building: o.building, ...material, at })
  }
  /** Opens the who-list for an order about places and goods, measured from `at` (`CONTEXT.md`: Who-list). */
  function realmWho(
    order: WhoPlaceOrder,
    at: WhoAt | undefined,
    names: { script?: string; city?: string } = {},
  ) {
    if (!at) return setRealmOrder(undefined)
    setRealmOrder({ step: 'place', order, at, title: whoTitle(order, world?.map.size, names) })
  }
  /** The tile picked for a realm order's Walk to: then who walks there. */
  function realmWalkTo(x: number, y: number) {
    if (!world) return
    const size = world.map.size
    const [tx, ty] = [wrap(x, size), wrap(y, size)]
    realmWho({ kind: 'walkTo', x: tx, y: ty }, { x: tx, y: ty })
  }
  /**
   * Where the who-list measures from for an order with no target tile: the realm's town hall,
   * else, with none known, the Leader.
   */
  function realmHome(): WhoAt | undefined {
    if (!world) return undefined
    const seen = { cities: knownCities, buildings: knownBuildings }
    const hall = world.home.cityId ? townHallAt(seen, world.home.cityId) : undefined
    if (hall) return hall
    const lead = own.find((r) => r.id === world.home.leaderId)
    return lead && { x: lead.x, y: lead.y, near: lead.name }
  }
  /**
   * Explore or Run script as a realm order (`CONTEXT.md`: Realm order): its form first (always
   * for Explore; for a script when it needs values or Customise was pressed), then the who-list,
   * nearest a building, carriage or waypoint picked for a param first, else the town hall.
   */
  function realmScriptOrder(
    order: Extract<WhoPlaceOrder, { kind: 'explore' | 'gather' | 'runScript' }>,
  ) {
    if (!world) return
    setRealmOrder(undefined)
    const script =
      order.kind === 'runScript' ? scripts.find((s) => s.id === order.scriptId) : undefined
    const names = script ? { script: script.name } : {}
    const toWho = (params?: StartParamValues) => {
      const place = paramsPlace(params, {
        buildings: knownBuildings,
        carriages: world.carriages,
        waypoints: world.waypoints,
      })
      realmWho(params ? { ...order, params } : order, place ?? realmHome(), names)
    }
    if (order.kind === 'explore' || order.kind === 'gather') customising.current = true
    const asked = opensForm(groupOrderStart(order) ?? { kind: order.kind }, [], async (params) =>
      toWho(params),
    )
    if (!asked) toWho()
  }
  /**
   * A tile picked for a realm order's road or wall line: its start, then its end. A line that
   * can't be built says why (`lineProblem`) and the Player picks its end again; else the who-list
   * opens for it. A wall is of the material picked on the banner.
   */
  function realmLineTile(x: number, y: number, o: Extract<RealmOrder, { step: 'line' }>) {
    if (!world) return
    const size = world.map.size
    const at = { x: wrap(x, size), y: wrap(y, size) }
    if (!o.from) return setRealmOrder({ step: 'line', building: o.building, from: at })
    const stone = o.building === 'wall' && wallMaterial === 'stone'
    const line: WhoLine = {
      kind: 'line',
      building: o.building,
      from: o.from,
      to: at,
      ...(stone ? { material: 'stone' as const } : {}),
    }
    // A tile takes the line if it has a site of its building to join or the building can go there
    // (a stone wall over a wooden gate upgrades the gate).
    const builds = (tx: number, ty: number) => {
      const kind = stone && stoneOverAt(world, tx, ty, 'gate') ? 'gate' : o.building
      const site = world.buildings.some(
        (b) => b.site && b.kind === kind && b.x === tx && b.y === ty,
      )
      return site || buildProblemAt(world, tx, ty)(kind, line.material) === undefined
    }
    const problem = lineProblem(line, size, builds)
    if (problem)
      return setRealmOrder({ step: 'line', building: o.building, from: o.from, error: problem })
    setRealmOrder({ step: 'lineWho', line })
  }
  /**
   * Confirm on the who-list: those ticked get what the group card sends them, replacing what they
   * do, or appended to their queue for those set to After: for Build the first there lays out the
   * site and the others join it; a line they share. With Shift held the same kind stays armed for
   * the next place; else the realm bar is back.
   */
  async function confirmRealmOrder(
    order: Extract<WhoOrder, { kind: 'build' | 'line' }>,
    ids: readonly string[],
    after: readonly string[],
    again: boolean,
  ) {
    const to = ids.flatMap((id) => own.filter((r) => r.id === id))
    const material = order.material ? { material: order.material } : {}
    if (!again) setRealmOrder(undefined)
    else if (order.kind === 'line') setRealmOrder({ step: 'line', building: order.building })
    else setRealmOrder({ step: 'where', building: order.building, ...material })
    await sendGroup(order, false, to, undefined, new Set(after))
  }
  /**
   * Confirm on the who-list of an order about places and goods: those ticked get what the group
   * card sends them, replacing what they do, or appended to their queue for those set to After.
   * With Shift held Walk to stays armed for the next place; else the realm bar is back.
   */
  async function confirmPlace(
    order: WhoPlaceOrder,
    ids: readonly string[],
    after: readonly string[],
    again: boolean,
  ) {
    const to = ids.flatMap((id) => own.filter((r) => r.id === id))
    setRealmOrder(again && order.kind === 'walkTo' ? { step: 'walkTo' } : undefined)
    await sendGroup(order, false, to, undefined, new Set(after))
  }
  /**
   * A realm order from a building's card (`CONTEXT.md`: Realm order): its form first when it
   * has one (Customise, a Work's settings), then the who-list.
   */
  function startAbout(order: BuildingGroupOrder, target: Building) {
    const toWho = (o: BuildingGroupOrder) => {
      setSelectedTile(undefined)
      setWorkPick(undefined)
      setRealmOrder({ step: 'about', order: o, target })
    }
    const start = groupOrderStart(order)
    const asked =
      start !== undefined &&
      opensForm(start, [], async (params) => toWho({ ...order, params } as BuildingGroupOrder))
    if (!asked) toWho(order)
  }
  /**
   * Confirm on the who-list of an order about a building: those ticked get what the group card
   * sends, those far off walking there first (`realmRequests`), and those set to After get it
   * appended to their queue; then the realm bar is back.
   */
  async function confirmAbout(
    order: BuildingGroupOrder,
    target: Building,
    ids: readonly string[],
    after: readonly string[],
  ) {
    const to = ids.flatMap((id) => own.filter((r) => r.id === id))
    setRealmOrder(undefined)
    await sendGroup(order, false, to, target, new Set(after))
  }
  /**
   * The carriage or vessel of the realm on a tile, as its card's realm orders need it
   * (`OrderedVehicle`): a carriage with its seats left, who drives it and whether a horse can pull
   * it; else a boat or ship with its seats left and who rows it.
   */
  function vehicleHere(x: number, y: number): OrderedVehicle | undefined {
    if (!world) return undefined
    const realmId = world.home.realmId
    const k = world.carriages.find((c) => c.realmId === realmId && c.x === x && c.y === y)
    if (k) {
      const driver = world.residents.find((r) => drivenCarriageId(r) === k.id)
      // A hitched horse, else a free one of the realm on its tile (`CONTEXT.md`: Hitched horse).
      const pulls = !!k.horseId || !!groupSeen.horses?.some((h) => h.x === k.x && h.y === k.y)
      return {
        what: 'carriage',
        carriage: k,
        seats: k.load ? seatsLeft(world, { ...k, load: k.load }, k.passengerIds?.length ?? 0) : 0,
        ...(driver ? { driver: { id: driver.id, name: driver.name } } : {}),
        ...(pulls ? {} : { noHorse: 'no horse to pull it' }),
      }
    }
    const v = world.vessels.find((s) => s.realmId === realmId && s.x === x && s.y === y)
    if (!v) return undefined
    const room = vesselRoom(v)
    const rower = v.rowerId ? world.residents.find((r) => r.id === v.rowerId) : undefined
    return {
      what: 'vessel',
      vessel: v,
      seats: room === undefined ? 0 : Math.max(0, Math.floor(room / PASSENGER_WEIGHT + 1e-9)),
      ...(rower ? { rower: { id: rower.id, name: rower.name } } : {}),
    }
  }
  /** Where the one taking an order about a carriage or vessel stands (`standAt`), if anywhere. */
  function vehicleStand(vehicle: OrderedVehicle) {
    if (!world) return undefined
    const standable = (x: number, y: number) => {
      const t = terrainAt?.(x, y)
      return t !== undefined && t !== UNEXPLORED && isPassableTerrain(t)
    }
    return standAt(vehicle, { size: world.map.size, standable, buildings: world.buildings })
  }
  /**
   * A realm order from a carriage's or vessel's card (`CONTEXT.md`: Realm order): Customise's form
   * first when it was asked for (a haul route), then the who-list, measured from where the one
   * taking it stands.
   */
  function startVehicle(order: VehicleGroupOrder, vehicle: OrderedVehicle) {
    const at = vehicleStand(vehicle)
    setSelectedTile(undefined)
    if (!at) return setRealmOrder(undefined)
    const toWho = (o: VehicleGroupOrder) =>
      setRealmOrder({ step: 'vehicle', order: o, vehicle, at })
    const start = groupOrderStart(order)
    const asked =
      start !== undefined &&
      opensForm(start, [], async (params) => toWho({ ...order, params } as VehicleGroupOrder))
    if (!asked) toWho(order)
  }
  /** The tile picked for Drive this to, Row this to or a haul route's other stop: then who. */
  function realmVehicleTile(x: number, y: number, o: Extract<RealmOrder, { step: 'vehiclePick' }>) {
    if (!world) return
    const size = world.map.size
    const to = { x: wrap(x, size), y: wrap(y, size) }
    const order = vehicleOrder(o.pick, o.vehicle, { to, ...(o.haul ? { haul: o.haul } : {}) })
    if (order) startVehicle(order, o.vehicle)
  }
  /**
   * Confirm on the who-list of an order about a carriage or vessel: those ticked get what the
   * group card sends, those far off walking there first (`vehicleRequests`), those set to After
   * getting it appended to their queue. A driver it replaces Now is stopped first.
   */
  async function confirmVehicle(
    o: Extract<RealmOrder, { step: 'vehicle' }>,
    ids: readonly string[],
    after: readonly string[],
  ) {
    if (!world) return
    const to = ids.flatMap((id) => own.filter((r) => r.id === id))
    setRealmOrder(undefined)
    const { requests, skipped, stop } = vehicleRequests(o.order, o.vehicle, to, {
      tick: world.tick,
      size: world.map.size,
      // No walk-to among these orders: no free tiles to spread over.
      free: () => true,
      seen: groupSeen,
      at: o.at,
      after: new Set(after),
    })
    if (stop) await sendOrder({ kind: 'stop', residentId: stop })
    await sendToGroup(
      requests.map((q) => q.order),
      skipped,
      to,
    )
  }
  /** The queue planner's Add step, on the resident card and the group card. */
  function addStep(w: NonNullable<typeof world>) {
    const seen = { cities: knownCities, buildings: knownBuildings, residents: w.residents }
    const cities = plan && nextPick(plan)?.pick === 'city' ? planCities(seen, w.home.realmId) : []
    const tile = plan?.kind === 'build' ? plan.picked[0] : undefined
    return (
      <AddStep
        plan={plan}
        onStart={(kind, after) => void startPlan(kind, after)}
        open={paletteOpen}
        onOpen={setPaletteOpen}
        onPlan={setPlan}
        conditionNames={{
          buildings: w.buildings,
          lastSeen: w.lastSeen.buildings,
          cities: knownCities,
        }}
        onAnswer={(answer) => plan && void addPlanned(plan, answer)}
        onCancel={() => setPlan(undefined)}
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
    // A storage, a stable, a haven or one of the realm's carriages, to store at or fetch from.
    const place = (): Place | undefined => {
      const at = storePlaceAt(world, realmId, x, y)
      return at && { id: at.id, name: at.name }
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
            // A site of a workplace too: Work builds it first (`CONTEXT.md`: Working a site).
            b.kind !== 'road' && covers(b, x, y) && MAX_WORKERS[b.kind] !== undefined,
        )
        if (!workplace) return fail('no workplace there')
        // What a smithy makes is picked for each worker on their own card.
        if (workplace.kind === 'smithy') return fail('pick what to make on each one’s card')
        return sendGroup({ kind: 'work', workplace, name: name(workplace) })
      }
      case 'drive':
        return sendGroup({ kind: 'drive', x, y })
      case 'row':
        return sendGroup({ kind: 'row', x, y })
      case 'haul':
        if (!groupPickWith.haul) return
        return sendGroup({ kind: 'haul', x, y, ...groupPickWith.haul })
      case 'roadTo':
      case 'wallTo':
        if (!groupLineFrom) return
        setGroupLineFrom(undefined)
        // Each gets the Build line task with the same line, so they share it (`CONTEXT.md`: Build line).
        return sendGroup({
          kind: 'line',
          building: mode === 'roadTo' ? 'road' : 'wall',
          from: groupLineFrom,
          to: { x, y },
          ...(mode === 'wallTo' && wallMaterial === 'stone' ? { material: wallMaterial } : {}),
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
        if (!at) return fail('no storage, stable, haven, carriage or boat of yours there')
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
   * script starts at once, each going on with what they keep (`CONTEXT.md`: Starting at once),
   * unless the form opens, once for all (`opensForm`), filled with the values all of them keep.
   */
  async function sendGroup(
    order: GroupOrder,
    queued = shift.current,
    /** Who gets it: the picked group, or those ticked on a realm order's who-list. */
    to: readonly Resident[] = group,
    /** A realm order's building: those far from it walk there first (`realmRequests`). */
    target?: Building,
    /** Those of a who-list set to After, who get it appended to their queue (`realmRequests`). */
    after?: ReadonlySet<string>,
  ) {
    if (!world) return
    const given = 'params' in order && order.params !== undefined
    const asked =
      !given &&
      opensForm(
        groupOrderStart(order) ?? { kind: order.kind },
        to.map((r) => r.scriptParams),
        (params) => sendGroup({ ...order, params } as GroupOrder, queued, to, target, after),
      )
    if (asked) return
    const size = world.map.size
    const inGroup = new Set(to.map((r) => r.id))
    // Free: explored land a resident can stand on, with no wall or gate and nobody else on it.
    const free = (x: number, y: number) => {
      const t = terrainAt?.(x, y)
      if (t === undefined || !isPassableTerrain(t)) return false
      if (world.buildings.some((b) => isWallOrGate(b) && covers(b, x, y, size))) return false
      return !world.residents.some((r) => r.x === x && r.y === y && !inGroup.has(r.id))
    }
    // With Shift held, each one's queue gets the order appended (`CONTEXT.md`: Queue); from a
    // who-list, only the queues of those set to After.
    const ctx = { tick: world.tick, size, free, seen: groupSeen }
    const { requests, skipped } =
      target || after
        ? realmRequests(order, to, {
            ...ctx,
            ...(target ? { target } : {}),
            ...(after ? { after } : {}),
          })
        : groupRequests(order, to, { ...ctx, queued })
    if (order.kind === 'build') setGroupBuildAt(undefined)
    await sendToGroup(
      requests.map((q) => q.order),
      skipped,
      to,
    )
  }
  /**
   * Sends the group's requests, one per resident, and says on the card how many went out and who
   * was skipped or turned down and why.
   */
  async function sendToGroup(
    requests: OrderRequest[],
    skipped: Skipped[],
    to: readonly Resident[] = group,
  ) {
    setGroupError(undefined)
    const answers = await Promise.all(requests.map((o) => sendOrder(o)))
    const turnedDown = requests.flatMap((o, i) => {
      const why = answers[i]
      const r = to.find((g) => g.id === o.residentId)
      return why && r ? [{ id: r.id, name: r.name, why }] : []
    })
    setGroupReport({
      sent: requests.length - turnedDown.length,
      of: to.length,
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
  async function build(building: BuildingKind, material?: WallMaterial) {
    if (!selected) return
    const order = {
      kind: 'task',
      task: 'build',
      residentId: selected.id,
      building,
      ...(material === 'stone' ? { material } : {}),
    }
    setOrderError(await giveOrder(order))
  }
  /**
   * Gives the picked resident the Work task at the workplace on their tile, making `makes` at a
   * smithy: they run the Player's Work (default) script (`CONTEXT.md`: Default script).
   */
  async function work(makes?: Good | typeof MEND) {
    if (!selected) return
    const workplaceId = buildingHere?.id
    const order = { kind: 'task', task: 'work', residentId: selected.id, workplaceId, makes }
    setOrderError(await giveOrder(order))
  }
  /**
   * Gives the picked resident the Tear down task for the building or site on their tile: they
   * run the Player's Tear down (default) script.
   */
  /**
   * Gives the picked resident the Repair task for a worn building (`CONTEXT.md`: Repairing): they
   * run the Player's Repair (default) script, walking there and fetching what it lacks.
   */
  async function repair(buildingId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'repair', residentId: selected.id, buildingId }
    setOrderError(await giveOrder(order))
  }
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
   * Gives the picked resident the Explore task: they run the Player's Explore (default) script
   * (`CONTEXT.md`: Explore); with Shift held it goes in their queue.
   */
  async function explore() {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'task', task: 'explore', residentId: selected.id }))
  }
  /**
   * Gives the picked resident the Gather task (`CONTEXT.md`: Gather), its form first so the
   * Player picks the good; with Shift held it goes in their queue.
   */
  async function gather() {
    if (!selected) return
    customising.current = true
    setOrderError(await giveOrder({ kind: 'task', task: 'gather', residentId: selected.id }))
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
   * Picks what the picked resident runs when an alarm reaches them: a script, `none` for nothing,
   * or with null the Alarm default (`CONTEXT.md`: Alarm script); a script's params are picked
   * first, as before a script starts. Never queued: it leaves what they do as it is.
   */
  async function setAlarmScript(scriptId: number | 'none' | null) {
    if (!selected) return
    const order = { kind: 'setAlarmScript', residentId: selected.id, scriptId }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Picks, or clears with a null `targetId`, the value of a param of the script the picked
   * resident runs (`CONTEXT.md`: Script parameter): the building, carriage or waypoint's id, or
   * the number typed for a number param or the word chosen for a choice param. It leaves the
   * script running.
   */
  async function setScriptParam(
    name: string,
    picked: { targetId: string | null } | { value: number | string },
  ) {
    if (!selected?.script) return
    const { scriptId } = selected.script
    const order = { kind: 'setScriptParam', residentId: selected.id, scriptId, name, ...picked }
    setOrderError(await giveOrder(order))
  }
  /**
   * Changes the realm's Work settings for a workplace (`CONTEXT.md`: Workplace settings): its
   * work script, null for the Work default, or values for its params, null clearing one.
   */
  async function setWorkSettings(
    buildingId: string,
    params?: StartParamValues,
    scriptId?: number | null,
  ) {
    const order = { kind: 'setWorkSettings', buildingId, params, scriptId }
    setOrderError(await sendOrder(order))
  }
  /**
   * Has the Player's Leader rally the crew where they stand (`CONTEXT.md`: Rallying the crew), or
   * stop. By hand only: never into a queue, whatever is held (ADR 0042).
   */
  async function rallyBy(leaderId: string, stopIt = false) {
    const kind = stopIt ? 'stop' : 'rally'
    setOrderError(await giveOrder({ kind, residentId: leaderId }, false))
  }
  /** The picked resident, the Leader, rallies the crew (`CONTEXT.md`: Rallying the crew). */
  async function rally() {
    if (selected) await rallyBy(selected.id)
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
  /** Orders the picked resident to relocate to another city of the realm (`CONTEXT.md`: Relocate). */
  async function relocate(cityId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'relocate', residentId: selected.id, cityId }))
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
   * Names the picked resident the realm's heir (`CONTEXT.md`: Heir), the same `nameHeir` order a
   * script's `nameHeir` requests.
   */
  async function nameHeir() {
    if (!selected) return
    const order = { kind: 'nameHeir', residentId: selected.id, heirId: selected.id }
    setOrderError(await giveOrder(order))
  }
  /** Clears the realm's heir (`CONTEXT.md`: Heir), as a script's `clearHeir` does. */
  async function clearHeir() {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'clearHeir', residentId: selected.id }))
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
  /** Orders the picked resident to Feed someone Down or a horse next to them. */
  async function feed(targetId: string, units: number) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'feed', residentId: selected.id, targetId, units }))
  }
  /**
   * Orders the picked resident to swap a good they carry into its slot, or with `null` to take
   * the slot's item off (`CONTEXT.md`: Equipment); with Shift held it goes in their queue.
   */
  async function equip(slot: string, good: string | null) {
    if (!selected) return
    const order = good
      ? { kind: 'equip', residentId: selected.id, good }
      : { kind: 'takeOff', residentId: selected.id, slot }
    setOrderError(await giveOrder(order))
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
   * Orders the picked resident to board a carriage on their tile or a boat beside them, or with
   * none to get off the one they are aboard, onto its tile or the shore beside the boat
   * (`CONTEXT.md`: Passenger, Beside a vessel); with Shift held, appends it to their queue.
   */
  async function boardCarriage(carriageId?: string, residentId = selected?.id, asCrew = false) {
    if (!residentId) return
    const order = !carriageId
      ? { kind: 'getOff', residentId }
      : isVesselId(carriageId)
        ? { kind: 'board', residentId, vesselId: carriageId, ...(asCrew ? { asCrew } : {}) }
        : { kind: 'board', residentId, carriageId }
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
  /**
   * Orders the picked resident to hitch the horse they choose to a carriage on their tile
   * (`CONTEXT.md`: Hitched horse); with Shift held, appends it to their queue.
   */
  async function hitch(carriageId: string, horseId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'hitch', residentId: selected.id, carriageId, horseId }))
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
  // A carriage, ram or catapult site on the tile, worked and supplied the same way (`CONTEXT.md`: Siege machine).
  const carriageSiteHere = onTile(
    world?.buildings.filter(
      (b) => b.kind === 'carriage' || b.kind === 'ram' || b.kind === 'catapult',
    ),
  )
  const armyCarriages = commandedCarriages(world?.diplomacy.alliance, world?.home.realmId)
  const isStrangers = (k: { id: string; realmId: string | null }) =>
    strangersCarriage(k, world?.home.realmId, armyCarriages)
  const ownCarriageHere = onTile(world?.carriages.filter((k) => !isStrangers(k)))
  // The boat of the realm the picked resident is aboard, else one beside them, to row
  // (`CONTEXT.md`: Rowing); boarding from beside it, the one at its oars becomes a passenger.
  const boatToRow = ((): { id: string; problem?: string; ship?: boolean } | undefined => {
    if (!selected || !world) return undefined
    // One of a ship's crew aboard it sails it, with enough crew (`CONTEXT.md`: Sailing).
    const crewed = world.vessels.find(
      (v) => v.kind === 'ship' && v.id === selected.aboard && v.crewIds.includes(selected.id),
    )
    if (crewed) {
      const short = crewShort(crewed)
      const problem = short > 0 ? `the ship needs ${short} more crew to sail` : undefined
      return { id: crewed.id, ship: true, ...(problem ? { problem } : {}) }
    }
    // On the haven a ship of theirs is docked at, they may take it on a haul route as its captain
    // (`CONTEXT.md`: Haul route by water), with enough crew aboard once they board too.
    const docked =
      selected.aboard === undefined
        ? world.vessels.find(
            (v) =>
              v.kind === 'ship' &&
              vesselOfResident(v, selected) &&
              besideVessel(v, selected, world.map.size, world.buildings),
          )
        : undefined
    if (docked) {
      const short = crewShort(docked) - 1
      const problem = short > 0 ? `the ship needs ${short} more crew aboard to sail` : undefined
      return { id: docked.id, ship: true, ...(problem ? { problem } : {}) }
    }
    // A ship is sailed, never rowed (`CONTEXT.md`: Sailing).
    const mine = world.vessels.filter((v) => v.kind !== 'ship' && vesselOfResident(v, selected))
    const aboard = mine.find((v) => v.id === selected.aboard)
    if (aboard) return { id: aboard.id }
    if (selected.aboard !== undefined) return undefined
    const beside = mine.find((v) => besideVessel(v, selected, world.map.size))
    if (!beside) return undefined
    const full =
      beside.rowerId !== undefined && (vesselRoom(beside) ?? PASSENGER_WEIGHT) < PASSENGER_WEIGHT
    return full ? { id: beside.id, problem: 'the boat is full' } : { id: beside.id }
  })()
  const stealableHere = onTile(world?.carriages.filter(isStrangers))
  // Another organization's boat, or nobody's, beside the picked resident of the realm's, to row
  // off (`CONTEXT.md`: Stealing a carriage or horse, its vessel part).
  const boatToSteal = ((): { id: string; problem: string | undefined } | undefined => {
    if (!selected || !world || selected.owner !== world.home.realmId) return undefined
    if (selected.aboard !== undefined) return undefined
    const size = world.map.size
    const v = world.vessels.find(
      (v) =>
        v.kind !== 'ship' && v.realmId !== world.home.realmId && besideVessel(v, selected, size),
    )
    if (!v) return undefined
    return { id: v.id, problem: rowOffProblem(world, selected, v, world.home.realmId, size) }
  })()
  // Another organization's horses for the picked resident (`CONTEXT.md`: Stealing a carriage or
  // horse): a free one to mount, and one to pull the realm's own carriage that has none of its own.
  const unhorsedHere = onTile(
    world?.carriages.filter((k) => k.realmId === world.home.realmId && !k.horseId),
  )
  const horseToHitch =
    world && selected && unhorsedHere
      ? horseToSteal(world, selected, unhorsedHere, world.home.realmId)
      : undefined
  const looseStrangers = onTile(
    world?.horses.filter(
      (h) => h.realmId !== world.home.realmId && !carriagePulledBy(world, h) && !riderOf(world, h),
    ),
  )
  // What the pick waiting for a tile would do under the pointer, or at the tile tapped on a touch
  // screen (`CONTEXT.md`: Picking a target).
  /**
   * The ground a way is found on as the Player knows it, and the tiles it can't step onto: a way
   * doesn't cross a wall, nor a gate unless it is the realm's own or an ally's, or open
   * (`CONTEXT.md`: Wall, Gate); climbing onto the realm's own walls is left out.
   */
  const wayGround = (w: NonNullable<typeof world>) => {
    const size = w.map.size
    const roads = roadTiles(w, size)
    const allies = new Set(w.diplomacy.alliance?.members.map((m) => m.realmId))
    allies.add(w.home.realmId)
    const walls = new Set(
      knownBuildings
        .filter((b) => isWallOrGate(b))
        .filter((b) => {
          const realmId = w.cities.find((c) => c.id === b.cityId)?.realmId
          return b.kind === 'wall' || (b.closed && !(realmId && allies.has(realmId)))
        })
        .map((b) => tileIndex(size, b.x, b.y)),
    )
    return {
      blocked: (x: number, y: number) => walls.has(tileIndex(size, x, y)),
      ground: (x: number, y: number): Terrain | undefined => {
        if (roads.has(tileIndex(size, x, y))) return Terrain.Road
        const t = terrainAt?.(x, y)
        return t === undefined || t === UNEXPLORED ? undefined : (t as Terrain)
      },
    }
  }
  const preview = (() => {
    if (!world || !pick || !pickAt) return undefined
    const size = world.map.size
    const seen: PreviewWorld = {
      ...wayGround(world),
      ...planWorld(world),
      cityNames: knownCities,
      nodeAt: (x, y) => nodeAt?.(x, y),
      buildProblem: (kind, x, y) =>
        // A kind picked before its tile is judged as the Build menu there would (realm control).
        realmOrder?.step === 'where'
          ? realmBuildProblem(world, x, y, kind, realmOrder.material)
          : buildHereProblem(kind, x, y, world, (nx, ny) => nodeAt?.(nx, ny), {
              size,
              at: (tx, ty) => terrainAt?.(tx, ty) ?? UNEXPLORED,
            }),
    }
    const what = previewPickOf(pick, {
      lineFrom: group.length > 1 ? groupLineFrom : lineFrom,
      plan,
    })
    // A drive or haul goes from those standing on a carriage of the realm.
    const carriageAt = (r: Resident) =>
      world.carriages.find(
        (k) =>
          k.x === r.x &&
          k.y === r.y &&
          (picking === 'driveOff' ? isStrangers(k) : k.realmId === world.home.realmId),
      )
    const going = what.kind === 'way' && what.goer === 'carriage'
    const goers = group
      .filter((r) => !going || carriageAt(r))
      .map((r) => ({
        from: r,
        ticks: (path: readonly (readonly [number, number])[], goer: 'foot' | 'carriage') => {
          const way = { target: pickAt, path: path.map(([x, y]) => [x, y] as [number, number]) }
          const carriage = carriageAt(r)
          const order =
            goer === 'carriage' && carriage
              ? { kind: 'drive' as const, carriageId: carriage.id, ...way, progress: 0 }
              : { kind: 'walkTo' as const, ...way, progress: 0 }
          return arrivesIn?.({ ...r, order })
        },
      }))
    return pickPreview(what, pickAt, seen, goers)
  })()
  // Each resident's way to a realm order's target, by where they stand and the target: found
  // once, not again each tick while they stand still.
  const whoWays = useRef(new Map<string, WhoWay>())
  // In realm control mode, the carriage or vessel of the realm on the picked tile, to give orders
  // about from its card (`CONTEXT.md`: Realm order).
  const tileVehicle =
    controlMode === 'realm' && selectedTile
      ? vehicleHere(selectedTile.x, selectedTile.y)
      : undefined
  // The realm order's who-list (`CONTEXT.md`: Who-list): its order and rows, while it is open.
  const who = (() => {
    if (!world) return undefined
    let order: WhoOrder
    let at: WhoAt
    let given: string | undefined
    if (realmOrder?.step === 'about') {
      order = realmOrder.order
      at = { x: realmOrder.target.x, y: realmOrder.target.y }
    } else if (realmOrder?.step === 'who') {
      const { building, material } = realmOrder
      at = realmOrder.at
      order = { kind: 'build', building, at, ...(material ? { material } : {}) }
    } else if (realmOrder?.step === 'lineWho') {
      order = realmOrder.line
      at = order.from
    } else if (realmOrder?.step === 'place') {
      order = realmOrder.order
      at = realmOrder.at
      given = realmOrder.title
    } else if (realmOrder?.step === 'vehicle') {
      order = realmOrder.order
      at = realmOrder.at
    } else return undefined
    // Explore and a script go no set way: as the crow flies from where the list measures.
    const crow = order.kind === 'explore' || order.kind === 'gather' || order.kind === 'runScript'
    const size = world.map.size
    const { ground, blocked } = wayGround(world)
    const ways = whoWays.current
    if (ways.size > 2000) ways.clear()
    // The way goes to the target, or to a line's tile nearest the resident.
    const targetOf = (r: { x: number; y: number }) => wayTarget(order, at, r, size)
    const wayOf = (r: Resident): WhoWay => {
      // Explore and a script go no set way: as the crow flies from where the list measures.
      if (crow) return undefined
      const at = targetOf(r)
      const key = `${r.id}:${r.x},${r.y}>${at.x},${at.y}`
      if (ways.has(key)) return ways.get(key)
      const found = searchPath(size, r, at, ground, 'foot', blocked)
      const way: WhoWay =
        found === 'none'
          ? 'none'
          : found === 'gaveUp'
            ? undefined
            : {
                tiles: found.length,
                ticks: arrivesIn?.({
                  ...r,
                  order: {
                    kind: 'walkTo',
                    target: at,
                    path: found.map(([x, y]) => [x, y] as [number, number]),
                    progress: 0,
                  },
                }),
              }
      ways.set(key, way)
      return way
    }
    // An order about a carriage or vessel takes that one only (`onlyThis`).
    const seen = realmOrder.step === 'vehicle' ? onlyThis(realmOrder.vehicle, groupSeen) : groupSeen
    const ctx = { tick: world.tick, size, seen }
    const rows = whoRows(order, own, targetOf, (r) => wayOf(r as Resident), ctx)
    const title = given ?? whoTitle(order, size)
    const where = whoWhere(order, at)
    // Another order or place opens a list ticked afresh.
    return { order, rows, key: `${title}:${where}`, title, where }
  })()

  async function logout() {
    await api.logout().catch(() => {})
    // The explored terrain this browser kept is the Player's alone (ADR 0034).
    await clearTerrainCache()
    onLoggedOut()
  }

  const leader = world?.residents.find(
    (r): r is Resident => r.id === world.home.leaderId && faresKnown(r),
  )
  // The realm's heir (`CONTEXT.md`: Heir): absent before the world comes, null with none.
  const heirId = world?.home.heirId ?? null
  const heirName = world && heirId ? world.residents.find((r) => r.id === heirId)?.name : undefined
  const heirShown = world && leader ? (heirName ?? null) : undefined
  const pickHeir = () => setOpenDrawer('residents')
  const drawer = (id: DrawerId, panel: ReactNode, full = false) => (
    <Drawer id={id} open={openDrawer} onClose={closeDrawer} full={full}>
      {panel}
    </Drawer>
  )

  const residentsPanel = world && {
    groups: groupResidents(own, {
      cities: world.cities,
      realmId: world.home.realmId,
      homeCityId: world.home.cityId,
      leaderId: world.home.leaderId,
      diplomacy: world.diplomacy,
    }),
    leaderId: world.home.leaderId,
    heirId,
    scripts,
    buildings: world.buildings,
    inSight: world.residents,
    horses: world.horses,
    cities: knownCities,
    arrivesIn: arrivesIn || undefined,
    tick: world.tick,
    phone,
    selectedId: selected?.id,
    onSelect: (id: string) => {
      setSelectedIds([id])
      setSelectedTile(undefined)
      // The card has no room beside the full list, so the short list comes back with it.
      setResidentsFull(false)
      const r = own.find((x) => x.id === id)
      if (r) showOnMap(Math.floor(r.x), Math.floor(r.y))
    },
  }

  // A Player without a realm names it before the world shows (`CONTEXT.md`: Realm name).
  if (founding && !world && status !== 'updated')
    return <Founding leaderName={founding.leaderName} onFound={found} />

  const game = (
    <div className={phone ? 'game phone' : 'game'}>
      <section className="game-map">
        {world ? (
          <MapView
            world={world}
            keepTerrainFor={{ seed: world.map.seed, player: account.name }}
            selectedIds={selectedIds}
            onSelect={(id) => select([id])}
            // In realm control mode a drag (or the Select toggle) picks no group.
            onSelectMany={controlMode === 'unit' ? select : undefined}
            controlMode={controlMode}
            onSelectTile={(x, y) => {
              // A click on the ground drops a group; one resident stays picked to send there.
              if (group.length > 1) setSelectedIds([])
              const size = world.map.size
              setSelectedTile({ x: ((x % size) + size) % size, y: ((y % size) + size) % size })
              setPicking(false)
              setArmyPick(undefined)
              setParamPick(undefined)
              setWorkPick(undefined)
              setPlan(undefined)
              setOrderError(undefined)
              // The realm order's Build menu or who-list gives way to the tile's card.
              setRealmOrder(undefined)
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
              (group.length > 1 && groupPicking !== false) ||
              realmPicking
            }
            onPickTile={pickTile}
            preview={preview}
            // A tile tapped stays previewed until another is tapped.
            onPointerTile={(tile) => setPickAt((at) => (at?.tapped ? at : tile))}
            onNodesLoaded={onNodesLoaded}
            onTerrainLoaded={onTerrainLoaded}
            newRealm={isNewRealm(world.events, world.tick)}
            focus={focus}
            land={landShown}
          />
        ) : (
          <p className="game-waiting">Waiting for the server…</p>
        )}
      </section>
      <TopBar
        realm={world ? (world.home.realmName ?? leader?.name) : undefined}
        account={account.name}
        cityName={homeCity?.name}
        tick={world?.tick}
        status={status}
        goods={goods}
        leader={leader?.name}
        heir={heirShown}
        onPickHeir={pickHeir}
        onLogout={logout}
        onWiki={() => reportFirstDay('openWiki')}
        control={world ? { mode: controlMode, onSwitch: switchControlMode } : undefined}
        zeal={world?.zeal}
        zealDraining={leader?.order?.kind === 'rally'}
      />
      {world && controlMode === 'realm' && (
        <RealmBar
          open={realmBarOpen}
          onOpen={(order) => {
            setSelectedTile(undefined)
            if (order === realmBarOpen) return setRealmOrder(undefined)
            if (order === 'explore') return realmScriptOrder({ kind: 'explore' })
            if (order === 'gather') return realmScriptOrder({ kind: 'gather' })
            setRealmOrder(
              order === 'build'
                ? { step: 'menu' }
                : order === 'road' || order === 'wall'
                  ? { step: 'line', building: order }
                  : order === 'runScript'
                    ? { step: 'script' }
                    : { step: order },
            )
          }}
        />
      )}
      {phone ? (
        <PhoneMenu
          open={openDrawer}
          onToggle={(id) => setOpenDrawer((open) => toggleDrawer(open, id))}
          marked={marks.rail}
          goods={goods}
          leader={leader?.name}
          heir={heirShown}
          onPickHeir={pickHeir}
          account={account.name}
          onLogout={logout}
          onWiki={() => reportFirstDay('openWiki')}
        />
      ) : (
        <ToolRail
          open={openDrawer}
          onToggle={(id) => setOpenDrawer((open) => toggleDrawer(open, id))}
          marked={marks.rail}
        />
      )}
      {residentsPanel &&
        drawer(
          'residents',
          fullList ? (
            <ResidentsFullList
              {...residentsPanel}
              onPick={(ids) => {
                select(ids)
                // The group card has no room beside the full list, so the short list comes back.
                setResidentsFull(false)
                const first = own.find((r) => r.id === ids[0])
                if (first) showOnMap(Math.floor(first.x), Math.floor(first.y))
              }}
              onClose={() => setResidentsFull(false)}
            />
          ) : (
            <ResidentsList {...residentsPanel} onOpenFull={() => setResidentsFull(true)} />
          ),
          fullList,
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
              world.tick,
            )}
            tick={world.tick}
            phone={phone}
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
          'waypoints',
          <WaypointsPanel
            waypoints={world.waypoints}
            onCentre={(w) => showOnMap(w.x, w.y)}
            onRename={(w, name) => sendOrder({ kind: 'renameWaypoint', waypointId: w.id, name })}
            onRemove={(w) => sendOrder({ kind: 'removeWaypoint', waypointId: w.id })}
            // A waypoint is a place like a tile: picked, it is its tile (`CONTEXT.md`: Waypoint).
            onPick={pick ? (w) => pickTile(w.x, w.y) : undefined}
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
          'diplomacy',
          <DiplomacyTabs
            tab={drawers.tab}
            onTab={(tab) => setDrawers(openDiplomacy(tab))}
            marked={marks.tabs}
            panels={{
              contracts: (
                <ContractsPanel
                  contracts={world.diplomacy.contracts}
                  realmId={world.home.realmId}
                  own={own}
                  inSight={world.residents}
                  horses={world.horses}
                  buildings={world.buildings}
                  cities={world.cities}
                  realms={realms}
                  scripts={scripts}
                  tick={world.tick}
                  sendOrder={sendOrder}
                />
              ),
              demands: (
                <DemandsPanel
                  demands={world.diplomacy.demands}
                  realmId={world.home.realmId}
                  knownRealms={world.diplomacy.knownRealms}
                  knownNpcOrgs={world.diplomacy.knownNpcOrgs}
                  cities={world.cities}
                  buildings={world.buildings}
                  carriedWays={world.diplomacy.carriedWays ?? []}
                  noCaravans={world.diplomacy.noCaravans === true}
                  lastSeen={world.lastSeen.cities}
                  tick={world.tick}
                  sendOrder={sendOrder}
                />
              ),
              directOffers: (
                <DirectOffersPanel
                  offers={world.diplomacy.directOffers}
                  knownRealms={world.diplomacy.directOfferRealms}
                  carriedWays={world.diplomacy.carriedWays ?? []}
                  buildings={world.buildings}
                  cities={world.cities}
                  residents={world.residents}
                  carriages={world.carriages}
                  horses={world.horses}
                  realmId={world.home.realmId}
                  tick={world.tick}
                  mapSize={world.map.size}
                  noCaravans={world.diplomacy.noCaravans === true}
                  arrivesIn={arrivesIn || undefined}
                  onShowPlace={showOnMap}
                  giveOrder={giveOrder}
                  sendOrder={sendOrder}
                />
              ),
              alliance: (
                <AlliancePanel
                  diplomacy={world.diplomacy}
                  residents={world.residents}
                  carriages={world.carriages}
                  realmId={world.home.realmId}
                  sendOrder={sendOrder}
                />
              ),
              standing: (
                <StandingPanel
                  standings={world.diplomacy.standings}
                  joinRequests={world.diplomacy.joinRequests}
                  directives={world.diplomacy.directives}
                  sendOrder={sendOrder}
                />
              ),
            }}
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
            traders={world.traders}
            traderVisits={world.traderVisits}
            realmId={world.home.realmId}
            realms={realms}
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
            onSwap={async (swap) => setOrderError(await giveOrder({ kind: 'swap', ...swap }))}
            onBuyHorse={async (buy) => setOrderError(await giveOrder({ kind: 'buyHorse', ...buy }))}
            onSellHorse={async (sale) =>
              setOrderError(await giveOrder({ kind: 'sellHorse', ...sale }))
            }
            onTransfer={async (transfer) =>
              setOrderError(await giveOrder({ kind: 'transfer', ...transfer }))
            }
            onSend={async ({ residentId, carriageId, x, y }) =>
              setOrderError(
                await giveOrder(
                  carriageId
                    ? { kind: 'drive', residentId, carriageId, x, y }
                    : { kind: 'walkTo', residentId, x, y },
                ),
              )
            }
            arrivesIn={arrivesIn || undefined}
            directives={world.diplomacy.directives}
            debt={world.diplomacy.debt ?? 0}
            noCaravans={world.diplomacy.noCaravans === true}
            allies={new Set(world.diplomacy.alliance?.members.map((m) => m.realmId))}
            openId={openCityId}
            onOpen={(id) => {
              setOpenCityId(id)
              // Opening a row shows the city on the map, outlined (`CONTEXT.md`: Cities drawer).
              const at = id && cityPlace(id, knownCities, knownBuildings)
              if (at) setToShow({ ...at, zoom: cityScale })
            }}
            scrollTo={tradeAt}
            standings={world.diplomacy.standings}
            events={world.events}
            onBuyOff={async (residentId, directiveId, carriageId) =>
              setOrderError(
                await sendOrder({ kind: 'buyOff', residentId, directiveId, carriageId }),
              )
            }
            onPayDebt={async (residentId, coins, carriageId) =>
              setOrderError(await sendOrder({ kind: 'payDebt', residentId, coins, carriageId }))
            }
            onPostOffer={async (offer) =>
              setOrderError(await sendOrder({ kind: 'postOffer', ...offer }))
            }
            onTakeDownOffer={async (offerId) =>
              setOrderError(await sendOrder({ kind: 'takeDownOffer', offerId }))
            }
            onAcceptOffer={async (accept) =>
              setOrderError(await giveOrder({ kind: 'acceptOffer', ...accept }))
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
      <DrawerEdge open={fullList ? undefined : openDrawer} />
      {/* Every notice in one lane under the top bar (`CONTEXT.md`: Notices). */}
      <NoticeLane phone={phone}>
        {/* First in the lane under the top bar, so the notices stack below it. */}
        {showsCreativeBar(account) && <CreativeBar tick={world?.tick} />}
        {laneNotices({
          pick: pick !== undefined,
          horseOffer: world?.horseOffer,
          demand: demandNotice !== undefined,
          incoming: incomingNotice !== undefined,
          firstDay: world !== null && firstDayShown(world.firstDay),
          traderVisit: world?.traderVisits.some((v) => !dismissedVisits.has(visitKey(v))),
          groupReport: groupReport !== undefined,
        }).map((kind) =>
          kind === 'pick' && pick ? (
            <PickBanner
              key={kind}
              prompt={pickPrompt(pick, touch)}
              hint={pickHint(pick)}
              material={
                picksWallLine(pick) ? { value: wallMaterial, onChange: setWallMaterial } : undefined
              }
              under={pick.kind === 'plan' && pick.error ? undefined : preview?.label}
              onConfirm={pickAt?.tapped ? () => pickTile(pickAt.x, pickAt.y) : undefined}
              onWaypoints={
                world && world.waypoints.length > 0 && openDrawer !== 'waypoints'
                  ? () => setOpenDrawer('waypoints')
                  : undefined
              }
              onCancel={cancelPick}
            />
          ) : kind === 'horseOffer' ? (
            <HorseOfferNotice
              key={kind}
              horses={HORSE_GRANT_HORSES}
              onClaim={() => sendOrder({ kind: 'claimHorses' })}
            />
          ) : kind === 'demand' && demandNotice ? (
            <IncomingNotice
              key={kind}
              line={demandNotice}
              onOpen={() => setDrawers(openDiplomacy('demands'))}
              onDismiss={putDemandsAway}
            />
          ) : kind === 'incoming' && incomingNotice ? (
            <IncomingNotice
              key={kind}
              line={incomingNotice}
              onOpen={() => setDrawers(openDiplomacy('directOffers'))}
              onDismiss={putIncomingAway}
            />
          ) : kind === 'firstDay' && world ? (
            <FirstDayCard
              key={kind}
              card={world.firstDay}
              onWiki={() => reportFirstDay('openWiki')}
              onDismiss={dismissFirstDay}
            />
          ) : kind === 'traderVisit' && world ? (
            world.traderVisits
              .filter((v) => !dismissedVisits.has(visitKey(v)))
              .map((v) => (
                <TraderVisitNotice
                  key={visitKey(v)}
                  visit={v}
                  tick={world.tick}
                  onShow={() => showOnMap(v.x, v.y)}
                  onTrade={() => {
                    setOpenCityId(v.cityId)
                    setTradeAt({ buildingId: v.traderId })
                    setOpenDrawer('cities')
                  }}
                  onDismiss={() => setDismissedVisits((seen) => new Set([...seen, visitKey(v)]))}
                />
              ))
          ) : kind === 'groupReport' && groupReport ? (
            <GroupReportNotice
              key={kind}
              report={groupReport}
              onDismiss={() => setGroupReport(undefined)}
            />
          ) : null,
        )}
      </NoticeLane>
      {world && tileMenu && (
        <TileMenu
          at={tileMenu.at}
          tile={tileMenu}
          held={world.waypoints}
          size={world.map.size}
          onAdd={(name) => sendOrder({ kind: 'addWaypoint', x: tileMenu.x, y: tileMenu.y, name })}
          onClose={closeTileMenu}
        />
      )}
      {world && selectedTile && (
        <CardSheet phone={phone} pinnedPeek={workPick !== undefined} hidden={hideCard}>
          <TileCard
            card={describeTile(
              {
                ...selectedTile,
                buildings: world.buildings,
                carriages: world.carriages,
                vessels: world.vessels,
                machines: world.machines,
                horses: world.horses,
                piles: world.piles,
                node: nodeAt?.(selectedTile.x, selectedTile.y),
                nodeAt,
                terrain: terrainAt?.(selectedTile.x, selectedTile.y),
                region: regionAt(land, world.map.size, selectedTile.x, selectedTile.y),
                patch: world.patches.find((p) => p.x === selectedTile.x && p.y === selectedTile.y),
                strangers: world.residents.filter((r) => !own.some((o) => o.id === r.id)),
                residents: world.residents,
                // A building remembered out of sight is named after its city as last seen.
                cities: [...world.cities, ...world.lastSeen.cities],
                realms,
                lastSeen: { buildings: world.lastSeen.buildings, tick: world.tick },
                tick: world.tick,
                viewer: {
                  realmId: world.home.realmId,
                  allies: new Set(world.diplomacy.alliance?.members.map((m) => m.realmId)),
                },
                rally: { leaderId: world.home.leaderId, zeal: world.zeal },
                workers: (b) => workersHere(world.residents, b),
                veins: world.veins,
                drifters: world.drifters,
                // A haul route's arrival only for the Player's own driver.
                arrivesIn: (r) => {
                  const mine = own.find((o) => o.id === r.id)
                  return mine && arrivesIn ? arrivesIn(mine) : undefined
                },
                armies: world.armies,
                caravans: world.caravans,
                traders: world.traders,
                mapSize: world.map.size,
                commandedCarriages: armyCarriages,
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
            building={tileBuilding}
            workSettings={
              tileBuilding &&
              takesWorkSettings(tileBuilding) && (
                <WorkSettings
                  scripts={scripts}
                  settings={world.workSettings[tileBuilding.id]}
                  label={(id) => paramValueLabel(paramWorld(world), id)}
                  waypoints={world.waypoints}
                  picking={
                    workPick?.buildingId === tileBuilding.id ? workPick.param.name : undefined
                  }
                  onScript={(scriptId) =>
                    void setWorkSettings(tileBuilding.id, undefined, scriptId)
                  }
                  onPick={(param) => {
                    setPicking(false)
                    setParamPick(undefined)
                    setWorkPick((now) =>
                      now?.buildingId === tileBuilding.id && now.param.name === param.name
                        ? undefined
                        : { buildingId: tileBuilding.id, param },
                    )
                  }}
                  onNumber={(name, value) =>
                    void setWorkSettings(tileBuilding.id, { [name]: value })
                  }
                  onChoose={(param, value) =>
                    void setWorkSettings(tileBuilding.id, { [param.name]: value })
                  }
                  onClear={(name) => void setWorkSettings(tileBuilding.id, { [name]: null })}
                />
              )
            }
            creative={
              // Admins on a creative server act on any realm's building, carriage and Residents
              // by hand, and add Residents and horses on the tile.
              showsCreativeBar(account) &&
              (() => {
                const { x, y } = selectedTile
                const carriage = world.carriages.find((k) => k.x === x && k.y === y)
                const name = tileBuilding ? BUILDING_NAMES[tileBuilding.kind].toLowerCase() : ''
                const offer = creativeOffer(tileBuilding, carriage, name)
                const cities = creativeCities(knownCities, world.home.realmId)
                const tileCity = knownCities.find((c) =>
                  inCityArea({ buildings: knownBuildings }, c, x, y, world.map.size),
                )
                const here = world.residents.filter(
                  (r) => Math.floor(r.x) === x && Math.floor(r.y) === y,
                )
                return (
                  <>
                    {offersAnything(offer) && (
                      <CreativeSection key={`${tileBuilding?.id}/${carriage?.id}`} offer={offer} />
                    )}
                    <CreativeAddSection
                      key={`${x},${y}`}
                      x={x}
                      y={y}
                      knownCities={cities}
                      tileCityId={tileCity?.id}
                      homeCityId={world.home.cityId ?? undefined}
                      homeRealmId={world.home.realmId ?? undefined}
                    >
                      {here.map((r) => (
                        <CreativeResidentActions key={r.id} resident={r} tick={world.tick} named />
                      ))}
                    </CreativeAddSection>
                  </>
                )
              })()
            }
            realmOrders={
              // In realm control mode a building in sight starts the orders about it.
              controlMode === 'realm' &&
              tileBuilding &&
              world.buildings.includes(tileBuilding) && (
                <BuildingOrders
                  key={tileBuilding.id}
                  building={tileBuilding}
                  name={BUILDING_NAMES[tileBuilding.kind].toLowerCase()}
                  rows={buildingOrderRows(tileBuilding, {
                    // A site, or an outpost storage, goes by its own realm.
                    ours:
                      (tileBuilding.realmId ??
                        world.cities.find((c) => c.id === tileBuilding.cityId)?.realmId) ===
                      world.home.realmId,
                    horses: realmHorsesIn(tileBuilding).length,
                  })}
                  horses={realmHorsesIn(tileBuilding)}
                  tick={world.tick}
                  onOrder={(order) => startAbout(order, tileBuilding)}
                />
              )
            }
            nodeKind={nodeAt?.(selectedTile.x, selectedTile.y)?.kind}
            buildingNode={buildingNodeKind(
              world.buildings.find(
                (b) => !SHARES_A_TILE.includes(b.kind) && covers(b, selectedTile.x, selectedTile.y),
              ),
              nodeAt,
            )}
            actor={selected}
            onUnhitch={(carriageId, residentId) => void unhitch(carriageId, residentId)}
            onBoard={(vesselId, residentId) => void boardCarriage(vesselId, residentId)}
            onDriveOff={(residentId) => {
              select([residentId])
              setPicking('driveOff')
            }}
            onHitchOff={(residentId) => {
              select([residentId])
              setPicking('hitchOff')
            }}
            onCrew={(machineId, residentId) =>
              void giveOrder({ kind: 'crew', residentId, machineId }, false).then(setOrderError)
            }
            onPush={(machineId, residentId) => {
              select([residentId])
              setPushing(machineId)
              setPicking('push')
            }}
            onThrow={(machineId, residentId) => {
              select([residentId])
              setPushing(machineId)
              setPicking('throw')
            }}
            onRam={(machineId, residentId, targetId) =>
              void giveOrder({ kind: 'ram', residentId, machineId, targetId }, false).then(
                setOrderError,
              )
            }
            onTearDownMachine={(machineId, residentId) =>
              void giveOrder({ kind: 'tearDown', residentId, buildingId: machineId }, false).then(
                setOrderError,
              )
            }
            onStealHorse={(horseId, residentId) =>
              void giveOrder({ kind: 'mount', residentId, horseId }, false).then(setOrderError)
            }
            mapSize={world.map.size}
            onFeed={(targetId, units) => void feed(targetId, units)}
            onRepair={(buildingId) => void repair(buildingId)}
            onRally={(leaderId, stopIt) => void rallyBy(leaderId, stopIt)}
            onPickUp={async (residentId, spot, goods) =>
              setOrderError(await giveOrder({ kind: 'pickUp', residentId, spot, goods }))
            }
            orderError={orderError}
            onClose={() => {
              setSelectedTile(undefined)
              setWorkPick(undefined)
            }}
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
            onOpenCity={(id, buildingId) => {
              setOpenCityId(id)
              setTradeAt(buildingId ? { buildingId } : undefined)
              setOpenDrawer('cities')
            }}
            // The same `renameCity` order a script's `renameCity` requests, asked by the Leader.
            onRenameCity={async (cityId, name) => {
              const order = { kind: 'renameCity', residentId: world.home.leaderId, cityId, name }
              setOrderError(await giveOrder(order))
            }}
            // The same `renameHorse` order a script's `renameHorse` requests, asked by the Leader.
            onRenameHorse={async (horseId, name) => {
              const order = {
                kind: 'renameHorse',
                residentId: world.home.leaderId,
                horseId,
                name,
              }
              setOrderError(await giveOrder(order))
            }}
            onSelectResident={(id) => select([id])}
            onOpenHorse={(id) => {
              setPickedHorseId(id)
              setOpenDrawer('horses')
            }}
            tile={selectedTile}
            waypoints={world.waypoints}
            onAddWaypoint={(name) => sendOrder({ kind: 'addWaypoint', ...selectedTile, name })}
            realm={
              controlMode === 'realm' && (
                <>
                  {tileVehicle && (
                    <VehicleOrders
                      key={
                        tileVehicle.what === 'carriage'
                          ? tileVehicle.carriage.id
                          : tileVehicle.vessel.id
                      }
                      vehicle={tileVehicle}
                      rows={vehicleOrderRows(tileVehicle).map((r) =>
                        // Nowhere to stand beside a boat: nobody can take its orders.
                        r.reason || vehicleStand(tileVehicle) ? r : { ...r, reason: NO_STAND },
                      )}
                      picking={realmOrder?.step === 'vehiclePick' ? realmOrder.pick : undefined}
                      onPick={(pick, haul) => {
                        setSelectedTile(undefined)
                        setRealmOrder({
                          step: 'vehiclePick',
                          pick,
                          vehicle: tileVehicle,
                          ...(haul ? { haul } : {}),
                        })
                      }}
                      onOrder={(order) => startVehicle(order, tileVehicle)}
                    />
                  )}
                  <RealmTileOrders
                    // Another tile starts with Fetch folded.
                    key={`${selectedTile.x},${selectedTile.y}`}
                    building={tileBuilding !== undefined}
                    place={storePlaceAt(world, world.home.realmId, selectedTile.x, selectedTile.y)}
                    onWalk={() => {
                      setSelectedTile(undefined)
                      realmWalkTo(selectedTile.x, selectedTile.y)
                    }}
                    onBuild={() => {
                      setSelectedTile(undefined)
                      setRealmOrder({ step: 'menu', at: { x: selectedTile.x, y: selectedTile.y } })
                    }}
                    onStore={({ id, name, x, y }) => {
                      setSelectedTile(undefined)
                      realmWho({ kind: 'store', to: { id, name } }, { x, y })
                    }}
                    onFetch={({ id, name, x, y }, good) => {
                      setSelectedTile(undefined)
                      realmWho({ kind: 'fetch', good, from: { id, name } }, { x, y })
                    }}
                  />
                </>
              )
            }
          />
        </CardSheet>
      )}
      {world && selected && !selectedTile && (
        <CardSheet
          phone={phone}
          pinnedPeek={pick !== undefined && pick.kind !== 'army'}
          hidden={hideCard}
        >
          <InsertPointContext.Provider value={insertFor(selected.id)}>
            <ResidentCard
              key={selected.id}
              resident={selected}
              creative={
                showsCreativeBar(account) && (
                  <CreativeResidentActions resident={selected} tick={world.tick} />
                )
              }
              arrivesIn={arrivesIn || undefined}
              leaderId={world.home.leaderId}
              cities={knownCities}
              tick={world.tick}
              picking={picking}
              onWalkTo={() => setPicking((p) => (p === 'walk' ? false : 'walk'))}
              carriage={
                onTile(world.carriages.filter(loadKnown).filter((k) => !isStrangers(k))) ??
                onTile(world.carriages.filter(loadKnown))
              }
              boat={world.vessels.find(
                (v) =>
                  vesselOfResident(v, selected) &&
                  selected.aboard !== v.id &&
                  besideVessel(v, selected, world.map.size, world.buildings),
              )}
              carriageTheirs={!ownCarriageHere && !!stealableHere}
              onDriveTo={() => setPicking((p) => (p === 'drive' ? false : 'drive'))}
              {...(stealableHere && {
                driveOff: {
                  problem: driveOffProblem(
                    world,
                    selected,
                    stealableHere,
                    world.home.realmId,
                    world.map.size,
                  ),
                },
                onDriveOff: () => setPicking((p) => (p === 'driveOff' ? false : 'driveOff')),
              })}
              {...(unhorsedHere &&
                horseToHitch && {
                  hitchOff: {
                    problem: hitchOffProblem(
                      world,
                      selected,
                      { ...unhorsedHere, realmId: world.home.realmId },
                      horseToHitch.id,
                    ),
                  },
                  onHitchOff: () => setPicking((p) => (p === 'hitchOff' ? false : 'hitchOff')),
                })}
              {...(looseStrangers && {
                stealHorse: {
                  problem: mountOffProblem(world, selected, looseStrangers, world.home.realmId),
                },
                onStealHorse: () =>
                  void giveOrder(
                    { kind: 'mount', residentId: selected.id, horseId: looseStrangers.id },
                    false,
                  ).then(setOrderError),
              })}
              onRoadTo={() =>
                setPicking((p) => (p === 'roadFrom' || p === 'roadTo' ? false : 'roadFrom'))
              }
              onWallTo={() =>
                setPicking((p) => (p === 'wallFrom' || p === 'wallTo' ? false : 'wallFrom'))
              }
              onHaulTo={(setup) => {
                setHaulSetup(setup)
                setPicking((p) => (p === 'haul' ? false : 'haul'))
              }}
              onStop={stop}
              onRally={rally}
              zeal={world.zeal}
              horseToRide={onTile(
                world.horses.filter(
                  (h) =>
                    horseOfResident(h, selected) &&
                    !carriagePulledBy(world, h) &&
                    !riderOf(world, h) &&
                    !isDown(h),
                ),
              )}
              onRide={ride}
              carriageToBoard={onTile(
                world.carriages.filter((k) => carriageOfResident(k, selected)),
              )}
              boatToBoard={world.vessels.find(
                (v) =>
                  vesselOfResident(v, selected) &&
                  besideVessel(v, selected, world.map.size, world.buildings) &&
                  // A ship with no room left still takes crew (`CONTEXT.md`: Crew).
                  (v.kind === 'ship' ||
                    (vesselRoom(v) ?? PASSENGER_WEIGHT) >= PASSENGER_WEIGHT - 1e-9),
              )}
              onBoard={(id, asCrew) => void boardCarriage(id, undefined, asCrew)}
              {...(boatToRow ? { boatToRow } : {})}
              onRowTo={() => setPicking((p) => (p === 'row' ? false : 'row'))}
              {...(boatToSteal && {
                rowOff: { problem: boatToSteal.problem },
                onRowOff: () => setPicking((p) => (p === 'rowOff' ? false : 'rowOff')),
              })}
              carriageToUnhitch={onTile(
                world.carriages.filter((k) => carriageOfResident(k, selected) && k.horseId),
              )}
              onUnhitch={unhitch}
              toHitch={hitchChoice(world, selected)}
              onHitch={hitch}
              scripts={scripts}
              buildings={world.buildings}
              lastSeen={world.lastSeen.buildings}
              waypoints={world.waypoints}
              onRunScript={runScript}
              onSetDefenceScript={setDefenceScript}
              onSetAlarmScript={setAlarmScript}
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
              onLoad={async (vesselId, goods, unload) =>
                setOrderError(
                  await giveOrder({
                    kind: 'load',
                    residentId: selected.id,
                    vesselId,
                    goods,
                    unload,
                  }),
                )
              }
              onDrop={(spot, goods) => carry('drop', spot, goods)}
              onBuild={build}
              buildProblem={buildProblemAt(world, selected.x, selected.y)}
              workers={workersHere(world.residents, buildingHere)}
              holders={heldBy(world.residents, buildingHere)}
              realmId={world.home.realmId}
              onWork={work}
              onFeedStable={feedStable}
              onTrain={train}
              onExplore={explore}
              onGather={gather}
              onTeach={teach}
              onTearDown={tearDown}
              horses={world.horses}
              onBreed={breed}
              residents={own}
              onPair={pair}
              others={world.residents.filter((r) => !own.some((o) => o.id === r.id))}
              mapSize={world.map.size}
              onAttack={attack}
              onFeed={(targetId, units) => void feed(targetId, units)}
              onEquip={(slot, good) => void equip(slot, good)}
              walls={world.buildings.filter(
                (b) =>
                  isWallOrGate(b) &&
                  world.cities.find((c) => c.id === b.cityId)?.realmId !== world.home.realmId,
              )}
              onClimb={climb}
              makeLeader={(() => {
                if (selected.owner !== world.home.realmId || selected.id === world.home.leaderId) {
                  return undefined
                }
                const seen = {
                  tick: world.tick,
                  diplomacy: world.diplomacy,
                  cities: world.cities,
                  buildings: world.buildings,
                  mapSize: world.map.size,
                }
                const realm = { id: world.home.realmId, leaderId: world.home.leaderId }
                return {
                  problem: makeLeaderProblem(seen, realm, leader, selected),
                  heir: {
                    problem: nameHeirProblem(seen, realm, selected),
                    named: selected.id === heirId,
                  },
                }
              })()}
              leaderName={leader?.name}
              onMakeLeader={makeLeader}
              heirName={heirId !== selected.id ? heirName : undefined}
              onNameHeir={() => void nameHeir()}
              onClearHeir={() => void clearHeir()}
              relocate={relocateFor(selected)}
              onRelocate={relocate}
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
                    // Working by a workplace's settings, what they don't override reads its values.
                    workplace={(() => {
                      const from = world.residents.find((r) => r.id === selected.id)?.script
                        ?.settingsFrom
                      return from === undefined
                        ? undefined
                        : (world.workSettings[from]?.params ?? {})
                    })()}
                    label={(id) => paramValueLabel(paramWorld(world), id)}
                    target={targetParam(
                      scripts.find((s) => s.id === selected.script!.scriptId) ?? {},
                    )}
                    onTile={targetOnTile(
                      world,
                      scripts.find((s) => s.id === selected.script!.scriptId),
                      selected,
                    )}
                    waypoints={world.waypoints}
                    picking={paramPick?.name}
                    onPick={(p) => {
                      setPicking(false)
                      setParamPick((now) => (now?.name === p.name ? undefined : p))
                    }}
                    onNumber={(name, value) => void setScriptParam(name, { value })}
                    onChoose={(p, value) =>
                      void setScriptParam(
                        p.name,
                        p.type === 'choice' ? { value } : { targetId: value },
                      )
                    }
                    onClear={(name) => void setScriptParam(name, { targetId: null })}
                  />
                )
              }
              scriptMemory={selected.script && scriptDebug(selected.id, selected.script.scriptId)}
              scriptLog={
                <ScriptLog
                  id={selected.id}
                  lines={scriptLogs.get(selected.id)}
                  watch={watchScript}
                />
              }
              onStore={async () =>
                setOrderError(
                  await giveOrder({ ...storeAll(selected, world.tick), residentId: selected.id }),
                )
              }
              // A paste or load for a resident with no queue, or steps wrapped in a repeat block,
              // opens a draft (`CONTEXT.md`: Queue draft); other edits change the running queue.
              onEditQueue={async (items: PlanItem[], loop?: boolean) => {
                const draft = draftEdit(selected, items, loop)
                if (draft) return planQueue(selected.id, draft)
                setOrderError(await sendOrder(givePlan(selected, { items, loop })))
              }}
              onDraftQueue={() => selected.queue && planQueue(selected.id, planOf(selected.queue))}
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
              collapsed={pick !== undefined && pick.kind !== 'army' && !picksCity}
            />
          </InsertPointContext.Provider>
        </CardSheet>
      )}
      {world && group.length > 1 && !selectedTile && (
        <CardSheet
          phone={phone}
          pinnedPeek={pick?.kind === 'group' || pick?.kind === 'plan'}
          hidden={hideCard}
        >
          <GroupCard
            // Another group picked starts a card sorted afresh (ADR 0019).
            key={selectedIds.join()}
            residents={group}
            seen={groupSeen}
            mapSize={world.map.size}
            relocate={relocateForGroup(group)}
            cities={knownCities}
            scripts={scripts}
            buildings={world.buildings}
            carriages={groupCarriages}
            boats={groupBoats}
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
                node: nodeAt?.(groupBuildAt.x, groupBuildAt.y),
                terrain: terrainAt?.(groupBuildAt.x, groupBuildAt.y),
                problem: buildProblemAt(world, groupBuildAt.x, groupBuildAt.y),
              }
            }
            // Picking a defence or Alarm script is never queued: it leaves what they do as it is.
            // Gather shows its form first, for the good (`CONTEXT.md`: Gather).
            onOrder={(order) => {
              if (order.kind === 'gather') customising.current = true
              void sendGroup(
                order,
                order.kind !== 'setDefenceScript' &&
                  order.kind !== 'setAlarmScript' &&
                  shift.current,
              )
            }}
            orderError={groupError}
            onPick={(id) => select([id])}
            onClose={() => select([])}
            planner={
              <InsertPointContext.Provider value={insertFor('group')}>
                <GroupPlanner
                  plan={groupPlan}
                  onPlan={setGroupPlan}
                  onGive={() => void giveGroupPlan()}
                  addStep={addStep(world)}
                  scripts={scripts}
                  buildings={world.buildings}
                  lastSeen={world.lastSeen.buildings}
                  waypoints={world.waypoints}
                  realm={world.home.realmId}
                />
              </InsertPointContext.Provider>
            }
            collapsed={pick?.kind === 'group' || (pick?.kind === 'plan' && !picksCity)}
          />
        </CardSheet>
      )}
      {world && realmOrder?.step === 'menu' && !selectedTile && (
        <CardSheet phone={phone} pinnedPeek={false} hidden={hideCard}>
          <SelectionCard
            rel="own"
            title={realmOrder.at ? `Build at ${realmOrder.at.x}, ${realmOrder.at.y}` : 'Build'}
            lines={[
              realmOrder.at
                ? 'Pick what to build here, then who builds it.'
                : 'Pick what to build, then where it goes, then who builds it.',
            ]}
            onClose={() => setRealmOrder(undefined)}
          >
            <section className="inspector-block" aria-label="Build">
              {realmOrder.at ? (
                <BuildMenu
                  node={nodeAt?.(realmOrder.at.x, realmOrder.at.y)}
                  terrain={terrainAt?.(realmOrder.at.x, realmOrder.at.y)}
                  buildProblem={(kind, material) =>
                    realmBuildProblem(world, realmOrder.at!.x, realmOrder.at!.y, kind, material)
                  }
                  onBuild={(building, material) => {
                    const at = realmOrder.at!
                    realmTile(at.x, at.y, {
                      step: 'where',
                      building,
                      ...(material ? { material } : {}),
                    })
                  }}
                />
              ) : (
                <BuildMenu
                  node={undefined}
                  // Judged once the tile is picked.
                  buildProblem={() => undefined}
                  anywhere
                  onBuild={(building, material) =>
                    setRealmOrder({ step: 'where', building, ...(material ? { material } : {}) })
                  }
                />
              )}
            </section>
          </SelectionCard>
        </CardSheet>
      )}
      {world && realmOrder?.step === 'script' && !selectedTile && !starting && (
        <CardSheet phone={phone} pinnedPeek={false} hidden={hideCard}>
          <RealmScriptCard
            scripts={scripts}
            onRun={(scriptId) => realmScriptOrder({ kind: 'runScript', scriptId })}
            onClose={() => setRealmOrder(undefined)}
          />
        </CardSheet>
      )}
      {world && realmOrder?.step === 'relocate' && !selectedTile && (
        <CardSheet phone={phone} pinnedPeek={false} hidden={hideCard}>
          <RealmRelocateCard
            choices={realmRelocateChoices(
              { cities: knownCities, buildings: knownBuildings, residents: world.residents },
              world.home.realmId,
            )}
            onRelocate={(cityId) => {
              const seen = { cities: knownCities, buildings: knownBuildings }
              const city = knownCities.find((c) => c.id === cityId)
              realmWho(
                { kind: 'relocate', cityId },
                relocateAt(seen, cityId),
                city ? { city: city.name } : {},
              )
            }}
            onClose={() => setRealmOrder(undefined)}
          />
        </CardSheet>
      )}
      {world && who && realmOrder && !selectedTile && (
        <CardSheet phone={phone} pinnedPeek={false} hidden={hideCard}>
          <WhoList
            key={who.key}
            title={who.title}
            where={who.where}
            rows={who.rows}
            suggest={
              realmOrder.step === 'vehicle'
                ? vehicleSuggests(realmOrder.order)
                : WHO_SUGGESTS[who.order.kind]
            }
            most={realmOrder.step === 'vehicle' ? vehicleMost(realmOrder.order) : undefined}
            mostNote={
              realmOrder.step === 'vehicle' ? (n) => mostNote(realmOrder.order, n) : undefined
            }
            doing={(id) => {
              const r = own.find((o) => o.id === id)
              return r
                ? doingLine(r, {
                    scripts,
                    buildings: world.buildings,
                    residents: world.residents,
                    horses: world.horses,
                    cities: knownCities,
                    arrives: arrivesIn?.(r),
                  })
                : ''
            }}
            groups={residentsPanel ? residentsPanel.groups : []}
            tick={world.tick}
            onConfirm={(ids, after, again) =>
              void (realmOrder.step === 'vehicle'
                ? confirmVehicle(realmOrder, ids, after)
                : realmOrder.step === 'about'
                  ? confirmAbout(realmOrder.order, realmOrder.target, ids, after)
                  : realmOrder.step === 'place'
                    ? confirmPlace(realmOrder.order, ids, after, again)
                    : (who.order.kind === 'build' || who.order.kind === 'line') &&
                      confirmRealmOrder(who.order, ids, after, again))
            }
            onClose={() => setRealmOrder(undefined)}
          />
        </CardSheet>
      )}
      {world && starting && (
        <StartParamsForm
          picking={starting.picking !== undefined}
          script={starting.script.name}
          params={starting.params}
          target={targetParam(starting.script)}
          values={starting.values}
          fromWorkplace={starting.base !== undefined}
          label={(id) => paramValueLabel(paramWorld(world), id)}
          waypoints={world.waypoints}
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
            const { params, values, base } = starting
            void starting.start(
              base ? overrideParamValues(params, base, values) : startParamValues(params, values),
            )
          }}
          onCancel={() => setStarting(undefined)}
        />
      )}
      {status === 'updated' && (
        <CentredDialog title="The game was updated">
          <p>A new version of the game is out. Reload the page to play on.</p>
          <div className="hud-dialog-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </CentredDialog>
      )}
      {takeover && (
        <CentredDialog title="Your heir has taken over">
          <p>
            Your Leader has died. {takeover.heir} is your Leader now and leads your realm on from{' '}
            {takeover.city}, under its name, with its standing, contracts and alliance.
            {takeover.cities.length > 0 &&
              ` Your other ${takeover.cities.length === 1 ? 'city is' : 'cities are'} self-managed now and hold you in good standing.`}{' '}
            The realm log says what became of each. Name a new heir to be safe again.
          </p>
          <div className="hud-dialog-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                putTakeoverAway()
                showOnMap(takeover.x, takeover.y)
              }}
            >
              Play on
            </button>
          </div>
        </CentredDialog>
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
  return (
    <CustomiseContext.Provider
      value={{
        can: (order) => canCustomise(order, scripts, world?.workSettings),
        give: (give) => {
          customising.current = true
          give()
        },
      }}
    >
      {game}
    </CustomiseContext.Provider>
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
