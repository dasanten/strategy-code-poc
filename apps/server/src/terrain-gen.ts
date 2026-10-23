import {
  MAP_SIZE,
  SEA_COUNT,
  TERRAIN_SHARES,
  Terrain,
  isPassableTerrain,
  wrap,
  wrapDelta,
  type TerrainMap,
} from '@csp/shared'

/** Integer hash of a lattice point, the basis of the seeded noise below. */
export function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Smooth value noise in [0, 1) on a lattice of `cells` × `cells` points spread over the map. The
 * lattice repeats every `cells` points, so the noise joins seamlessly where the map's sides do.
 */
function valueNoise(x: number, y: number, size: number, cells: number, seed: number): number {
  const fx = (x / size) * cells
  const fy = (y / size) * cells
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const x0 = wrap(ix, cells)
  const y0 = wrap(iy, cells)
  const x1 = wrap(ix + 1, cells)
  const y1 = wrap(iy + 1, cells)
  const a = hash(x0, y0, seed)
  const b = hash(x1, y0, seed)
  const c = hash(x0, y1, seed)
  const d = hash(x1, y1, seed)
  const top = a + (b - a) * sx
  const bottom = c + (d - c) * sx
  return top + (bottom - top) * sy
}

/**
 * Layered seamless noise in [0, 1): coarse shapes with finer detail on top. Features are about
 * `spacing` tiles apart (rounded so a whole number of them fits around the map).
 */
function fbm(
  x: number,
  y: number,
  size: number,
  spacing: number,
  octaves: number,
  seed: number,
): number {
  let cells = Math.max(1, Math.round(size / spacing))
  let sum = 0
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, size, cells, seed + o * 1013) * amp
    total += amp
    amp *= 0.5
    cells *= 2
  }
  return sum / total
}

/**
 * Tiles apart at which `fbmField` works noise out exactly; in between it blends. Its finest
 * features lie dozens of tiles apart, so the blend never shows, and a full-size map takes a
 * sixteenth of the work.
 */
const FIELD_STEP = 4

/**
 * `fbm` for every tile of a map `size` across, by tile index: worked out every `FIELD_STEP` tiles
 * along each direction and blended in between, seamless across the joins like `fbm` itself. A map
 * whose size `FIELD_STEP` doesn't divide gets it worked out on every tile.
 */
function fbmField(size: number, spacing: number, octaves: number, seed: number): Float32Array {
  const step = size % FIELD_STEP === 0 ? FIELD_STEP : 1
  const n = size / step
  const coarse = new Float32Array(n * n)
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      coarse[cy * n + cx] = fbm(cx * step, cy * step, size, spacing, octaves, seed)
    }
  }
  if (step === 1) return coarse
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y / step)
    const y1 = (y0 + 1) % n
    const fy = (y % step) / step
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x / step)
      const x1 = (x0 + 1) % n
      const fx = (x % step) / step
      const top = coarse[y0 * n + x0]! * (1 - fx) + coarse[y0 * n + x1]! * fx
      const bottom = coarse[y1 * n + x0]! * (1 - fx) + coarse[y1 * n + x1]! * fx
      out[y * size + x] = top * (1 - fy) + bottom * fy
    }
  }
  return out
}

/**
 * The value below which `share` of `values` lie: the one that would stand at that place if they
 * were sorted, found without sorting them (quickselect), as a full map has 33 million.
 */
function quantile(values: Float32Array, share: number): number {
  if (values.length === 0) return Infinity
  const a = values.slice()
  const k = Math.min(a.length - 1, Math.max(0, Math.floor(share * a.length)))
  let lo = 0
  let hi = a.length - 1
  while (lo < hi) {
    // The middle of three as the pivot, then Hoare's partition around it.
    const mid = (lo + hi) >>> 1
    const [p, q, r] = [a[lo]!, a[mid]!, a[hi]!]
    const pivot = Math.max(Math.min(p, q), Math.min(Math.max(p, q), r))
    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i]! < pivot) i++
      while (a[j]! > pivot) j--
      if (i <= j) {
        const t = a[i]!
        a[i++] = a[j]!
        a[j--] = t
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else break
  }
  return a[k]!
}

/** The four tiles sharing a side with tile `t`, across the joins. */
export function neighbours(size: number, t: number): [number, number, number, number] {
  const x = t % size
  const y = (t - x) / size
  return [
    y * size + wrap(x + 1, size),
    y * size + wrap(x - 1, size),
    wrap(y + 1, size) * size + x,
    wrap(y - 1, size) * size + x,
  ]
}

/**
 * The `i`th (0 to 3) of `neighbours(size, t)`, without making an array: for the loops over every
 * tile of a full map.
 */
function neighbour(size: number, t: number, i: number): number {
  const x = t % size
  const y = (t - x) / size
  if (i === 0) return y * size + (x + 1 === size ? 0 : x + 1)
  if (i === 1) return y * size + (x === 0 ? size - 1 : x - 1)
  if (i === 2) return (y + 1 === size ? 0 : y + 1) * size + x
  return (y === 0 ? size - 1 : y - 1) * size + x
}

/** Steps from every tile to the nearest tile where `from` is true (4 neighbours, across joins). */
function stepsFrom(size: number, from: (t: number) => boolean): Int32Array {
  const dist = new Int32Array(size * size).fill(-1)
  const queue = new Int32Array(size * size)
  let head = 0
  let tail = 0
  for (let t = 0; t < size * size; t++) {
    if (from(t)) {
      dist[t] = 0
      queue[tail++] = t
    }
  }
  while (head < tail) {
    const t = queue[head++]!
    for (let i = 0; i < 4; i++) {
      const n = neighbour(size, t, i)
      if (dist[n] === -1) {
        dist[n] = dist[t]! + 1
        queue[tail++] = n
      }
    }
  }
  return dist
}

/** Labels each passable tile with its connected group; returns the labels and group sizes. */
export function landGroups(map: TerrainMap): { group: Int32Array; sizes: number[] } {
  const { size, tiles } = map
  const group = new Int32Array(size * size).fill(-1)
  const sizes: number[] = []
  // Each tile goes on the stack at most once, labelled as it does.
  const stack = new Int32Array(size * size)
  let top = 0
  for (let start = 0; start < size * size; start++) {
    if (group[start] !== -1 || !isPassableTerrain(tiles[start]!)) continue
    const g = sizes.length
    let count = 0
    group[start] = g
    stack[top++] = start
    while (top > 0) {
      const t = stack[--top]!
      count++
      for (let i = 0; i < 4; i++) {
        const n = neighbour(size, t, i)
        if (group[n] === -1 && isPassableTerrain(tiles[n]!)) {
          group[n] = g
          stack[top++] = n
        }
      }
    }
    sizes.push(count)
  }
  return { group, sizes }
}

/** Lakes stay at least this many tiles from the sea, so they are inland. */
const LAKE_COAST_MARGIN = 48

/**
 * Generates the map from a seed (`CONTEXT.md`: Map, Terrain): a square whose opposite sides
 * join, so every pattern runs on seamlessly across them. A few large seas, small lakes inland,
 * mountains in ranges with hills around them, forests in patches and plains in between. Land
 * cut off from the rest becomes water, so all land stays joined. Shares come from the balance
 * file.
 */
export function generateTerrain(seed: number, size = MAP_SIZE): TerrainMap {
  const n = size * size
  const tiles = new Uint8Array(n)
  const xOf = (t: number) => t % size
  const yOf = (t: number) => Math.floor(t / size)

  // Seas: a few large blobs with ragged coasts. Each tile scores by how deep it lies inside the
  // nearest blob; the deepest share becomes sea.
  let s = 0
  const rand = () => hash(s++, 11, seed)
  const seas = Array.from({ length: SEA_COUNT }, () => ({
    x: rand() * size,
    y: rand() * size,
    r: size * (0.12 + rand() * 0.08),
  }))
  const seaScore = new Float32Array(n)
  const coast = fbmField(size, 240, 4, seed + 5)
  for (let t = 0; t < n; t++) {
    const x = xOf(t)
    const y = yOf(t)
    let deepest = -Infinity
    for (const sea of seas) {
      const d = Math.hypot(wrapDelta(sea.x, x, size), wrapDelta(sea.y, y, size))
      deepest = Math.max(deepest, 1 - d / sea.r)
    }
    seaScore[t] = deepest + (coast[t]! - 0.5) * 0.6
  }
  const seaCut = quantile(seaScore, 1 - TERRAIN_SHARES.sea)
  for (let t = 0; t < n; t++) if (seaScore[t]! >= seaCut) tiles[t] = Terrain.Sea

  // Lakes: the lowest spots of a blobby field, only well away from the sea.
  const fromSea = stepsFrom(size, (t) => tiles[t] === Terrain.Sea)
  // Typed arrays filled up to a count, here and below: a full map has too many tiles for plain ones.
  const lakeAt = new Int32Array(n)
  const lakeTiles = new Float32Array(n)
  let lakes = 0
  const lakeNoise = fbmField(size, 360, 3, seed + 1)
  for (let t = 0; t < n; t++) {
    if (tiles[t] === Terrain.Sea || fromSea[t]! <= LAKE_COAST_MARGIN) continue
    lakeAt[lakes] = t
    lakeTiles[lakes++] = lakeNoise[t]!
  }
  const lakeField = lakeTiles.subarray(0, lakes)
  const lakeCut = quantile(lakeField, (TERRAIN_SHARES.lake * n) / lakes)
  for (let k = 0; k < lakes; k++) {
    if (lakeField[k]! < lakeCut) tiles[lakeAt[k]!] = Terrain.Lake
  }

  // Mountains and hills: ridges of a noise field, strongest where a coarse mask lets ranges form.
  // The highest ridge tiles are mountains, the band below them hills.
  const isLand = (t: number) => tiles[t] !== Terrain.Sea && tiles[t] !== Terrain.Lake
  const relief = new Float32Array(n)
  const landTiles = new Float32Array(n)
  let landCount = 0
  const ridges = fbmField(size, 640, 4, seed + 2)
  const masks = fbmField(size, 1600, 2, seed + 3)
  for (let t = 0; t < n; t++) {
    if (!isLand(t)) continue
    const ridge = 1 - Math.abs(2 * ridges[t]! - 1)
    const mask = masks[t]!
    relief[t] = ridge * ridge * mask
    landTiles[landCount++] = relief[t]!
  }
  const reliefSorted = landTiles.subarray(0, landCount)
  const mountainCut = quantile(reliefSorted, 1 - (TERRAIN_SHARES.mountain * n) / landCount)
  const hillsCut = quantile(
    reliefSorted,
    1 - ((TERRAIN_SHARES.mountain + TERRAIN_SHARES.hills) * n) / landCount,
  )

  // Forest: patches of a separate field among the remaining land; plains everywhere else.
  const growth = fbmField(size, 280, 4, seed + 4)
  const flatTiles = new Float32Array(n)
  let flat = 0
  for (let t = 0; t < n; t++) {
    if (!isLand(t) || relief[t]! >= hillsCut) continue
    flatTiles[flat++] = growth[t]!
  }
  const forestCut = quantile(
    flatTiles.subarray(0, flat),
    1 - (TERRAIN_SHARES.forest * n) / flat,
  )
  for (let t = 0; t < n; t++) {
    if (!isLand(t)) continue
    tiles[t] =
      relief[t]! >= mountainCut
        ? Terrain.Mountain
        : relief[t]! >= hillsCut
          ? Terrain.Hills
          : growth[t]! >= forestCut
            ? Terrain.Forest
            : Terrain.Plains
  }

  // All land joined: land cut off from the largest stretch becomes water as a whole, sea if it
  // touches the sea anywhere, lake otherwise.
  const map: TerrainMap = { size, tiles }
  const { group, sizes } = landGroups(map)
  const main = sizes.indexOf(Math.max(...sizes))
  const bySea = new Uint8Array(sizes.length)
  for (let t = 0; t < n; t++) {
    const g = group[t]!
    if (g !== -1 && g !== main && neighbours(size, t).some((nb) => tiles[nb] === Terrain.Sea)) {
      bySea[g] = 1
    }
  }
  for (let t = 0; t < n; t++) {
    const g = group[t]!
    if (g === -1 || g === main) continue
    tiles[t] = bySea[g] ? Terrain.Sea : Terrain.Lake
  }
  return map
}

/** A rule a generated map must keep, broken. */
export interface TerrainProblem {
  rule: string
  message: string
}

/**
 * Checks the rules every generated map keeps (ADR 0004): every tile holds a known terrain, no
 * lake touches the sea, and all land is joined.
 */
export function checkTerrain(map: TerrainMap): TerrainProblem[] {
  const { size, tiles } = map
  const problems: TerrainProblem[] = []
  // A road is never stored in the map (`groundAt`).
  const known = new Set<number>(Object.values(Terrain).filter((t) => t !== Terrain.Road))
  for (let t = 0; t < tiles.length; t++) {
    const at = `(${t % size}, ${Math.floor(t / size)})`
    if (!known.has(tiles[t]!)) {
      problems.push({ rule: 'known-terrain', message: `tile ${at} holds ${tiles[t]}` })
    }
    if (tiles[t] === Terrain.Lake && neighbours(size, t).some((nb) => tiles[nb] === Terrain.Sea)) {
      problems.push({ rule: 'lakes-inland', message: `lake at ${at} touches the sea` })
    }
  }
  const { sizes } = landGroups(map)
  if (sizes.length > 1) {
    const largest = [...sizes].sort((a, b) => b - a).slice(0, 5)
    problems.push({
      rule: 'land-joined',
      message: `land falls into ${sizes.length} parts (${largest.join(', ')}, …)`,
    })
  }
  return problems
}
