/** A step from one road tile to the next it is drawn joined to. */
export type RoadJoin = readonly [dx: number, dy: number]

/** Right, below, below-right and below-left: every pair of touching tiles is looked at once. */
const STRAIGHT: readonly RoadJoin[] = [
  [1, 0],
  [0, 1],
]
const DIAGONAL: readonly RoadJoin[] = [
  [1, 1],
  [-1, 1],
]
const STEPS = [...STRAIGHT, ...DIAGONAL]

/**
 * The roads a road at (x, y) is drawn joined to, each join once, from the road to its right or
 * below (`CONTEXT.md`: Road, ADR 0008). Roads touching at a corner join too, unless a road beside
 * both already links them, so an L-corner gets no extra spur.
 */
export function roadJoins(
  x: number,
  y: number,
  isRoad: (x: number, y: number) => boolean,
): RoadJoin[] {
  const joins = STRAIGHT.filter(([dx, dy]) => isRoad(x + dx, y + dy))
  for (const [dx, dy] of DIAGONAL) {
    if (isRoad(x + dx, y + dy) && !isRoad(x + dx, y) && !isRoad(x, y + dy)) joins.push([dx, dy])
  }
  return joins
}

/** How wide a road's band is drawn at a zoom, in screen pixels per tile (ADR 0008). */
export const roadWidth = (tile: number) => Math.max(3, tile * 0.36)

/** How wide a wall is drawn at a zoom: its dark edge and the band in the owner's colour on it. */
export const wallWidths = (tile: number) => ({
  edge: Math.max(3, tile * 0.34),
  band: Math.max(1.5, tile * 0.22),
})

/** A straight run of joined road far out: from tile (x, y), `n` steps of (dx, dy); 0 is a lone road. */
export interface RoadRun {
  x: number
  y: number
  dx: number
  dy: number
  n: number
}

/** How wide a road is drawn far out, in screen pixels at every far zoom (`CONTEXT.md`: Roads far out). */
export const FAR_ROAD_WIDTH = 1.5

/**
 * The roads the far tier draws as thin lines (`CONTEXT.md`: Roads far out): every finished road
 * among `buildings` (those in sight and those last seen), joined as the middle tier joins them
 * (`roadJoins`), with joins in a row merged into one run. Road sites are left out.
 */
export function farRoadRuns(
  buildings: readonly { kind: string; x: number; y: number; site?: unknown }[],
  size: number,
): RoadRun[] {
  const key = (x: number, y: number) => `${(x + size) % size},${(y + size) % size}`
  const roads = new Map<string, readonly [number, number]>()
  for (const b of buildings) if (b.kind === 'road' && !b.site) roads.set(key(b.x, b.y), [b.x, b.y])
  const isRoad = (x: number, y: number) => roads.has(key(x, y))
  const joins = new Map<string, RoadJoin[]>()
  const joinsAt = (x: number, y: number) => {
    const k = key(x, y)
    let j = joins.get(k)
    if (!j) joins.set(k, (j = roadJoins(x, y, isRoad)))
    return j
  }
  const joined = (x: number, y: number, dx: number, dy: number) =>
    isRoad(x, y) && joinsAt(x, y).some(([jx, jy]) => jx === dx && jy === dy)
  const runs: RoadRun[] = []
  for (const [x, y] of roads.values()) {
    const own = joinsAt(x, y)
    if (own.length === 0 && !STEPS.some(([dx, dy]) => joined(x - dx, y - dy, dx, dy)))
      runs.push({ x, y, dx: 0, dy: 0, n: 0 })
    for (const [dx, dy] of own) {
      // A run starts where the road before it in that direction does not join on to it.
      if (joined(x - dx, y - dy, dx, dy)) continue
      let n = 1
      while (n < size && joined(x + n * dx, y + n * dy, dx, dy)) n++
      runs.push({ x, y, dx, dy, n })
    }
  }
  return runs
}
