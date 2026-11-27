import { useMemo } from 'react'
import type { Account, Resident } from '@csp/shared-types'
import { MapView } from '../screen/MapView.js'
import { isNewRealm } from './legend.js'
import { useLand } from '../world/useLand.js'
import { landMarks } from './land.js'
import { Icon } from '../ui/Icon.js'

import type { ClientWorld } from '../world/useWorld.js'
import { type ResidentOrders } from '../residents/useResidentOrders.js'
import { useMapFocus } from './useMapFocus.js'
import {
  type Picker,
  type SelectionState,
  type Ground,
  type RealmOrderState,
  type OpenCity,
  type SidebarTabs,
} from '../screen/game-wiring.js'

interface GameMapProps {
  world: ClientWorld | null
  account: Account
  selection: SelectionState
  /** The residents picked. */
  group: Resident[]
  /** Picks residents: one shows their card, several a group card (`Game`). */
  select: (ids: string[]) => void
  picker: Picker
  /** What the pick waiting for a tile would do under the pointer (`usePick`). */
  preview: ReturnType<Picker['preview']>
  ground: Ground
  focus: ReturnType<typeof useMapFocus>['focus']
  /** The land the Player knows: regions, passes and land bridges (`CONTEXT.md`: Region). */
  land: ReturnType<typeof useLand>
  city: OpenCity
  setOpenTab: SidebarTabs['setOpenTab']
  setOrderError: ResidentOrders['setOrderError']
  setRealmOrder: RealmOrderState['setRealmOrder']
}

/** The map, or a wait for the server before the world comes, with what a click on it does. */
export function GameMap(props: GameMapProps) {
  const { world, account, group, select, picker, preview, focus, land, setOpenTab } = props
  const { selectedIds, setSelectedIds, setSelectedTile, controlMode } = props.selection
  const { onNodesLoaded, onTerrainLoaded } = props.ground
  const { openCityId, setOpenCityId } = props.city
  const { setOrderError, setRealmOrder } = props
  const landShown = useMemo(
    () => (land ? { labels: land.labels, marks: landMarks(land) } : undefined),
    [land],
  )
  return (
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
  )
}
