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
  holdersOf,
  isSiegeSite,
  KEEPS_GOODS,
  SHARES_A_TILE,
  takesWorkSettings,
} from './building/building.js'
import { firstDayShown } from './realm/first-day.js'
import { type ControlMode } from './realm/control-mode.js'
import type {
  ClientFirstDayLine,
  Account,
  Building,
  BuildingKind,
  Good,
  GoodsSpot,
  OrderRequest,
  Resident,
  StartParamValues,
  Stock,
  TrainingSubject,
  SeenResident,
  WallMaterial,
} from '@csp/shared-types'
import { carriagePulledBy, carriageOfResident, seatsLeft } from './transport/carriages.js'
import { horseOfResident, riderOf } from './transport/horse-rules.js'
import { isDown } from './world/world.js'
import { NODE_WORKPLACE } from '@csp/shared-types'
import {
  buildProblem,
  driveOffProblems,
  hitchOffProblems,
  horseToSteal,
  mountOffProblems,
  nodeCorner,
  rowOffProblem,
} from './world/world-rules.js'
import { isPassableTerrain, wrap } from './world/terrain.js'
import { isWallOrGate } from './building/walls.js'
import { CreativeBar } from './creative/CreativeBar.js'
import { showsCreativeBar } from './creative/creative-bar.js'
import { CreativeSection } from './creative/CreativeSection.js'
import {
  creativeCities,
  creativeOffer,
  creativeProblem,
  offersAnything,
} from './creative/creative-section.js'
import {
  CreativeAddSection,
  CreativeGroupMove,
  CreativeResidentActions,
} from './creative/CreativeResidents.js'
import { cityIdsAtTile, targetParam } from '@csp/lang-wasm'
import { isAt, covers } from './building/footprint.js'
import { HORSE_GRANT_HORSES, PASSENGER_WEIGHT } from '@csp/balance'
import {
  besideVessel,
  crewShort,
  isVesselId,
  vesselOfResident,
  vesselRoom,
} from './transport/vessels.js'
import { AdminPage } from './admin/AdminPanel.js'
import { AlliancePanel } from './diplomacy/Alliance.js'
import { commandsSeen } from './army/alliance-army.js'
import { ArmiesPanel, ArmyCard } from './army/Armies.js'
import { ContractsPanel } from './diplomacy/Contracts.js'
import { demandNoticeLine, demandSides } from './diplomacy/demand-view.js'
import { DemandsPanel } from './diplomacy/Demands.js'
import { DirectOffersPanel } from './diplomacy/DirectOffers.js'
import { incomingItems, incomingNoticeLine } from './diplomacy/incoming-view.js'
import {
  NOTHING_SEEN,
  newestLine,
  rememberLogSeen,
  rememberedLogSeen,
  seeTab,
  sentToRealm,
  unseenMarks,
  type SeenIds,
} from './screen/unseen-view.js'
import { StandingPanel } from './diplomacy/Standing.js'
import { TileMenu, WaypointsPanel } from './realm/Waypoints.js'
import { api } from './world/api.js'
import { clearTerrainCache } from './map/terrain-cache.js'
import { CityInspector } from './city/CityInspector.js'
import {
  goodsOldText,
  goodsPickCities,
  goodsPickOf,
  keyGoods,
  rememberGoodsPick,
  rememberedGoodsPick,
  showBeside,
  foldOrUnfold,
  openDiplomacy,
  showsTab,
  toggleTab,
  withOpen,
  type SideTabId,
  type GoodsPick,
  type OpenTab,
} from './screen/hud-view.js'
import { cityPlace, cityScale } from './city/cities-tab-view.js'
import {
  CentredDialog,
  DiplomacyTabs,
  FirstDayCard,
  GroupReportNotice,
  HorseOfferNotice,
  TraderVisitNotice,
  IncomingNotice,
  NoticeLane,
  PhoneMenu,
  RealmBar,
  TopBar,
  mapCovered,
  useEscapeCloses,
} from './screen/Hud.js'
import { SideTab, Sidebar, useSidebar } from './screen/Sidebar.js'
import type { Covered } from './map/camera.js'
import { cardHidden, laneNotices, visitKey } from './screen/notices-view.js'
import { ResidentsFullList } from './residents/ResidentsFullList.js'
import { groupResidents } from './residents/residents-view.js'
import { groupHorses } from './transport/horses-view.js'
import { HorsesList } from './transport/Horses.js'
import { Founding, RealmEnded } from './realm/Founding.js'
import { appendRequest, storeAll, useShiftHeld } from './queue/queue-view.js'
import { InsertPointContext } from './queue/step-palette-view.js'
import { GroupPlanner } from './queue/GroupPlanner.js'
import { nextPick } from './queue/plan-step.js'
import { useSavedGroups } from './residents/saved-groups.js'
import {
  groupOrderStart,
  groupRequests,
  type GroupOrder,
  type GroupSeen,
  type Skipped,
} from './residents/group-orders.js'
import { BUILDING_NAMES } from './map/palette.js'
import { BuildingOrders } from './building/BuildingOrders.js'
import { buildingOrderRows, realmRequests } from './building/building-orders.js'
import { VehicleOrders } from './transport/VehicleOrders.js'
import { NO_STAND, vehicleOrderRows } from './transport/vehicle-orders.js'
import { Login } from './screen/Login.js'
import { MapView } from './screen/MapView.js'
import { isKitPath, isWikiPath, pageFor } from './screen/pages.js'
import { Wiki } from './wiki/Wiki.js'
import { Kit } from './ui/Kit.js'
import { RealmLog } from './realm/RealmLog.js'
import {
  heirTakeover,
  realmEnded,
  rememberTakeoverSeen,
  rememberedTakeoverSeen,
} from './realm/realm-log.js'
import { isNewRealm } from './map/legend.js'
import { MEND } from './residents/equipment-view.js'
import { GOOD_LABELS, GroupCard, ResidentCard, ResidentsList } from './residents/Residents.js'
import { CardSheet, TileCard } from './screen/SelectionCard.js'
import { Dock } from './screen/Dock.js'
import { barBesideTile } from './screen/dock-view.js'
import { storePlaceAt } from './realm/realm-orders-view.js'
import { RealmTileOrders } from './realm/RealmOrders.js'
import {
  pickHint,
  picksWallLine,
  pickPrompt,
  useMediaQuery,
  useTouchScreen,
} from './pick/pick-mode.js'
import { PickBanner } from './pick/PickBanner.js'
import { usePick } from './pick/usePick.js'
import { PHONE_QUERY } from './screen/sheet-view.js'
import { buildingNodeKind } from './building/building-info-view.js'
import {
  describeTile,
  hitchChoice,
  makeLeaderProblem,
  nameHeirProblem,
  commandedCarriages,
  strangersCarriage,
} from './screen/selection-view.js'
import {
  groupRelocateActionProblem,
  groupRelocateChoices,
  knownOf,
  relocateActionProblem,
  relocateChoices,
} from './residents/relocate-view.js'
import { ScriptLibrary } from './script/ScriptLibrary.js'
import { ScriptLog } from './script/ScriptLog.js'
import { ScriptParamFields, StartParamsForm } from './script/ScriptParams.js'
import { WorkSettings } from './building/WorkSettings.js'
import { overrideParamValues, startParamValues, startValuesValid } from './script/start-params.js'
import { CustomiseContext } from './script/Customise.js'
import { paramValueLabel } from './script/script-params-view.js'
import { faresKnown, loadKnown } from './residents/seen.js'
import { useWorld } from './world/useWorld.js'
import { useLand } from './world/useLand.js'
import { landMarks, regionAt } from './map/land.js'
import { Icon } from './ui/Icon.js'
import {
  useControlModeKey,
  useEscapeOrder,
  useModeAfterPick,
  useSelection,
} from './screen/useSelection.js'
import { useScriptWorkshop } from './script/useScriptWorkshop.js'
import { paramWorld, planWorld, targetOnTile, toFeed } from './world/seen-world.js'
import { useKnownGround } from './map/useKnownGround.js'
import { useCustomiseLapse, useStartForm } from './script/useStartForm.js'
import { useRealmOrder } from './realm/useRealmOrder.js'
import { RealmOrderCards } from './realm/RealmOrderCards.js'
import { usePlanning } from './queue/usePlanning.js'
import { useResidentPanels } from './residents/useResidentPanels.js'
import { useOpenCity } from './city/useOpenCity.js'

/*@@EXTRACTED top-seen.tsx@@*/

export function App() {
  // The Wiki needs no account, so it shows without asking who is logged in.
  if (isWikiPath(window.location.pathname)) return <Wiki />
  if (isKitPath(window.location.pathname)) return <Kit />
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
  // What is picked, and in which control mode (`useSelection`).
  const {
    selectedIds,
    setSelectedIds,
    selectedTile,
    setSelectedTile,
    tileMenu,
    setTileMenu,
    closeTileMenu,
    pickedHorseId,
    setPickedHorseId,
    openArmyId,
    setOpenArmyId,
    controlMode,
    setControlMode,
  } = useSelection()
  // The first-day lines reported and not turned down, so each goes out once (`reportFirstDay`).
  const firstDayReported = useRef(new Set<ClientFirstDayLine>())
  // The dock on the right (`Dock`) once it is mounted; none on a phone.
  const [dock, setDock] = useState<HTMLElement | null>(null)
  const [orderError, setOrderError] = useState<string | undefined>()
  const [armyError, setArmyError] = useState<string | undefined>()
  // What the last group order did.
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
  // The script library's list and the script to open in the workshop (`useScriptWorkshop`).
  const {
    scripts,
    setScripts,
    scriptToOpen,
    openScript,
    scriptRunInfo,
    scriptMemoryTree,
    scriptDebug,
  } = useScriptWorkshop({ world, runs, memories, watchScript }, (tab) => setOpenTab(tab))
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
  // The cities and buildings the Player knows, in sight or remembered (`CONTEXT.md`: Last seen).
  const knownCities = world ? knownOf(world.cities, world.lastSeen.cities) : []
  const knownBuildings = world ? knownOf(world.buildings, world.lastSeen.buildings) : []
  // The terrain and nodes the Player explored, and the checks on them (`useKnownGround`).
  const ground = useKnownGround(world, knownBuildings)
  const { nodeAt, onNodesLoaded, terrainAt, onTerrainLoaded, arrivesIn } = ground
  const { buildProblemAt, knownGround, realmBuildProblem, wayGround } = ground
  // The form before a script starts (`useStartForm`).
  const form = useStartForm(world, scripts)
  const { starting, setStarting, customising, opensForm } = form
  // A realm order being given in realm control mode (`useRealmOrder`).
  const realm = useRealmOrder({
    world,
    own,
    controlMode,
    selectedTile,
    setSelectedTile,
    scripts,
    knownCities,
    knownBuildings,
    groupSeen,
    ground,
    form,
    picker: {
      get wallMaterial() {
        return picker.wallMaterial
      },
      work: { clear: () => picker.work.clear() },
    },
    sendOrder,
    sendGroup,
    sendToGroup,
  })
  const { realmOrder, setRealmOrder, realmBarOpen, realmCard, realmWho, realmWalkTo } = realm
  const { startAbout, startVehicle, vehicleStand, tileVehicle } = realm
  // Picking on the map (`usePick`): what waits for a tile, its preview, what a pick then does.
  const picker = usePick({
    world,
    group,
    own,
    formPick: starting?.picking,
    realm: realm.realmPick,
    actions: {
      giveOrder: (order, queued) => giveOrder(order, queued),
      sendOrder,
      sendGroup: (order) => sendGroup(order),
      creativeMove,
      setScriptParam,
      setWorkSettings: (buildingId, params) => setWorkSettings(buildingId, params),
      addPlanned: (planned) => addPlanned(planned),
      formTile: form.formTile,
      paramSeen: paramWorld,
      planSeen: (w) => planWorld(w, terrainAt),
      here: () => ({
        ownCarriage: ownCarriageHere,
        boatToRow,
        boatToSteal,
        stealable: stealableHere,
        unhorsed: unhorsedHere,
        horseToHitch,
      }),
      tileMenu: (x, y, at) => {
        setSelectedTile(undefined)
        setTileMenu({ x, y, at })
      },
      cancelled: () => {
        form.pickCancelled()
        realm.pickCancelled()
      },
      orderError: setOrderError,
      armyError: setArmyError,
      groupError: setGroupError,
      groupReportCleared: () => setGroupReport(undefined),
    },
  })
  const pick = picker.target
  const plan = picker.plan.plan
  const orderPicked = picker.ordering || realmOrder !== undefined
  useCustomiseLapse(customising, orderPicked)
  // The queue drafts, the group's plan and the planner's insert point (`usePlanning`).
  const { insertFor, groupPlan, setGroupPlan, addPlanned, addStep, giveGroupPlan, queueOf } =
    usePlanning({
      world,
      group,
      selected,
      picker,
      scripts,
      knownCities,
      knownBuildings,
      ground,
      opensForm,
      sendOrder,
      sendToGroup,
      setOrderError,
    })
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
  const homeCity = world?.cities.find((c) => c.id === world.home.cityId)
  /** The realm's horses standing in a building, to breed (`CONTEXT.md`: Breeding). */
  const realmHorsesIn = (b: Building) =>
    world
      ? world.horses.filter((h) => h.realmId === world.home.realmId && isAt(h, b, world.map.size))
      : []
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
  // A place to show on the map, such as one from the realm log or a resident picked in the list:
  // asked for, then centred between the open sidebar tab and the selection card once they are drawn.
  // A place to show on the map; `zoom` picks the zoom from the one now (the zoom stays without).
  const [toShow, setToShow] = useState<{ x: number; y: number; zoom?: (scale: number) => number }>()
  const [focus, setFocus] = useState<{
    x: number
    y: number
    zoom?: (scale: number) => number
    cover: Covered
  }>()
  // The sidebar's open tab, if any (ADR 0044: one at a time), as the browser kept it.
  // The Diplomacy tab's own tab is kept with it, and stays while the sidebar is folded.
  const [sidebar, setSidebar] = useSidebar()
  const openTab = sidebar.open
  const setOpenTab = useCallback(
    (open: OpenTab | ((open: OpenTab) => OpenTab)) =>
      setSidebar((s) => withOpen(s, typeof open === 'function' ? open(s.open) : open)),
    [setSidebar],
  )
  // The resident card's open tab and the full Residents list (`useResidentPanels`).
  const { cardSections, onCardSections, fullList, setResidentsFull } = useResidentPanels(openTab)
  const demandsShown = showsTab(sidebar, 'demands')
  const offersShown = showsTab(sidebar, 'directOffers')
  // The notice of demands sent to the realm (`CONTEXT.md`: Demand), until the Player dismisses it
  // or has them in front of them in the sidebar.
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
  // or has it in front of them in the sidebar.
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
  // What the Player hasn't seen in a sidebar tab yet, for the marks on its strip and the Diplomacy tabs
  // (`CONTEXT.md`: Sidebar): what was sent to the realm, seen once its tab was in front of them,
  // and realm log lines newer than the last one they had open.
  const [seenIds, setSeenIds] = useState<SeenIds>(NOTHING_SEEN)
  const sent = useMemo(
    () =>
      world
        ? sentToRealm(world.diplomacy, world.home.realmId)
        : { contracts: [], demands: [], directOffers: [] },
    [world],
  )
  const tabShown = openTab === 'diplomacy' ? sidebar.tab : undefined
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
    if (openTab === 'realmLog' && newest !== null) {
      setLogSeenUpTo((upTo) => {
        if (upTo !== null && upTo >= newest) return upTo
        rememberLogSeen(homeRealm, newest)
        return newest
      })
    } else {
      // Until the log was open in this browser, what it held on arrival counts as seen.
      setLogSeenUpTo((upTo) => upTo ?? rememberedLogSeen(homeRealm) ?? newest ?? -1)
    }
  }, [events, homeRealm, openTab])
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
  const foldSidebar = useCallback(() => setOpenTab(undefined), [setOpenTab])
  useEscapeCloses(openTab, foldSidebar)
  // What the map waits for while an order that needs a target is given (ADR 0012: pick mode).
  const touch = useTouchScreen()
  // Narrow or touch: cards are bottom sheets and the HUD folds into a menu button (ADR 0012).
  const phone = useMediaQuery(PHONE_QUERY)
  // The building the tile card is about: in sight, or as last seen.
  const tileBuilding =
    world && selectedTile
      ? [...world.buildings, ...world.lastSeen.buildings].find(
          (b) => !SHARES_A_TILE.includes(b.kind) && covers(b, selectedTile.x, selectedTile.y),
        )
      : undefined
  // A step picking a city keeps the card open: it lists the realm's cities to pick from too.
  const picksCity = plan !== undefined && nextPick(plan)?.pick === 'city'
  /** Leaves pick mode without giving the order; the card comes back as it was. */
  const cancelPick = picker.cancel
  /**
   * Switches the control mode (the HUD switch, Tab). Into realm control mode it drops a picked
   * resident, group or army, which are commanded in unit control mode only.
   */
  const switchControlMode = useCallback(
    (mode: ControlMode) => {
      if (mode === 'realm') {
        setSelectedIds([])
        setOpenArmyId(undefined)
        setStarting(undefined)
        cancelPick()
      }
      setControlMode(mode)
    },
    [cancelPick, setControlMode],
  )
  useControlModeKey(controlMode, switchControlMode)
  // Picking a resident, a group or an army some other way than a map click (the Residents list,
  // a saved group's key, the Armies tab, a notice) switches to unit control mode.
  const openArmy = world?.armies.find((a) => a.id === openArmyId)
  const pickedArmy = picker.army.pick !== undefined || openArmy !== undefined
  useModeAfterPick({ controlMode, selectedIds, setControlMode }, pickedArmy)
  const hideCard = cardHidden(openTab, fullList)
  const shownCard = !hideCard
  const anySelected = selectedIds.length > 0
  const picked = pick !== undefined
  const formOpen = starting !== undefined
  const tileOpen = selectedTile !== undefined
  // The command bar beside an open tile card: both on a desktop, the tile card's keys winning.
  const besideTile = barBesideTile(phone, tileOpen)
  const armyOpen = openArmy !== undefined
  useEscapeOrder(
    { picked, formOpen, shownCard, tileOpen, anySelected, realmCard, armyOpen },
    {
      pick: cancelPick,
      form: () => setStarting(undefined),
      tile: () => setSelectedTile(undefined),
      cards: () => {
        setSelectedIds([])
        picker.resident.stop()
        setRealmOrder(undefined)
        setOpenArmyId(undefined)
      },
    },
  )
  useLayoutEffect(() => {
    if (!toShow) return
    const covered = mapCovered()
    const shown = showBeside(window.innerWidth, covered.left, covered.right, covered.strip)
    if (shown.foldSidebar) foldSidebar()
    setFocus({ ...toShow, cover: shown })
  }, [toShow, foldSidebar])
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
    picker.dropAll()
    setGroupPlan(undefined)
    setStarting(undefined)
    setOrderError(undefined)
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
  const { openCityId, setOpenCityId, tradeAt, setTradeAt } = useOpenCity()
  // The wandering traders' stops whose notice the Player dismissed (`CONTEXT.md`: Trader stop).
  const [dismissedVisits, setDismissedVisits] = useState<ReadonlySet<string>>(new Set())

  /**
   * Moves residents to a tile at once (`CONTEXT.md`: Creative mode): a creative action, no order.
   * Answers why it was refused or what it broke, or nothing; they show there with the next tick.
   */
  async function creativeMove(residentIds: string[], x: number, y: number) {
    if (!world) return undefined
    const size = world.map.size
    try {
      const done = await api.creativeAct({
        action: 'moveResidents',
        residentIds,
        x: wrap(x, size),
        y: wrap(y, size),
      })
      return creativeProblem(done)
    } catch (e: unknown) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  /** The tile picked for the group to build on, with what the group card's Build menu needs of it. */
  const groupBuildTile = (w: NonNullable<typeof world>, at: { x: number; y: number } | undefined) =>
    at && {
      ...at,
      site: w.buildings.find((b) => b.kind !== 'road' && b.site && covers(b, at.x, at.y)),
      node: nodeAt?.(at.x, at.y),
      terrain: terrainAt?.(at.x, at.y),
      problem: buildProblemAt(w, at.x, at.y),
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
    if (order.kind === 'build') picker.group.built()
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
  const onTile = <T extends { x: number; y: number }>(things: T[] | undefined) =>
    selected && things?.find((t) => t.x === selected.x && t.y === selected.y)
  // A road may share its tile with a building (`CONTEXT.md`: Road); a building is wherever its
  // footprint is (`CONTEXT.md`: At a building).
  const buildingHere =
    selected && world?.buildings.find((b) => !SHARES_A_TILE.includes(b.kind) && isAt(selected, b))
  const roadHere = onTile(world?.buildings.filter((b) => b.kind === 'road'))
  // A carriage or siege machine site on the tile, worked and supplied the same way (`CONTEXT.md`: Siege machine).
  const carriageSiteHere = onTile(
    world?.buildings.filter((b) => b.kind === 'carriage' || isSiegeSite(b.kind)),
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
    return { id: v.id, problem: rowOffProblem(selected.id, v.id, world.home.realmId) }
  })()
  // Another organization's horses for the picked resident (`CONTEXT.md`: Stealing a carriage or
  // horse): a free one to mount, and one to pull the realm's own carriage that has none of its own.
  const unhorsedHere = onTile(
    world?.carriages.filter((k) => k.realmId === world.home.realmId && !k.horseId),
  )
  const horseToHitch =
    world && selected && unhorsedHere
      ? horseToSteal(selected.id, unhorsedHere.id, world.home.realmId)
      : undefined
  const looseStrangers = onTile(
    world?.horses.filter(
      (h) => h.realmId !== world.home.realmId && !carriagePulledBy(world, h) && !riderOf(world, h),
    ),
  )
  // What the pick waiting for a tile would do under the pointer, or at the tile tapped on a touch
  // screen (`CONTEXT.md`: Picking a target).
  const preview = picker.preview(
    () => ({
      ...wayGround(world!),
      ...planWorld(world!),
      cityNames: knownCities,
      nodeAt: (x, y) => nodeAt?.(x, y),
      buildProblem: (kind, x, y) =>
        // A kind picked before its tile is judged as the Build menu there would (realm control).
        realmOrder?.step === 'where'
          ? realmBuildProblem(world!, x, y, kind, realmOrder.material)
          : buildProblem(kind, x, y, knownGround(world!)),
    }),
    arrivesIn || undefined,
    isStrangers,
  )

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
  const pickHeir = () => setOpenTab('residents')
  const sideTab = (id: SideTabId, panel: ReactNode) => <SideTab id={id}>{panel}</SideTab>

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
              picker.drop()
              setOrderError(undefined)
              // The realm order's Build menu or who-list gives way to the tile's card.
              setRealmOrder(undefined)
            }}
            selectedCityId={openCityId}
            onSelectCity={(id) => {
              setOpenCityId(id)
              setOpenTab('cities')
            }}
            picking={picker.onMap}
            onPickTile={picker.pickTile}
            preview={preview}
            // A tile tapped stays previewed until another is tapped.
            onPointerTile={picker.pointerTile}
            onNodesLoaded={onNodesLoaded}
            onTerrainLoaded={onTerrainLoaded}
            newRealm={isNewRealm(world.events, world.tick)}
            focus={focus}
            land={landShown}
          />
        ) : (
          <div className="game-waiting">
            <p className="waiting-panel pn fx">
              <Icon name="clock" />
              <span className="px t16">Waiting for the server…</span>
            </p>
          </div>
        )}
      </section>
      <TopBar
        phone={phone}
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
        <RealmBar phone={phone} open={realmBarOpen} onOpen={realm.openBar} />
      )}
      {phone && (
        <PhoneMenu
          open={openTab}
          onToggle={(id) => setOpenTab((open) => toggleTab(open, id))}
          marked={marks.strip}
          goods={goods}
          leader={leader?.name}
          heir={heirShown}
          onPickHeir={pickHeir}
          account={account.name}
          onLogout={logout}
          onWiki={() => reportFirstDay('openWiki')}
          zeal={world?.zeal}
          zealDraining={leader?.order?.kind === 'rally'}
        />
      )}
      <Sidebar
        open={openTab}
        marked={marks.strip}
        phone={phone}
        full={fullList}
        onToggle={(id) => setOpenTab((open) => toggleTab(open, id))}
        onFold={() => setSidebar(foldOrUnfold)}
        onClose={foldSidebar}
      >
        {residentsPanel &&
          sideTab(
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
          )}
        {world &&
          sideTab(
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
          sideTab(
            'waypoints',
            <WaypointsPanel
              waypoints={world.waypoints}
              onCentre={(w) => showOnMap(w.x, w.y)}
              onRename={(w, name) => sendOrder({ kind: 'renameWaypoint', waypointId: w.id, name })}
              onRemove={(w) => sendOrder({ kind: 'removeWaypoint', waypointId: w.id })}
              // A waypoint is a place like a tile: picked, it is its tile (`CONTEXT.md`: Waypoint).
              onPick={pick ? (w) => picker.pickTile(w.x, w.y) : undefined}
            />,
          )}
        {world &&
          sideTab(
            'armies',
            <ArmiesPanel
              armies={world.armies}
              own={own}
              inSight={world.residents}
              openId={openArmy?.id}
              onOpen={(id) => {
                // The army's card takes the command bar: a resident or group picked lets go.
                if (id) setSelectedIds([])
                // On a phone the tab fills the screen over the sheet: it folds, as it does when a
                // resident is picked from Residents (`showBeside`), so the army's sheet shows.
                if (id && phone) foldSidebar()
                cancelPick()
                setArmyError(undefined)
                setOpenArmyId(id)
              }}
              sendOrder={sendOrder}
            />,
          )}
        {world &&
          sideTab(
            'diplomacy',
            <DiplomacyTabs
              tab={sidebar.tab}
              onTab={(tab) => setSidebar((s) => openDiplomacy(s, tab))}
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
          sideTab(
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
              onBuyHorse={async (buy) =>
                setOrderError(await giveOrder({ kind: 'buyHorse', ...buy }))
              }
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
                // Opening a row shows the city on the map, outlined (`CONTEXT.md`: Cities tab).
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
        {world &&
          sideTab(
            'realmLog',
            <RealmLog
              events={world.events}
              realmId={world.home.realmId}
              deliveries={world.diplomacy.deliveries}
              onShowPlace={(p) => showOnMap(p.x, p.y)}
            />,
          )}
      </Sidebar>
      {/* The script workshop, a screen over the map that the Scripts tab opens (ADR 0044). Mounted
          before the world arrives too, and while closed: it loads the scripts the inspector can
          run. */}
      <ScriptLibrary
        open={openTab === 'scripts'}
        onClose={foldSidebar}
        onScripts={setScripts}
        toOpen={scriptToOpen}
      />
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
                picksWallLine(pick)
                  ? { value: picker.wallMaterial, onChange: picker.setWallMaterial }
                  : undefined
              }
              under={pick.kind === 'plan' && pick.error ? undefined : preview?.label}
              onConfirm={
                picker.pickAt?.tapped
                  ? () => picker.pickTile(picker.pickAt!.x, picker.pickAt!.y)
                  : undefined
              }
              onWaypoints={
                world && world.waypoints.length > 0 && openTab !== 'waypoints'
                  ? () => setOpenTab('waypoints')
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
              onOpen={() => setSidebar((s) => openDiplomacy(s, 'demands'))}
              onDismiss={putDemandsAway}
            />
          ) : kind === 'incoming' && incomingNotice ? (
            <IncomingNotice
              key={kind}
              line={incomingNotice}
              onOpen={() => setSidebar((s) => openDiplomacy(s, 'directOffers'))}
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
                    setOpenTab('cities')
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
      {!phone && <Dock onMount={setDock} />}
      {world && selectedTile && (
        <CardSheet
          phone={phone}
          dock={dock}
          pinnedPeek={picker.work.pick !== undefined}
          hidden={hideCard}
        >
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
                  return nodeCorner(node, NODE_WORKPLACE[node.kind], knownGround(world))
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
                    picker.work.pick?.buildingId === tileBuilding.id
                      ? picker.work.pick.param.name
                      : undefined
                  }
                  onScript={(scriptId) =>
                    void setWorkSettings(tileBuilding.id, undefined, scriptId)
                  }
                  onPick={(param) => picker.work.toggle(tileBuilding.id, param)}
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
                const shared = world.buildings.filter(
                  (b) => SHARES_A_TILE.includes(b.kind) && covers(b, x, y, world.map.size),
                )
                const offer = creativeOffer(tileBuilding, carriage, name, shared)
                const cities = creativeCities(knownCities, world.home.realmId)
                const areaIds = cityIdsAtTile(knownBuildings, x, y, world.map.size)
                const tileCity = knownCities.find((c) => areaIds.includes(c.id))
                const here = world.residents.filter(
                  (r) => Math.floor(r.x) === x && Math.floor(r.y) === y,
                )
                return (
                  <>
                    {offersAnything(offer) && (
                      <CreativeSection
                        key={`${tileBuilding?.id}/${carriage?.id}/${offer.finish?.buildingId}`}
                        offer={offer}
                      />
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
              picker.resident.start('driveOff')
            }}
            onHitchOff={(residentId) => {
              select([residentId])
              picker.resident.start('hitchOff')
            }}
            onCrew={(machineId, residentId) =>
              void giveOrder({ kind: 'crew', residentId, machineId }, false).then(setOrderError)
            }
            onPush={(machineId, residentId) => {
              select([residentId])
              picker.resident.startMachine('push', machineId)
            }}
            onThrow={(machineId, residentId) => {
              select([residentId])
              picker.resident.startMachine('throw', machineId)
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
              picker.work.clear()
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
              setOpenTab('cities')
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
              setOpenTab('horses')
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
      {world && selected && besideTile.shows && (
        <CardSheet
          phone={phone}
          pinnedPeek={pick !== undefined && pick.kind !== 'army'}
          bar
          keysOff={!besideTile.keys}
          hidden={hideCard}
        >
          <InsertPointContext.Provider value={insertFor(selected.id)}>
            <ResidentCard
              key={selected.id}
              resident={selected}
              creative={
                showsCreativeBar(account) && (
                  <CreativeResidentActions
                    resident={selected}
                    tick={world.tick}
                    move={{
                      picking: picker.resident.mode === 'creativeMove',
                      onPick: () => picker.resident.toggle('creativeMove'),
                    }}
                  />
                )
              }
              arrivesIn={arrivesIn || undefined}
              leaderId={world.home.leaderId}
              cities={knownCities}
              tick={world.tick}
              picking={picker.resident.mode}
              onWalkTo={() => picker.resident.toggle('walk')}
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
              onDriveTo={() => picker.resident.toggle('drive')}
              {...(stealableHere && {
                driveOff: {
                  problem: driveOffProblems([selected.id], stealableHere.id, world.home.realmId)[0],
                },
                onDriveOff: () => picker.resident.toggle('driveOff'),
              })}
              {...(unhorsedHere &&
                horseToHitch && {
                  hitchOff: {
                    problem: hitchOffProblems(
                      [selected.id],
                      unhorsedHere.id,
                      world.home.realmId,
                      horseToHitch,
                    )[0],
                  },
                  onHitchOff: () => picker.resident.toggle('hitchOff'),
                })}
              {...(looseStrangers && {
                stealHorse: {
                  problem: mountOffProblems(
                    [selected.id],
                    looseStrangers.id,
                    world.home.realmId,
                  )[0],
                },
                onStealHorse: () =>
                  void giveOrder(
                    { kind: 'mount', residentId: selected.id, horseId: looseStrangers.id },
                    false,
                  ).then(setOrderError),
              })}
              onRoadTo={() => picker.resident.toggle('roadFrom')}
              onWallTo={() => picker.resident.toggle('wallFrom')}
              onHaulTo={picker.resident.toggleHaul}
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
              onRowTo={() => picker.resident.toggle('row')}
              {...(boatToSteal && {
                rowOff: { problem: boatToSteal.problem },
                onRowOff: () => picker.resident.toggle('rowOff'),
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
                const realm = { id: world.home.realmId, leaderId: world.home.leaderId }
                return {
                  problem: makeLeaderProblem(world.diplomacy, realm, selected.id),
                  heir: {
                    problem: nameHeirProblem(world.diplomacy, realm, selected.id),
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
              onSections={onCardSections}
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
                    picking={picker.param.name}
                    onPick={picker.param.toggle}
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
              scriptRun={selected.script && scriptRunInfo(selected.id, selected.script.scriptId)}
              scriptMemory={selected.script && scriptMemoryTree(selected.id)}
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
              {...queueOf(selected)}
              addStep={addStep(world)}
              onClose={() => {
                setSelectedIds([])
                picker.cardClosed()
              }}
              collapsed={pick !== undefined && pick.kind !== 'army' && !picksCity}
            />
          </InsertPointContext.Provider>
        </CardSheet>
      )}
      {world && group.length > 1 && besideTile.shows && (
        <CardSheet
          phone={phone}
          pinnedPeek={pick?.kind === 'group' || pick?.kind === 'plan'}
          bar
          keysOff={!besideTile.keys}
          hidden={hideCard}
        >
          <GroupCard
            // Another group picked starts a card sorted afresh (ADR 0019).
            key={selectedIds.join()}
            residents={group}
            seen={groupSeen}
            mapSize={world.map.size}
            creative={
              showsCreativeBar(account) && (
                <CreativeGroupMove
                  move={{
                    picking: picker.group.mode === 'creativeMove',
                    onPick: picker.group.toggleCreativeMove,
                  }}
                />
              )
            }
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
            picking={picker.group.mode}
            onPicking={picker.group.start}
            buildAt={groupBuildTile(world, picker.group.buildAt)}
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
      {world && openArmy && besideTile.shows && (
        // The army opened in the Armies tab, its card in the command bar as a resident's is.
        <CardSheet
          phone={phone}
          pinnedPeek={picker.army.pick !== undefined}
          bar
          keysOff={!besideTile.keys}
          hidden={hideCard}
        >
          <ArmyCard
            key={openArmy.id}
            army={openArmy}
            own={own}
            inSight={world.residents}
            carriages={world.carriages}
            realmId={world.home.realmId}
            picking={picker.army.pick}
            onPick={(p) => {
              picker.army.set(p)
              setArmyError(undefined)
            }}
            pickError={armyError}
            scripts={scripts}
            sendOrder={sendOrder}
            scriptMemory={
              openArmy.script && scriptDebug(openArmy.id, openArmy.script.scriptId ?? 0)
            }
            onClose={() => {
              setOpenArmyId(undefined)
              picker.army.clear()
            }}
          />
        </CardSheet>
      )}
      {world && (
        <RealmOrderCards
          realm={realm}
          world={world}
          own={own}
          scripts={scripts}
          knownCities={knownCities}
          knownBuildings={knownBuildings}
          ground={ground}
          groups={residentsPanel ? residentsPanel.groups : []}
          tileOpen={selectedTile !== undefined}
          formOpen={starting !== undefined}
          sheet={{ phone, dock, hidden: hideCard }}
        />
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
            picker.formPicking()
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
        <CentredDialog title="The game was updated" tone="news">
          <p>A new version of the game is out. Reload the page to play on.</p>
          <div className="hud-dialog-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </CentredDialog>
      )}
      {takeover && (
        <CentredDialog title="Your heir has taken over" tone="bad">
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
      {world && realmEnded(world.events) && <RealmEnded />}
    </div>
  )
  return <CustomiseContext.Provider value={form.customise}>{game}</CustomiseContext.Provider>
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
