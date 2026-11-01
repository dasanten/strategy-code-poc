import {
  DIAGONAL_STEP,
  drivenCarriageId,
  isLineOrder,
  TICK_MS,
  type Resident,
  type ResidentOrder,
} from '@csp/shared'
import { residentActivity } from './figures.js'
import type { MapWorld } from './map-world.js'

/**
 * How long a token takes to glide from one tile to the next (`CONTEXT.md`: Motion on the map): the
 * tick, so it arrives about when the next state does.
 */
export const GLIDE_MS = TICK_MS

/** How long a token on its way eases to where the world says it is, when the next state disagrees. */
export const EASE_MS = TICK_MS / 2

/**
 * How many ticks past the latest state a token goes on along its way: a state a little late keeps
 * it moving, a world that stopped sending does not run it to the end of its way.
 */
export const AHEAD_TICKS = 1.5

/** Further than this, in tiles, from where it was drawn, a token on its way is drawn in place. */
const JUMP_TILES = 3

/** How many tiles along its old way a token is looked for in the next state: one step a tick. */
const LOOK_AHEAD = 4

/** The way a token is going along: the tiles still to go, and how far into the first step it is. */
export interface Going {
  path: readonly (readonly [number, number])[]
  /** In tiles, as an order's `progress`: a diagonal step is `DIAGONAL_STEP` long. */
  progress: number
}

/** A token in a state the map was given: a resident, horse or carriage, its tile and its way. */
export interface Token {
  id: string
  x: number
  y: number
  way?: Going
}

/** The step a token with no way is on: the tile it left, and when the state that moved it arrived. */
interface Step {
  x: number
  y: number
  since: number
}

/**
 * A token on its way: its tile and the tiles ahead, each step's length, how far along it was in
 * the state that arrived at `since`, and its pace in tiles a tick.
 */
interface Track {
  points: (readonly [number, number])[]
  lengths: number[]
  /** For each step, whether it crosses the map edge: the token waits at its start. */
  wraps: boolean[]
  along: number
  pace: number
  since: number
}

/** How far a token is drawn off where it goes, easing out from `since`. */
interface Ease {
  dx: number
  dy: number
  since: number
}

/** A token's track from its tile along its way. */
function trackOf(x: number, y: number, way: Going, since: number): Track {
  const points: (readonly [number, number])[] = [[x, y], ...way.path]
  const lengths: number[] = []
  const wraps: boolean[] = []
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i]![0] - points[i - 1]![0])
    const dy = Math.abs(points[i]![1] - points[i - 1]![1])
    // A step of more than one tile is one across the map edge, to the neighbour on the far side.
    wraps.push(dx > 1 || dy > 1)
    lengths.push(Math.min(dx, 1) + Math.min(dy, 1) === 2 ? DIAGONAL_STEP : 1)
  }
  return { points, lengths, wraps, along: Math.max(0, way.progress), pace: 0, since }
}

/** Where a token on `track` is at `now`, in tile units. */
function onTrack(t: Track, now: number): readonly [number, number] {
  const ticks = Math.min(AHEAD_TICKS, Math.max(0, (now - t.since) / TICK_MS))
  let d = t.along + t.pace * ticks
  for (let i = 0; i < t.lengths.length; i++) {
    const [ax, ay] = t.points[i]!
    if (t.wraps[i]) return [ax, ay]
    const len = t.lengths[i]!
    if (d < len) {
      const [bx, by] = t.points[i + 1]!
      const f = d / len
      return [ax + (bx - ax) * f, ay + (by - ay) * f]
    }
    d -= len
  }
  return t.points.at(-1)!
}

/**
 * How far a token went along its old track to where a state shows it, in tiles: undefined when
 * its tile is not among the next few of that track (it turned or jumped) or it went back.
 */
function travelled(t: Track, x: number, y: number, progress: number): number | undefined {
  let d = 0
  for (let k = 0; k < Math.min(t.points.length, LOOK_AHEAD); k++) {
    const [px, py] = t.points[k]!
    if (px === x && py === y) {
      const went = d + progress - t.along
      return went >= 0 ? went : undefined
    }
    d += t.lengths[k] ?? 0
  }
  return undefined
}

/** How much of an ease is left `u` of the way through it, from 1 down to 0, smoothly. */
function easeLeft(u: number): number {
  if (u >= 1) return 0
  const v = Math.max(0, u)
  return 1 - v * v * (3 - 2 * v)
}

/**
 * Where the tokens are between ticks (`CONTEXT.md`: Motion on the map). The world moves once a
 * tick, but a token on its way (`Token.way`) is drawn moving steadily along it at the pace seen
 * over the last states, across tile edges, however many ticks a step takes. When the next state
 * disagrees (it stopped, turned, went faster or slower) the token eases from where it was drawn to
 * where the world says it is. A token with no way that stepped to a neighbouring tile glides there
 * over the tick, from the tile it was on in the previous state. A token that moved further,
 * wrapped around the map edge or just appeared is drawn in place. Pure drawing: the world and what
 * it sends change nothing. Times are in ms on one clock (`performance.now()`).
 */
export class Motion {
  /** Every token's tile in the latest state. */
  private tiles = new Map<string, { x: number; y: number }>()
  /** The tokens with no way that are gliding to a neighbouring tile, by id. */
  private steps = new Map<string, Step>()
  /** The tokens on their way, by id. */
  private tracks = new Map<string, Track>()
  /** The tokens easing to where the world says they are, by id. */
  private eases = new Map<string, Ease>()
  /** Until when something moves: the map wants frames until then. */
  private until = -Infinity

  /** Takes the state that arrived at `now`. */
  update(tokens: Iterable<Token>, now: number): void {
    const tiles = new Map<string, { x: number; y: number }>()
    const tracks = new Map<string, Track>()
    const eases = new Map<string, Ease>()
    for (const t of tokens) {
      tiles.set(t.id, { x: t.x, y: t.y })
      const was = this.tiles.get(t.id)
      const old = this.tracks.get(t.id)
      const track = t.way && t.way.path.length > 0 ? trackOf(t.x, t.y, t.way, now) : undefined
      if (track) {
        // The pace seen since the last state; a token that turned keeps the pace it had.
        const went = old && travelled(old, t.x, t.y, track.along)
        const ticks = old ? Math.max(1, Math.round((now - old.since) / TICK_MS)) : 1
        track.pace = went !== undefined ? went / ticks : (old?.pace ?? 0)
        tracks.set(t.id, track)
      }
      if (!was) continue
      if (!old && !track) {
        this.glide(t, was, now)
        continue
      }
      // On its way now or until now: it eases from where it was drawn, unless it jumped.
      const [bx, by] = this.at(t.id, was.x, was.y, now)
      this.steps.delete(t.id)
      const [nx, ny] = track ? onTrack(track, now) : [t.x, t.y]
      const [dx, dy] = [bx - nx, by - ny]
      const near = Math.abs(t.x - was.x) <= 1 && Math.abs(t.y - was.y) <= 1
      const along = old !== undefined && travelled(old, t.x, t.y, Infinity) !== undefined
      const jumped = !(near || along) || Math.max(Math.abs(dx), Math.abs(dy)) > JUMP_TILES
      if (!jumped && Math.abs(dx) + Math.abs(dy) > 1e-3) eases.set(t.id, { dx, dy, since: now })
    }
    // Steps of tokens gone from sight, and steps finished, are forgotten.
    for (const [id, s] of this.steps) {
      if (!tiles.has(id) || now - s.since >= GLIDE_MS) this.steps.delete(id)
    }
    this.tiles = tiles
    this.tracks = tracks
    this.eases = eases
    this.until = -Infinity
    for (const s of this.steps.values()) this.until = Math.max(this.until, s.since + GLIDE_MS)
    for (const e of eases.values()) this.until = Math.max(this.until, e.since + EASE_MS)
    for (const k of tracks.values()) {
      if (k.pace > 0) this.until = Math.max(this.until, k.since + AHEAD_TICKS * TICK_MS)
    }
  }

  /** A token with no way that stepped one tile starts gliding; one that jumped is in place. */
  private glide(t: Token, was: { x: number; y: number }, now: number): void {
    if (was.x === t.x && was.y === t.y) return
    if (Math.abs(t.x - was.x) > 1 || Math.abs(t.y - was.y) > 1) {
      // A jump, or across the map edge: in place.
      this.steps.delete(t.id)
      return
    }
    this.steps.set(t.id, { x: was.x, y: was.y, since: now })
  }

  /**
   * Where the token `id`, on tile (x, y) in the latest state, is drawn at `now`: in tile units,
   * along its way, on its way from the tile it left, or in place.
   */
  at(id: string, x: number, y: number, now: number): readonly [number, number] {
    const track = this.tracks.get(id)
    const s = this.steps.get(id)
    let [px, py]: readonly [number, number] = [x, y]
    if (track) [px, py] = onTrack(track, now)
    else if (s) {
      const t = Math.min(1, Math.max(0, (now - s.since) / GLIDE_MS))
      ;[px, py] = [s.x + (x - s.x) * t, s.y + (y - s.y) * t]
    }
    const e = this.eases.get(id)
    if (!e) return [px, py]
    const left = easeLeft((now - e.since) / EASE_MS)
    return [px + e.dx * left, py + e.dy * left]
  }

  /** Whether the token `id` is on its way at `now`: moving along it, gliding or easing. */
  gliding(id: string, now: number): boolean {
    const s = this.steps.get(id)
    const k = this.tracks.get(id)
    const e = this.eases.get(id)
    return (
      (s !== undefined && now - s.since < GLIDE_MS) ||
      (k !== undefined && k.pace > 0 && now - k.since < AHEAD_TICKS * TICK_MS) ||
      (e !== undefined && now - e.since < EASE_MS)
    )
  }

  /** Whether a token is still on its way at `now`: the map wants another frame. */
  moving(now: number): boolean {
    return now < this.until
  }
}

/**
 * The way a resident's order goes along while they walk or drive it (`CONTEXT.md`: Motion on the
 * map): walk to, drive, haul, Store, Fetch, a road or wall line, going after someone.
 */
export function goingOf(order: ResidentOrder | null | undefined): Going | undefined {
  const o = order
  if (!o || !('path' in o) || !o.path || o.path.length === 0) return undefined
  if (o.kind === 'haul' && o.phase !== 'driving') return undefined
  if ((isLineOrder(o) || o.kind === 'store' || o.kind === 'fetch') && o.phase !== 'walking') {
    return undefined
  }
  return { path: o.path, progress: o.progress }
}

/**
 * The tokens of a state, each with the way it goes (`CONTEXT.md`: Motion on the map): a resident's
 * own, a carriage's and its passengers' its driver's, a hitched horse's its carriage's, a ridden
 * horse's its rider's. So riders and passengers move with their horse or carriage.
 */
export function motionTokens(world: Pick<MapWorld, 'residents' | 'horses' | 'carriages'>): Token[] {
  const byCarriage = new Map<string, Going | undefined>()
  const byHorse = new Map<string, Going | undefined>()
  for (const r of world.residents) {
    const carriage = drivenCarriageId(r)
    if (carriage !== undefined) byCarriage.set(carriage, goingOf(r.order))
    if (r.riding !== undefined) byHorse.set(r.riding, goingOf(r.order))
  }
  for (const k of world.carriages) {
    if (k.horseId !== null && byCarriage.has(k.id)) byHorse.set(k.horseId, byCarriage.get(k.id))
  }
  const token = (id: string, x: number, y: number, way: Going | undefined): Token =>
    way ? { id, x, y, way } : { id, x, y }
  return [
    ...world.residents.map((r) =>
      token(r.id, r.x, r.y, r.aboard !== undefined ? byCarriage.get(r.aboard) : goingOf(r.order)),
    ),
    ...world.horses.map((h) => token(h.id, h.x, h.y, byHorse.get(h.id))),
    ...world.carriages.map((k) => token(k.id, k.x, k.y, byCarriage.get(k.id))),
  ]
}

/** How far a resident at work sways on their tile, in tiles: a few pixels. */
export const WORK_SWAY = 0.06

/** How long one sway of a resident at work takes, in ms. */
export const WORK_SWAY_MS = 1400

/** A phase from 0 to 1 out of a token's id, so a crew does not sway in lockstep. */
function phaseOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

/**
 * How far a resident is drawn off their spot at `now` (`CONTEXT.md`: Motion on the map), in
 * tiles: one at work (`residentActivity`) sways side to side and bobs, from the animation clock
 * and seeded by their id; anyone else keeps still. One sine per token.
 */
export function workSway(
  r: Pick<Resident, 'id' | 'order' | 'carried' | 'x' | 'y' | 'riding'>,
  now: number,
): readonly [number, number] {
  if (residentActivity(r) !== 'working') return [0, 0]
  const s = Math.sin(2 * Math.PI * (now / WORK_SWAY_MS + phaseOf(r.id)))
  return [WORK_SWAY * s, -WORK_SWAY * 0.6 * s * s]
}
