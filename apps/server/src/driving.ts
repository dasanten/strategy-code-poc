import {
  carriageCanEnter,
  commandsCarriage,
  commands,
  driveProblem,
  terrainAt,
  type OrderRequest,
} from '@csp/shared'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'

/** The input of a drive order: which resident drives which carriage, and the tile to go to. */
interface DriveRequest extends OrderRequest {
  kind: 'drive'
  residentId: string
  carriageId: string
  x: number
  y: number
}

/**
 * The drive order (`CONTEXT.md`: Carriage): one of the Player's adult residents drives one of
 * the Player's carriages from the tile they share to another tile, pulled by its horse. Like
 * walking, it only sets the order; the path, which keeps out of mountains, is found and the
 * carriage driven along it in later ticks (`Walking`).
 */
export const drive: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<DriveRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    const carriage = world.carriages.find((k) => k.id === o.carriageId)
    if (!commandsCarriage(world, realm.id, carriage)) return 'not one of your carriages'
    if (!Number.isInteger(o.x) || !Number.isInteger(o.y)) return 'the target must be a tile'
    if (terrain && !carriageCanEnter(terrainAt(terrain, o.x!, o.y!))) {
      return 'a carriage can’t go there'
    }
    return driveProblem(world, r, carriage)
  },
  apply(world, _sender, order) {
    const { residentId, carriageId, x, y } = order as DriveRequest
    const r = world.residents.find((x) => x.id === residentId)
    const carriage = world.carriages.find((k) => k.id === carriageId)
    // Two drivers ordered onto one carriage in the same tick: the first one drives it.
    if (!r || !carriage || driveProblem(world, r, carriage)) return
    r.order = { kind: 'drive', carriageId, target: { x, y }, path: null, progress: 0 }
  },
}
