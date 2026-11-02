import {
  SHARES_A_TILE,
  covers,
  wrap,
  type Building,
  type SeenCarriage,
  type SeenHorse,
  type SeenResident,
} from '@csp/shared'
import type { Spot } from './unit-tokens.js'

/**
 * One of the Player's residents where it shows on screen, and how far from it a click reaches: 0
 * for one a click never picks, only a box. `stack` is everyone behind the same token when it
 * stands for several (`Spot.stack`).
 */
export interface Pickable {
  id: string
  x: number
  y: number
  reach: number
  stack?: readonly string[]
}

/** A point on screen, in pixels. */
export interface Point {
  x: number
  y: number
}

/**
 * The residents of the Player's realm that can be clicked or boxed on the map: at the figure or
 * token they were drawn as last frame (`spots`), so the reach grows with it, or else at their
 * tile's centre (`place`). Up close only those drawn as a figure (or behind a "+N" badge) count.
 * A passenger, inside their carriage, is only boxed: a click there opens the carriage's card,
 * which lists them (`CONTEXT.md`: Passenger).
 */
export function pickables(
  residents: readonly Pick<SeenResident, 'id' | 'owner' | 'x' | 'y' | 'aboard'>[],
  realmId: string,
  spots: ReadonlyMap<string, Spot>,
  place: (x: number, y: number) => readonly [number, number],
  scale: number,
  close: boolean,
): Pickable[] {
  const list: Pickable[] = []
  for (const r of residents) {
    if (r.owner !== realmId) continue
    const spot = spots.get(r.id)
    if (close && !spot) continue
    const [x, y] = spot ? [spot.x, spot.y] : place(r.x + 0.5, r.y + 0.5)
    const reach = spot ? Math.max(8, spot.r * 1.4) : Math.max(10, scale * 0.6)
    const p: Pickable = { id: r.id, x, y, reach: r.aboard === undefined ? reach : 0 }
    if (spot?.stack) p.stack = spot.stack
    list.push(p)
  }
  return list
}

/** The nearest pickable whose reach covers a point on screen, if any. */
export function pickableAt(
  list: readonly Pickable[],
  sx: number,
  sy: number,
): Pickable | undefined {
  let best: { p: Pickable; d: number } | undefined
  for (const p of list) {
    const d = Math.hypot(p.x - sx, p.y - sy)
    if (p.reach > 0 && d <= p.reach && (!best || d < best.d)) best = { p, d }
  }
  return best?.p
}

/** A building as the picking rule needs it. */
export type PickBuilding = Pick<Building, 'id' | 'kind' | 'x' | 'y' | 'cityId'>

/**
 * What a click on the map picks (`CONTEXT.md`: Picking on the map): one of the Player's
 * residents, a stack of them as a group, or a tile for its tile card, with what on it the click
 * stands for: a building, or a carriage or loose horse of the Player's.
 */
export type MapPick =
  | { kind: 'resident'; id: string }
  | { kind: 'group'; ids: string[] }
  | {
      kind: 'tile'
      x: number
      y: number
      on?: { kind: 'building'; building: PickBuilding } | { kind: 'carriage' | 'horse'; id: string }
    }

/** What of the world the picking rule looks at: what the Player sees and remembers. */
export interface PickWorld {
  realmId: string
  size: number
  residents: readonly Pick<SeenResident, 'id' | 'owner' | 'x' | 'y' | 'aboard' | 'riding'>[]
  buildings: readonly PickBuilding[]
  carriages: readonly Pick<SeenCarriage, 'id' | 'realmId' | 'x' | 'y' | 'horseId'>[]
  horses: readonly Pick<SeenHorse, 'id' | 'realmId' | 'x' | 'y'>[]
}

/**
 * What a click at a point on screen picks, the tile `(tx, ty)` being under it (`CONTEXT.md`:
 * Picking on the map), the same at every zoom tier that draws tokens. A resident of the Player's
 * wins: the token clicked, or else the ones on the tile. Several on one token (or on the tile)
 * are a stack, picked as a group, unless someone else's resident is among them: then the tile
 * card lists them. Next comes a building on the tile, then a carriage or loose horse of the
 * Player's, then the bare tile. Passengers are inside their carriage, so a click there is the
 * carriage's. `own` is `pickables`.
 */
export function mapPickAt(
  own: readonly Pickable[],
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  world: PickWorld,
): MapPick {
  const { size, realmId } = world
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const hit = pickableAt(own, sx, sy)
  if (hit) {
    const stack = hit.stack ?? [hit.id]
    if (stack.length === 1) return { kind: 'resident', id: hit.id }
    if (stack.every((id) => byId.get(id)?.owner === realmId))
      return { kind: 'group', ids: [...stack] }
    const r = byId.get(hit.id)!
    return tilePick(r.x, r.y, world)
  }
  const [x, y] = [wrap(tx, size), wrap(ty, size)]
  const here = world.residents.filter(
    (r) => r.aboard === undefined && wrap(r.x, size) === x && wrap(r.y, size) === y,
  )
  const ours = here.filter((r) => r.owner === realmId)
  if (ours.length === 1 && here.length === 1) return { kind: 'resident', id: ours[0]!.id }
  if (ours.length > 1 && ours.length === here.length)
    return { kind: 'group', ids: ours.map((r) => r.id) }
  return tilePick(x, y, world)
}

/** A tile's card, with what on it the click stands for. */
function tilePick(tx: number, ty: number, world: PickWorld): MapPick {
  const { size, realmId } = world
  const [x, y] = [wrap(tx, size), wrap(ty, size)]
  const at = (e: { x: number; y: number }) => wrap(e.x, size) === x && wrap(e.y, size) === y
  const building = world.buildings.find(
    (b) => !SHARES_A_TILE.includes(b.kind) && covers(b, x, y, size),
  )
  if (building) return { kind: 'tile', x, y, on: { kind: 'building', building } }
  const carriage = world.carriages.find((k) => k.realmId === realmId && at(k))
  if (carriage) return { kind: 'tile', x, y, on: { kind: 'carriage', id: carriage.id } }
  // A hitched horse shows as its carriage, a ridden one as its rider.
  const busy = new Set<string | null | undefined>([
    ...world.carriages.map((k) => k.horseId),
    ...world.residents.map((r) => r.riding),
  ])
  const horse = world.horses.find((h) => h.realmId === realmId && !busy.has(h.id) && at(h))
  if (horse) return { kind: 'tile', x, y, on: { kind: 'horse', id: horse.id } }
  return { kind: 'tile', x, y }
}

/** A key that changes when what a click would pick does, so the hover outline redraws only then. */
export function pickKey(pick: MapPick | undefined): string {
  if (!pick) return ''
  if (pick.kind === 'resident') return `r:${pick.id}`
  if (pick.kind === 'group') return `g:${pick.ids.join(',')}`
  return `t:${pick.x},${pick.y}`
}

/** The pickables inside a box dragged between two corners, in either order. */
export function inBox(list: readonly Pickable[], a: Point, b: Point): string[] {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
  return list.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map((p) => p.id)
}

/**
 * A Shift-click on residents (one, or a stack): adds them to the selection, or takes them out if
 * all are in it already.
 */
export function toggled(ids: readonly string[], picked: string | readonly string[]): string[] {
  const these = typeof picked === 'string' ? [picked] : picked
  if (these.every((id) => ids.includes(id))) return ids.filter((i) => !these.includes(i))
  return [...ids, ...these.filter((id) => !ids.includes(id))]
}
