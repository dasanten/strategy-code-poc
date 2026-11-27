import { type ControlMode } from '../realm/control-mode.js'
import type { Account } from '@csp/shared-types'
import { api } from '../world/api.js'
import { clearTerrainCache } from '../map/terrain-cache.js'
import { toggleTab } from './hud-view.js'
import { PhoneMenu, RealmBar, TopBar } from './Hud.js'

import type { ClientWorld } from '../world/useWorld.js'
import { useFirstDay, type Notices } from './useNotices.js'
import { useTopBarGoods } from './useTopBarGoods.js'
import { leadership, type Live, type RealmOrderState, type SidebarTabs } from './game-wiring.js'

interface GameHudProps {
  world: ClientWorld | null
  account: Account
  status: Live['status']
  phone: boolean
  /** The goods in the top bar (`useTopBarGoods`). */
  goods: ReturnType<typeof useTopBarGoods>
  tabs: SidebarTabs
  /** The marks on the sidebar's strip (`useNotices`). */
  marks: Notices['marks']
  controlMode: ControlMode
  /** Switches the control mode, dropping what only unit control mode commands (`Game`). */
  switchControlMode: (mode: ControlMode) => void
  realm: RealmOrderState
  reportFirstDay: ReturnType<typeof useFirstDay>['reportFirstDay']
  onLoggedOut: () => void
}

/** The top bar, the realm bar in realm control mode, and on a phone the menu the HUD folds into. */
export function GameHud(props: GameHudProps) {
  const { world, account, status, phone, goods, marks, controlMode, switchControlMode } = props
  const { realm, reportFirstDay, onLoggedOut } = props
  const { openTab, setOpenTab } = props.tabs
  const { realmBarOpen } = realm
  const { leader, heirShown } = leadership(world)
  const homeCity = world?.cities.find((c) => c.id === world.home.cityId)
  const pickHeir = () => setOpenTab('residents')
  async function logout() {
    await api.logout().catch(() => {})
    // The explored terrain this browser kept is the Player's alone (ADR 0034).
    await clearTerrainCache()
    onLoggedOut()
  }
  return (
    <>
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
    </>
  )
}
