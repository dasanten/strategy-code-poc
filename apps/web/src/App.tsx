import { useCallback, useEffect, useState } from 'react'
import { checkScript, type Diagnostic } from '@csp/lang'
import {
  formatGameTime,
  holdersOf,
  KEEPS_GOODS,
  type Account,
  type Building,
  type BuildingKind,
  type Good,
  type GoodsSpot,
  type KnownNode,
  type Resident,
  type Stock,
} from '@csp/shared'
import { AdminPage } from './AdminPanel.js'
import { AlliancePanel } from './Alliance.js'
import { api } from './api.js'
import { CityInspector } from './CityInspector.js'
import { Login } from './Login.js'
import { MapView } from './MapView.js'
import { pageFor } from './pages.js'
import { RealmLog } from './RealmLog.js'
import { ResidentInspector, ResidentsList, type HaulSetup, type Picking } from './Residents.js'
import { ScriptEditor } from './ScriptEditor.js'
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
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [picking, setPicking] = useState<Picking>(false)
  const [haulSetup, setHaulSetup] = useState<HaulSetup>()
  const [orderError, setOrderError] = useState<string | undefined>()
  const own = world ? world.residents.filter((r) => r.owner === world.home.realmId) : []
  const selected = own.find((r) => r.id === selectedId)
  const homeCity = world?.cities.find((c) => c.id === world.home.cityId)

  /**
   * Orders the picked resident to walk to a tile, or, while picking where to drive, to drive the
   * carriage on their tile there, or, while picking a haul route's other stop, to haul between
   * their tile and that one (ADR 0002: the server checks it).
   */
  async function goTo(x: number, y: number) {
    const mode = picking
    setPicking(false)
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
  async function stop() {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'stop', residentId: selected.id }))
  }
  /** Orders the picked resident to pair with another resident of their city. */
  async function pair(partnerId: string) {
    if (!selected) return
    setOrderError(await sendOrder({ kind: 'pair', residentId: selected.id, partnerId }))
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
            {world ? (
              <MapView
                world={world}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id)
                  setPicking(false)
                  setOrderError(undefined)
                }}
                picking={picking !== false}
                onPickTile={goTo}
                onNodesLoaded={onNodesLoaded}
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
              onHaulTo={(setup) => {
                setHaulSetup(setup)
                setPicking((p) => (p === 'haul' ? false : 'haul'))
              }}
              onStop={stop}
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
            />
          )}
          {world && (
            <AlliancePanel
              diplomacy={world.diplomacy}
              realmId={world.home.realmId}
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
            />
          )}
          {world && <RealmLog events={world.events} realmId={world.home.realmId} />}
          <section className="editor-panel">
            <h2>Resident script</h2>
            <ScriptEditor onChange={(src) => setDiagnostics(checkScript(src))} />
            <p className="diagnostics">
              {diagnostics.length === 0
                ? 'No syntax errors.'
                : diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n')}
            </p>
          </section>
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
