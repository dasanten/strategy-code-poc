import { useState } from 'react'
import type { Building, OrderRequest, Resident, SeenResident } from '@csp/shared-types'
import { carriagePulledBy, carriageOfResident, seatsLeft } from '../transport/carriages.js'
import { riderOf } from '../transport/horse-rules.js'
import { isPassableTerrain } from '../world/terrain.js'
import { isWallOrGate } from '../building/walls.js'
import { covers } from '../building/footprint.js'
import { PASSENGER_WEIGHT } from '@csp/balance'
import { besideVessel, vesselOfResident, vesselRoom } from '../transport/vessels.js'
import { useShiftHeld } from '../queue/queue-view.js'
import {
  groupOrderStart,
  groupRequests,
  type GroupOrder,
  type GroupSeen,
  type Skipped,
} from './group-orders.js'
import { realmRequests } from '../building/building-orders.js'
import { toFeed } from '../world/seen-world.js'
import { useKnownGround } from '../map/useKnownGround.js'
import { useStartForm } from '../script/useStartForm.js'

import type { ClientWorld } from '../world/useWorld.js'

/** What group orders need of the game (`useGroupOrders`). */
export interface GroupOrderNeeds {
  world: ClientWorld | null
  /** The residents picked together (`CONTEXT.md`: Group). */
  group: Resident[]
  /** The known ground's lookups and checks (`useKnownGround`). */
  ground: Pick<ReturnType<typeof useKnownGround>, 'nodeAt' | 'terrainAt' | 'buildProblemAt'>
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
  /** Opens the form before a script starts, once for all, if the order asks for one. */
  opensForm: ReturnType<typeof useStartForm>['opensForm']
  /** Shift held: the order goes in each one's queue (`useShiftHeld`). */
  shift: ReturnType<typeof useShiftHeld>
  /** A Build order went out: the group's build pick is done (`usePick`). */
  onBuilt: () => void
}

/**
 * Orders given to a group at once (`CONTEXT.md`: Group), or to those ticked on a realm order's
 * who-list, and what the last one did (`groupReport`, `groupError`), shown on the group card and
 * in the notice lane; with what group orders need of what the Player sees.
 */
export function useGroupOrders(needs: GroupOrderNeeds) {
  const { world, group, sendOrder, opensForm, shift, onBuilt } = needs
  const { nodeAt, terrainAt, buildProblemAt } = needs.ground
  // What the last group order did.
  const [groupReport, setGroupReport] = useState<{ sent: number; of: number; skipped: Skipped[] }>()
  const [groupError, setGroupError] = useState<string>()
  // What group orders need of what the Player sees (`GroupSeen`).
  const groupSeen: GroupSeen = world
    ? {
        vessels: world.vessels.filter((v) => v.realmId === world.home.realmId),
        // Free horses of the realm, to mount (`CONTEXT.md`: Riding).
        horses: world.horses.filter(
          (h) =>
            h.realmId === world.home.realmId && !carriagePulledBy(world, h) && !riderOf(world, h),
        ),
        carriages: world.carriages.filter((k) => k.realmId === world.home.realmId),
        buildings: world.buildings,
        toFeed: toFeed(world),
      }
    : {}
  // The realm's carriages someone of the group stands on, to board with the seats left on each
  // (`CONTEXT.md`: Passenger).
  const groupCarriages = world
    ? world.carriages.flatMap((k) =>
        k.load && group.some((r) => r.x === k.x && r.y === k.y && carriageOfResident(k, r))
          ? [
              {
                carriage: k,
                seats: seatsLeft(world, { ...k, load: k.load }, k.passengerIds?.length ?? 0),
              },
            ]
          : [],
      )
    : []
  // The realm's boats someone of the group stands beside, and its ships docked at a haven one of
  // them stands on, to board with the places left in each (`CONTEXT.md`: Beside a vessel, Docked).
  const groupBoats = world
    ? world.vessels.flatMap((v) => {
        const room = vesselRoom(v)
        if (room === undefined) return []
        const beside = (r: SeenResident) =>
          vesselOfResident(v, r) && besideVessel(v, r, world.map.size, world.buildings)
        if (!group.some(beside)) return []
        return [{ vessel: v, seats: Math.max(0, Math.floor(room / PASSENGER_WEIGHT + 1e-9)) }]
      })
    : []
  /** The tile picked for the group to build on, with what the group card's Build menu needs of it. */
  const groupBuildTile = (w: NonNullable<typeof world>, at: { x: number; y: number } | undefined) =>
    at && {
      ...at,
      site: w.buildings.find((b) => b.kind !== 'road' && b.site && covers(b, at.x, at.y)),
      node: nodeAt?.(at.x, at.y),
      terrain: terrainAt?.(at.x, at.y),
      problem: buildProblemAt(w, at.x, at.y),
    }
  /**
   * Gives each resident of the group the same order request (ADR 0002), skipping those who
   * can't take it, and says on the card who was skipped or turned down and why. One starting a
   * script starts at once, each going on with what they keep (`CONTEXT.md`: Starting at once),
   * unless the form opens, once for all (`opensForm`), filled with the values all of them keep.
   */
  async function sendGroup(
    order: GroupOrder,
    queued = shift.current,
    /** Who gets it: the picked group, or those ticked on a realm order's who-list. */
    to: readonly Resident[] = group,
    /** A realm order's building: those far from it walk there first (`realmRequests`). */
    target?: Building,
    /** Those of a who-list set to After, who get it appended to their queue (`realmRequests`). */
    after?: ReadonlySet<string>,
  ) {
    if (!world) return
    const given = 'params' in order && order.params !== undefined
    const asked =
      !given &&
      opensForm(
        groupOrderStart(order) ?? { kind: order.kind },
        to.map((r) => r.scriptParams),
        (params) => sendGroup({ ...order, params } as GroupOrder, queued, to, target, after),
      )
    if (asked) return
    const size = world.map.size
    const inGroup = new Set(to.map((r) => r.id))
    // Free: explored land a resident can stand on, with no wall or gate and nobody else on it.
    const free = (x: number, y: number) => {
      const t = terrainAt?.(x, y)
      if (t === undefined || !isPassableTerrain(t)) return false
      if (world.buildings.some((b) => isWallOrGate(b) && covers(b, x, y, size))) return false
      return !world.residents.some((r) => r.x === x && r.y === y && !inGroup.has(r.id))
    }
    // With Shift held, each one's queue gets the order appended (`CONTEXT.md`: Queue); from a
    // who-list, only the queues of those set to After.
    const ctx = { tick: world.tick, size, free, seen: groupSeen }
    const { requests, skipped } =
      target || after
        ? realmRequests(order, to, {
            ...ctx,
            ...(target ? { target } : {}),
            ...(after ? { after } : {}),
          })
        : groupRequests(order, to, { ...ctx, queued })
    if (order.kind === 'build') onBuilt()
    await sendToGroup(
      requests.map((q) => q.order),
      skipped,
      to,
    )
  }
  /**
   * Sends the group's requests, one per resident, and says on the card how many went out and who
   * was skipped or turned down and why.
   */
  async function sendToGroup(
    requests: OrderRequest[],
    skipped: Skipped[],
    to: readonly Resident[] = group,
  ) {
    setGroupError(undefined)
    const answers = await Promise.all(requests.map((o) => sendOrder(o)))
    const turnedDown = requests.flatMap((o, i) => {
      const why = answers[i]
      const r = to.find((g) => g.id === o.residentId)
      return why && r ? [{ id: r.id, name: r.name, why }] : []
    })
    setGroupReport({
      sent: requests.length - turnedDown.length,
      of: to.length,
      skipped: [...skipped, ...turnedDown],
    })
  }
  return {
    groupReport,
    setGroupReport,
    groupError,
    setGroupError,
    groupSeen,
    groupCarriages,
    groupBoats,
    groupBuildTile,
    sendGroup,
    sendToGroup,
  }
}

/** The group's orders (`useGroupOrders`). */
export type GroupOrders = ReturnType<typeof useGroupOrders>
