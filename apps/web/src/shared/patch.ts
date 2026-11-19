// Gathering by hand and patches (`CONTEXT.md`: Gathering, Patch), as the server's `gathering.rs`
// has them: what a tile's patch holds now and when it is full again.
import {
  GATHER_PER_DAY,
  PATCH_REGROW_DAYS,
  PATCH_REST_DAYS,
  PATCH_SIZE,
  TICKS_PER_GAME_DAY,
} from '@csp/balance'
import type { Good, SeenPatch } from '@csp/shared-types'
import { Terrain } from './terrain.js'

/** The goods gathered by hand, in the order the game offers them. */
export const GATHERED_GOODS = ['wood', 'food', 'stone'] as const satisfies readonly Good[]
export type GatheredGood = (typeof GATHERED_GOODS)[number]

/** Units of each gathered good a resident of average Strength and no skill gathers a game day. */
export const GATHER_PACE = GATHER_PER_DAY as unknown as Record<GatheredGood, number>

/** The goods a tile of `terrain` gives by hand: Wood and Food in a forest, Stone in hills. */
export function gatheredOn(terrain: Terrain | undefined): GatheredGood[] {
  if (terrain === Terrain.Forest) return ['wood', 'food']
  if (terrain === Terrain.Hills) return ['stone']
  return []
}

type PatchAt = Pick<SeenPatch, 'left' | 'at'>

/** Ticks a patch rests after it was last gathered before it grows back. */
const REST_TICKS = Math.floor(PATCH_REST_DAYS * TICKS_PER_GAME_DAY)
/** Units a patch grows back a tick once it rests. */
const GROWTH_PER_TICK = PATCH_SIZE / (PATCH_REGROW_DAYS * TICKS_PER_GAME_DAY)

/** What a patch holds at `tick` (`patch_now`); a tile with no patch seen is full. */
export function patchLeft(p: PatchAt | undefined, tick: number): number {
  if (!p) return PATCH_SIZE
  const growing = Math.max(0, tick - (p.at + REST_TICKS))
  return Math.min(PATCH_SIZE, p.left + growing * GROWTH_PER_TICK)
}

/** Whether a tile is picked over at `tick`: less than a unit left. */
export function isPickedOver(p: PatchAt | undefined, tick: number): boolean {
  return patchLeft(p, tick) < 1
}

/** The tick a patch is full again. */
export function fullAt(p: PatchAt): number {
  return p.at + REST_TICKS + Math.ceil((PATCH_SIZE - p.left) / GROWTH_PER_TICK)
}

/** The tick a picked-over patch gives something again (a whole unit). */
export function givesAgainAt(p: PatchAt): number {
  return p.at + REST_TICKS + Math.ceil(Math.max(0, 1 - p.left) / GROWTH_PER_TICK)
}

/** The patches in sight by tile, as `"x,y"`. */
export function patchesByTile(patches: readonly SeenPatch[]): ReadonlyMap<string, SeenPatch> {
  return new Map(patches.map((p) => [`${p.x},${p.y}`, p]))
}
