import {
  DIAGONAL_STEP,
  Terrain,
  foodPerTick,
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
  let ticks = 0
  alongWay(world, terrain, explored, r, a, b, (t) => (ticks += t))
  return Math.ceil(ticks)
}

/**
 * About how many units of Food a resident eats on the way from `a` to `b` (`wayFood`), with the
 * horse they ride (`CONTEXT.md`: Explore): `walkTime`'s way, each step's ticks at what they eat a
 * tick on its terrain (`foodPerTick`).
 */
export function wayFood(
  world: WorldState,
  terrain: TerrainMap,
  explored: (x: number, y: number) => boolean,
  r: Resident,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const horse = horseRidden(world, r)
  let food = 0
  alongWay(world, terrain, explored, r, a, b, (ticks, ground) => {
    food += ticks * foodPerTick(r, ground, world.tick, horse)
  })
  return food
}

/** Each step of `walkTime`'s way, with its ticks and the ground it goes onto. */
function alongWay(
  world: WorldState,
  terrain: TerrainMap,
  explored: (x: number, y: number) => boolean,
  r: Resident,
  a: { x: number; y: number },
  b: { x: number; y: number },
  step: (ticks: number, ground: Terrain) => void,
): void {
  const size = terrain.size
  const dx = wrapDelta(a.x, b.x, size)
  const dy = wrapDelta(a.y, b.y, size)
  const alongX = Math.abs(dx) >= Math.abs(dy)
  const long = alongX ? Math.abs(dx) : Math.abs(dy)
  const short = alongX ? Math.abs(dy) : Math.abs(dx)
  const slowest = walkSpeed(r, Terrain.Mountain, world.tick)
  const horse = horseRidden(world, r)
  const pace = (g: number) => (horse ? rideSpeed(r, horse, g) : walkSpeed(r, g, world.tick))
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
    step((diagonal ? DIAGONAL_STEP : 1) / (pace(ground) || slowest), ground)
  }
}
