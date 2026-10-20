import { CHUNK_SIZE, chunksAcross, type RegionHolder, type RegionMap } from '@csp/shared'

/** An Organization on the Region map, without its tiles. */
export type RegionHolderInfo = Omit<RegionHolder, 'tiles'>

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

/**
 * Applies a Region map update from the server: a whole map replaces the copy, a part replaces
 * just its chunks. `size` is the map's.
 */
export function applyRegionMap(
  state: RegionState | null,
  update: RegionMap,
  size: number,
): RegionState {
  const whole = update.chunks === null || state === null
  const holders = new Map(whole ? [] : state.holders)
  const owners = new Map(whole ? [] : state.owners)
  if (!whole) {
    const across = chunksAcross(size)
    for (const c of update.chunks!) {
      const [x0, y0] = [(c % across) * CHUNK_SIZE, Math.floor(c / across) * CHUNK_SIZE]
      for (let y = y0; y < Math.min(size, y0 + CHUNK_SIZE); y++) {
        for (let x = x0; x < Math.min(size, x0 + CHUNK_SIZE); x++) owners.delete(y * size + x)
      }
    }
  }
  for (const { tiles, ...holder } of update.holders) {
    holders.set(holder.id, holder)
    for (const t of tiles) owners.set(t, holder.id)
  }
  return { tick: update.tick, holders, owners, changed: whole ? null : update.chunks }
}

/** What shares a colour on the Region map: an alliance's members, or an Organization alone. */
export function colourKey(holder: RegionHolderInfo): string {
  return holder.alliance?.id ?? holder.id
}

/** A steady colour for a colour key, as 0xRRGGBB: the same key always gets the same colour. */
export function regionColour(key: string): number {
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
