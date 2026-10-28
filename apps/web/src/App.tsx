import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import {
  carriagePulledBy,
  holdersOf,
  horseOfResident,
  riderOf,
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
  type Stock,
  isAt,
  SHARES_A_TILE,
  covers,
  type SeenResident,
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
  ToolRail,
  TopBar,
  mapCovered,
  useEscapeCloses,
} from './Hud.js'
import type { Covered } from './map/camera.js'
import { groupResidents, rememberedTab, rememberTab, type CardSections } from './residents-view.js'
import { Founding } from './Founding.js'
import { appendRequest, editRequest, STORE_ALL, useShiftHeld } from './queue-view.js'
import { useSavedGroups } from './saved-groups.js'
import { groupRequests, type GroupOrder, type Skipped } from './group-orders.js'
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
  ResidentsList,
  type HaulSetup,
  type Picking,
} from './Residents.js'
import { TileCard } from './SelectionCard.js'
import { buildingNodeKind } from './building-info-view.js'
import {
  buildHereProblem,
  describeTile,
  makeLeaderProblem,
  nodeFit,
  type ActionId,
} from './selection-view.js'
import { ScriptLibrary } from './ScriptLibrary.js'
import { ScriptParamFields } from './ScriptParams.js'
import { paramPickAt, paramValueLabel, type ParamWorld } from './script-params-view.js'
import { faresKnown, loadKnown } from './seen.js'
import { useWorld } from './useWorld.js'

/** What the resident card's script param fields need of the world (`script-params-view`). */
function paramWorld(world: NonNullable<ReturnType<typeof useWorld>['world']>): ParamWorld {
  const { buildings, carriages, cities } = world
  return { buildings, carriages, cities, realmId: world.home.realmId, size: world.map.size }
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
  const { world, founding, status, sendOrder, found } = useWorld(onLoggedOut)
  // The residents picked on the map or in the list: one shows their card, several a group card.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // A tile picked on the map with no resident of the Player's on it; its card shows over the
  // resident's, who stays picked to be sent there.
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number }>()
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
  // A group order waiting for a tile, the tile picked to build on, and what the last one did.
  const [groupPicking, setGroupPicking] = useState<GroupPicking>(false)
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
  const homeCity = world?.cities.find((c) => c.id === world.home.cityId)
  // The script library's list, shared with the resident inspector's run-script order.
  const [scripts, setScripts] = useState<ScriptSummary[]>([])
  // A script to open in the library, such as the one a resident's task runs; `at` reopens it.
  const [scriptToOpen, setScriptToOpen] = useState<{ id: number; at: number }>()
  // A place to show on the map, such as one from the realm log or a resident picked in the list:
  // asked for, then centred between the open drawer and the selection card once they are drawn.
  const [toShow, setToShow] = useState<{ x: number; y: number }>()
  const [focus, setFocus] = useState<{ x: number; y: number; cover: Covered }>()
  // The drawer open over the map, if any (ADR 0008: one at a time).
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>()
  const closeDrawer = useCallback(() => setOpenDrawer(undefined), [])
  useEscapeCloses(openDrawer, closeDrawer)
  // With no drawer open, Escape drops the selection.
  const anySelected = selectedIds.length > 0
  useEffect(() => {
    if (openDrawer || !anySelected) return
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof Element && e.target.closest('input, textarea, select, .cm-editor')
      if (e.key !== 'Escape' || typing) return
      setSelectedIds([])
      setPicking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDrawer, anySelected])
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
   * Gives an order, or, with Shift held, appends a resident's order to their queue (`CONTEXT.md`:
   * Queue). Orders that can't be queue steps are given as they are.
   */
  const giveOrder = (order: OrderRequest) => {
    const r = shift.current ? own.find((x) => x.id === order.residentId) : undefined
    return sendOrder((r && appendRequest(r, order)) ?? order)
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
   * A tile picked for the group (`CONTEXT.md`: Group): walking there (also by right-click),
   * working the workplace there, or where to build.
   */
  async function groupTile(x: number, y: number) {
    const mode = groupPicking
    setGroupPicking(false)
    if (!world) return
    if (mode === 'build') {
      setGroupBuildAt({ x, y })
      return
    }
    setGroupBuildAt(undefined)
    if (mode !== 'work') return sendGroup({ kind: 'walkTo', x, y })
    const workplace = world.buildings.find(
      (b) => b.kind !== 'road' && !b.site && covers(b, x, y) && MAX_WORKERS[b.kind] !== undefined,
    )
    setGroupReport(undefined)
    if (!workplace) return setGroupError('no workplace there')
    // What a smithy makes is picked for each worker on their own card.
    if (workplace.kind === 'smithy') return setGroupError('pick what to make on each one’s card')
    const name = BUILDING_NAMES[workplace.kind].toLowerCase()
    await sendGroup({ kind: 'work', workplace, name })
  }
  /**
   * Gives each resident of the group the same order request (ADR 0002), skipping those who
   * can't take it, and says on the card who was skipped or turned down and why.
   */
  async function sendGroup(order: GroupOrder) {
    if (!world) return
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
    const queued = shift.current
    const { requests, skipped } = groupRequests(order, group, {
      tick: world.tick,
      size,
      free,
      queued,
    })
    if (order.kind === 'build') setGroupBuildAt(undefined)
    setGroupError(undefined)
    const answers = await Promise.all(requests.map((q) => sendOrder(q.order)))
    const turnedDown = requests.flatMap((q, i) => {
      const why = answers[i]
      const r = group.find((g) => g.id === q.residentId)
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
    setOrderError(await sendOrder(order))
  }
  /**
   * Gives the picked resident the Feed the stable task for the stable they stand in: they run the
   * Player's Feed the stable (default) script (`CONTEXT.md`: Feeding the stable).
   */
  async function feedStable(stableId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'feedStable', residentId: selected.id, stableId }
    setOrderError(await sendOrder(order))
  }
  /** Orders the picked resident to stop what they are doing, such as a haul route. */
  /** Orders the picked resident to run one of the Player's scripts. */
  async function runScript(scriptId: number) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'runScript', residentId: selected.id, scriptId }))
  }
  /**
   * Picks, or clears with null, the value of a param of the script the picked resident runs
   * (`CONTEXT.md`: Script parameter). It leaves the script running.
   */
  async function setScriptParam(name: string, targetId: string | null) {
    if (!selected?.script) return
    const { scriptId } = selected.script
    const order = { kind: 'setScriptParam', residentId: selected.id, scriptId, name, targetId }
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
    <div className="game">
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
              paramPick !== undefined ||
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
      <ToolRail
        open={openDrawer}
        onToggle={(id) => setOpenDrawer((open) => toggleDrawer(open, id))}
      />
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
          'armies',
          <ArmiesPanel
            armies={world.armies}
            own={own}
            inSight={world.residents}
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
      {world && selectedTile && (
        <div className="game-selection">
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
          />
        </div>
      )}
      {world && selected && !selectedTile && (
        <div className="game-selection">
          <ResidentCard
            key={selected.id}
            resident={selected}
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
            scripts={scripts}
            buildings={world.buildings}
            onRunScript={runScript}
            onEditScript={(id) => {
              setScriptToOpen({ id, at: Date.now() })
              setOpenDrawer('scripts')
            }}
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
                  onClear={(name) => void setScriptParam(name, null)}
                />
              )
            }
            onStore={async () =>
              setOrderError(await giveOrder({ ...STORE_ALL, residentId: selected.id }))
            }
            onEditQueue={async (steps, loop) =>
              setOrderError(await sendOrder(editRequest(selected, steps, loop)))
            }
            onClose={() => {
              setSelectedIds([])
              setPicking(false)
              setParamPick(undefined)
            }}
          />
        </div>
      )}
      {world && group.length > 1 && !selectedTile && (
        <div className="game-selection">
          <GroupCard
            residents={group}
            scripts={scripts}
            buildings={world.buildings}
            picking={groupPicking}
            onPicking={(p) => {
              setGroupPicking(p)
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
            onOrder={(order) => void sendGroup(order)}
            report={groupReport}
            orderError={groupError}
            onPick={(id) => select([id])}
            onClose={() => select([])}
          />
        </div>
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
