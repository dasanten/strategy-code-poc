import type { Building, OrderRequest, WorldState } from '@csp/shared'
import type { OrderKind, OrderSender } from './orders.js'
import { realmOf } from './starting-city.js'

/** The input of a gate order: which gate, and whether it should stand open. */
interface SetGateRequest extends OrderRequest {
  kind: 'setGate'
  gateId: string
  open: boolean
}

/** The finished gate `gateId` of one of the sender's cities, or why there is none. */
function ownGate(world: WorldState, sender: OrderSender, gateId: unknown): Building | string {
  const realm = realmOf(world, sender.userId)
  const gate = world.buildings.find((b) => b.id === gateId)
  if (!gate || gate.kind !== 'gate') return 'no such gate'
  if (gate.site) return 'that gate is not finished yet'
  const city = world.cities.find((c) => c.id === gate.cityId)
  if (!realm || !city || city.realmId !== realm.id) return 'not a gate of your cities'
  return gate
}

/**
 * The gate order (`CONTEXT.md`: Walls in combat): the city's realm opens or closes one of its
 * gates. A realm's decision, like an alliance's, it takes effect at the start of the next tick.
 */
export const setGate: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<SetGateRequest>
    if (typeof o.open !== 'boolean') return 'say whether the gate should be open'
    const gate = ownGate(world, sender, o.gateId)
    return typeof gate === 'string' ? gate : undefined
  },
  apply(world, sender, order) {
    const { gateId, open } = order as SetGateRequest
    const gate = ownGate(world, sender, gateId)
    if (typeof gate === 'string') return
    if (open) delete gate.closed
    else gate.closed = true
  },
}
