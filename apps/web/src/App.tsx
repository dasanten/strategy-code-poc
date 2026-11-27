import { useCallback, useEffect, useState } from 'react'
import { type ControlMode } from './realm/control-mode.js'
import type { Account } from '@csp/shared-types'
import { AdminPage } from './admin/AdminPanel.js'
import { TileMenu } from './realm/Waypoints.js'
import { api } from './world/api.js'
import { cardHidden } from './screen/notices-view.js'
import { Founding } from './realm/Founding.js'
import { useShiftHeld } from './queue/queue-view.js'
import { useSavedGroups } from './residents/saved-groups.js'
import { Login } from './screen/Login.js'
import { isKitPath, isWikiPath, pageFor } from './screen/pages.js'
import { Wiki } from './wiki/Wiki.js'
import { Kit } from './ui/Kit.js'
import { Dock } from './screen/Dock.js'
import { barBesideTile } from './screen/dock-view.js'
import { useMediaQuery } from './pick/pick-mode.js'
import { usePick } from './pick/usePick.js'
import { PHONE_QUERY } from './screen/sheet-view.js'
import { knownOf } from './residents/relocate-view.js'
import { ScriptLibrary } from './script/ScriptLibrary.js'
import { CustomiseContext } from './script/Customise.js'
import { useWorld } from './world/useWorld.js'
import { useLand } from './world/useLand.js'
import {
  useControlModeKey,
  useEscapeOrder,
  useModeAfterPick,
  useSelection,
} from './screen/useSelection.js'
import { useScriptWorkshop } from './script/useScriptWorkshop.js'
import { paramWorld, planWorld, previewWorld } from './world/seen-world.js'
import { useKnownGround } from './map/useKnownGround.js'
import { useCustomiseLapse, useStartForm } from './script/useStartForm.js'
import { useRealmOrder } from './realm/useRealmOrder.js'
import { RealmOrderCards } from './realm/RealmOrderCards.js'
import { usePlanning } from './queue/usePlanning.js'
import { useResidentPanels } from './residents/useResidentPanels.js'
import { useOpenCity } from './city/useOpenCity.js'
import { useResidentOrders } from './residents/useResidentOrders.js'
import { useGroupOrders } from './residents/useGroupOrders.js'
import { whatsHere } from './residents/whats-here.js'
import { useNotices, useFirstDay } from './screen/useNotices.js'
import { useTopBarGoods } from './screen/useTopBarGoods.js'
import { useMapFocus } from './map/useMapFocus.js'
import { useSidebarTabs } from './screen/useSidebarTabs.js'
import { ownResidents, realmsKnown } from './screen/game-wiring.js'
import { GameMap } from './map/GameMap.js'
import { GameHud } from './screen/GameHud.js'
import { GameSidebar, residentGroups } from './screen/GameSidebar.js'
import { GameNotices } from './screen/GameNotices.js'
import { GameDialogs } from './screen/GameDialogs.js'
import { TileCardSheet } from './screen/TileCardSheet.js'
import { ResidentCardSheet } from './residents/ResidentCardSheet.js'
import { GroupCardSheet } from './residents/GroupCardSheet.js'
import { ArmyCardSheet } from './army/ArmyCardSheet.js'
import { StartFormSheet } from './script/StartFormSheet.js'

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

/**
 * The game screen: wires the hooks of each part of the screen together and lays the screen out.
 * Each part keeps its own state (`useSelection`, `usePick`, `useResidentOrders`, …) and gets what
 * it needs of the others here.
 */
function Game({ account, onLoggedOut }: { account: Account; onLoggedOut: () => void }) {
  const live = useWorld(onLoggedOut)
  const { world, founding, status, sendOrder } = live
  // The land the Player knows: regions, passes and land bridges (`CONTEXT.md`: Region).
  const land = useLand(world?.map, world?.grownChunks)
  const selection = useSelection()
  const { selectedIds, setSelectedIds, selectedTile, setSelectedTile } = selection
  const { openArmyId, setOpenArmyId, controlMode, setControlMode } = selection
  const tabs = useSidebarTabs()
  const { openTab, setOpenTab } = tabs
  const own = ownResidents(world)
  const group = selectedIds.flatMap((id) => own.filter((r) => r.id === id))
  const selected = group.length === 1 ? group[0] : undefined
  const { runs, memories, watchScript } = live
  const workshop = useScriptWorkshop({ world, runs, memories, watchScript }, setOpenTab)
  const { scripts } = workshop
  const knownCities = world ? knownOf(world.cities, world.lastSeen.cities) : []
  const knownBuildings = world ? knownOf(world.buildings, world.lastSeen.buildings) : []
  const ground = useKnownGround(world, knownBuildings)
  const form = useStartForm(world, scripts)
  const { starting, setStarting, opensForm, customising } = form
  const shift = useShiftHeld()
  const here = whatsHere(world, selected)
  const { buildingHere } = here
  const orders = useResidentOrders({
    world,
    own,
    selected,
    buildingHere,
    sendOrder,
    opensForm,
    customising,
    shift,
  })
  const onBuilt = () => picker.group.built()
  const groupOrders = useGroupOrders({ world, group, ground, sendOrder, opensForm, shift, onBuilt })
  const { groupSeen, sendGroup, sendToGroup } = groupOrders
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
    sendOrder,
    sendGroup,
    sendToGroup,
    picker: {
      get wallMaterial() {
        return picker.wallMaterial
      },
      work: { clear: () => picker.work.clear() },
    },
  })
  const picker = usePick({
    world,
    group,
    own,
    formPick: starting?.picking,
    realm: realm.realmPick,
    actions: {
      giveOrder: (order, queued) => orders.giveOrder(order, queued),
      sendOrder,
      sendGroup: (order) => sendGroup(order),
      creativeMove: orders.creativeMove,
      setScriptParam: orders.setScriptParam,
      setWorkSettings: (buildingId, params) => orders.setWorkSettings(buildingId, params),
      addPlanned: (planned) => planning.addPlanned(planned),
      formTile: form.formTile,
      paramSeen: paramWorld,
      planSeen: (w) => planWorld(w, ground.terrainAt),
      here: () => ({
        ownCarriage: here.ownCarriageHere,
        boatToRow: here.boatToRow,
        boatToSteal: here.boatToSteal,
        stealable: here.stealableHere,
        unhorsed: here.unhorsedHere,
        horseToHitch: here.horseToHitch,
      }),
      tileMenu: (x, y, at) => {
        setSelectedTile(undefined)
        selection.setTileMenu({ x, y, at })
      },
      cancelled: () => {
        form.pickCancelled()
        realm.pickCancelled()
      },
      orderError: orders.setOrderError,
      armyError: orders.setArmyError,
      groupError: groupOrders.setGroupError,
      groupReportCleared: () => groupOrders.setGroupReport(undefined),
    },
  })
  const cancelPick = picker.cancel
  useCustomiseLapse(customising, picker.ordering || realm.realmOrder !== undefined)
  const planning = usePlanning({
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
    setOrderError: orders.setOrderError,
  })
  const panels = useResidentPanels(openTab)
  const mapFocus = useMapFocus(tabs.foldSidebar)
  const { showOnMap } = mapFocus
  const notices = useNotices(world, tabs.sidebar)
  const firstDay = useFirstDay(world, live.setFirstDay, selectedIds)
  const goods = useTopBarGoods(world, knownCities)
  const city = useOpenCity()
  const phone = useMediaQuery(PHONE_QUERY)
  // The dock on the right (`Dock`) once it is mounted; none on a phone.
  const [dock, setDock] = useState<HTMLElement | null>(null)
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
  const openArmy = world?.armies.find((a) => a.id === openArmyId)
  useModeAfterPick(selection, picker.army.pick !== undefined || openArmy !== undefined)
  const hideCard = cardHidden(openTab, panels.fullList)
  // The command bar beside an open tile card: both on a desktop, the tile card's keys winning.
  const besideTile = barBesideTile(phone, selectedTile !== undefined)
  useEscapeOrder(
    {
      picked: picker.target !== undefined,
      formOpen: starting !== undefined,
      shownCard: !hideCard,
      tileOpen: selectedTile !== undefined,
      anySelected: selectedIds.length > 0,
      realmCard: realm.realmCard,
      armyOpen: openArmy !== undefined,
    },
    {
      pick: cancelPick,
      form: () => setStarting(undefined),
      tile: () => setSelectedTile(undefined),
      cards: () => {
        setSelectedIds([])
        picker.resident.stop()
        realm.setRealmOrder(undefined)
        setOpenArmyId(undefined)
      },
    },
  )
  /** Picks residents on the map: one shows their card, several a group card. */
  const select = (ids: string[]) => {
    setSelectedIds(ids)
    setSelectedTile(undefined)
    picker.dropAll()
    planning.setGroupPlan(undefined)
    setStarting(undefined)
    orders.setOrderError(undefined)
    groupOrders.setGroupReport(undefined)
    groupOrders.setGroupError(undefined)
  }
  // Ctrl+1–9 saves the picked residents as a group, 1–9 picks it again (`CONTEXT.md`: Group).
  useSavedGroups(
    world?.home.realmId,
    group.map((r) => r.id),
    own,
    select,
    showOnMap,
  )
  // What the pick waiting for a tile would do under the pointer, or at the tile tapped on a touch
  // screen (`CONTEXT.md`: Picking a target).
  const preview = picker.preview(
    () => previewWorld(world!, ground, knownCities, realm.realmOrder),
    ground.arrivesIn || undefined,
    here.isStrangers,
  )

  // A Player without a realm names it before the world shows (`CONTEXT.md`: Realm name).
  if (founding && !world && status !== 'updated')
    return <Founding leaderName={founding.leaderName} onFound={live.found} />

  const seen = world && {
    world,
    own,
    realms: realmsKnown(world),
    knownCities,
    knownBuildings,
    scripts,
    phone,
  }
  const sheet = { phone, dock, hidden: hideCard }
  const cards = seen && besideTile.shows ? seen : null
  const { tileMenu } = selection
  return (
    <CustomiseContext.Provider value={form.customise}>
      <div className={phone ? 'game phone' : 'game'}>
        <GameMap
          {...{ world, account, selection, group, select, picker, preview, ground, land, city }}
          focus={mapFocus.focus}
          setOpenTab={setOpenTab}
          setOrderError={orders.setOrderError}
          setRealmOrder={realm.setRealmOrder}
        />
        <GameHud
          {...{ world, account, status, phone, goods, tabs, controlMode, switchControlMode, realm }}
          marks={notices.marks}
          reportFirstDay={firstDay.reportFirstDay}
          onLoggedOut={onLoggedOut}
        />
        <GameSidebar
          {...{ seen, phone, tabs, panels, selection, selected, select, openArmy, picker, orders }}
          {...{ sendOrder, ground, city, mapFocus }}
          marks={notices.marks}
        />
        {/* The script workshop, a screen over the map that the Scripts tab opens (ADR 0044).
            Mounted before the world arrives too, and while closed: it loads the scripts the
            inspector can run. */}
        <ScriptLibrary
          open={openTab === 'scripts'}
          onClose={tabs.foldSidebar}
          onScripts={workshop.setScripts}
          toOpen={workshop.scriptToOpen}
        />
        <GameNotices
          {...{ world, account, phone, picker, preview, tabs, notices, firstDay, groupOrders }}
          {...{ city, sendOrder, showOnMap }}
        />
        {world && tileMenu && (
          <TileMenu
            at={tileMenu.at}
            tile={tileMenu}
            held={world.waypoints}
            size={world.map.size}
            onAdd={(name) => sendOrder({ kind: 'addWaypoint', x: tileMenu.x, y: tileMenu.y, name })}
            onClose={selection.closeTileMenu}
          />
        )}
        {!phone && <Dock onMount={setDock} />}
        {seen && selectedTile && (
          <TileCardSheet
            {...{ seen, account, land, sheet, selection, selected, select, picker, ground }}
            {...{ orders, realm, city, setOpenTab, sendOrder }}
            tile={selectedTile}
            armyCarriages={here.armyCarriages}
          />
        )}
        {cards && selected && (
          <ResidentCardSheet
            {...{ account, selected, besideTile, sheet, setSelectedIds, picker, ground, here }}
            {...{ orders, planning, workshop, panels, live }}
            seen={cards}
          />
        )}
        {cards && group.length > 1 && (
          <GroupCardSheet
            {...{ account, group, selectedIds, select, besideTile, sheet, picker, groupOrders }}
            {...{ planning, customising, shift }}
            seen={cards}
            arrivesIn={ground.arrivesIn}
          />
        )}
        {cards && openArmy && (
          <ArmyCardSheet
            {...{ openArmy, besideTile, sheet, picker, orders, sendOrder, setOpenArmyId }}
            seen={cards}
            scriptDebug={workshop.scriptDebug}
          />
        )}
        {seen && (
          <RealmOrderCards
            {...{ realm, world: seen.world, own, scripts, knownCities, knownBuildings, ground }}
            groups={residentGroups(seen.world, own)}
            tileOpen={selectedTile !== undefined}
            formOpen={starting !== undefined}
            sheet={sheet}
          />
        )}
        {world && starting && <StartFormSheet {...{ world, starting, setStarting, picker }} />}
        <GameDialogs world={world} status={status} notices={notices} showOnMap={showOnMap} />
      </div>
    </CustomiseContext.Provider>
  )
}
