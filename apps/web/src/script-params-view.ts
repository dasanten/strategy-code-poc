import {
  MAX_WORKERS,
  buildingRealm,
  isAt,
  type Building,
  type Carriage,
  type City,
  type ScriptParam,
  type ScriptParamType,
  type ScriptParamValue,
} from '@csp/shared'
import { BUILDING_NAMES } from './map/palette.js'

/**
 * The resident card's script param fields (`CONTEXT.md`: Script parameter): what each value
 * picked names, and what a tap on the map picks for a param of a type. The server checks the
 * pick again (ADR 0002).
 */

/** What the card needs of the world to name and pick param values. */
export interface ParamWorld {
  buildings: readonly Building[]
  /** The buildings the Player remembers out of sight (`CONTEXT.md`: Last seen). */
  lastSeen: readonly Building[]
  carriages: readonly Pick<Carriage, 'id' | 'x' | 'y' | 'realmId'>[]
  cities: readonly Pick<City, 'id' | 'realmId'>[]
  realmId: string
  /** The map's size, for footprints across its edge. */
  size: number
}

/** The buildings a storage param may name besides carriages: those a store or fetch goes to. */
const STORAGE_KINDS: readonly string[] = ['storage', 'stable']

const ownBuilding = (w: ParamWorld, b: Building) => buildingRealm(w, b) === w.realmId

/** A workplace or construction site, which anyone may work (`CONTEXT.md`: Holding a workplace). */
export const anyonesToWork = (b: Building) => !!b.site || MAX_WORKERS[b.kind] !== undefined

/**
 * Whether a building fits a param of `type`: the realm's own, finished for a storage param; for a
 * building param also a workplace or site of anyone's.
 */
function buildingFits(w: ParamWorld, type: ScriptParamType, b: Building): boolean {
  if (type === 'building') return ownBuilding(w, b) || anyonesToWork(b)
  return ownBuilding(w, b) && STORAGE_KINDS.includes(b.kind) && !b.site
}

/**
 * What a tap on the tile picks for a param of `type`: the building there that fits, in sight or
 * else as last seen, or for a storage param one of the realm's carriages there; why nothing, as a
 * string.
 */
export function paramPickAt(
  w: ParamWorld,
  type: ScriptParamType,
  at: { x: number; y: number },
): { id: string } | string {
  const on = (list: readonly Building[]) =>
    list.find((x) => x.kind !== 'road' && isAt(at, x, w.size))
  const b = on(w.buildings) ?? on(w.lastSeen)
  if (b && buildingFits(w, type, b)) return { id: b.id }
  if (type === 'storage') {
    const k = w.carriages.find((x) => x.x === at.x && x.y === at.y && x.realmId === w.realmId)
    if (k) return { id: k.id }
    return 'pick a storage, a stable or a carriage of yours'
  }
  return 'pick a building of yours, or a workplace or construction site'
}

/**
 * How the card names a picked value: the building or carriage and where, "(last seen)" when the
 * building is remembered out of sight; null when it is neither in sight nor remembered.
 */
export function paramValueLabel(w: ParamWorld, id: string): string | null {
  const name = (b: Building) =>
    `${b.site ? 'Site: ' : ''}${BUILDING_NAMES[b.kind]} at ${b.x}, ${b.y}`
  const b = w.buildings.find((x) => x.id === id)
  if (b) return name(b)
  const was = w.lastSeen.find((x) => x.id === id)
  if (was) return `${name(was)} (last seen)`
  const k = w.carriages.find((x) => x.id === id)
  if (k) return `Carriage at ${k.x}, ${k.y}`
  return null
}

/**
 * What a param's `//` comment says (`CONTEXT.md`: Script parameter): what it is for, and after
 * "none:" what the script uses while none is picked. "where the output goes; none: the nearest
 * storage of my realm" is for "where the output goes", unset "the nearest storage of my realm".
 */
export function paramNote(description: string | undefined): { purpose?: string; unset?: string } {
  if (!description) return {}
  const m = /^(.*?)[;,]?\s*\bnone:\s*(.*)$/.exec(description)
  if (!m) return { purpose: description }
  const purpose = m[1]!.trim()
  const unset = m[2]!.trim()
  return { ...(purpose && { purpose }), ...(unset && { unset }) }
}

/**
 * What a param field shows as the value the script uses (`CONTEXT.md`: Script parameter): the one
 * picked, else what the script uses with it unset. Working by a workplace's settings
 * (`CONTEXT.md`: Workplace settings), the workplace's value ("4, from the workplace"); else a
 * number's default ("1, the default"); a default script's target param the one on the resident's
 * tile ("Farm at 10, 5, on their tile"); any other what its comment says after "none:", else
 * "none picked". `set` is whether the Player picked it for the resident.
 */
export function effectiveParam(
  p: Pick<ScriptParam, 'name' | 'type' | 'default' | 'description'>,
  value: ScriptParamValue | undefined,
  at: {
    /** How a picked value is named; null when it is out of sight. */
    label: (id: string) => string | null
    /** The script's target param (`targetParam`), which unset is the one they stand on. */
    target?: string
    /** For the target param, what on their tile it would be, named; null for nothing that fits. */
    onTile?: string | null
    /** The workplace's value, working by its settings. */
    workplace?: ScriptParamValue
  },
): { text: string; set: boolean } {
  const from = at.workplace
  if (value === undefined && from !== undefined) {
    if (p.type === 'number' && typeof from === 'number')
      return { text: `${from}, from the workplace`, set: false }
    if (p.type !== 'number' && typeof from === 'string')
      return { text: `${at.label(from) ?? 'out of sight'}, from the workplace`, set: false }
  }
  if (p.type === 'number') {
    if (typeof value === 'number') return { text: String(value), set: true }
    if (p.default !== undefined) return { text: `${p.default}, the default`, set: false }
  } else if (typeof value === 'string') {
    return { text: at.label(value) ?? 'out of sight', set: true }
  } else if (p.name === at.target && at.onTile !== undefined) {
    return {
      text: at.onTile === null ? 'none on their tile' : `${at.onTile}, on their tile`,
      set: false,
    }
  }
  return { text: paramNote(p.description).unset ?? 'none picked', set: false }
}

/** What a param of `type` would be on the tile, named (`paramValueLabel`); null for nothing that fits. */
export function paramOnTile(
  w: ParamWorld,
  type: ScriptParamType,
  at: { x: number; y: number },
): string | null {
  const got = paramPickAt(w, type, at)
  return typeof got === 'string' ? null : paramValueLabel(w, got.id)
}
