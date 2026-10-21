import { useCallback, useEffect, useState } from 'react'
import {
  formatGameTime,
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
} from '@csp/shared'
import { AdminPage } from './AdminPanel.js'
import { AlliancePanel } from './Alliance.js'
import { commandsSeen } from './alliance-army.js'
import { ArmiesPanel, type ArmyPick } from './Armies.js'
import { ContractsPanel } from './Contracts.js'
import { StandingPanel } from './Standing.js'
import { api } from './api.js'
import { CityInspector } from './CityInspector.js'
import { Login } from './Login.js'
import { MapView } from './MapView.js'
import { pageFor } from './pages.js'
import { RealmLog } from './RealmLog.js'
import { realmEnded } from './realm-log.js'
import { ResidentInspector, ResidentsList, type HaulSetup, type Picking } from './Residents.js'
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
  // A place from the realm log to show on the map.
  const [focus, setFocus] = useState<{ x: number; y: number }>()

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
      const order = { kind: 'haul', residentId: selected.id, carriageId: carriage.id, x, y }
      setOrderError(await sendOrder({ ...order, ...haulSetup }))
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
  /** Orders the picked resident to build on their tile, or to join the site there. */
  async function build(building: BuildingKind) {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'build', residentId: selected.id, building }))
  }
  /** Orders the picked resident to work the workplace on their tile, making `makes` at a smithy. */
  async function work(makes?: Good) {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'workAt', residentId: selected.id, makes }))
  }
  /** Orders the picked resident to tear down the building or site on their tile. */
  async function tearDown(buildingId: string) {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'tearDown', residentId: selected.id, buildingId }))
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
  // A road may share its tile with a building (`CONTEXT.md`: Road).
  const buildingHere = onTile(world?.buildings.filter((b) => b.kind !== 'road'))
  const roadHere = onTile(world?.buildings.filter((b) => b.kind === 'road'))

  async function logout() {
    await api.logout().catch(() => {})
    onLoggedOut()
  }

  return (
    <div className="layout">
      <header>
        <h1>Code Strategy</h1>
        {world && (
          <span className="clock" title="1 game day = 1 real hour; 1 game year = 1 real day">
            {formatGameTime(world.tick)}
          </span>
        )}
        <span className={`status ${status}`}>
          {status === 'open' ? `tick ${world?.tick ?? '…'}` : status}
        </span>
        <span className="spacer" />
        <span>{account.name}</span>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </header>
      <main>
        <div className="play-column">
          <section className="map-panel">
            {world && realmEnded(world.events) && (
              <div className="realm-ended" role="alert">
                <p>
                  Your Leader has died and your realm has ended. The realm log says what became of
                  your cities. You start afresh with a new Leader and a new starting city.
                </p>
                <button type="button" onClick={() => window.location.reload()}>
                  Start afresh
                </button>
              </div>
            )}
            {world ? (
              <MapView
                world={world}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id)
                  setPicking(false)
                  setArmyPick(undefined)
                  setOrderError(undefined)
                }}
                picking={picking !== false || armyPick !== undefined}
                onPickTile={goTo}
                onNodesLoaded={onNodesLoaded}
                focus={focus}
              />
            ) : (
              <p>Waiting for the server…</p>
            )}
          </section>
          {world && (
            <ResidentsList
              residents={own}
              leaderId={world.home.leaderId}
              tick={world.tick}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
        <div className="side-column">
          {world && (
            <ResidentInspector
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
              orderError={orderError}
              pile={onTile(world.piles)}
              storage={onTile(
                world.buildings.filter((b) => KEEPS_GOODS.includes(b.kind) && !b.site),
              )}
              building={buildingHere}
              road={roadHere}
              node={selected && nodeAt?.(selected.x, selected.y)}
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
            />
          )}
          {world && (
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
            />
          )}
          {world && (
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
            />
          )}
          {world && (
            <AlliancePanel
              diplomacy={world.diplomacy}
              residents={world.residents}
              carriages={world.carriages}
              realmId={world.home.realmId}
              sendOrder={sendOrder}
            />
          )}
          {world && (
            <StandingPanel
              standings={world.diplomacy.standings}
              joinRequests={world.diplomacy.joinRequests}
              directives={world.diplomacy.directives}
              sendOrder={sendOrder}
            />
          )}
          {world && (
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
              directives={world.diplomacy.directives}
              onBuyOff={async (residentId, directiveId, carriageId) =>
                setOrderError(
                  await sendOrder({ kind: 'buyOff', residentId, directiveId, carriageId }),
                )
              }
            />
          )}
          {world && (
            <RealmLog
              events={world.events}
              realmId={world.home.realmId}
              deliveries={world.diplomacy.deliveries}
              onShowPlace={(p) => setFocus({ x: p.x, y: p.y })}
            />
          )}
          <ScriptLibrary onScripts={setScripts} />
        </div>
      </main>
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
