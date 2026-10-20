import {
  carriageCanEnter,
  driveProblem,
  terrainAt,
  type Army,
  type OrderRequest,
  type WorldState,
} from '@csp/shared'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'

/**
 * The input of a drive order: which resident drives which carriage, and the tile to go to, or
 * with `armyId` the army to follow as its supply wagon.
 */
interface DriveRequest extends OrderRequest {
  kind: 'drive'
  residentId: string
  carriageId: string
  x?: number
  y?: number
  armyId?: string
}

/** The realm's army a carriage goes after, or why it can't (`CONTEXT.md`: Supply line). */
export function armyToSupply(world: WorldState, realmId: string, armyId: unknown): Army | string {
  const army = world.armies.find((a) => a.id === armyId)
  return army && army.realmId === realmId ? army : 'not one of your armies'
}

/** Where an army stands to start with: its first member's tile (`Walking` keeps it up to date). */
export function armyStart(world: WorldState, army: Army): { x: number; y: number } {
  const first = world.residents.find((r) => r.id === army.memberIds[0])
  return { x: first?.x ?? 0, y: first?.y ?? 0 }
}

/**
 * The drive order (`CONTEXT.md`: Carriage): one of the Player's adult residents drives one of
 * the Player's carriages from the tile they share to another tile, pulled by its horse. Like
 * walking, it only sets the order; the path, which keeps out of mountains, is found and the
 * carriage driven along it in later ticks (`Walking`). With an army of the Player's instead of a
 * tile, the carriage follows that army as its supply wagon for as long as it exists
 * (`CONTEXT.md`: Supply line).
 */
export const drive: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<DriveRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!r || !realm || r.owner !== realm.id) return 'not one of your residents'
    const carriage = world.carriages.find((k) => k.id === o.carriageId)
    if (!carriage || carriage.realmId !== realm.id) return 'not one of your carriages'
    if (o.armyId !== undefined) {
      const army = armyToSupply(world, realm.id, o.armyId)
      if (typeof army === 'string') return army
    } else {
      if (!Number.isInteger(o.x) || !Number.isInteger(o.y)) return 'the target must be a tile'
      if (terrain && !carriageCanEnter(terrainAt(terrain, o.x!, o.y!))) {
        return 'a carriage can’t go there'
      }
    }
    return driveProblem(world, r, carriage)
  },
  apply(world, _sender, order) {
    const { residentId, carriageId, x, y, armyId } = order as DriveRequest
    const r = world.residents.find((x) => x.id === residentId)
    const carriage = world.carriages.find((k) => k.id === carriageId)
    // Two drivers ordered onto one carriage in the same tick: the first one drives it.
    if (!r || !carriage || driveProblem(world, r, carriage)) return
    if (armyId === undefined) {
      r.order = { kind: 'drive', carriageId, target: { x: x!, y: y! }, path: null, progress: 0 }
      return
    }
    const army = world.armies.find((a) => a.id === armyId)
    if (!army) return
    const target = armyStart(world, army)
    r.order = { kind: 'drive', carriageId, target, path: null, progress: 0, army: army.id }
  },
}
