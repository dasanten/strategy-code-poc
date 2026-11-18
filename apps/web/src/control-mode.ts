import {
  mapPickAt,
  tilePick,
  type MapPick,
  type Pickable,
  type PickWorld,
} from './map/selection.js'

/**
 * Control mode (`CONTEXT.md`: Control mode; ADR 0041): how the Player gives orders. In unit
 * control mode they pick a resident, a group or an army, then say what they do; in realm control
 * mode they say what is to be done and where, then who does it. Only the UI: the mode is kept
 * per browser, never in the world.
 */
export type ControlMode = 'unit' | 'realm'

const CONTROL_MODE_KEY = 'csp.controlMode'

/** The control mode the Player left this browser in; a new Player starts in unit control mode. */
export function rememberedControlMode(
  storage: () => Pick<Storage, 'getItem'> = () => localStorage,
): ControlMode {
  try {
    if (storage().getItem(CONTROL_MODE_KEY) === 'realm') return 'realm'
  } catch {
    // Storage can be off (a private window); then it starts as in a fresh browser.
  }
  return 'unit'
}

export function rememberControlMode(
  mode: ControlMode,
  storage: () => Pick<Storage, 'setItem'> = () => localStorage,
): void {
  try {
    storage().setItem(CONTROL_MODE_KEY, mode)
  } catch {
    // Not remembered, which only costs a click next time.
  }
}

/** The other control mode, as the switch and Tab flip it. */
export function flipped(mode: ControlMode): ControlMode {
  return mode === 'unit' ? 'realm' : 'unit'
}

/**
 * Whether a key press flips the control mode: Tab alone, and not while typing, where Tab moves
 * on to the next field as ever.
 */
export function flipsControlMode(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  typing: boolean
}): boolean {
  return e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.typing
}

/**
 * What a click on the map picks in a control mode, the tile `(tx, ty)` being under the point
 * `(sx, sy)` on screen. Unit control mode is Picking on the map (`mapPickAt`). Realm control
 * mode picks a building on the tile, else a carriage or loose horse of the Player's (it counts
 * as one), else the bare tile: residents are drawn but never picked, alone or as a stack, so a
 * crowded tile is still easy to build on. `own` is the Player's residents on screen
 * (`pickables`); realm control mode does not look at them.
 */
export function controlPickAt(
  mode: ControlMode,
  own: readonly Pickable[],
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  world: PickWorld,
): MapPick {
  if (mode === 'realm') return tilePick(tx, ty, world)
  return mapPickAt(own, sx, sy, tx, ty, world)
}

/**
 * What the Player has picked besides the map, as the control mode cares about it: a resident or
 * a group, or an army whose order waits for a target.
 */
export interface Picked {
  residents: number
  army: boolean
}

/**
 * The control mode after something was picked: picking a resident, a group or an army some
 * other way than a map click (the Residents list, a saved group's key, the Armies drawer, a
 * notice) switches to unit control mode, where those are commanded.
 */
export function modeAfterPick(mode: ControlMode, picked: Picked): ControlMode {
  return picked.residents > 0 || picked.army ? 'unit' : mode
}

/** What the realm bar says beside its orders (`CONTEXT.md`: Realm order). */
export const REALM_BAR_HINT =
  'What, where, then who. A click picks a building or a tile, never a resident.'

/** An order the realm bar starts (`CONTEXT.md`: Realm order): one that begins with a kind or a place. */
export type RealmBarOrder = 'build' | 'walkTo' | 'explore' | 'runScript' | 'relocate'

/** The realm bar's orders, in its order, each with what its button says on hover. */
export const REALM_BAR_ORDERS: readonly { id: RealmBarOrder; label: string; title: string }[] = [
  { id: 'build', label: 'Build', title: 'Build: pick what, then where, then who builds it' },
  { id: 'walkTo', label: 'Walk to', title: 'Walk to: pick where, then who walks there' },
  { id: 'explore', label: 'Explore', title: 'Explore: what to look for, then who goes' },
  { id: 'runScript', label: 'Run script', title: 'Run script: pick the script, then who runs it' },
  { id: 'relocate', label: 'Relocate', title: 'Relocate: pick the city, then who moves there' },
]
