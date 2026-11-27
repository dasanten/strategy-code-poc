import { type ReactNode } from 'react'
import type { Resident } from '@csp/shared-types'
import { ArmiesPanel } from '../army/Armies.js'
import { WaypointsPanel } from '../realm/Waypoints.js'
import { foldOrUnfold, toggleTab, type SideTabId } from './hud-view.js'
import { SideTab, Sidebar } from './Sidebar.js'
import { ResidentsFullList } from '../residents/ResidentsFullList.js'
import { groupResidents } from '../residents/residents-view.js'
import { groupHorses } from '../transport/horses-view.js'
import { HorsesList } from '../transport/Horses.js'
import { RealmLog } from '../realm/RealmLog.js'
import { ResidentsList } from '../residents/Residents.js'

import type { ClientWorld } from '../world/useWorld.js'
import { type ResidentOrders } from '../residents/useResidentOrders.js'
import { type Notices } from './useNotices.js'
import { useMapFocus } from '../map/useMapFocus.js'
import {
  leadership,
  type GameSeen,
  type Live,
  type Picker,
  type SelectionState,
  type Ground,
  type OpenCity,
  type ResidentPanels,
  type SidebarTabs,
} from './game-wiring.js'
import { DiplomacyTab } from '../diplomacy/DiplomacyTab.js'
import { CitiesTab } from '../city/CitiesTab.js'

interface GameSidebarProps {
  /** What the Player sees, once the world came. */
  seen: GameSeen | null
  phone: boolean
  tabs: SidebarTabs
  /** The marks on the strip and the Diplomacy tabs (`useNotices`). */
  marks: Notices['marks']
  panels: ResidentPanels
  selection: SelectionState
  /** The one resident picked. */
  selected: Resident | undefined
  /** Picks residents: one shows their card, several a group card (`Game`). */
  select: (ids: string[]) => void
  /** The army whose card is open. */
  openArmy: ClientWorld['armies'][number] | undefined
  picker: Picker
  orders: ResidentOrders
  sendOrder: Live['sendOrder']
  ground: Ground
  city: OpenCity
  mapFocus: ReturnType<typeof useMapFocus>
}

/** The sidebar and its tabs (ADR 0044: one open at a time). */
export function GameSidebar(props: GameSidebarProps) {
  const { seen, phone, marks, selected, select, openArmy, picker, sendOrder } = props
  const world = seen?.world ?? null
  const own = seen?.own ?? []
  const scripts = seen?.scripts ?? []
  const knownCities = seen?.knownCities ?? []
  const { openTab, setOpenTab, setSidebar, foldSidebar } = props.tabs
  const { fullList, setResidentsFull } = props.panels
  const { selectedTile, pickedHorseId, setPickedHorseId, setSelectedIds, setSelectedTile } =
    props.selection
  const { setOpenArmyId } = props.selection
  const { setArmyError } = props.orders
  const { arrivesIn } = props.ground
  const { showOnMap } = props.mapFocus
  const pick = picker.target
  const cancelPick = picker.cancel
  const { heirId } = leadership(world)
  const sideTab = (id: SideTabId, panel: ReactNode) => <SideTab id={id}>{panel}</SideTab>
  const residentsPanel = world && {
    groups: residentGroups(world, own),
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
  return (
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
          seen && (
            <DiplomacyTab
              seen={seen}
              tabs={props.tabs}
              marks={marks}
              sendOrder={sendOrder}
              giveOrder={props.orders.giveOrder}
              arrivesIn={arrivesIn}
              showOnMap={showOnMap}
            />
          ),
        )}
      {world &&
        sideTab(
          'cities',
          seen && (
            <CitiesTab
              seen={seen}
              city={props.city}
              orders={props.orders}
              sendOrder={sendOrder}
              arrivesIn={arrivesIn}
              show={props.mapFocus.show}
            />
          ),
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
  )
}

/** The Residents tab's groups (`groupResidents`), which a realm order's who-list ticks by too. */
export function residentGroups(world: ClientWorld, own: Resident[]) {
  return groupResidents(own, {
    cities: world.cities,
    realmId: world.home.realmId,
    homeCityId: world.home.cityId,
    leaderId: world.home.leaderId,
    diplomacy: world.diplomacy,
  })
}
