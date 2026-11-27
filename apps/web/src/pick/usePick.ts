// Picking on the map (ADR 0012: pick mode; `CONTEXT.md`: Picking a target): which pick waits for a
// tile, where it is previewed, what a click or tap then does, and cancelling. `pick-mode.ts` and
// `pick-preview.ts` are its pure parts; `Game()` passes in what a pick needs and gets back what it
// draws and what was picked.
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Building,
  OrderRequest,
  Resident,
  ScriptParam,
  StartParamValues,
  WallMaterial,
} from '@csp/shared-types'
import type { ArmyPick } from '../army/Armies.js'
import { BUILDABLE, MAX_WORKERS } from '../building/building.js'
import { covers } from '../building/footprint.js'
import { isWallOrGate } from '../building/walls.js'
import { BUILDING_NAMES } from '../map/palette.js'
import { nextPick, pickInto, planAsk, type Plan, type PlanWorld } from '../queue/plan-step.js'
import { storePlaceAt } from '../realm/realm-orders-view.js'
import type { arrivalOf } from '../residents/doing-view.js'
import type { GroupOrder, Place } from '../residents/group-orders.js'
import type { GroupPicking, GroupPickWith, HaulSetup, Picking } from '../residents/Residents.js'
import { paramPickAt, type ParamWorld } from '../script/script-params-view.js'
import type { useWorld } from '../world/useWorld.js'
import { wrap } from '../world/terrain.js'
import {
  pickPrompt,
  pickTap,
  pickTarget,
  type PickTarget,
  type RealmVehiclePick,
} from './pick-mode.js'
import { pickPreview, previewPickOf, type PreviewWorld } from './pick-preview.js'

type World = NonNullable<ReturnType<typeof useWorld>['world']>
type Tile = { x: number; y: number }

/** What a realm order being given waits for on the map, if it waits for a tile (`CONTEXT.md`: Realm order). */
interface RealmPick {
  /** The kind a realm order picks a place for, and why the last tile picked would not do. */
  target?: { building?: Building['kind']; vehicle?: RealmVehiclePick; error?: string }
  /** The line a realm order picks the ends of, and why the last line picked would not do. */
  line?: { building: 'road' | 'wall'; from?: Tile; error?: string }
  /** The tile picked for it. */
  onTile: (x: number, y: number) => void
}

/** What the picked resident has at hand for the picks that take a carriage, boat or horse. */
interface PickHere {
  ownCarriage: { id: string } | undefined
  boatToRow: { id: string; ship?: boolean } | undefined
  boatToSteal: { id: string } | undefined
  stealable: { id: string } | undefined
  unhorsed: { id: string } | undefined
  horseToHitch: string | undefined
}

/** What a pick does once its tile is picked: `Game()`'s orders, and where it reports. */
interface PickActions {
  giveOrder: (order: OrderRequest, queued?: boolean) => Promise<string | undefined>
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
  sendGroup: (order: GroupOrder) => Promise<void> | void
  creativeMove: (residentIds: string[], x: number, y: number) => Promise<string | undefined>
  setScriptParam: (name: string, picked: { targetId: string | null }) => Promise<void>
  setWorkSettings: (buildingId: string, params: StartParamValues) => Promise<void>
  /** A planned step with all its places picked (`CONTEXT.md`: Planning ahead). */
  addPlanned: (plan: Plan) => Promise<void>
  /** A value picked for the form before a script starts (`CONTEXT.md`: Before it starts). */
  formTile: (x: number, y: number) => void
  paramSeen: (w: World) => ParamWorld
  planSeen: (w: World) => PlanWorld
  here: () => PickHere
  /** A right-click or long-press with nothing to pick and nobody to send: the tile menu. */
  tileMenu: (x: number, y: number, at: Tile) => void
  /** Cancel's part outside picking: the form's pick, a realm order picking its place. */
  cancelled: () => void
  orderError: (why: string | undefined) => void
  armyError: (why: string | undefined) => void
  groupError: (why: string | undefined) => void
  groupReportCleared: () => void
}

export interface PickInputs {
  world: World | null | undefined
  /** The residents picked: one gets a resident's pick, several a group's. */
  group: readonly Resident[]
  /** The Player's residents that take orders, to tell whom a group attacks. */
  own: readonly Resident[]
  /** The param the form before a script starts waits for, if any. */
  formPick: ScriptParam | undefined
  realm: RealmPick | undefined
  actions: PickActions
}

/** One step of the picked residents' pick: Build line's ends come in turn. */
const LINE_PAIRS: Partial<Record<Exclude<Picking, false>, Picking>> = {
  roadTo: 'roadFrom',
  wallTo: 'wallFrom',
}

export function usePick({ world, group, own, formPick, realm, actions }: PickInputs) {
  const [picking, setPicking] = useState<Picking>(false)
  /** The siege machine the picked resident pushes or aims once a tile is picked (`CONTEXT.md`: Siege machine). */
  const [pushing, setPushing] = useState<string | undefined>()
  const [haulSetup, setHaulSetup] = useState<HaulSetup>()
  const [armyPick, setArmyPick] = useState<ArmyPick>()
  // The param of the picked resident's script whose value the map is waiting for (`CONTEXT.md`:
  // Script parameter).
  const [paramPick, setParamPick] = useState<ScriptParam>()
  // The param of a workplace's Work settings whose value the map is waiting for (`CONTEXT.md`:
  // Workplace settings).
  const [workPick, setWorkPick] = useState<{ buildingId: string; param: ScriptParam }>()
  // The step being planned with the queue planner's Add step (`CONTEXT.md`: Queue, Planning
  // ahead): the map picks its places, then the card asks for what more it needs.
  const [plan, setPlan] = useState<Plan>()
  // A group order waiting for a tile, what it needs besides the tile, and a line's first end.
  const [groupPicking, setGroupPicking] = useState<GroupPicking>(false)
  const [groupPickWith, setGroupPickWith] = useState<GroupPickWith>({})
  const [groupLineFrom, setGroupLineFrom] = useState<Tile>()
  // The tile picked for the group to build on, which its card's Build menu is then about.
  const [groupBuildAt, setGroupBuildAt] = useState<Tile>()
  // The start picked for the picked resident's Build line, while they pick its end.
  const [lineFrom, setLineFrom] = useState<Tile>()
  /** What a wall line is built of, picked on the banner while its ends are picked (`CONTEXT.md`: Wood or stone). */
  const [wallMaterial, setWallMaterial] = useState<WallMaterial>('wood')
  // Where a pick is previewed: the tile under the pointer, or the one tapped on a touch screen.
  const [pickAt, setPickAt] = useState<Tile & { tapped?: boolean }>()

  const isGroup = group.length > 1
  const selected = group.length === 1 ? group[0] : undefined
  // The param whose value the map is waiting for: of the running script, for the form, or of a
  // workplace's Work settings.
  const pickingParam = paramPick ?? formPick ?? workPick?.param
  const target: PickTarget | undefined = pickTarget({
    picking,
    groupPicking,
    isGroup,
    armyPick,
    paramPick: pickingParam,
    plan,
    realm: realm?.target,
    realmLine: realm?.line,
  })
  // A new pick (or none) previews nothing until the pointer or a tap shows where.
  const pickKey = target ? pickPrompt(target, false) : ''
  useEffect(() => setPickAt(undefined), [pickKey])

  /**
   * A tile picked for the group (`CONTEXT.md`: Group): walking there (also by right-click),
   * working the workplace there, where to build, drive or haul to, a line's ends, the building to
   * tear down, the place to store at or fetch from, whom to attack or the wall to climb.
   */
  async function groupTile(x: number, y: number) {
    const mode = groupPicking
    setGroupPicking(false)
    if (!world) return
    if (mode === 'creativeMove') {
      actions.groupError(
        await actions.creativeMove(
          group.map((r) => r.id),
          x,
          y,
        ),
      )
      return
    }
    if (mode === 'build') {
      setGroupBuildAt({ x, y })
      return
    }
    if (mode === 'roadFrom' || mode === 'wallFrom') {
      // Then the line's other end.
      setGroupLineFrom({ x, y })
      setGroupPicking(mode === 'roadFrom' ? 'roadTo' : 'wallTo')
      return
    }
    setGroupBuildAt(undefined)
    actions.groupReportCleared()
    const fail = (why: string) => actions.groupError(why)
    const name = (b: Building) => BUILDING_NAMES[b.kind].toLowerCase()
    const realmId = world.home.realmId
    // A storage, a stable, a haven or one of the realm's carriages, to store at or fetch from.
    const place = (): Place | undefined => {
      const at = storePlaceAt(world, realmId, x, y)
      return at && { id: at.id, name: at.name }
    }
    // A wall or gate of another realm's city, or of none.
    const foreignWall = world.buildings.find(
      (b) =>
        isWallOrGate(b) &&
        covers(b, x, y) &&
        world.cities.find((c) => c.id === b.cityId)?.realmId !== realmId,
    )
    switch (mode) {
      case 'work': {
        const workplace = world.buildings.find(
          (b) =>
            // A site of a workplace too: Work builds it first (`CONTEXT.md`: Working a site).
            b.kind !== 'road' && covers(b, x, y) && MAX_WORKERS[b.kind] !== undefined,
        )
        if (!workplace) return fail('no workplace there')
        // What a smithy makes is picked for each worker on their own card.
        if (workplace.kind === 'smithy') return fail('pick what to make on each one’s card')
        return actions.sendGroup({ kind: 'work', workplace, name: name(workplace) })
      }
      case 'drive':
        return actions.sendGroup({ kind: 'drive', x, y })
      case 'row':
        return actions.sendGroup({ kind: 'row', x, y })
      case 'haul':
        if (!groupPickWith.haul) return
        return actions.sendGroup({ kind: 'haul', x, y, ...groupPickWith.haul })
      case 'roadTo':
      case 'wallTo':
        if (!groupLineFrom) return
        setGroupLineFrom(undefined)
        // Each gets the Build line task with the same line, so they share it (`CONTEXT.md`: Build line).
        return actions.sendGroup({
          kind: 'line',
          building: mode === 'roadTo' ? 'road' : 'wall',
          from: groupLineFrom,
          to: { x, y },
          ...(mode === 'wallTo' && wallMaterial === 'stone' ? { material: wallMaterial } : {}),
        })
      case 'tearDown': {
        // A building before a road sharing its tile.
        const there = world.buildings.filter((b) => BUILDABLE.includes(b.kind) && covers(b, x, y))
        const building = there.find((b) => b.kind !== 'road') ?? there[0]
        if (!building) return fail('nothing to tear down there')
        return actions.sendGroup({ kind: 'tearDown', building, name: name(building) })
      }
      case 'storeAt':
      case 'fetchFrom': {
        const at = place()
        if (!at) return fail('no storage, stable, haven, carriage or boat of yours there')
        if (mode === 'storeAt') return actions.sendGroup({ kind: 'store', to: at })
        return actions.sendGroup({ kind: 'fetch', good: groupPickWith.good ?? 'food', from: at })
      }
      case 'attack': {
        const target =
          world.residents.find((r) => r.x === x && r.y === y && !own.some((o) => o.id === r.id)) ??
          foreignWall
        if (!target) return fail('nobody of another realm there, and no wall or gate')
        return actions.sendGroup({ kind: 'attack', targetId: target.id })
      }
      case 'climb':
        if (!foreignWall) return fail('no wall or gate of another realm there')
        return actions.sendGroup({ kind: 'climb', wall: foreignWall })
      default:
        return actions.sendGroup({ kind: 'walkTo', x, y })
    }
  }

  /**
   * Orders the picked resident to walk to a tile, or, while picking where to drive, to drive the
   * carriage on their tile there, or, while picking a haul route's other stop, to haul between
   * their tile and that one, or, while picking a road's or wall's two ends, to build it along the
   * line between them with the Build line task (ADR 0002: the server checks it).
   */
  async function goTo(x: number, y: number) {
    const mode = picking
    setPicking(false)
    if (realm) return realm.onTile(x, y)
    if (formPick) return actions.formTile(x, y)
    if (paramPick) {
      setParamPick(undefined)
      if (!world) return
      const picked = paramPickAt(actions.paramSeen(world), paramPick.type, { x, y })
      if (typeof picked === 'string') actions.orderError(picked)
      else await actions.setScriptParam(paramPick.name, { targetId: picked.id })
      return
    }
    if (workPick) {
      setWorkPick(undefined)
      if (!world) return
      const picked = paramPickAt(actions.paramSeen(world), workPick.param.type, { x, y })
      if (typeof picked === 'string') actions.orderError(picked)
      else await actions.setWorkSettings(workPick.buildingId, { [workPick.param.name]: picked.id })
      return
    }
    if (armyPick) {
      setArmyPick(undefined)
      actions.armyError(
        await actions.sendOrder({ kind: armyPick.kind, armyId: armyPick.armyId, x, y }),
      )
      return
    }
    if (plan && nextPick(plan)) {
      if (!world) return
      const next = pickInto(actions.planSeen(world), plan, { x, y })
      if (nextPick(next) || planAsk(next)) setPlan(next)
      else await actions.addPlanned(next)
      return
    }
    if (isGroup) {
      await groupTile(x, y)
      return
    }
    if (!selected) return
    const { giveOrder, orderError } = actions
    if (mode === 'creativeMove') {
      orderError(await actions.creativeMove([selected.id], x, y))
      return
    }
    // One of a siege machine's crew pushes it there (`CONTEXT.md`: Siege machine).
    if (mode === 'push' && pushing) {
      const order = { kind: 'push', residentId: selected.id, machineId: pushing, x, y }
      orderError(await giveOrder(order, false))
      return
    }
    // One of a catapult's crew aims it at the wall on that tile (`CONTEXT.md`: Catapult).
    if (mode === 'throw' && pushing) {
      const order = { kind: 'throw', residentId: selected.id, machineId: pushing, x, y }
      orderError(await giveOrder(order, false))
      return
    }
    const here = actions.here()
    // Driving and hauling keep to the realm's; only Drive off takes another's (`CONTEXT.md`:
    // Stealing a carriage or horse), whatever else stands on the tile.
    const carriage = here.ownCarriage
    const rowed = mode === 'row' ? here.boatToRow : mode === 'rowOff' ? here.boatToSteal : undefined
    if (rowed) {
      // To the water tile, or the free water beside a land tile (`CONTEXT.md`: Rowing); another
      // organization's boat is stolen by it (Stealing a carriage or horse).
      // A ship is sailed by one of its crew, to Sea or to a haven (`CONTEXT.md`: Sailing).
      const kind = 'ship' in rowed && rowed.ship ? 'sail' : 'row'
      const order = { kind, residentId: selected.id, vesselId: rowed.id, x, y }
      orderError(await giveOrder(order))
      return
    }
    const driven = mode === 'driveOff' ? here.stealable : mode === 'drive' ? carriage : undefined
    if (driven) {
      const order = { kind: 'drive', residentId: selected.id, carriageId: driven.id, x, y }
      orderError(await giveOrder(order))
      return
    }
    // Only this names a stranger's horse, so only this steals one to pull the realm's carriage.
    if (mode === 'hitchOff' && here.unhorsed && here.horseToHitch) {
      const order = {
        kind: 'drive',
        residentId: selected.id,
        carriageId: here.unhorsed.id,
        horseId: here.horseToHitch,
        x,
        y,
      }
      orderError(await giveOrder(order, false))
      return
    }
    // With no carriage of theirs here, the boat beside them (`CONTEXT.md`: Haul route by water).
    const hauled = carriage ?? here.boatToRow
    if (mode === 'haul' && hauled && haulSetup) {
      // The Haul task: they run the Player's Haul (default) script (`CONTEXT.md`: Default script).
      const order = { kind: 'task', task: 'haul', residentId: selected.id, carriageId: hauled.id }
      orderError(await giveOrder({ ...order, x, y, ...haulSetup }))
      return
    }
    if (mode === 'roadFrom' || mode === 'wallFrom') {
      // Then the line's other end.
      setLineFrom({ x, y })
      setPicking(mode === 'roadFrom' ? 'roadTo' : 'wallTo')
      return
    }
    if ((mode === 'roadTo' || mode === 'wallTo') && lineFrom) {
      // The Build line task: they run the Player's Build line (default) script (`CONTEXT.md`: Build line).
      const building = mode === 'roadTo' ? 'road' : 'wall'
      const order = {
        kind: 'task',
        task: 'buildLine',
        residentId: selected.id,
        building,
        ...(building === 'wall' && wallMaterial === 'stone' ? { material: wallMaterial } : {}),
      }
      setLineFrom(undefined)
      orderError(await giveOrder({ ...order, from: lineFrom, to: { x, y } }))
      return
    }
    orderError(await giveOrder({ kind: 'walkTo', residentId: selected.id, x, y }))
  }

  /**
   * A tile clicked or tapped while picking (`pickTap`): a click picks it; a tap on a touch screen
   * previews it first, and a second tap there or Confirm picks it. A right-click or long-press
   * (`pressed`) with nothing picked and nobody to send opens the tile menu there instead.
   */
  const pickTile = (x: number, y: number, tap?: { touch: boolean }, pressed?: Tile) => {
    if (pressed && world && !target && !formPick && !selected && group.length <= 1) {
      const size = world.map.size
      return actions.tileMenu(wrap(x, size), wrap(y, size), pressed)
    }
    if (tap && target) {
      const next = pickTap(pickAt?.tapped ? pickAt : undefined, { x, y }, tap.touch)
      if ('preview' in next) return setPickAt({ ...next.preview, tapped: true })
    }
    setPickAt(undefined)
    void goTo(x, y)
  }

  // Cancel's part outside picking, as `Game()` last gave it: `cancel` stays the same function.
  const cancelled = useRef(actions.cancelled)
  cancelled.current = actions.cancelled
  /** Leaves pick mode without giving the order; the card comes back as it was. */
  const cancel = useCallback(() => {
    setPicking(false)
    setGroupPicking(false)
    setArmyPick(undefined)
    setParamPick(undefined)
    setWorkPick(undefined)
    setPlan(undefined)
    cancelled.current()
  }, [])

  /** Leaves the picks of the picked resident and the cards they come from (a tile was picked). */
  const drop = () => {
    setPicking(false)
    setArmyPick(undefined)
    setParamPick(undefined)
    setWorkPick(undefined)
    setPlan(undefined)
  }

  /**
   * What the pick would do under the pointer, or at the tile tapped on a touch screen
   * (`CONTEXT.md`: Picking a target); `seen` is only asked for while there is one.
   */
  function preview(
    seen: () => PreviewWorld,
    /** How long a resident's way takes them, on foot or by carriage. */
    arrivesIn: ReturnType<typeof arrivalOf> | undefined,
    /** Whether a carriage is another organization's (Drive off takes one). */
    isStrangers: (k: { id: string; realmId: string | null }) => boolean,
  ) {
    if (!world || !target || !pickAt) return undefined
    const what = previewPickOf(target, { lineFrom: isGroup ? groupLineFrom : lineFrom, plan })
    // A drive or haul goes from those standing on a carriage of the realm.
    const carriageAt = (r: Resident) =>
      world.carriages.find(
        (k) =>
          k.x === r.x &&
          k.y === r.y &&
          (picking === 'driveOff' ? isStrangers(k) : k.realmId === world.home.realmId),
      )
    const going = what.kind === 'way' && what.goer === 'carriage'
    const goers = group
      .filter((r) => !going || carriageAt(r))
      .map((r) => ({
        from: r,
        ticks: (path: readonly (readonly [number, number])[], goer: 'foot' | 'carriage') => {
          const way = { target: pickAt, path: path.map(([x, y]) => [x, y] as [number, number]) }
          const carriage = carriageAt(r)
          const order =
            goer === 'carriage' && carriage
              ? { kind: 'drive' as const, carriageId: carriage.id, ...way, progress: 0 }
              : { kind: 'walkTo' as const, ...way, progress: 0 }
          return arrivesIn?.(r, order)
        },
      }))
    return pickPreview(what, pickAt, seen(), goers)
  }

  return {
    /** The pick waiting for a tile, if one is. */
    target,
    /** The param whose value the map is waiting for, if one is. */
    pickingParam,
    /** Whether a click on the map picks a tile rather than a resident (`MapView`'s `picking`). */
    onMap:
      picking !== false ||
      armyPick !== undefined ||
      pickingParam !== undefined ||
      target?.kind === 'plan' ||
      (isGroup && groupPicking !== false) ||
      realm !== undefined,
    /** Whether an order of the picked residents or a planned step is picking. */
    ordering: picking !== false || groupPicking !== false || plan !== undefined,
    /** Where the pick is previewed, and whether a tap put it there. */
    pickAt,
    pickTile,
    /** The tile under the pointer: a tile tapped stays previewed until another is tapped. */
    pointerTile: (tile: Tile | undefined) => setPickAt((at) => (at?.tapped ? at : tile)),
    cancel,
    drop,
    /** As `drop`, and the group's pick and the tile it picked to build on too. */
    dropAll: () => {
      drop()
      setGroupPicking(false)
      setGroupBuildAt(undefined)
    },
    preview,
    wallMaterial,
    setWallMaterial,
    /** The picked resident's pick (`Picking`). */
    resident: {
      mode: picking,
      /** Starts `mode`, or leaves it when it is the one waiting (a line's either end). */
      toggle: (mode: Exclude<Picking, false>) =>
        setPicking((p) => (p === mode || (p && LINE_PAIRS[p] === mode) ? false : mode)),
      start: (mode: Exclude<Picking, false>) => setPicking(mode),
      /** Pushing a siege machine, or aiming a catapult, there. */
      startMachine: (mode: 'push' | 'throw', machineId: string) => {
        setPushing(machineId)
        setPicking(mode)
      },
      /** A haul route's other stop, carrying what `setup` says. */
      toggleHaul: (setup: HaulSetup) => {
        setHaulSetup(setup)
        setPicking((p) => (p === 'haul' ? false : 'haul'))
      },
      stop: () => setPicking(false),
    },
    /** The picked group's pick (`GroupPicking`). */
    group: {
      mode: groupPicking,
      start: (mode: GroupPicking, with_?: GroupPickWith) => {
        setGroupPicking(mode)
        setGroupPickWith(with_ ?? {})
        setGroupLineFrom(undefined)
        setGroupBuildAt(undefined)
      },
      toggleCreativeMove: () =>
        setGroupPicking((p) => (p === 'creativeMove' ? false : 'creativeMove')),
      /** The tile picked for the group to build on. */
      buildAt: groupBuildAt,
      built: () => setGroupBuildAt(undefined),
    },
    /** The open army's pick (`CONTEXT.md`: Army). */
    army: {
      pick: armyPick,
      set: (p: ArmyPick | undefined) => {
        setArmyPick(p)
        setPicking(false)
      },
      clear: () => setArmyPick(undefined),
    },
    /** A param of the picked resident's script (`CONTEXT.md`: Script parameter). */
    param: {
      name: paramPick?.name,
      toggle: (p: ScriptParam) => {
        setPicking(false)
        setParamPick((now) => (now?.name === p.name ? undefined : p))
      },
    },
    /** A param of a workplace's Work settings (`CONTEXT.md`: Workplace settings). */
    work: {
      pick: workPick,
      toggle: (buildingId: string, param: ScriptParam) => {
        setPicking(false)
        setParamPick(undefined)
        setWorkPick((now) =>
          now?.buildingId === buildingId && now.param.name === param.name
            ? undefined
            : { buildingId, param },
        )
      },
      clear: () => setWorkPick(undefined),
    },
    /** The step planned with Add step (`CONTEXT.md`: Planning ahead). */
    plan: {
      plan,
      set: setPlan,
      /** A new step starts: the resident's, group's and param's picks give way to it. */
      starting: () => {
        setPicking(false)
        setGroupPicking(false)
        setParamPick(undefined)
      },
    },
    /** The form before a script starts picks a value: the resident's and group's picks give way. */
    formPicking: () => {
      setPicking(false)
      setGroupPicking(false)
    },
    /** The picked resident's card closes. */
    cardClosed: () => {
      setPicking(false)
      setParamPick(undefined)
      setPlan(undefined)
    },
  }
}
