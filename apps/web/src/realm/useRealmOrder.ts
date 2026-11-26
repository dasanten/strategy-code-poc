import { useEffect, useRef, useState } from 'react'
import { stoneOverAt } from '../building/building.js'
import { REALM_BAR_ORDERS, type ControlMode, type RealmBarOrder } from './control-mode.js'
import type {
  Building,
  BuildingKind,
  OrderRequest,
  Resident,
  ScriptSummary,
  StartParamValues,
  WallMaterial,
} from '@csp/shared-types'
import { drivenCarriageId, seatsLeft } from '../transport/carriages.js'
import { UNEXPLORED } from '@csp/shared-types'
import { isPassableTerrain, wrap } from '../world/terrain.js'
import { PASSENGER_WEIGHT } from '@csp/balance'
import { vesselRoom } from '../transport/vessels.js'
import {
  groupOrderStart,
  type GroupOrder,
  type GroupSeen,
  type Skipped,
} from '../residents/group-orders.js'
import { type BuildingGroupOrder } from '../building/building-orders.js'
import {
  onlyThis,
  standAt,
  vehicleOrder,
  vehicleRequests,
  type OrderedVehicle,
  type VehicleGroupOrder,
} from '../transport/vehicle-orders.js'
import { type HaulSetup } from '../residents/Residents.js'
import {
  lineProblem,
  wayTarget,
  whoRows,
  whoTitle,
  whoWhere,
  type WhoAt,
  type WhoLine,
  type WhoOrder,
  type WhoPlaceOrder,
  type WhoWay,
} from './who-list-view.js'
import { paramsPlace, townHallAt } from './realm-orders-view.js'
import { searchPath } from '../map/path-preview.js'
import { type RealmVehiclePick } from '../pick/pick-mode.js'
import { useWorld } from '../world/useWorld.js'
import type { useKnownGround } from '../map/useKnownGround.js'
import type { SeenCity } from '@csp/shared-types'
import type { useStartForm } from '../script/useStartForm.js'

/**
 * A realm order being given (`CONTEXT.md`: Realm order): Build on the realm bar opens the Build
 * menu, then the kind picks where it goes (with why the last tile would not do), then the
 * who-list says who builds it there. An order about a picked building, from its card, goes
 * straight to the who-list (`about`). Road or Wall picks a line's start and end (with why the
 * last line would not do), then the who-list says who builds it, sharing the line. Build here on
 * a tile's card opens the menu for that tile (`at`). Walk to picks the tile; Run script and
 * Relocate open their own card first; those and the storage card's orders go to the who-list as
 * `place`.
 */
export type RealmOrder =
  | { step: 'menu'; at?: { x: number; y: number } }
  | { step: 'where'; building: BuildingKind; material?: WallMaterial; error?: string }
  | { step: 'walkTo' }
  | { step: 'script' }
  | { step: 'relocate' }
  | { step: 'place'; order: WhoPlaceOrder; at: WhoAt; title: string }
  | { step: 'who'; building: BuildingKind; material?: WallMaterial; at: { x: number; y: number } }
  | { step: 'about'; order: BuildingGroupOrder; target: Building }
  | { step: 'line'; building: 'road' | 'wall'; from?: { x: number; y: number }; error?: string }
  | { step: 'lineWho'; line: WhoLine }
  /** A carriage's or boat's order picking its tile: where to drive or row, a route's other stop. */
  | { step: 'vehiclePick'; pick: RealmVehiclePick; vehicle: OrderedVehicle; haul?: HaulSetup }
  /** The who-list of an order about a carriage or vessel, `at` where its taker stands (`standAt`). */
  | {
      step: 'vehicle'
      order: VehicleGroupOrder
      vehicle: OrderedVehicle
      at: { x: number; y: number }
    }

type SeenWorld = ReturnType<typeof useWorld>['world']

/** What a realm order needs of the game around it (`useRealmOrder`). */
export interface RealmOrderNeeds {
  world: SeenWorld
  own: Resident[]
  controlMode: ControlMode
  selectedTile: { x: number; y: number } | undefined
  setSelectedTile: (tile: undefined) => void
  scripts: ScriptSummary[]
  knownCities: SeenCity[]
  knownBuildings: Building[]
  groupSeen: GroupSeen
  ground: Pick<
    ReturnType<typeof useKnownGround>,
    'terrainAt' | 'arrivesIn' | 'buildProblemAt' | 'realmBuildProblem' | 'wayGround'
  >
  form: Pick<ReturnType<typeof useStartForm>, 'customising' | 'opensForm'>
  /** The wall's material picked on the banner, and the Work setting's pick, read when used. */
  picker: { readonly wallMaterial: WallMaterial; work: { clear: () => void } }
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
  sendGroup: (
    order: GroupOrder,
    queued: boolean,
    to: readonly Resident[],
    target?: Building,
    after?: ReadonlySet<string>,
  ) => Promise<void>
  sendToGroup: (
    requests: OrderRequest[],
    skipped: Skipped[],
    to: readonly Resident[],
  ) => Promise<void>
}

/**
 * A realm order being given in realm control mode (`CONTEXT.md`: Realm order): its steps from
 * the realm bar or a tile's card to the who-list, what its pick on the map does, and who gets it.
 */
export function useRealmOrder(needs: RealmOrderNeeds) {
  const { world, own, controlMode, selectedTile, setSelectedTile, scripts } = needs
  const { knownCities, knownBuildings, groupSeen, picker, sendOrder, sendGroup, sendToGroup } =
    needs
  const { terrainAt, arrivesIn, buildProblemAt, realmBuildProblem, wayGround } = needs.ground
  const { customising, opensForm } = needs.form
  // A realm order being given in realm control mode (`CONTEXT.md`: Realm order).
  const [realmOrder, setRealmOrder] = useState<RealmOrder>()
  // A realm order waiting for its place on the map: where the kind goes, where to walk to, or a
  // line's ends.
  const realmPicking =
    realmOrder?.step === 'where' ||
    realmOrder?.step === 'walkTo' ||
    realmOrder?.step === 'line' ||
    realmOrder?.step === 'vehiclePick'
  // The road or wall line the realm order gives, if it gives one.
  const realmLine =
    realmOrder?.step === 'line'
      ? realmOrder.building
      : realmOrder?.step === 'lineWho'
        ? realmOrder.line.building
        : undefined
  // The realm bar's order being given, if one is: its button shows pressed.
  const realmBarOpen: RealmBarOrder | undefined =
    realmOrder === undefined || realmOrder.step === 'about'
      ? undefined
      : realmLine
        ? realmLine
        : realmOrder.step === 'menu' || realmOrder.step === 'where' || realmOrder.step === 'who'
          ? 'build'
          : realmOrder.step === 'script'
            ? 'runScript'
            : realmOrder.step === 'place'
              ? REALM_BAR_ORDERS.find((o) => o.id === realmOrder.order.kind)?.id
              : realmOrder.step === 'walkTo' || realmOrder.step === 'relocate'
                ? realmOrder.step
                : undefined
  // A realm order is given in realm control mode only: leaving it drops one half given.
  useEffect(() => {
    if (controlMode === 'unit') setRealmOrder(undefined)
  }, [controlMode])
  // The realm order's Build menu or who-list, which Escape closes as it does a card.
  const realmCard = realmOrder !== undefined && !realmPicking
  /**
   * The tile picked for a realm order's Build: a kind that can't go there says why, and the
   * Player picks again; else the who-list opens for it.
   */
  function realmTile(x: number, y: number, o: Extract<RealmOrder, { step: 'where' }>) {
    if (!world) return
    const size = world.map.size
    const at = { x: wrap(x, size), y: wrap(y, size) }
    const problem = realmBuildProblem(world, at.x, at.y, o.building, o.material)
    const material = o.material ? { material: o.material } : {}
    if (problem)
      return setRealmOrder({ step: 'where', building: o.building, ...material, error: problem })
    setRealmOrder({ step: 'who', building: o.building, ...material, at })
  }
  /** Opens the who-list for an order about places and goods, measured from `at` (`CONTEXT.md`: Who-list). */
  function realmWho(
    order: WhoPlaceOrder,
    at: WhoAt | undefined,
    names: { script?: string; city?: string } = {},
  ) {
    if (!at) return setRealmOrder(undefined)
    setRealmOrder({ step: 'place', order, at, title: whoTitle(order, world?.map.size, names) })
  }
  /** The tile picked for a realm order's Walk to: then who walks there. */
  function realmWalkTo(x: number, y: number) {
    if (!world) return
    const size = world.map.size
    const [tx, ty] = [wrap(x, size), wrap(y, size)]
    realmWho({ kind: 'walkTo', x: tx, y: ty }, { x: tx, y: ty })
  }
  /**
   * Where the who-list measures from for an order with no target tile: the realm's town hall,
   * else, with none known, the Leader.
   */
  function realmHome(): WhoAt | undefined {
    if (!world) return undefined
    const seen = { cities: knownCities, buildings: knownBuildings }
    const hall = world.home.cityId ? townHallAt(seen, world.home.cityId) : undefined
    if (hall) return hall
    const lead = own.find((r) => r.id === world.home.leaderId)
    return lead && { x: lead.x, y: lead.y, near: lead.name }
  }
  /**
   * Explore or Run script as a realm order (`CONTEXT.md`: Realm order): its form first (always
   * for Explore; for a script when it needs values or Customise was pressed), then the who-list,
   * nearest a building, carriage or waypoint picked for a param first, else the town hall.
   */
  function realmScriptOrder(
    order: Extract<WhoPlaceOrder, { kind: 'explore' | 'gather' | 'runScript' }>,
  ) {
    if (!world) return
    setRealmOrder(undefined)
    const script =
      order.kind === 'runScript' ? scripts.find((s) => s.id === order.scriptId) : undefined
    const names = script ? { script: script.name } : {}
    const toWho = (params?: StartParamValues) => {
      const place = paramsPlace(params, {
        buildings: knownBuildings,
        carriages: world.carriages,
        waypoints: world.waypoints,
      })
      realmWho(params ? { ...order, params } : order, place ?? realmHome(), names)
    }
    if (order.kind === 'explore' || order.kind === 'gather') customising.current = true
    const asked = opensForm(groupOrderStart(order) ?? { kind: order.kind }, [], async (params) =>
      toWho(params),
    )
    if (!asked) toWho()
  }
  /**
   * A tile picked for a realm order's road or wall line: its start, then its end. A line that
   * can't be built says why (`lineProblem`) and the Player picks its end again; else the who-list
   * opens for it. A wall is of the material picked on the banner.
   */
  function realmLineTile(x: number, y: number, o: Extract<RealmOrder, { step: 'line' }>) {
    if (!world) return
    const size = world.map.size
    const at = { x: wrap(x, size), y: wrap(y, size) }
    if (!o.from) return setRealmOrder({ step: 'line', building: o.building, from: at })
    const stone = o.building === 'wall' && picker.wallMaterial === 'stone'
    const line: WhoLine = {
      kind: 'line',
      building: o.building,
      from: o.from,
      to: at,
      ...(stone ? { material: 'stone' as const } : {}),
    }
    // A tile takes the line if it has a site of its building to join or the building can go there
    // (a stone wall over a wooden gate upgrades the gate).
    const builds = (tx: number, ty: number) => {
      const kind = stone && stoneOverAt(world, tx, ty, 'gate') ? 'gate' : o.building
      const site = world.buildings.some(
        (b) => b.site && b.kind === kind && b.x === tx && b.y === ty,
      )
      return site || buildProblemAt(world, tx, ty)(kind, line.material) === undefined
    }
    const problem = lineProblem(line, size, builds)
    if (problem)
      return setRealmOrder({ step: 'line', building: o.building, from: o.from, error: problem })
    setRealmOrder({ step: 'lineWho', line })
  }
  /**
   * Confirm on the who-list: those ticked get what the group card sends them, replacing what they
   * do, or appended to their queue for those set to After: for Build the first there lays out the
   * site and the others join it; a line they share. With Shift held the same kind stays armed for
   * the next place; else the realm bar is back.
   */
  async function confirmRealmOrder(
    order: Extract<WhoOrder, { kind: 'build' | 'line' }>,
    ids: readonly string[],
    after: readonly string[],
    again: boolean,
  ) {
    const to = ids.flatMap((id) => own.filter((r) => r.id === id))
    const material = order.material ? { material: order.material } : {}
    if (!again) setRealmOrder(undefined)
    else if (order.kind === 'line') setRealmOrder({ step: 'line', building: order.building })
    else setRealmOrder({ step: 'where', building: order.building, ...material })
    await sendGroup(order, false, to, undefined, new Set(after))
  }
  /**
   * Confirm on the who-list of an order about places and goods: those ticked get what the group
   * card sends them, replacing what they do, or appended to their queue for those set to After.
   * With Shift held Walk to stays armed for the next place; else the realm bar is back.
   */
  async function confirmPlace(
    order: WhoPlaceOrder,
    ids: readonly string[],
    after: readonly string[],
    again: boolean,
  ) {
    const to = ids.flatMap((id) => own.filter((r) => r.id === id))
    setRealmOrder(again && order.kind === 'walkTo' ? { step: 'walkTo' } : undefined)
    await sendGroup(order, false, to, undefined, new Set(after))
  }
  /**
   * A realm order from a building's card (`CONTEXT.md`: Realm order): its form first when it
   * has one (Customise, a Work's settings), then the who-list.
   */
  function startAbout(order: BuildingGroupOrder, target: Building) {
    const toWho = (o: BuildingGroupOrder) => {
      setSelectedTile(undefined)
      picker.work.clear()
      setRealmOrder({ step: 'about', order: o, target })
    }
    const start = groupOrderStart(order)
    const asked =
      start !== undefined &&
      opensForm(start, [], async (params) => toWho({ ...order, params } as BuildingGroupOrder))
    if (!asked) toWho(order)
  }
  /**
   * Confirm on the who-list of an order about a building: those ticked get what the group card
   * sends, those far off walking there first (`realmRequests`), and those set to After get it
   * appended to their queue; then the realm bar is back.
   */
  async function confirmAbout(
    order: BuildingGroupOrder,
    target: Building,
    ids: readonly string[],
    after: readonly string[],
  ) {
    const to = ids.flatMap((id) => own.filter((r) => r.id === id))
    setRealmOrder(undefined)
    await sendGroup(order, false, to, target, new Set(after))
  }
  /**
   * The carriage or vessel of the realm on a tile, as its card's realm orders need it
   * (`OrderedVehicle`): a carriage with its seats left, who drives it and whether a horse can pull
   * it; else a boat or ship with its seats left and who rows it.
   */
  function vehicleHere(x: number, y: number): OrderedVehicle | undefined {
    if (!world) return undefined
    const realmId = world.home.realmId
    const k = world.carriages.find((c) => c.realmId === realmId && c.x === x && c.y === y)
    if (k) {
      const driver = world.residents.find((r) => drivenCarriageId(r) === k.id)
      // A hitched horse, else a free one of the realm on its tile (`CONTEXT.md`: Hitched horse).
      const pulls = !!k.horseId || !!groupSeen.horses?.some((h) => h.x === k.x && h.y === k.y)
      return {
        what: 'carriage',
        carriage: k,
        seats: k.load ? seatsLeft(world, { ...k, load: k.load }, k.passengerIds?.length ?? 0) : 0,
        ...(driver ? { driver: { id: driver.id, name: driver.name } } : {}),
        ...(pulls ? {} : { noHorse: 'no horse to pull it' }),
      }
    }
    const v = world.vessels.find((s) => s.realmId === realmId && s.x === x && s.y === y)
    if (!v) return undefined
    const room = vesselRoom(v)
    const rower = v.rowerId ? world.residents.find((r) => r.id === v.rowerId) : undefined
    return {
      what: 'vessel',
      vessel: v,
      seats: room === undefined ? 0 : Math.max(0, Math.floor(room / PASSENGER_WEIGHT + 1e-9)),
      ...(rower ? { rower: { id: rower.id, name: rower.name } } : {}),
    }
  }
  /** Where the one taking an order about a carriage or vessel stands (`standAt`), if anywhere. */
  function vehicleStand(vehicle: OrderedVehicle) {
    if (!world) return undefined
    const standable = (x: number, y: number) => {
      const t = terrainAt?.(x, y)
      return t !== undefined && t !== UNEXPLORED && isPassableTerrain(t)
    }
    return standAt(vehicle, { size: world.map.size, standable, buildings: world.buildings })
  }
  /**
   * A realm order from a carriage's or vessel's card (`CONTEXT.md`: Realm order): Customise's form
   * first when it was asked for (a haul route), then the who-list, measured from where the one
   * taking it stands.
   */
  function startVehicle(order: VehicleGroupOrder, vehicle: OrderedVehicle) {
    const at = vehicleStand(vehicle)
    setSelectedTile(undefined)
    if (!at) return setRealmOrder(undefined)
    const toWho = (o: VehicleGroupOrder) =>
      setRealmOrder({ step: 'vehicle', order: o, vehicle, at })
    const start = groupOrderStart(order)
    const asked =
      start !== undefined &&
      opensForm(start, [], async (params) => toWho({ ...order, params } as VehicleGroupOrder))
    if (!asked) toWho(order)
  }
  /** The tile picked for Drive this to, Row this to or a haul route's other stop: then who. */
  function realmVehicleTile(x: number, y: number, o: Extract<RealmOrder, { step: 'vehiclePick' }>) {
    if (!world) return
    const size = world.map.size
    const to = { x: wrap(x, size), y: wrap(y, size) }
    const order = vehicleOrder(o.pick, o.vehicle, { to, ...(o.haul ? { haul: o.haul } : {}) })
    if (order) startVehicle(order, o.vehicle)
  }
  /**
   * Confirm on the who-list of an order about a carriage or vessel: those ticked get what the
   * group card sends, those far off walking there first (`vehicleRequests`), those set to After
   * getting it appended to their queue. A driver it replaces Now is stopped first.
   */
  async function confirmVehicle(
    o: Extract<RealmOrder, { step: 'vehicle' }>,
    ids: readonly string[],
    after: readonly string[],
  ) {
    if (!world) return
    const to = ids.flatMap((id) => own.filter((r) => r.id === id))
    setRealmOrder(undefined)
    const { requests, skipped, stop } = vehicleRequests(o.order, o.vehicle, to, {
      tick: world.tick,
      size: world.map.size,
      // No walk-to among these orders: no free tiles to spread over.
      free: () => true,
      seen: groupSeen,
      at: o.at,
      after: new Set(after),
    })
    if (stop) await sendOrder({ kind: 'stop', residentId: stop })
    await sendToGroup(
      requests.map((q) => q.order),
      skipped,
      to,
    )
  }
  // Each resident's way to a realm order's target, by where they stand and the target: found
  // once, not again each tick while they stand still.
  const whoWays = useRef(new Map<string, WhoWay>())
  // In realm control mode, the carriage or vessel of the realm on the picked tile, to give orders
  // about from its card (`CONTEXT.md`: Realm order).
  const tileVehicle =
    controlMode === 'realm' && selectedTile
      ? vehicleHere(selectedTile.x, selectedTile.y)
      : undefined
  // The realm order's who-list (`CONTEXT.md`: Who-list): its order and rows, while it is open.
  const who = (() => {
    if (!world) return undefined
    let order: WhoOrder
    let at: WhoAt
    let given: string | undefined
    if (realmOrder?.step === 'about') {
      order = realmOrder.order
      at = { x: realmOrder.target.x, y: realmOrder.target.y }
    } else if (realmOrder?.step === 'who') {
      const { building, material } = realmOrder
      at = realmOrder.at
      order = { kind: 'build', building, at, ...(material ? { material } : {}) }
    } else if (realmOrder?.step === 'lineWho') {
      order = realmOrder.line
      at = order.from
    } else if (realmOrder?.step === 'place') {
      order = realmOrder.order
      at = realmOrder.at
      given = realmOrder.title
    } else if (realmOrder?.step === 'vehicle') {
      order = realmOrder.order
      at = realmOrder.at
    } else return undefined
    // Explore and a script go no set way: as the crow flies from where the list measures.
    const crow = order.kind === 'explore' || order.kind === 'gather' || order.kind === 'runScript'
    const size = world.map.size
    const { ground, blocked } = wayGround(world)
    const ways = whoWays.current
    if (ways.size > 2000) ways.clear()
    // The way goes to the target, or to a line's tile nearest the resident.
    const targetOf = (r: { x: number; y: number }) => wayTarget(order, at, r, size)
    const wayOf = (r: Resident): WhoWay => {
      // Explore and a script go no set way: as the crow flies from where the list measures.
      if (crow) return undefined
      const at = targetOf(r)
      const key = `${r.id}:${r.x},${r.y}>${at.x},${at.y}`
      if (ways.has(key)) return ways.get(key)
      const found = searchPath(size, r, at, ground, 'foot', blocked)
      const way: WhoWay =
        found === 'none'
          ? 'none'
          : found === 'gaveUp'
            ? undefined
            : {
                tiles: found.length,
                ticks: arrivesIn?.(r, {
                  kind: 'walkTo',
                  target: at,
                  path: found.map(([x, y]) => [x, y] as [number, number]),
                  progress: 0,
                }),
              }
      ways.set(key, way)
      return way
    }
    // An order about a carriage or vessel takes that one only (`onlyThis`).
    const seen = realmOrder.step === 'vehicle' ? onlyThis(realmOrder.vehicle, groupSeen) : groupSeen
    const ctx = { tick: world.tick, size, seen }
    const rows = whoRows(order, own, targetOf, (r) => wayOf(r as Resident), ctx)
    const title = given ?? whoTitle(order, size)
    const where = whoWhere(order, at)
    // Another order or place opens a list ticked afresh.
    return { order, rows, key: `${title}:${where}`, title, where }
  })()
  // What the realm order waits for on the map, if anything, and what a tile picked then does.
  const realmPick =
    realmOrder && realmPicking
      ? {
          ...(realmOrder.step === 'where'
            ? {
                target: {
                  building: realmOrder.building,
                  ...(realmOrder.error ? { error: realmOrder.error } : {}),
                },
              }
            : realmOrder.step === 'walkTo'
              ? { target: {} }
              : realmOrder.step === 'vehiclePick'
                ? { target: { vehicle: realmOrder.pick } }
                : realmOrder.step === 'line'
                  ? {
                      line: {
                        building: realmOrder.building,
                        ...(realmOrder.from ? { from: realmOrder.from } : {}),
                        ...(realmOrder.error ? { error: realmOrder.error } : {}),
                      },
                    }
                  : {}),
          onTile: (x: number, y: number) => {
            if (realmOrder.step === 'where') return realmTile(x, y, realmOrder)
            if (realmOrder.step === 'walkTo') return realmWalkTo(x, y)
            if (realmOrder.step === 'line') return realmLineTile(x, y, realmOrder)
            if (realmOrder.step === 'vehiclePick') return realmVehicleTile(x, y, realmOrder)
          },
        }
      : undefined
  /** A pick was cancelled: a realm order picking its place goes back to the realm bar. */
  const pickCancelled = () =>
    setRealmOrder((o) =>
      o?.step === 'where' || o?.step === 'walkTo' || o?.step === 'line' || o?.step === 'vehiclePick'
        ? undefined
        : o,
    )
  /** A realm bar button: its order starts, or, pressed again, stops. */
  const openBar = (order: RealmBarOrder) => {
    setSelectedTile(undefined)
    if (order === realmBarOpen) return setRealmOrder(undefined)
    if (order === 'explore') return realmScriptOrder({ kind: 'explore' })
    if (order === 'gather') return realmScriptOrder({ kind: 'gather' })
    setRealmOrder(
      order === 'build'
        ? { step: 'menu' }
        : order === 'road' || order === 'wall'
          ? { step: 'line', building: order }
          : order === 'runScript'
            ? { step: 'script' }
            : { step: order },
    )
  }
  return {
    realmOrder,
    setRealmOrder,
    realmPicking,
    realmBarOpen,
    realmCard,
    realmPick,
    pickCancelled,
    openBar,
    realmTile,
    realmWho,
    realmWalkTo,
    realmScriptOrder,
    confirmRealmOrder,
    confirmPlace,
    startAbout,
    confirmAbout,
    vehicleStand,
    startVehicle,
    confirmVehicle,
    tileVehicle,
    who,
  }
}
