import { CHUNK_SIZE, chunksAcross } from '../shared/terrain.js'
import type { RegionHolder, RegionMap } from '@csp/shared-types'
import type { ZoomTier } from './camera.js'

/** An Organization on the Region map. */
export type RegionHolderInfo = RegionHolder

/** The client's copy of the Region map (`CONTEXT.md`: Region map). */
export interface RegionState {
  /** The tick the territory was worked out at. */
  tick: number
  holders: ReadonlyMap<string, RegionHolderInfo>
  /** The holder of each tile shown, by `y * size + x`. */
  owners: ReadonlyMap<number, string>
  /** The chunks the latest update changed; null when it replaced everything. */
  changed: readonly number[] | null
}

/** A chunk's corner and its width and height, clipped to the map. */
function chunkBox(chunk: number, size: number) {
  const across = chunksAcross(size)
  const [x0, y0] = [(chunk % across) * CHUNK_SIZE, Math.floor(chunk / across) * CHUNK_SIZE]
  return { x0, y0, w: Math.min(CHUNK_SIZE, size - x0), h: Math.min(CHUNK_SIZE, size - y0) }
}

/**
 * Applies a Region map update from the server (ADR 0034): a whole one replaces the copy, a part
 * replaces just its chunks and clears those it names as gone. Each chunk comes as runs of one
 * holder along its rows. `size` is the map's.
 */
export function applyRegionMap(
  state: RegionState | null,
  update: RegionMap,
  size: number,
): RegionState {
  const whole = update.whole || state === null
  const holders = new Map(whole ? [] : state.holders)
  const owners = new Map(whole ? [] : state.owners)
  for (const holder of update.holders) holders.set(holder.id, holder)
  const clear = (chunk: number) => {
    const { x0, y0, w, h } = chunkBox(chunk, size)
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) owners.delete(y * size + x)
    }
  }
  if (!whole) {
    for (const c of update.gone) clear(c)
    for (const { chunk } of update.chunks) clear(chunk)
  }
  for (const { chunk, runs } of update.chunks) {
    const { x0, y0, w, h } = chunkBox(chunk, size)
    let at = 0
    for (let r = 0; r + 1 < runs.length; r += 2) {
      const [length, holder] = [runs[r]!, runs[r + 1]!]
      const id = holder >= 0 ? update.holders[holder]?.id : undefined
      if (id !== undefined) {
        for (let i = at; i < Math.min(at + length, w * h); i++) {
          owners.set((y0 + Math.floor(i / w)) * size + x0 + (i % w), id)
        }
      }
      at += length
    }
  }
  // A holder that changed alliance changes colour wherever it holds: everything is redrawn.
  const recoloured = update.holders.some((h) => {
    const before = state?.holders.get(h.id)
    return before !== undefined && colourKey(before) !== colourKey(h)
  })
  const changed =
    whole || recoloured ? null : [...update.chunks.map((c) => c.chunk), ...update.gone]
  return { tick: update.tick, holders, owners, changed }
}

/** What shares a colour on the Region map: an alliance's members, or an Organization alone. */
export function colourKey(holder: RegionHolderInfo): string {
  return holder.alliance?.id ?? holder.id
}

/**
 * The admin map's land layer colours each kind of region (`CONTEXT.md`: Region) its own: the
 * colour keys its overlay uses (`region-kind:` and the kind's name), each with a fixed colour.
 */
export const LAND_KIND_COLOURS: Readonly<Record<string, number>> = {
  'region-kind:Heartland': 0x7cc95a,
  'region-kind:Frontier': 0xc0623a,
  'region-kind:Island': 0x8a6fd6,
}

/** A steady colour for a colour key, as 0xRRGGBB: the same key always gets the same colour. */
export function regionColour(key: string): number {
  const fixed = LAND_KIND_COLOURS[key]
  if (fixed !== undefined) return fixed
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  const hue = ((h >>> 0) % 360) / 360
  return hslToRgb(hue, 0.7, 0.55)
}

function hslToRgb(h: number, s: number, l: number): number {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    const v =
      u < 1 / 6
        ? p + (q - p) * 6 * u
        : u < 1 / 2
          ? q
          : u < 2 / 3
            ? p + (q - p) * (2 / 3 - u) * 6
            : p
    return Math.round(v * 255)
  }
  return (channel(h + 1 / 3) << 16) | (channel(h) << 8) | channel(h - 1 / 3)
}

/** The details for a tile on the Region map: who holds it, and for which alliance. */
export function holderLabel(holder: RegionHolderInfo | undefined): string {
  if (!holder) return 'held by nobody'
  return `held by ${holder.name}${holder.alliance ? ` (${holder.alliance.name})` : ''}`
}

/** The holder of a tile on the Region map, if any. */
export function holderAt(
  state: RegionState | null,
  size: number,
  x: number,
  y: number,
): RegionHolderInfo | undefined {
  const id = state?.owners.get(y * size + x)
  return id === undefined ? undefined : state!.holders.get(id)
}

/** How opaque territory is drawn over the terrain, 0–255. */
const REGION_ALPHA = 140

/**
 * One chunk of the Region map as RGBA pixels, one per tile, row-major: each held tile in its
 * holder's colour, the rest clear. Undefined when nothing in it is held.
 */
export function regionChunkPixels(
  state: RegionState,
  size: number,
  cx: number,
  cy: number,
): Uint8ClampedArray | undefined {
  const out = new Uint8ClampedArray(CHUNK_SIZE * CHUNK_SIZE * 4)
  let any = false
  for (let dy = 0; dy < CHUNK_SIZE; dy++) {
    for (let dx = 0; dx < CHUNK_SIZE; dx++) {
      const [x, y] = [cx * CHUNK_SIZE + dx, cy * CHUNK_SIZE + dy]
      if (x >= size || y >= size) continue
      const holder = holderAt(state, size, x, y)
      if (!holder) continue
      const c = regionColour(colourKey(holder))
      const i = (dy * CHUNK_SIZE + dx) * 4
      out[i] = c >> 16
      out[i + 1] = (c >> 8) & 0xff
      out[i + 2] = c & 0xff
      out[i + 3] = REGION_ALPHA
      any = true
    }
  }
  return any ? out : undefined
}

/** The chunks holding any of the Region map's tiles. */
export function regionChunks(state: RegionState, size: number): Set<number> {
  const across = chunksAcross(size)
  const out = new Set<number>()
  for (const t of state.owners.keys()) {
    out.add(
      Math.floor(Math.floor(t / size) / CHUNK_SIZE) * across + Math.floor((t % size) / CHUNK_SIZE),
    )
  }
  return out
}

/** A legend entry: one colour, and the Organizations sharing it (an alliance's members). */
export interface RegionGroup {
  key: string
  colour: number
  /** The alliance's name, or the Organization's when it stands alone. */
  name: string
  /** The members holding territory shown, for an alliance; empty for an Organization alone. */
  members: string[]
}

/** The legend of the Region map: each colour on it, by name. */
export function regionGroups(state: RegionState): RegionGroup[] {
  const held = new Set(state.owners.values())
  const groups = new Map<string, RegionGroup>()
  for (const holder of state.holders.values()) {
    if (!held.has(holder.id)) continue
    const key = colourKey(holder)
    const group = groups.get(key) ?? {
      key,
      colour: regionColour(key),
      name: holder.alliance?.name ?? holder.name,
      members: [],
    }
    if (holder.alliance) group.members.push(holder.name)
    groups.set(key, group)
  }
  for (const g of groups.values()) g.members.sort((a, b) => a.localeCompare(b))
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * How the Region map shows (`CONTEXT.md`: Region map): filled territory in the far tier, only
 * its borders at the middle and close tiers so the terrain stays readable, and filled at any tier
 * while the Region map button forces it on. The admin map shows territory only when toggled on.
 */
export type RegionLook = 'fill' | 'borders' | 'none'

export function regionLook(tier: ZoomTier, forced: boolean, admin = false): RegionLook {
  if (forced) return 'fill'
  if (admin) return 'none'
  return tier === 'far' ? 'fill' : 'borders'
}

/**
 * A stretch of territory border along tile edges, in tiles from its chunk's top left corner,
 * from (x0, y0) to (x1, y1). (nx, ny) points into the holder's tiles, so two holders meeting on
 * an edge can each draw their line on their own side of it.
 */
export interface BorderRun {
  x0: number
  y0: number
  x1: number
  y1: number
  nx: number
  ny: number
}

/** The four sides of a tile: the neighbour across it, and the edge as two corners. */
const SIDES = [
  { dx: 0, dy: -1, from: [0, 0], to: [1, 0] },
  { dx: 0, dy: 1, from: [0, 1], to: [1, 1] },
  { dx: -1, dy: 0, from: [0, 0], to: [0, 1] },
  { dx: 1, dy: 0, from: [1, 0], to: [1, 1] },
] as const

/**
 * One chunk's territory borders, by colour: each held tile's edges where the tile across is held
 * by someone else or by nobody, joined into runs along a row or column.
 */
export function regionBorders(
  state: RegionState,
  size: number,
  cx: number,
  cy: number,
): Map<number, BorderRun[]> {
  const out = new Map<number, BorderRun[]>()
  const owner = (x: number, y: number) =>
    state.owners.get((((y % size) + size) % size) * size + (((x % size) + size) % size))
  for (const side of SIDES) {
    // Runs go along x for top and bottom edges, along y for left and right ones.
    const alongX = side.dy !== 0
    for (let a = 0; a < CHUNK_SIZE; a++) {
      let open: { run: BorderRun; holder: string } | undefined
      for (let b = 0; b < CHUNK_SIZE; b++) {
        const [dx, dy] = alongX ? [b, a] : [a, b]
        const [x, y] = [cx * CHUNK_SIZE + dx, cy * CHUNK_SIZE + dy]
        const id = x < size && y < size ? state.owners.get(y * size + x) : undefined
        const edge = id !== undefined && owner(x + side.dx, y + side.dy) !== id
        if (edge && open && open.holder === id) {
          open.run.x1 = dx + side.to[0]
          open.run.y1 = dy + side.to[1]
          continue
        }
        open = undefined
        if (!edge) continue
        const run: BorderRun = {
          x0: dx + side.from[0],
          y0: dy + side.from[1],
          x1: dx + side.to[0],
          y1: dy + side.to[1],
          nx: 0 - side.dx,
          ny: 0 - side.dy,
        }
        const colour = regionColour(colourKey(state.holders.get(id)!))
        const runs = out.get(colour) ?? []
        runs.push(run)
        out.set(colour, runs)
        open = { run, holder: id }
      }
    }
  }
  return out
}
