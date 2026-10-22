import { CHUNK_SIZE, Terrain, UNEXPLORED, chunksAcross, wrap, type TerrainChunk } from '@csp/shared'
import { TERRAIN_COLORS } from './palette.js'

/**
 * Painted board-game terrain (ADR 0008): chunk textures with ragged, organic edges between
 * terrain types and a little shading within each, and small marks (trees, hill arcs, peaks,
 * waves, grass tufts) for the closer zooms. Everything here follows from map positions alone, so
 * edges join across chunk borders and where the map's sides meet.
 */

/** Texture pixels per tile in a terrain chunk texture. */
export const TERRAIN_TEXELS = 4
/** From this many screen pixels per tile up, terrain marks are drawn. */
export const MARK_SCALE = 10

/** How far (in tiles) a tile's colour may reach into its neighbours, at most. */
const EDGE_REACH = 0.65
/** Texture pixels between the points of the noise that bends the edges. */
const EDGE_CELL = 6
/** Shading: broad patches and a fine grain, each this much lighter or darker at most. */
const PATCH_CELL = 28
const PATCH_SHADE = 0.06
const GRAIN_CELL = 3
const GRAIN_SHADE = 0.03

/** A steady pseudo-random number in [0, 1) for a lattice point (the same as terrain generation). */
export function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Smooth value noise in [0, 1) at (px, py) of a picture `period` pixels across whose sides join,
 * on a lattice about `cell` pixels apart. The lattice fits the period exactly, so the noise
 * repeats every `period` pixels and joins where the map's sides do.
 */
export function smoothNoise(
  px: number,
  py: number,
  cell: number,
  period: number,
  seed: number,
): number {
  // Runs for every texture pixel several times over, so it stays free of allocations.
  const cells = Math.max(1, Math.round(period / cell))
  const gx = (wrap(px, period) / period) * cells
  const gy = (wrap(py, period) / period) * cells
  const ix = Math.floor(gx)
  const iy = Math.floor(gy)
  const fx = gx - ix
  const fy = gy - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const x0 = ix % cells
  const y0 = iy % cells
  const x1 = (ix + 1) % cells
  const y1 = (iy + 1) % cells
  const h00 = hash(x0, y0, seed)
  const h01 = hash(x0, y1, seed)
  const a = h00 + (hash(x1, y0, seed) - h00) * ux
  const b = h01 + (hash(x1, y1, seed) - h01) * ux
  return a + (b - a) * uy
}

/**
 * The tile whose colour shows at texture pixel (px, py) of the whole map, as a tile offset from
 * the tile the pixel lies in (each of -1, 0 or 1): near a border the noise pushes a pixel into the
 * tile next to it, so borders between terrain types come out ragged.
 */
export function edgeOffset(px: number, py: number, mapSize: number): [number, number] {
  const period = mapSize * TERRAIN_TEXELS
  return [edgeStep(px, py, px, period, 21), edgeStep(px, py, py, period, 22)]
}

/** `edgeOffset` along one direction, `along` being px or py. */
function edgeStep(px: number, py: number, along: number, period: number, seed: number): number {
  const jitter = (smoothNoise(px, py, EDGE_CELL, period, seed) - 0.5) * 2 * EDGE_REACH
  return Math.floor((along + 0.5) / TERRAIN_TEXELS + jitter) - Math.floor(along / TERRAIN_TEXELS)
}

/** How much lighter (above 1) or darker a texture pixel of the whole map is shaded. */
export function shadeAt(px: number, py: number, mapSize: number): number {
  const period = mapSize * TERRAIN_TEXELS
  return (
    1 +
    (smoothNoise(px, py, PATCH_CELL, period, 23) - 0.5) * 2 * PATCH_SHADE +
    (smoothNoise(px, py, GRAIN_CELL, period, 24) - 0.5) * 2 * GRAIN_SHADE
  )
}

/**
 * `smoothNoise` for every pixel of a `side` × `side` square from (ox, oy), row by row. Much
 * quicker than asking pixel by pixel: each lattice point is hashed once. The square must not
 * cross the period's end.
 */
export function noiseField(
  ox: number,
  oy: number,
  side: number,
  cell: number,
  period: number,
  seed: number,
): Float64Array {
  const cells = Math.max(1, Math.round(period / cell))
  // Lattice column and smoothed fraction of each pixel column, and the same for the rows.
  const axis = (o: number) => {
    const at = new Int32Array(side)
    const frac = new Float64Array(side)
    for (let p = 0; p < side; p++) {
      const g = (wrap(o + p, period) / period) * cells
      at[p] = Math.floor(g)
      const f = g - at[p]!
      frac[p] = f * f * (3 - 2 * f)
    }
    return { at, frac, first: at[0]!, span: at[side - 1]! - at[0]! + 2 }
  }
  const xs = axis(ox)
  const ys = axis(oy)
  const lattice = new Float64Array(xs.span * ys.span)
  for (let j = 0; j < ys.span; j++) {
    for (let i = 0; i < xs.span; i++) {
      lattice[j * xs.span + i] = hash((xs.first + i) % cells, (ys.first + j) % cells, seed)
    }
  }
  const out = new Float64Array(side * side)
  for (let py = 0; py < side; py++) {
    const row = (ys.at[py]! - ys.first) * xs.span
    const uy = ys.frac[py]!
    for (let px = 0; px < side; px++) {
      const k = row + xs.at[px]! - xs.first
      const ux = xs.frac[px]!
      const h00 = lattice[k]!
      const h01 = lattice[k + xs.span]!
      const a = h00 + (lattice[k + 1]! - h00) * ux
      const b = h01 + (lattice[k + xs.span + 1]! - h01) * ux
      out[py * side + px] = a + (b - a) * uy
    }
  }
  return out
}

/**
 * The terrain bytes of a chunk by its position (already brought onto the map), or undefined while
 * it is explored but not loaded yet. Chunks the Player never explored give all `UNEXPLORED`.
 */
export type ChunkTiles = (cx: number, cy: number) => Uint8Array | undefined

/** A chunk's terrain bytes where the Player hasn't been at all. */
export const UNEXPLORED_TILES = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(UNEXPLORED)

/**
 * A chunk's terrain texture, `TERRAIN_TEXELS` pixels per tile, as RGBA. Its edges reach into the
 * eight chunks around it; where one of those isn't loaded yet the chunk's own tile shows instead,
 * and `missing` lists those chunks (by index) so the texture can be made again once they are.
 */
export function terrainPixels(
  chunk: TerrainChunk,
  mapSize: number,
  tilesOf: ChunkTiles,
): { pixels: Uint8ClampedArray; missing: number[] } {
  const across = chunksAcross(mapSize)
  // The chunk and the eight around it, by (dy + 1) * 3 + (dx + 1).
  const around: (Uint8Array | undefined)[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      around.push(
        dx === 0 && dy === 0
          ? chunk.tiles
          : tilesOf(wrap(chunk.cx + dx, across), wrap(chunk.cy + dy, across)),
      )
    }
  }
  const missing = new Set<number>()
  const side = CHUNK_SIZE * TERRAIN_TEXELS
  const [ox, oy] = [chunk.cx * side, chunk.cy * side]
  const period = mapSize * TERRAIN_TEXELS
  const field = (cell: number, seed: number) => noiseField(ox, oy, side, cell, period, seed)
  const [edgeX, edgeY] = [field(EDGE_CELL, 21), field(EDGE_CELL, 22)]
  const [patch, grain] = [field(PATCH_CELL, 23), field(GRAIN_CELL, 24)]
  const pixels = new Uint8ClampedArray(side * side * 4)
  for (let py = 0; py < side; py++) {
    const ly = Math.floor(py / TERRAIN_TEXELS)
    const ry = (py + 0.5) / TERRAIN_TEXELS
    for (let px = 0; px < side; px++) {
      const lx = Math.floor(px / TERRAIN_TEXELS)
      const n = py * side + px
      // As `edgeOffset` and `shadeAt`, from the noise worked out for the whole chunk at once.
      let sx = Math.floor((px + 0.5) / TERRAIN_TEXELS + (edgeX[n]! - 0.5) * 2 * EDGE_REACH)
      let sy = Math.floor(ry + (edgeY[n]! - 0.5) * 2 * EDGE_REACH)
      const nx = sx < 0 ? 0 : sx >= CHUNK_SIZE ? 2 : 1
      const ny = sy < 0 ? 0 : sy >= CHUNK_SIZE ? 2 : 1
      let tiles = around[ny * 3 + nx]
      if (!tiles) {
        missing.add(wrap(chunk.cy + ny - 1, across) * across + wrap(chunk.cx + nx - 1, across))
        tiles = chunk.tiles
        sx = lx
        sy = ly
      }
      const t = tiles[wrap(sy, CHUNK_SIZE) * CHUNK_SIZE + wrap(sx, CHUNK_SIZE)]!
      const c = TERRAIN_COLORS[t] ?? 0xff00ff
      // Unexplored terrain stays flat: nothing is known about it.
      const shade =
        t === UNEXPLORED
          ? 1
          : 1 + (patch[n]! - 0.5) * 2 * PATCH_SHADE + (grain[n]! - 0.5) * 2 * GRAIN_SHADE
      const i = n * 4
      pixels[i] = (c >> 16) * shade
      pixels[i + 1] = ((c >> 8) & 0xff) * shade
      pixels[i + 2] = (c & 0xff) * shade
      pixels[i + 3] = 255
    }
  }
  return { pixels, missing: [...missing] }
}

/** A small dark mark that says what the terrain is (ADR 0008). */
export type TerrainMarkKind = 'tree' | 'trees' | 'hill' | 'peak' | 'wave' | 'tuft'

export interface TerrainMark {
  kind: TerrainMarkKind
  /** Where its middle is, in tiles from the chunk's corner. */
  x: number
  y: number
}

/**
 * The marks on a chunk's explored tiles: one or two trees on every forest tile, and on some
 * tiles a hill arc, a peak, a wave or a grass tuft. Each sits somewhere near the middle of its
 * tile, the same place every time.
 */
export function terrainMarks(chunk: TerrainChunk): TerrainMark[] {
  const marks: TerrainMark[] = []
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const [x, y] = [chunk.cx * CHUNK_SIZE + lx, chunk.cy * CHUNK_SIZE + ly]
      const r = hash(x, y, 31)
      const kind = markKind(chunk.tiles[ly * CHUNK_SIZE + lx]!, r)
      if (kind) marks.push({ kind, x: lx + 0.3 + 0.4 * r, y: ly + 0.3 + 0.4 * hash(x, y, 32) })
    }
  }
  return marks
}

function markKind(t: number, r: number): TerrainMarkKind | undefined {
  switch (t) {
    case Terrain.Forest:
      return r < 0.5 ? 'tree' : 'trees'
    case Terrain.Hills:
      return r < 0.7 ? 'hill' : undefined
    case Terrain.Mountain:
      return r < 0.8 ? 'peak' : undefined
    case Terrain.Lake:
    case Terrain.Sea:
      return r < 0.35 ? 'wave' : undefined
    case Terrain.Plains:
      return r < 0.12 ? 'tuft' : undefined
    default:
      return undefined
  }
}
