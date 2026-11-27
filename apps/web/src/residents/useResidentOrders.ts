import { useState } from 'react'
import type {
  Building,
  BuildingKind,
  Good,
  GoodsSpot,
  OrderRequest,
  Resident,
  StartParamValues,
  Stock,
  TrainingSubject,
  WallMaterial,
} from '@csp/shared-types'
import { wrap } from '../world/terrain.js'
import { creativeProblem } from '../creative/creative-section.js'
import { isVesselId } from '../transport/vessels.js'
import { api } from '../world/api.js'
import { appendRequest, useShiftHeld } from '../queue/queue-view.js'
import { MEND } from './equipment-view.js'
import { useStartForm } from '../script/useStartForm.js'

import type { ClientWorld } from '../world/useWorld.js'

/** What resident orders need of the game (`useResidentOrders`). */
export interface ResidentOrderNeeds {
  world: ClientWorld | null
  /** The residents the Player gives orders to. */
  own: Resident[]
  /** The one resident picked, whose card gives the orders. */
  selected: Resident | undefined
  /** The building the picked resident stands at (`whatsHere`). */
  buildingHere: Building | undefined
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
  /** Opens the form before a script starts, if the order asks for one (`useStartForm`). */
  opensForm: ReturnType<typeof useStartForm>['opensForm']
  /** Set to show a task's form even with nothing to fill in (`useStartForm`). */
  customising: ReturnType<typeof useStartForm>['customising']
  /** Shift held: an order goes in the queue (`useShiftHeld`). */
  shift: ReturnType<typeof useShiftHeld>
}

/**
 * Orders given by hand to the Player's residents (ADR 0002: each requests an order), and what
 * the last one answered: `orderError` on the resident and tile cards, `armyError` on the army's.
 */
export function useResidentOrders(needs: ResidentOrderNeeds) {
  const { world, own, selected, buildingHere, sendOrder, opensForm, customising, shift } = needs
  const [orderError, setOrderError] = useState<string | undefined>()
  const [armyError, setArmyError] = useState<string | undefined>()
  /**
   * Gives an order, or, `queued` (Shift held), appends a resident's order to their queue
   * (`CONTEXT.md`: Queue). Orders that can't be queue steps are given as they are. An order
   * starting a script starts at once (`CONTEXT.md`: Starting at once), unless the form opens
   * (`opensForm`); Start gives it with the values.
   */
  const giveOrder = (order: OrderRequest, queued = shift.current): Promise<string | undefined> => {
    const r = own.find((x) => x.id === order.residentId)
    const asked =
      order.params === undefined &&
      opensForm(order, [r?.scriptParams], async (params) =>
        setOrderError(await giveOrder({ ...order, params }, queued)),
      )
    if (asked) return Promise.resolve(undefined)
    const queuedFor = queued ? r : undefined
    return sendOrder((queuedFor && appendRequest(queuedFor, order)) ?? order)
  }
  /**
   * Moves residents to a tile at once (`CONTEXT.md`: Creative mode): a creative action, no order.
   * Answers why it was refused or what it broke, or nothing; they show there with the next tick.
   */
  async function creativeMove(residentIds: string[], x: number, y: number) {
    if (!world) return undefined
    const size = world.map.size
    try {
      const done = await api.creativeAct({
        action: 'moveResidents',
        residentIds,
        x: wrap(x, size),
        y: wrap(y, size),
      })
      return creativeProblem(done)
    } catch (e: unknown) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  /** Orders the picked resident to pick up or drop goods on their tile. */
  async function carry(kind: 'pickUp' | 'drop', spot: GoodsSpot, goods: Stock) {
    if (!selected) return
    setOrderError(await giveOrder({ kind, residentId: selected.id, spot, goods }))
  }
  /**
   * Gives the picked resident the Build task on their tile, laying out a site or joining the one
   * there: they run the Player's Build (default) script, which fetches missing materials from
   * the realm's storages (`CONTEXT.md`: Fetching materials).
   */
  async function build(building: BuildingKind, material?: WallMaterial) {
    if (!selected) return
    const order = {
      kind: 'task',
      task: 'build',
      residentId: selected.id,
      building,
      ...(material === 'stone' ? { material } : {}),
    }
    setOrderError(await giveOrder(order))
  }
  /**
   * Gives the picked resident the Work task at the workplace on their tile, making `makes` at a
   * smithy: they run the Player's Work (default) script (`CONTEXT.md`: Default script).
   */
  async function work(makes?: Good | typeof MEND) {
    if (!selected) return
    const workplaceId = buildingHere?.id
    const order = { kind: 'task', task: 'work', residentId: selected.id, workplaceId, makes }
    setOrderError(await giveOrder(order))
  }
  /**
   * Gives the picked resident the Tear down task for the building or site on their tile: they
   * run the Player's Tear down (default) script.
   */
  /**
   * Gives the picked resident the Repair task for a worn building (`CONTEXT.md`: Repairing): they
   * run the Player's Repair (default) script, walking there and fetching what it lacks.
   */
  async function repair(buildingId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'repair', residentId: selected.id, buildingId }
    setOrderError(await giveOrder(order))
  }
  async function tearDown(buildingId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'tearDown', residentId: selected.id, buildingId }
    setOrderError(await giveOrder(order))
  }
  /**
   * Gives the picked resident the Breed horses task for two horses in the stable on their tile:
   * they run the Player's Breed horses (default) script.
   */
  async function breed(stableId: string, horseIds: [string, string]) {
    if (!selected) return
    const order = { kind: 'task', task: 'breed', residentId: selected.id, stableId, horseIds }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Gives the picked resident the Feed the stable task for the stable they stand in: they run the
   * Player's Feed the stable (default) script (`CONTEXT.md`: Feeding the stable).
   */
  async function feedStable(stableId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'feedStable', residentId: selected.id, stableId }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Gives the picked resident the Train task for the training ground they stand on: they run the
   * Player's Train (default) script (`CONTEXT.md`: Trainee).
   */
  async function train(groundId: string) {
    if (!selected) return
    const order = { kind: 'task', task: 'train', residentId: selected.id, groundId }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Gives the picked resident the Explore task: they run the Player's Explore (default) script
   * (`CONTEXT.md`: Explore); with Shift held it goes in their queue.
   */
  async function explore() {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'task', task: 'explore', residentId: selected.id }))
  }
  /**
   * Gives the picked resident the Gather task (`CONTEXT.md`: Gather), its form first so the
   * Player picks the good; with Shift held it goes in their queue.
   */
  async function gather() {
    if (!selected) return
    customising.current = true
    setOrderError(await giveOrder({ kind: 'task', task: 'gather', residentId: selected.id }))
  }
  /**
   * Orders the picked resident to teach `subject` at the training ground they stand on
   * (`CONTEXT.md`: Teacher); with Shift held it goes in their queue.
   */
  async function teach(buildingId: string, subject: TrainingSubject) {
    if (!selected) return
    const order = { kind: 'teach', residentId: selected.id, buildingId, subject }
    setOrderError(await giveOrder(order))
  }
  /** Orders the picked resident to stop what they are doing, such as a haul route. */
  /** Orders the picked resident to run one of the Player's scripts. */
  async function runScript(scriptId: number) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'runScript', residentId: selected.id, scriptId }))
  }
  /**
   * Picks the script the picked resident runs when struck, or with null the Defend default
   * (`CONTEXT.md`: Defence script); its params are picked first, as before a script starts. Never
   * queued: it leaves what they do as it is.
   */
  async function setDefenceScript(scriptId: number | null) {
    if (!selected) return
    const order = { kind: 'setDefenceScript', residentId: selected.id, scriptId }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Picks what the picked resident runs when an alarm reaches them: a script, `none` for nothing,
   * or with null the Alarm default (`CONTEXT.md`: Alarm script); a script's params are picked
   * first, as before a script starts. Never queued: it leaves what they do as it is.
   */
  async function setAlarmScript(scriptId: number | 'none' | null) {
    if (!selected) return
    const order = { kind: 'setAlarmScript', residentId: selected.id, scriptId }
    setOrderError(await giveOrder(order, false))
  }
  /**
   * Picks, or clears with a null `targetId`, the value of a param of the script the picked
   * resident runs (`CONTEXT.md`: Script parameter): the building, carriage or waypoint's id, or
   * the number typed for a number param or the word chosen for a choice param. It leaves the
   * script running.
   */
  async function setScriptParam(
    name: string,
    picked: { targetId: string | null } | { value: number | string },
  ) {
    if (!selected?.script) return
    const { scriptId } = selected.script
    const order = { kind: 'setScriptParam', residentId: selected.id, scriptId, name, ...picked }
    setOrderError(await giveOrder(order))
  }
  /**
   * Changes the realm's Work settings for a workplace (`CONTEXT.md`: Workplace settings): its
   * work script, null for the Work default, or values for its params, null clearing one.
   */
  async function setWorkSettings(
    buildingId: string,
    params?: StartParamValues,
    scriptId?: number | null,
  ) {
    const order = { kind: 'setWorkSettings', buildingId, params, scriptId }
    setOrderError(await sendOrder(order))
  }
  /**
   * Has the Player's Leader rally the crew where they stand (`CONTEXT.md`: Rallying the crew), or
   * stop. By hand only: never into a queue, whatever is held (ADR 0042).
   */
  async function rallyBy(leaderId: string, stopIt = false) {
    const kind = stopIt ? 'stop' : 'rally'
    setOrderError(await giveOrder({ kind, residentId: leaderId }, false))
  }
  /** The picked resident, the Leader, rallies the crew (`CONTEXT.md`: Rallying the crew). */
  async function rally() {
    if (selected) await rallyBy(selected.id)
  }
  async function stop() {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'stop', residentId: selected.id }))
  }
  /** Orders the picked resident to pair with another resident of their city. */
  async function pair(partnerId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'pair', residentId: selected.id, partnerId }))
  }
  /** Orders the picked resident to relocate to another city of the realm (`CONTEXT.md`: Relocate). */
  async function relocate(cityId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'relocate', residentId: selected.id, cityId }))
  }
  /**
   * Orders the Player's Leader to hand the realm over to the picked resident (`CONTEXT.md`:
   * Leader handover), the same `handOver` order a script's `handOver` requests.
   */
  async function makeLeader() {
    if (!selected || !world) return
    const order = { kind: 'handOver', residentId: world.home.leaderId, newLeaderId: selected.id }
    setOrderError(await giveOrder(order))
  }
  /**
   * Names the picked resident the realm's heir (`CONTEXT.md`: Heir), the same `nameHeir` order a
   * script's `nameHeir` requests.
   */
  async function nameHeir() {
    if (!selected) return
    const order = { kind: 'nameHeir', residentId: selected.id, heirId: selected.id }
    setOrderError(await giveOrder(order))
  }
  /** Clears the realm's heir (`CONTEXT.md`: Heir), as a script's `clearHeir` does. */
  async function clearHeir() {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'clearHeir', residentId: selected.id }))
  }
  /**
   * Renames the picked resident (`CONTEXT.md`: Renaming a resident), with the realm name when it
   * is the Leader of an unnamed realm: the same `rename` order a script's `rename` requests.
   */
  async function rename(name: string, realmName?: string) {
    if (!selected) return
    const order = { kind: 'rename', residentId: selected.id, targetId: selected.id, name }
    setOrderError(await giveOrder(realmName === undefined ? order : { ...order, realmName }))
  }
  /** Orders the picked resident to attack a resident of another realm. */
  async function attack(targetId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'attack', residentId: selected.id, targetId }))
  }
  /** Orders the picked resident to Feed someone Down or a horse next to them. */
  async function feed(targetId: string, units: number) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'feed', residentId: selected.id, targetId, units }))
  }
  /**
   * Orders the picked resident to swap a good they carry into its slot, or with `null` to take
   * the slot's item off (`CONTEXT.md`: Equipment); with Shift held it goes in their queue.
   */
  async function equip(slot: string, good: string | null) {
    if (!selected) return
    const order = good
      ? { kind: 'equip', residentId: selected.id, good }
      : { kind: 'takeOff', residentId: selected.id, slot }
    setOrderError(await giveOrder(order))
  }
  /** Orders the picked resident to mount a horse on their tile, or with none to dismount. */
  async function ride(horseId?: string) {
    if (!selected) return
    const order = horseId
      ? { kind: 'mount', residentId: selected.id, horseId }
      : { kind: 'dismount', residentId: selected.id }
    setOrderError(await sendOrder(order))
  }
  /**
   * Orders the picked resident to board a carriage on their tile or a boat beside them, or with
   * none to get off the one they are aboard, onto its tile or the shore beside the boat
   * (`CONTEXT.md`: Passenger, Beside a vessel); with Shift held, appends it to their queue.
   */
  async function boardCarriage(carriageId?: string, residentId = selected?.id, asCrew = false) {
    if (!residentId) return
    const order = !carriageId
      ? { kind: 'getOff', residentId }
      : isVesselId(carriageId)
        ? { kind: 'board', residentId, vesselId: carriageId, ...(asCrew ? { asCrew } : {}) }
        : { kind: 'board', residentId, carriageId }
    setOrderError(await giveOrder(order))
  }
  /**
   * Orders the picked resident to unhitch the horse from a carriage on their tile (`CONTEXT.md`:
   * Hitched horse); with Shift held, appends it to their queue.
   */
  async function unhitch(carriageId: string, residentId = selected?.id) {
    if (!residentId) return
    setOrderError(await giveOrder({ kind: 'unhitch', residentId, carriageId }))
  }
  /**
   * Orders the picked resident to hitch the horse they choose to a carriage on their tile
   * (`CONTEXT.md`: Hitched horse); with Shift held, appends it to their queue.
   */
  async function hitch(carriageId: string, horseId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'hitch', residentId: selected.id, carriageId, horseId }))
  }
  /** Orders the picked resident to climb over a wall or gate of another realm next to them. */
  async function climb(wallId: string) {
    if (!selected) return
    setOrderError(await giveOrder({ kind: 'climb', residentId: selected.id, wallId }))
  }
  return {
    orderError,
    setOrderError,
    armyError,
    setArmyError,
    giveOrder,
    creativeMove,
    carry,
    build,
    work,
    repair,
    tearDown,
    breed,
    feedStable,
    train,
    explore,
    gather,
    teach,
    runScript,
    setDefenceScript,
    setAlarmScript,
    setScriptParam,
    setWorkSettings,
    rallyBy,
    rally,
    stop,
    pair,
    relocate,
    makeLeader,
    nameHeir,
    clearHeir,
    rename,
    attack,
    feed,
    equip,
    ride,
    boardCarriage,
    unhitch,
    hitch,
    climb,
  }
}

/** The orders given by hand (`useResidentOrders`). */
export type ResidentOrders = ReturnType<typeof useResidentOrders>
