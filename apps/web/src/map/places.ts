import type { Graphics } from 'pixi.js'
import {
  FOOTPRINT,
  covers,
  type Building,
  type ResidentOrder,
  type SeenCarriage,
  type SeenResident,
} from '@csp/shared'
import { tileToScreen, type Camera, type Size } from './camera.js'
import { LEADER_COLOR } from './palette.js'
import type { Spot } from './unit-tokens.js'

/**
 * A place a picked resident's plan points at, as the map outlines it (`CONTEXT.md`: Places of the
 * picked): a building's whole footprint (or a haul stop's tile with none on it), or a carriage's
 * token.
 */
export type Place =
  | { kind: 'footprint'; key: string; x: number; y: number; side: number }
  | { kind: 'carriage'; id: string }

/** What the places are looked up in: only what the Player knows, in sight or last seen. */
interface PlaceWorld {
  residents: readonly Pick<SeenResident, 'id' | 'order' | 'script'>[]
  buildings: readonly Pick<Building, 'id' | 'kind' | 'x' | 'y' | 'site'>[]
  lastSeen?: { buildings: readonly Pick<Building, 'id' | 'kind' | 'x' | 'y' | 'site'>[] }
  carriages: readonly Pick<SeenCarriage, 'id'>[]
  map: { size: number }
}

/** Where an order heads for: a building or carriage by id, or a tile (and what is built there). */
type Aim = { id: string } | { at: { x: number; y: number }; site?: Building['kind'] }

/**
 * The places a resident's current order heads for: the workplace of Work, the site of Build (the
 * one of its kind on its tile, while not on it yet), the storage or carriage of Store and Fetch,
 * both stops of a haul (not an army it supplies, which moves), and the building of the other
 * orders done at one.
 */
export function orderAims(o: ResidentOrder | null | undefined): Aim[] {
  switch (o?.kind) {
    case 'workAt':
    case 'tearDown':
    case 'teach':
    case 'train':
      return [{ id: o.buildingId }]
    case 'breed':
      return [{ id: o.stableId }]
    case 'climb':
      return [{ id: o.wallId }]
    case 'build':
      return [o.siteId ? { id: o.siteId } : { at: o.at, site: o.building }]
    case 'store':
    case 'fetch': {
      const p = o.kind === 'store' ? o.to : o.from
      return [{ id: p.kind === 'storage' ? p.storageId : p.carriageId }]
    }
    case 'haul':
      return o.toArmy === undefined ? [{ at: o.from }, { at: o.to }] : [{ at: o.from }]
    default:
      return []
  }
}

/** The ids the script a resident runs has picked for its params: buildings, storages, carriages. */
export function paramAims(r: Pick<SeenResident, 'script'>): Aim[] {
  const params = r.script?.params ?? {}
  return Object.values(params).flatMap((v) => (typeof v === 'string' ? [{ id: v }] : []))
}

/**
 * The places the picked residents point at (`CONTEXT.md`: Places of the picked): what their
 * script's params name and where their current order heads, each once. Only places the Player
 * knows: buildings in sight or last seen (the one in sight first), carriages in sight; a haul stop
 * with no building on it is its tile.
 */
export function pickedPlaces(world: PlaceWorld, picked: readonly string[]): Place[] {
  const { size } = world.map
  const known = [...world.buildings, ...(world.lastSeen?.buildings ?? [])]
  const footprint = (b: (typeof known)[number]): Place => ({
    kind: 'footprint',
    key: b.id,
    x: b.x,
    y: b.y,
    side: FOOTPRINT[b.kind],
  })
  const place = (aim: Aim): Place | undefined => {
    if ('id' in aim) {
      const b = known.find((x) => x.id === aim.id)
      if (b) return footprint(b)
      const k = world.carriages.find((x) => x.id === aim.id)
      return k && { kind: 'carriage', id: k.id }
    }
    const { x, y } = aim.at
    const b = known.find(
      (b) =>
        (aim.site ? b.kind === aim.site && !!b.site : b.kind !== 'road') && covers(b, x, y, size),
    )
    if (b) return footprint(b)
    // A build not laid out yet shows as its planned footprint instead (`map/plans.ts`).
    return aim.site ? undefined : { kind: 'footprint', key: `${x},${y}`, x, y, side: 1 }
  }
  const out = new Map<string, Place>()
  for (const id of picked) {
    const r = world.residents.find((u) => u.id === id)
    if (!r) continue
    for (const aim of [...paramAims(r), ...orderAims(r.order)]) {
      const p = place(aim)
      if (p) out.set(p.kind === 'carriage' ? p.id : p.key, p)
    }
  }
  return [...out.values()]
}

/**
 * Draws the picked residents' places in the way's colour: a footprint as a frame just outside all
 * its tiles (an own building's plate is edged in the same colour right on them), a carriage as a
 * ring round its token where it was drawn (`spots`).
 */
export function drawPlaces(
  g: Graphics,
  cam: Camera,
  view: Size,
  size: number,
  places: readonly Place[],
  spots: ReadonlyMap<string, Spot>,
) {
  const tile = cam.scale
  const out = Math.max(3, tile * 0.12)
  let any = false
  for (const p of places) {
    if (p.kind === 'carriage') {
      const spot = spots.get(p.id)
      if (!spot) continue
      g.circle(spot.x, spot.y, spot.r * 1.3)
      any = true
      continue
    }
    const [sx, sy] = tileToScreen(cam, view, size, p.x, p.y)
    const w = p.side * tile
    if (sx > view.width || sy > view.height || sx + w < 0 || sy + w < 0) continue
    g.roundRect(sx - out, sy - out, w + 2 * out, w + 2 * out, out)
    any = true
  }
  // A stroke with nothing drawn since the last one would paint the last one's shapes again (Pixi).
  if (any) g.stroke({ width: 2.5, color: LEADER_COLOR, join: 'round' })
}
