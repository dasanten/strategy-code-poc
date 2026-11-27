import { SHARES_A_TILE, takesWorkSettings } from '../building/building.js'
import type { Account, Building, Resident } from '@csp/shared-types'
import { NODE_WORKPLACE } from '@csp/shared-types'
import { nodeCorner } from '../world/world-rules.js'
import { showsCreativeBar } from '../creative/creative-bar.js'
import { CreativeSection } from '../creative/CreativeSection.js'
import { creativeCities, creativeOffer, offersAnything } from '../creative/creative-section.js'
import { CreativeAddSection, CreativeResidentActions } from '../creative/CreativeResidents.js'
import { cityIdsAtTile } from '@csp/lang-wasm'
import { isAt, covers } from '../building/footprint.js'
import { BUILDING_NAMES } from '../map/palette.js'
import { BuildingOrders } from '../building/BuildingOrders.js'
import { buildingOrderRows } from '../building/building-orders.js'
import { VehicleOrders } from '../transport/VehicleOrders.js'
import { NO_STAND, vehicleOrderRows } from '../transport/vehicle-orders.js'
import { GOOD_LABELS } from '../residents/Residents.js'
import { CardSheet, TileCard } from './SelectionCard.js'
import { storePlaceAt } from '../realm/realm-orders-view.js'
import { RealmTileOrders } from '../realm/RealmOrders.js'
import { buildingNodeKind } from '../building/building-info-view.js'
import { describeTile } from './selection-view.js'
import { WorkSettings } from '../building/WorkSettings.js'
import { paramValueLabel } from '../script/script-params-view.js'
import { useLand } from '../world/useLand.js'
import { regionAt } from '../map/land.js'
import { paramWorld } from '../world/seen-world.js'

import { type ResidentOrders } from '../residents/useResidentOrders.js'
import { workersHere, type WhatsHere } from '../residents/whats-here.js'
import {
  type GameSeen,
  type Sheet,
  type Live,
  type Picker,
  type SelectionState,
  type Ground,
  type RealmOrderState,
  type OpenCity,
  type SidebarTabs,
} from './game-wiring.js'

interface TileCardSheetProps {
  seen: GameSeen
  account: Account
  /** The tile picked (`Selection`). */
  tile: { x: number; y: number }
  land: ReturnType<typeof useLand>
  sheet: Sheet
  selection: SelectionState
  /** The one resident picked, who stays picked to be sent to the tile. */
  selected: Resident | undefined
  /** Picks residents: one shows their card, several a group card (`Game`). */
  select: (ids: string[]) => void
  picker: Picker
  ground: Ground
  orders: ResidentOrders
  realm: RealmOrderState
  /** The carriages the Player's alliance army commands (`whatsHere`). */
  armyCarriages: WhatsHere['armyCarriages']
  city: OpenCity
  setOpenTab: SidebarTabs['setOpenTab']
  sendOrder: Live['sendOrder']
}

/**
 * The tile card of a tile picked on the map (`CONTEXT.md`: Tile card), in its sheet: what is on
 * the tile, the orders about it, its Work settings, and in realm control mode the realm orders.
 */
export function TileCardSheet(props: TileCardSheetProps) {
  const { world, own, realms, scripts, knownCities, knownBuildings } = props.seen
  const { account, land, selected, select, picker, armyCarriages, setOpenTab, sendOrder } = props
  const selectedTile = props.tile
  const { phone, dock, hidden: hideCard } = props.sheet
  const { controlMode, setSelectedTile, setPickedHorseId } = props.selection
  const { nodeAt, terrainAt, arrivesIn, knownGround } = props.ground
  const { giveOrder, orderError, setOrderError, setWorkSettings } = props.orders
  const { unhitch, boardCarriage, feed, repair, rallyBy } = props.orders
  const { realmOrder, setRealmOrder, realmWalkTo, realmWho } = props.realm
  const { startAbout, startVehicle, vehicleStand, tileVehicle } = props.realm
  const { setOpenCityId, setTradeAt } = props.city
  // The building the tile card is about: in sight, or as last seen.
  const tileBuilding = [...world.buildings, ...world.lastSeen.buildings].find(
    (b) => !SHARES_A_TILE.includes(b.kind) && covers(b, selectedTile.x, selectedTile.y),
  )
  /** The realm's horses standing in a building, to breed (`CONTEXT.md`: Breeding). */
  const realmHorsesIn = (b: Building) =>
    world.horses.filter((h) => h.realmId === world.home.realmId && isAt(h, b, world.map.size))
  return (
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
              onScript={(scriptId) => void setWorkSettings(tileBuilding.id, undefined, scriptId)}
              onPick={(param) => picker.work.toggle(tileBuilding.id, param)}
              onNumber={(name, value) => void setWorkSettings(tileBuilding.id, { [name]: value })}
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
  )
}
