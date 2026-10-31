import {
  DIAGONAL_STEP,
  Terrain,
  horseRidden,
  rideSpeed,
  terrainAt,
  walkSpeed,
  wrap,
  wrapDelta,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'

/**
 * About how many ticks a resident takes to walk from `a` to `b` (`walkTime`): step by step along
 * the straight way, diagonally where it slants (`CONTEXT.md`: Step), at their pace on each tile's
 * terrain, Plains where they haven't explored. Tiles they can't walk on count at their slowest
 * pace on land; roads and walls are left out. A rider goes at their horse's pace (`CONTEXT.md`:
 * Riding), and at their slowest on foot where it can't go.
 */
export function walkTime(
  world: WorldState,
  terrain: TerrainMap,
  explored: (x: number, y: number) => boolean,
  r: Resident,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const size = terrain.size
  const dx = wrapDelta(a.x, b.x, size)
  const dy = wrapDelta(a.y, b.y, size)
  const alongX = Math.abs(dx) >= Math.abs(dy)
  const long = alongX ? Math.abs(dx) : Math.abs(dy)
  const short = alongX ? Math.abs(dy) : Math.abs(dx)
  const slowest = walkSpeed(r, Terrain.Mountain, world.tick)
  const horse = horseRidden(world, r)
  const pace = (g: number) => (horse ? rideSpeed(r, horse, g) : walkSpeed(r, g, world.tick))
  let ticks = 0
  let x = a.x
  let y = a.y
  for (let i = 0, slanted = 0; i < long; i++) {
    // Each step goes along the longer direction, and diagonally while the steps along the
    // shorter one so far lag behind the straight line.
    const diagonal = (slanted + 0.5) * long <= (i + 1) * short
    if (diagonal) slanted++
    if (alongX || diagonal) x = wrap(x + Math.sign(dx), size)
    if (!alongX || diagonal) y = wrap(y + Math.sign(dy), size)
    const ground = explored(x, y) ? terrainAt(terrain, x, y) : Terrain.Plains
    ticks += (diagonal ? DIAGONAL_STEP : 1) / (pace(ground) || slowest)
  }
  return Math.ceil(ticks)
}
