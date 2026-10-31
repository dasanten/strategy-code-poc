import { TICK_MS } from '@csp/shared'

/**
 * How long a token takes to glide from one tile to the next (`CONTEXT.md`: Motion on the map): the
 * tick, so it arrives about when the next state does.
 */
export const GLIDE_MS = TICK_MS

/** A token in a state the map was given: a resident, horse or carriage and its tile. */
export interface Token {
  id: string
  x: number
  y: number
}

/** The step a token is on: the tile it left, and when the state that moved it arrived. */
interface Step {
  x: number
  y: number
  since: number
}

/**
 * Where the tokens are between ticks (`CONTEXT.md`: Motion on the map). The world moves once a
 * tick, but a token that stepped to a neighbouring tile is drawn on its way there over the tick,
 * from the tile it was on in the previous state. A token that moved further, wrapped around the
 * map edge or just appeared is drawn in place. Pure drawing: the world and what it sends change
 * nothing. Times are in ms on one clock (`performance.now()`).
 */
export class Motion {
  /** Every token's tile in the latest state. */
  private tiles = new Map<string, { x: number; y: number }>()
  /** The tokens on their way, by id. */
  private steps = new Map<string, Step>()
  /** When the latest step started; nothing moves `GLIDE_MS` after it. */
  private lastStep = -Infinity

  /** Takes the state that arrived at `now`: the tokens that stepped one tile start gliding. */
  update(tokens: Iterable<Token>, now: number): void {
    const tiles = new Map<string, { x: number; y: number }>()
    for (const t of tokens) {
      tiles.set(t.id, { x: t.x, y: t.y })
      const was = this.tiles.get(t.id)
      if (!was || (was.x === t.x && was.y === t.y)) continue
      if (Math.abs(t.x - was.x) > 1 || Math.abs(t.y - was.y) > 1) {
        // A jump, or across the map edge: in place.
        this.steps.delete(t.id)
        continue
      }
      this.steps.set(t.id, { x: was.x, y: was.y, since: now })
      this.lastStep = now
    }
    // Steps of tokens gone from sight, and steps finished, are forgotten.
    for (const [id, s] of this.steps) {
      if (!tiles.has(id) || now - s.since >= GLIDE_MS) this.steps.delete(id)
    }
    this.tiles = tiles
  }

  /**
   * Where the token `id`, on tile (x, y) in the latest state, is drawn at `now`: in tile units,
   * on its way from the tile it left, or in place.
   */
  at(id: string, x: number, y: number, now: number): readonly [number, number] {
    const s = this.steps.get(id)
    if (!s) return [x, y]
    const t = Math.min(1, Math.max(0, (now - s.since) / GLIDE_MS))
    return [s.x + (x - s.x) * t, s.y + (y - s.y) * t]
  }

  /** Whether a token is still on its way at `now`: the map wants another frame. */
  moving(now: number): boolean {
    return now - this.lastStep < GLIDE_MS
  }
}
