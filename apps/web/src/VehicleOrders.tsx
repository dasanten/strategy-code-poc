import { useState } from 'react'
import { ActionRows } from './SelectionCard.js'
import { HaulBlock, type HaulSetup } from './Residents.js'
import { GROUP_KEYS } from './group-orders.js'
import {
  PICKS_A_TILE,
  vehicleOrder,
  type OrderedVehicle,
  type VehicleGroupOrder,
  type VehicleOrderId,
  type VehicleOrderRow,
} from './vehicle-orders.js'
import type { CardAction } from './selection-view.js'

/** Each row's key, as the group card's same order has it; a ship's crew on C. */
const KEYS: Record<VehicleOrderId, string> = {
  haul: GROUP_KEYS.haul,
  drive: GROUP_KEYS.drive,
  board: GROUP_KEYS.board,
  row: GROUP_KEYS.row,
  boardBoat: GROUP_KEYS.board,
  boardCrew: 'C',
}

/**
 * The realm orders on the card of a carriage or vessel of the realm in realm control mode
 * (`CONTEXT.md`: Realm order): Haul with this carriage, Drive this to and Board; a boat's Row
 * this to and Board; a docked ship's Board and Board as crew (`vehicleOrderRows`). Haul opens
 * the route form first, then, as Drive and Row do, waits for the tile on the map (`onPick`);
 * Board goes straight to the who-list (`onOrder`).
 */
export function VehicleOrders({
  vehicle,
  rows,
  picking,
  onPick,
  onOrder,
}: {
  vehicle: OrderedVehicle
  rows: readonly VehicleOrderRow[]
  /** The order waiting for its tile on the map, if one is. */
  picking: VehicleOrderId | undefined
  /** Pick the tile to drive, row or haul to; a haul's route goods with it. */
  onPick: (id: 'haul' | 'drive' | 'row', haul?: HaulSetup) => void
  onOrder: (order: VehicleGroupOrder) => void
}) {
  const [open, setOpen] = useState<VehicleOrderId>()
  const actions: CardAction<VehicleOrderId>[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    key: KEYS[r.id],
    ...(r.id === 'haul' ? { opens: true as const } : {}),
    ...(picking === r.id && r.id !== 'haul' ? { active: true as const } : {}),
    ...(r.reason ? { disabled: true as const, reason: r.reason } : {}),
    // A note shows under the label as a reason does, the row staying on.
    ...(r.note && !r.reason ? { reason: r.note } : {}),
  }))
  const act = (a: CardAction<VehicleOrderId>) => {
    if (a.opens) return setOpen(open === a.id ? undefined : a.id)
    if (a.id === 'drive' || a.id === 'row') return onPick(a.id)
    if (PICKS_A_TILE.includes(a.id)) return
    const order = vehicleOrder(a.id, vehicle)
    if (order) onOrder(order)
  }
  if (actions.length === 0) return null
  return (
    <section className="inspector-block realm-orders" aria-label="Realm orders">
      <div className="panel-head">
        <h3>Orders</h3>
        <span className="small muted">then who does it</span>
      </div>
      <ActionRows
        actions={actions}
        open={open}
        onAction={act}
        label="Realm orders"
        panel={
          open === 'haul' && (
            <HaulBlock
              adult
              onRoute={false}
              picking={picking === 'haul'}
              onHaulTo={(setup) => onPick('haul', setup)}
            />
          )
        }
      />
    </section>
  )
}
