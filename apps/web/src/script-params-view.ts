import { isAt, type Building, type Carriage, type City, type ScriptParamType } from '@csp/shared'
import { BUILDING_NAMES } from './map/palette.js'

/**
 * The resident card's script param fields (`CONTEXT.md`: Script parameter): what each value
 * picked names, and what a tap on the map picks for a param of a type. The server checks the
 * pick again (ADR 0002).
 */

/** What the card needs of the world to name and pick param values. */
export interface ParamWorld {
  buildings: readonly Building[]
  carriages: readonly Pick<Carriage, 'id' | 'x' | 'y' | 'realmId'>[]
  cities: readonly Pick<City, 'id' | 'realmId'>[]
  realmId: string
  /** The map's size, for footprints across its edge. */
  size: number
}

/** The buildings a storage param may name besides carriages: those a store or fetch goes to. */
const STORAGE_KINDS: readonly string[] = ['storage', 'stable']

const ownBuilding = (w: ParamWorld, b: Building) =>
  w.cities.some((c) => c.id === b.cityId && c.realmId === w.realmId)

/** Whether a building fits a param of `type`: the realm's own, finished for a storage param. */
function buildingFits(w: ParamWorld, type: ScriptParamType, b: Building): boolean {
  if (!ownBuilding(w, b)) return false
  return type === 'building' || (STORAGE_KINDS.includes(b.kind) && !b.site)
}

/**
 * What a tap on the tile picks for a param of `type`: the realm's building there that fits, or
 * for a storage param one of its carriages there; why nothing, as a string.
 */
export function paramPickAt(
  w: ParamWorld,
  type: ScriptParamType,
  at: { x: number; y: number },
): { id: string } | string {
  const b = w.buildings.find((x) => x.kind !== 'road' && isAt(at, x, w.size))
  if (b && buildingFits(w, type, b)) return { id: b.id }
  if (type === 'storage') {
    const k = w.carriages.find((x) => x.x === at.x && x.y === at.y && x.realmId === w.realmId)
    if (k) return { id: k.id }
    return 'pick a storage, a stable or a carriage of yours'
  }
  return 'pick a building or construction site of yours'
}

/** How the card names a picked value: the building or carriage and where; null out of sight. */
export function paramValueLabel(w: ParamWorld, id: string): string | null {
  const b = w.buildings.find((x) => x.id === id)
  if (b) return `${b.site ? 'Site: ' : ''}${BUILDING_NAMES[b.kind]} at ${b.x}, ${b.y}`
  const k = w.carriages.find((x) => x.id === id)
  if (k) return `Carriage at ${k.x}, ${k.y}`
  return null
}
