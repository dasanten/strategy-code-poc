import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  holdersOf,
  KEEPS_GOODS,
  isWallOrGate,
  type Account,
  type Building,
  type BuildingKind,
  type Good,
  type GoodsSpot,
  type KnownNode,
  type Resident,
  type ScriptSummary,
  type Stock,
  isAt,
  covers,
} from '@csp/shared'
import { AdminPage } from './AdminPanel.js'
import { AlliancePanel } from './Alliance.js'
import { commandsSeen } from './alliance-army.js'
import { ArmiesPanel, type ArmyPick } from './Armies.js'
import { ContractsPanel } from './Contracts.js'
import { StandingPanel } from './Standing.js'
import { api } from './api.js'
import { CityInspector } from './CityInspector.js'
import { keyGoods, toggleDrawer, type DrawerId, type OpenDrawer } from './hud-view.js'
import { CentredDialog, Drawer, ToolRail, TopBar, useEscapeCloses } from './Hud.js'
import { Login } from './Login.js'
import { MapView } from './MapView.js'
import { pageFor } from './pages.js'
import { RealmLog } from './RealmLog.js'
import { realmEnded } from './realm-log.js'
import {
  GOOD_LABELS,
  ResidentCard,
  ResidentsList,
  type HaulSetup,
  type Picking,
} from './Residents.js'
import { TileCard } from './SelectionCard.js'
import { describeTile, makeLeaderProblem } from './selection-view.js'
import { ScriptLibrary } from './ScriptLibrary.js'
import { useWorld } from './useWorld.js'

export function App() {
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
  const { world, status, sendOrder } = useWorld(onLoggedOut)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  // A tile picked on the map with no resident of the Player's on it; its card shows over the
  // resident's, who stays picked to be sent there.
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number }>()
  const [picking, setPicking] = useState<Picking>(false)
  const [haulSetup, setHaulSetup] = useState<HaulSetup>()
  const [orderError, setOrderError] = useState<string | undefined>()
  const [armyPick, setArmyPick] = useState<ArmyPick>()
  const [armyError, setArmyError] = useState<string | undefined>()
  // The residents the Player gives orders to: their own, less those handed over to their alliance's
  // army or rented out, and, as its alliance leader, the ones handed over (`CONTEXT.md`: Alliance
  // army) and the mercenaries they hired (`CONTEXT.md`: Mercenary contract).
  const own = world
    ? world.residents.filter((r) => commandsSeen(world.diplomacy, world.home.realmId, r))
    : []
  const selected = own.find((r) => r.id === selectedId)
  const homeCity = world?.cities.find((c) => c.id === world.home.cityId)
  // The script library's list, shared with the resident inspector's run-script order.
  const [scripts, setScripts] = useState<ScriptSummary[]>([])
  // A script to open in the library, such as the one a resident's task runs; `at` reopens it.
  const [scriptToOpen, setScriptToOpen] = useState<{ id: number; at: number }>()
  // A place from the realm log to show on the map.
  const [focus, setFocus] = useState<{ x: number; y: number }>()
  // The drawer open over the map, if any (ADR 0008: one at a time).
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>()
  const closeDrawer = useCallback(() => setOpenDrawer(undefined), [])
  useEscapeCloses(openDrawer, closeDrawer)
  // The city picked on the map or opened in the Cities drawer.
  const [openCityId, setOpenCityId] = useState<string>()

  /**
   * Orders the picked resident to walk to a tile, or, while picking where to drive, to drive the
   * carriage on their tile there, or, while picking a haul route's other stop, to haul between
   * their tile and that one, or, while picking a road's far end, to build road along the line
   * from their tile to that one (ADR 0002: the server checks it).
   */
  async function goTo(x: number, y: number) {
    const mode = picking
    setPicking(false)
    if (armyPick) {
      setArmyPick(undefined)
      setArmyError(await sendOrder({ kind: armyPick.kind, armyId: armyPick.armyId, x, y }))
      return
    }
    if (!selected) return
    const carriage = onTile(world?.carriages)
    if (mode === 'drive' && carriage) {
      const order = { kind: 'drive', residentId: selected.id, carriageId: carriage.id, x, y }
      setOrderError(await sendOrder(order))
      return
    }
    if (mode === 'haul' && carriage && haulSetup) {
      // The Haul task: they run the Player's Haul (default) script (`CONTEXT.md`: Default script).
      const order = { kind: 'task', task: 'haul', residentId: selected.id, carriageId: carriage.id }
      setOrderError(await sendOrder({ ...order, x, y, ...haulSetup }))
      return
    }
    if (mode === 'road') {
      const from = { x: selected.x, y: selected.y }
      setOrderError(
        await sendOrder({ kind: 'roadLine', residentId: selected.id, from, to: { x, y } }),
      )
      return
    }
    setOrderError(await sendOrder({ kind: 'walkTo', residentId: selected.id, x, y }))
  }

  /** Orders the picked resident to pick up or drop goods on their tile. */
  async function carry(kind: 'pickUp' | 'drop', spot: GoodsSpot, goods: Stock) {
    if (!selected) return
    setOrderError(await sendOrder({ kind, residentId: selected.id, spot, goods }))
  }
  /**
   * Gives the picked resident the Build task on their tile, laying out a site or joining the one
   * there: they run the Player's Build (default) script, which fetches missing materials from
   * the realm's storages (`CONTEXT.md`: Fetching materials).
   */
  async function build(building: BuildingKind) {
    if (!selected) return
    const order = { kind: 'task', task: 'build', residentId: selected.id, building }
    setOrderError(await sendOrder(order))
  }
  /**
   * Gives the picked resident the Work task at the workplace on their tile, making `makes` at a
   * smithy: they run the Player's Work (default) script (`CONTEXT.md`: Default script).
   */
  async function work(makes?: Good) {
    if (!selected) return
    const workplaceId = buildingHere?.id
    const order = { kind: 'task', task: 'work', residentId: selected.id, workplaceId, makes }
    setOrderError(await sendOrder(order))
  }
  /**
   * Gives the picked resident the Tear down task for the building or site on their tile: they
   * run the Player's Tear down (default) script.
   */
  async function tearDown(buildingId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'tearDown', residentId: selected.id, buildingId }
    setOrderError(await sendOrder(order))
  }
  /** Orders the picked resident to stop what they are doing, such as a haul route. */
  /** Orders the picked resident to run one of the Player's scripts. */
  async function runScript(scriptId: number) {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'runScript', residentId: selected.id, scriptId }))
  }
  async function stop() {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'stop', residentId: selected.id }))
  }
  /** Orders the picked resident to pair with another resident of their city. */
  async function pair(partnerId: string) {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'pair', residentId: selected.id, partnerId }))
  }
  /**
   * Orders the Player's Leader to hand the realm over to the picked resident (`CONTEXT.md`:
   * Leader handover), the same `handOver` order a script's `handOver` requests.
   */
  async function makeLeader() {
    if (!selected || !world) return
    const order = { kind: 'handOver', residentId: world.home.leaderId, newLeaderId: selected.id }
    setOrderError(await sendOrder(order))
  }
  /** Orders the picked resident to attack a resident of another realm. */
  async function attack(targetId: string) {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'attack', residentId: selected.id, targetId }))
  }
  /** Orders the picked resident to climb over a wall or gate of another realm next to them. */
  async function climb(wallId: string) {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'climb', residentId: selected.id, wallId }))
  }
  const [nodeAt, setNodeAt] = useState<(x: number, y: number) => KnownNode | undefined>()
  const onNodesLoaded = useCallback(
    (lookup: (x: number, y: number) => KnownNode | undefined) => setNodeAt(() => lookup),
    [],
  )
  const onTile = <T extends { x: number; y: number }>(things: T[] | undefined) =>
    selected && things?.find((t) => t.x === selected.x && t.y === selected.y)
  // A road may share its tile with a building (`CONTEXT.md`: Road); a building is wherever its
  // footprint is (`CONTEXT.md`: At a building).
  const buildingHere =
    selected && world?.buildings.find((b) => b.kind !== 'road' && isAt(selected, b))
  const roadHere = onTile(world?.buildings.filter((b) => b.kind === 'road'))

  async function logout() {
    await api.logout().catch(() => {})
    onLoggedOut()
  }

  const leader = world?.residents.find((r) => r.id === world.home.leaderId)
  const drawer = (id: DrawerId, panel: ReactNode) => (
    <Drawer id={id} open={openDrawer} onClose={closeDrawer}>
      {panel}
    </Drawer>
  )

  return (
    <div className="game">
      <section className="game-map">
        {world ? (
          <MapView
            world={world}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              setSelectedTile(undefined)
              setPicking(false)
              setArmyPick(undefined)
              setOrderError(undefined)
            }}
            onSelectTile={(x, y) => {
              const size = world.map.size
              setSelectedTile({ x: ((x % size) + size) % size, y: ((y % size) + size) % size })
              setPicking(false)
              setArmyPick(undefined)
              setOrderError(undefined)
            }}
            selectedCityId={openCityId}
            onSelectCity={(id) => {
              setOpenCityId(id)
              setOpenDrawer('cities')
            }}
            picking={picking !== false || armyPick !== undefined}
            onPickTile={goTo}
            onNodesLoaded={onNodesLoaded}
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
            residents={own}
            leaderId={world.home.leaderId}
            tick={world.tick}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              setSelectedTile(undefined)
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
            residents={world.residents}
            buildings={world.buildings}
            realmId={world.home.realmId}
            realms={world.diplomacy.realmsInSight}
            carriages={world.carriages}
            tick={world.tick}
            mapSize={world.map.size}
            onSetGate={async (gateId, open) =>
              setOrderError(await sendOrder({ kind: 'setGate', gateId, open }))
            }
            onBuyCity={async (residentId, cityId) =>
              setOrderError(await sendOrder({ kind: 'buyCity', residentId, cityId }))
            }
            onTrade={async ({ side, ...trade }) =>
              setOrderError(await sendOrder({ kind: side, ...trade }))
            }
            onTransfer={async (transfer) =>
              setOrderError(await sendOrder({ kind: 'transfer', ...transfer }))
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
            onShowPlace={(p) => setFocus({ x: p.x, y: p.y })}
          />,
        )}
      {world && selectedTile && (
        <div className="game-selection">
          <TileCard
            card={describeTile(
              {
                ...selectedTile,
                buildings: world.buildings,
                carriages: world.carriages,
                piles: world.piles,
                node: nodeAt?.(selectedTile.x, selectedTile.y),
                strangers: world.residents.filter((r) => !own.includes(r)),
                cities: world.cities,
                viewer: {
                  realmId: world.home.realmId,
                  allies: new Set(world.diplomacy.alliance?.members.map((m) => m.realmId)),
                },
                workers: (b) => workersHere(world.residents, b),
              },
              GOOD_LABELS,
            )}
            building={world.buildings.find(
              (b) => b.kind !== 'road' && covers(b, selectedTile.x, selectedTile.y),
            )}
            nodeKind={nodeAt?.(selectedTile.x, selectedTile.y)?.kind}
            actor={selected}
            orderError={orderError}
            onClose={() => setSelectedTile(undefined)}
            onSendHere={async () => {
              if (!selected) return
              const order = { kind: 'walkTo', residentId: selected.id, ...selectedTile }
              setOrderError(await sendOrder(order))
            }}
            onSetGate={async (gateId, open) =>
              setOrderError(await sendOrder({ kind: 'setGate', gateId, open }))
            }
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
            carriage={onTile(world.carriages)}
            onDriveTo={() => setPicking((p) => (p === 'drive' ? false : 'drive'))}
            onRoadTo={() => setPicking((p) => (p === 'road' ? false : 'road'))}
            onHaulTo={(setup) => {
              setHaulSetup(setup)
              setPicking((p) => (p === 'haul' ? false : 'haul'))
            }}
            onStop={stop}
            scripts={scripts}
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
            node={nodeAt?.(selected.x, selected.y)}
            onPickUp={(spot, goods) => carry('pickUp', spot, goods)}
            onDrop={(spot, goods) => carry('drop', spot, goods)}
            onBuild={build}
            workers={workersHere(world.residents, buildingHere)}
            holders={heldBy(world.residents, buildingHere)}
            realmId={world.home.realmId}
            onWork={work}
            onTearDown={tearDown}
            residents={own}
            onPair={pair}
            others={world.residents.filter((r) => !own.includes(r))}
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
            onClose={() => {
              setSelectedId(undefined)
              setPicking(false)
            }}
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
function workersHere(residents: Resident[], building: Building | undefined): number {
  if (!building) return 0
  return residents.filter((r) => r.order?.kind === 'workAt' && r.order.buildingId === building.id)
    .length
}

/** The realms holding the building, as far as the Player sees its workers. */
function heldBy(residents: Resident[], building: Building | undefined): string[] {
  return building ? holdersOf({ residents }, building) : []
}
