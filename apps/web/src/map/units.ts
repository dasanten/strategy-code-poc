import type { Army, City, Resident } from '@csp/shared'
import {
  cityRelationship,
  isLeader,
  rankedAs,
  realmRelationship,
  type Leaders,
  type Relationship,
  type Tone,
  type Viewer,
} from './tokens.js'

/** What else decides who a thing belongs to: the cities in sight, and the Trade Org caravans' parts. */
export interface Known {
  cities: ReadonlyMap<string, Pick<City, 'realmId' | 'tradeOrg'>>
  /** Carriages and crew of the Trade Org caravans in sight, by id (`caravans.ts`). */
  caravan: ReadonlySet<string>
}

/** A resident (`owner`) or a horse, carriage or army (`realmId`). */
export type Owned = { id: string; cityId?: string | null } & (
  { owner: string | null } | { realmId: string | null }
)

/**
 * How the viewer stands to a resident, horse, carriage or army (ADR 0008): a Trade Org caravan's
 * carriage or crew is the Trade Organization's; one of a realm is the viewer's own, an alliance
 * member's or another realm's; one of no realm goes by its city (NPC city or Trade Organization).
 * Undefined for one of nobody.
 */
export function entityRelationship(e: Owned, viewer: Viewer, known: Known): Tone | undefined {
  if (known.caravan.has(e.id)) return 'trade'
  const realm = 'owner' in e ? e.owner : e.realmId
  if (realm !== null) return realmRelationship(realm, viewer)
  return cityRelationship(e.cityId ? known.cities.get(e.cityId) : undefined, viewer)
}

/** Which colour wins a tie between equally large groups on a tile: the viewer's own first. */
const TIE_ORDER: (Relationship | undefined)[] = [
  'own',
  'alliance',
  'other',
  'npc',
  'trade',
  undefined,
]

/** Residents on one tile as one token (ADR 0008: middle zoom). */
export interface ResidentGroup {
  x: number
  y: number
  ids: string[]
  /** The tone of the largest group of them, which colours the token. */
  rel: Tone | undefined
  /** A Leader who wears the crown is among them (`Leaders`): the token shows it. */
  leader: boolean
}

/**
 * Residents grouped per tile, each group coloured by its largest relationship (or on the admin
 * map, realm). Residents in `skip` (soldiers under their army's banner) are left out.
 */
export function residentGroups(
  residents: readonly Pick<Resident, 'id' | 'x' | 'y'>[],
  relOf: (id: string) => Tone | undefined,
  leaders: Leaders,
  skip: ReadonlySet<string> = new Set(),
): ResidentGroup[] {
  const byTile = new Map<string, { x: number; y: number; ids: string[] }>()
  for (const r of residents) {
    if (skip.has(r.id)) continue
    const key = `${r.x},${r.y}`
    const tile = byTile.get(key) ?? { x: r.x, y: r.y, ids: [] }
    byTile.set(key, tile)
    tile.ids.push(r.id)
  }
  return [...byTile.values()].map((t) => {
    const counts = new Map<Tone | undefined, number>()
    for (const id of t.ids) counts.set(relOf(id), (counts.get(relOf(id)) ?? 0) + 1)
    let rel: Tone | undefined
    let most = 0
    let rank = TIE_ORDER.length
    for (const [r, n] of counts) {
      const at = TIE_ORDER.indexOf(rankedAs(r))
      if (n > most || (n === most && at < rank)) [rel, most, rank] = [r, n, at]
    }
    return { ...t, rel, leader: t.ids.some((id) => isLeader(leaders, id)) }
  })
}

/** An army as one banner token with its soldier count (ADR 0008). */
export interface ArmyBanner {
  armyId: string
  x: number
  y: number
  soldiers: number
  /** Its members on the banner's tile, drawn by the banner instead of as residents. */
  under: string[]
}

/**
 * Where each army's banner stands: the tile most of its members in sight are on. Members
 * elsewhere still show as residents. An army with no member in sight has no banner.
 */
export function armyBanners(
  armies: readonly Pick<Army, 'id' | 'memberIds'>[],
  residents: readonly Pick<Resident, 'id' | 'x' | 'y'>[],
): ArmyBanner[] {
  const byId = new Map(residents.map((r) => [r.id, r]))
  const banners: ArmyBanner[] = []
  for (const a of armies) {
    const tiles = new Map<string, { x: number; y: number; ids: string[] }>()
    for (const id of a.memberIds) {
      const r = byId.get(id)
      if (!r) continue
      const key = `${r.x},${r.y}`
      const tile = tiles.get(key) ?? { x: r.x, y: r.y, ids: [] }
      tiles.set(key, tile)
      tile.ids.push(id)
    }
    let best: { x: number; y: number; ids: string[] } | undefined
    for (const t of tiles.values()) if (!best || t.ids.length > best.ids.length) best = t
    if (best)
      banners.push({
        armyId: a.id,
        x: best.x,
        y: best.y,
        soldiers: a.memberIds.length,
        under: best.ids,
      })
  }
  return banners
}

/** The kinds of unit token, each with its own size (ADR 0008). */
export type UnitToken = 'horse' | 'carriage' | 'army' | 'residents' | 'aside' | 'figure'

/**
 * A token's radius as a fraction of a tile, before `UNIT_GROWTH`: `aside` is people beside a
 * building or cart on their tile, `figure` a single resident up close.
 */
const UNIT_SIZE: Record<UnitToken, number> = {
  horse: 0.24,
  carriage: 0.36,
  army: 0.4,
  residents: 0.36,
  aside: 0.28,
  figure: 0.2,
}

/** How much bigger unit tokens are drawn than they first were, so they are easy to spot and click. */
export const UNIT_GROWTH = 1.5

/** The smallest a unit token's radius gets when zoomed out, in screen pixels. */
export const MIN_UNIT_RADIUS = 8

/** A unit token's radius in screen pixels at `tile` pixels per tile. */
export const unitRadius = (kind: UnitToken, tile: number): number =>
  Math.max(MIN_UNIT_RADIUS, tile * UNIT_SIZE[kind] * UNIT_GROWTH)
