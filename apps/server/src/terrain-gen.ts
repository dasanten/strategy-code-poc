import {
  MAP_DIAMETER,
  OFF_MAP,
  SEA_EDGE_SHARE,
  TERRAIN_SHARES,
  Terrain,
  isInsideDisc,
  type TerrainMap,
} from '@csp/shared'

/** Integer hash of a lattice point, the basis of the seeded noise below. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1) with features about `1 / freq` tiles apart. */
function valueNoise(x: number, y: number, freq: number, seed: number): number {
  const fx = x * freq
  const fy = y * freq
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const a = hash(ix, iy, seed)
  const b = hash(ix + 1, iy, seed)
  const c = hash(ix, iy + 1, seed)
  const d = hash(ix + 1, iy + 1, seed)
  const top = a + (b - a) * sx
  const bottom = c + (d - c) * sx
  return top + (bottom - top) * sy
}

/** Layered value noise in [0, 1): coarse shapes with finer detail on top. */
function fbm(x: number, y: number, freq: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, freq, seed + o * 1013) * amp
    total += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / total
}

/** A smooth periodic function of the angle around the disc, for where the sea lies. */
function coastline(seed: number): (angle: number) => number {
  let s = seed
  const rand = () => hash(s++, 7, seed)
  const waves = [2, 3, 5, 8, 13].map((f, i) => ({
    f,
    amp: 1 / (i + 1),
    phase: rand() * Math.PI * 2,
  }))
  return (angle) => waves.reduce((sum, w) => sum + w.amp * Math.sin(w.f * angle + w.phase), 0)
}

/** The value below which `share` of `values` lie. */
function quantile(values: Float32Array, share: number): number {
  if (values.length === 0) return Infinity
  const sorted = values.slice().sort()
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(share * sorted.length)))
  return sorted[i]!
}

/** Tiles further than this inside the deepest sea may hold lakes, so lakes stay inland. */
const LAKE_COAST_MARGIN = 12

/**
 * Generates the disc map from a seed (`CONTEXT.md`: Map, Terrain). Sea lies along parts of the
 * edge, lakes are inland, mountains form ranges with hills around them, forests grow in patches
 * and plains fill the rest. Terrain shares come from the balance file.
 */
export function generateTerrain(seed: number, diameter = MAP_DIAMETER): TerrainMap {
  const n = diameter * diameter
  const tiles = new Uint8Array(n).fill(OFF_MAP)
  const r = diameter / 2

  // Disc tiles, with their distance in from the edge and their angle around the centre.
  const index: number[] = []
  for (let y = 0; y < diameter; y++) {
    for (let x = 0; x < diameter; x++) {
      if (isInsideDisc(diameter, x, y)) index.push(y * diameter + x)
    }
  }
  const count = index.length
  const edgeDist = new Float32Array(count)
  const angle = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const t = index[i]!
    const dx = (t % diameter) + 0.5 - r
    const dy = Math.floor(t / diameter) + 0.5 - r
    edgeDist[i] = r - Math.sqrt(dx * dx + dy * dy)
    angle[i] = Math.atan2(dy, dx)
  }

  // Sea: where the coastline function is high, a band reaching in from the edge. Its threshold
  // sets how much of the edge is coast; its depth scale sets how much of the disc is sea.
  const coast = coastline(seed)
  const samples = new Float32Array(3600)
  for (let i = 0; i < samples.length; i++) samples[i] = coast((i / samples.length) * Math.PI * 2)
  const coastCut = quantile(samples, 1 - SEA_EDGE_SHARE)
  const seaReach = new Float32Array(count).fill(Infinity)
  const reaches: number[] = []
  for (let i = 0; i < count; i++) {
    const c = coast(angle[i]!) - coastCut
    if (c > 0) {
      seaReach[i] = edgeDist[i]! / c
      reaches.push(seaReach[i]!)
    }
  }
  const seaCut = quantile(Float32Array.from(reaches), (TERRAIN_SHARES.sea * count) / reaches.length)
  let deepestSea = 0
  const land = new Uint8Array(count).fill(1)
  for (let i = 0; i < count; i++) {
    if (seaReach[i]! < seaCut) {
      tiles[index[i]!] = Terrain.Sea
      land[i] = 0
      deepestSea = Math.max(deepestSea, edgeDist[i]!)
    }
  }
  // A sea tile cut off from the edge by rounding at a narrow tip becomes land.
  const seaReached = seaFromEdge({ diameter, tiles })
  for (let i = 0; i < count; i++) {
    if (!land[i] && !seaReached[index[i]!]) land[i] = 1
  }

  // Lakes: the lowest spots of a blobby field, only well inside the deepest sea.
  const lakeField: number[] = []
  const lakeAt: number[] = []
  for (let i = 0; i < count; i++) {
    if (!land[i] || edgeDist[i]! <= deepestSea + LAKE_COAST_MARGIN) continue
    const t = index[i]!
    lakeField.push(fbm(t % diameter, Math.floor(t / diameter), 1 / 90, 3, seed + 1))
    lakeAt.push(i)
  }
  const lakeCut = quantile(
    Float32Array.from(lakeField),
    (TERRAIN_SHARES.lake * count) / lakeField.length,
  )
  for (let k = 0; k < lakeAt.length; k++) {
    if (lakeField[k]! < lakeCut) {
      tiles[index[lakeAt[k]!]!] = Terrain.Lake
      land[lakeAt[k]!] = 0
    }
  }

  // Mountains and hills: ridges of a noise field, strongest where a coarse mask lets ranges form.
  // The highest ridge tiles are mountains, the band below them hills.
  const relief = new Float32Array(count)
  const landRelief: number[] = []
  for (let i = 0; i < count; i++) {
    if (!land[i]) continue
    const t = index[i]!
    const x = t % diameter
    const y = Math.floor(t / diameter)
    const ridge = 1 - Math.abs(2 * fbm(x, y, 1 / 160, 4, seed + 2) - 1)
    const mask = fbm(x, y, 1 / 400, 2, seed + 3)
    relief[i] = ridge * ridge * mask
    landRelief.push(relief[i]!)
  }
  const landCount = landRelief.length
  const reliefSorted = Float32Array.from(landRelief)
  const mountainCut = quantile(reliefSorted, 1 - (TERRAIN_SHARES.mountain * count) / landCount)
  const hillsCut = quantile(
    reliefSorted,
    1 - ((TERRAIN_SHARES.mountain + TERRAIN_SHARES.hills) * count) / landCount,
  )

  // Forest: patches of a separate field among the remaining land; plains everywhere else.
  const growth = new Float32Array(count)
  const flatGrowth: number[] = []
  for (let i = 0; i < count; i++) {
    if (!land[i] || relief[i]! >= hillsCut) continue
    const t = index[i]!
    growth[i] = fbm(t % diameter, Math.floor(t / diameter), 1 / 70, 4, seed + 4)
    flatGrowth.push(growth[i]!)
  }
  const forestCut = quantile(
    Float32Array.from(flatGrowth),
    1 - (TERRAIN_SHARES.forest * count) / flatGrowth.length,
  )

  for (let i = 0; i < count; i++) {
    if (!land[i]) continue
    tiles[index[i]!] =
      relief[i]! >= mountainCut
        ? Terrain.Mountain
        : relief[i]! >= hillsCut
          ? Terrain.Hills
          : growth[i]! >= forestCut
            ? Terrain.Forest
            : Terrain.Plains
  }

  return { diameter, tiles }
}

/** The four tiles sharing a side with tile index `t`. */
function neighbours(diameter: number, t: number): [number, number][] {
  const x = t % diameter
  const y = Math.floor(t / diameter)
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ]
}

/** Marks every sea tile joined to the disc's edge through sea. */
function seaFromEdge({ diameter, tiles }: TerrainMap): Uint8Array {
  const reached = new Uint8Array(tiles.length)
  const queue: number[] = []
  for (let t = 0; t < tiles.length; t++) {
    if (tiles[t] !== Terrain.Sea) continue
    if (neighbours(diameter, t).some(([nx, ny]) => !isInsideDisc(diameter, nx, ny))) {
      reached[t] = 1
      queue.push(t)
    }
  }
  while (queue.length > 0) {
    for (const [nx, ny] of neighbours(diameter, queue.pop()!)) {
      const nt = ny * diameter + nx
      if (isInsideDisc(diameter, nx, ny) && tiles[nt] === Terrain.Sea && !reached[nt]) {
        reached[nt] = 1
        queue.push(nt)
      }
    }
  }
  return reached
}

/** A rule a generated map must keep, broken. */
export interface TerrainProblem {
  rule: string
  message: string
}

/**
 * Checks the rules every generated map keeps (ADR 0004): nothing outside the disc exists or is
 * passable, every sea tile reaches the edge, and no lake touches the sea or the edge.
 */
export function checkTerrain(map: TerrainMap): TerrainProblem[] {
  const { diameter, tiles } = map
  const problems: TerrainProblem[] = []
  for (let t = 0; t < tiles.length; t++) {
    const x = t % diameter
    const y = Math.floor(t / diameter)
    const inside = isInsideDisc(diameter, x, y)
    if (!inside && tiles[t] !== OFF_MAP) {
      problems.push({ rule: 'nothing-off-map', message: `tile (${x}, ${y}) lies outside the disc` })
    }
    if (inside && tiles[t] === Terrain.Lake) {
      const shore = neighbours(diameter, t).map(([nx, ny]) =>
        isInsideDisc(diameter, nx, ny) ? tiles[ny * diameter + nx] : OFF_MAP,
      )
      if (shore.some((s) => s === Terrain.Sea || s === OFF_MAP)) {
        problems.push({ rule: 'lakes-inland', message: `lake at (${x}, ${y}) touches sea or edge` })
      }
    }
  }

  const seaReached = seaFromEdge(map)
  for (let t = 0; t < tiles.length; t++) {
    if (tiles[t] === Terrain.Sea && !seaReached[t]) {
      const x = t % diameter
      const y = Math.floor(t / diameter)
      problems.push({ rule: 'sea-at-edge', message: `sea at (${x}, ${y}) does not reach the edge` })
    }
  }
  return problems
}
