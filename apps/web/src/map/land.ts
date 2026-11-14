import type { LandRegion, LandWay, PlayerLand, RegionKind, WayKind } from '@csp/shared-types'
import { CHUNK_SIZE, chunksAcross } from '../shared/terrain.js'
import type { MapMark } from './preview-draw.js'

/*
 * The land as the Player knows it (`CONTEXT.md`: Region, Explored terrain): the region of every
 * tile they explored, the names of the regions they explored part of, and the passes and land
 * bridges they explored. The server sends nothing of land they have not explored (`LAND_PATH`).
 */

/** The colour of a pass's mark on the map. */
export const PASS_MARK_COLOR = 0xf2f2f2
/** The colour of a land bridge's mark on the map. */
export const LAND_BRIDGE_MARK_COLOR = 0x1f6fd1

/** Where a region's name is written on the map. */
export interface LandLabel {
  id: number
  name: string
  x: number
  y: number
}

/** The client's copy of the land the Player knows. */
export interface LandState {
  regions: ReadonlyMap<number, LandRegion>
  ways: readonly LandWay[]
  /** Each chunk's tiles by region id, row by row within the chunk; -1 for none or unknown. */
  chunks: ReadonlyMap<number, Int16Array>
  /** The kind of way on each tile of one the Player explored, by `y * size + x`. */
  wayTiles: ReadonlyMap<number, WayKind>
  /** One spot per region named, where its name is written. */
  labels: readonly LandLabel[]
}

/** A chunk's corner and its width and height, clipped to the map. */
function chunkBox(chunk: number, size: number) {
  const across = chunksAcross(size)
  const [x0, y0] = [(chunk % across) * CHUNK_SIZE, Math.floor(chunk / across) * CHUNK_SIZE]
  return { x0, y0, w: Math.min(CHUNK_SIZE, size - x0), h: Math.min(CHUNK_SIZE, size - y0) }
}

/**
 * Applies land from the server: each chunk it sends replaces that chunk, the regions it names
 * join those known, and its ways replace the ways (it always sends every way the Player knows).
 */
export function applyLand(state: LandState | null, update: PlayerLand, size: number): LandState {
  const regions = new Map(state?.regions ?? [])
  for (const r of update.regions) regions.set(r.id, r)
  const chunks = new Map(state?.chunks ?? [])
  for (const { chunk, runs } of update.chunks) {
    const { w, h } = chunkBox(chunk, size)
    const ids = new Int16Array(w * h).fill(-1)
    let at = 0
    for (let r = 0; r + 1 < runs.length; r += 2) {
      const [length, id] = [runs[r]!, runs[r + 1]!]
      if (id >= 0) ids.fill(id, at, Math.min(at + length, ids.length))
      at += length
    }
    chunks.set(chunk, ids)
  }
  const wayTiles = new Map<number, WayKind>()
  for (const way of update.ways) for (const t of way.tiles) wayTiles.set(t, way.kind)
  return {
    regions,
    ways: update.ways,
    chunks,
    wayTiles,
    labels: landLabels(regions, chunks, size),
  }
}

/**
 * Where each region's name goes: in the chunk holding most of the tiles of it the Player knows,
 * on the one of them nearest their middle there, so the name sits over land they explored.
 */
function landLabels(
  regions: ReadonlyMap<number, LandRegion>,
  chunks: ReadonlyMap<number, Int16Array>,
  size: number,
): LandLabel[] {
  const best = new Map<number, { chunk: number; count: number }>()
  for (const [chunk, ids] of chunks) {
    const counts = new Map<number, number>()
    for (const id of ids) if (id >= 0) counts.set(id, (counts.get(id) ?? 0) + 1)
    for (const [id, count] of counts) {
      const was = best.get(id)
      if (!was || count > was.count || (count === was.count && chunk < was.chunk))
        best.set(id, { chunk, count })
    }
  }
  const out: LandLabel[] = []
  for (const [id, { chunk }] of best) {
    const region = regions.get(id)
    const ids = chunks.get(chunk)
    if (!region || !ids) continue
    const { x0, y0, w } = chunkBox(chunk, size)
    let [sx, sy, n] = [0, 0, 0]
    ids.forEach((r, i) => {
      if (r !== id) return
      sx += i % w
      sy += Math.floor(i / w)
      n++
    })
    const [cx, cy] = [sx / n, sy / n]
    let [bx, by, bd] = [0, 0, Infinity]
    ids.forEach((r, i) => {
      if (r !== id) return
      const [x, y] = [i % w, Math.floor(i / w)]
      const d = (x - cx) ** 2 + (y - cy) ** 2
      if (d < bd) [bx, by, bd] = [x, y, d]
    })
    out.push({ id, name: region.name, x: x0 + bx, y: y0 + by })
  }
  return out.sort((a, b) => a.id - b.id)
}

/** What the tile card says of a tile's region: its name, its kind and the way on it, if any. */
export interface TileRegion {
  name: string
  kind: RegionKind
  way?: WayKind
}

/** The region of tile (x, y) as the Player knows it; undefined on water or unexplored land. */
export function regionAt(
  state: LandState | null | undefined,
  size: number,
  x: number,
  y: number,
): TileRegion | undefined {
  if (!state) return undefined
  const [tx, ty] = [((x % size) + size) % size, ((y % size) + size) % size]
  const across = chunksAcross(size)
  const chunk = Math.floor(ty / CHUNK_SIZE) * across + Math.floor(tx / CHUNK_SIZE)
  const ids = state.chunks.get(chunk)
  if (!ids) return undefined
  const { x0, y0, w } = chunkBox(chunk, size)
  const id = ids[(ty - y0) * w + (tx - x0)]
  const region = id === undefined || id < 0 ? undefined : state.regions.get(id)
  if (!region) return undefined
  const way = state.wayTiles.get(ty * size + tx)
  return { name: region.name, kind: region.kind, ...(way ? { way } : {}) }
}

/** What a way is called on the tile card and the map. */
export const WAY_NAMES: Record<WayKind, string> = { pass: 'pass', landBridge: 'land bridge' }

/**
 * The tile card's line for a tile's region: "Heartland of Ashvale", "Frontier: Greywold",
 * "Island: Tern", with "· pass" or "· land bridge" on a tile of one.
 */
export function regionLine(r: TileRegion): string {
  const named =
    r.kind === 'heartland'
      ? `Heartland of ${r.name}`
      : r.kind === 'frontier'
        ? `Frontier: ${r.name}`
        : `Island: ${r.name}`
  return r.way ? `${named} · ${WAY_NAMES[r.way]}` : named
}

/** The marks of the passes and land bridges the Player knows. */
export function landMarks(state: LandState | null | undefined): MapMark[] {
  return (state?.ways ?? []).map((w) => ({
    x: w.x,
    y: w.y,
    color: w.kind === 'pass' ? PASS_MARK_COLOR : LAND_BRIDGE_MARK_COLOR,
  }))
}
