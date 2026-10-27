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
