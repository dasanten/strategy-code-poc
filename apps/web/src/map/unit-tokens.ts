import type { Army, Building, Carriage, Horse, Resident, SeenCaravan, SeenCity } from '@csp/shared'
import { caravanParts } from '../caravans.js'
import { BASE_ART, UNIT_ART } from './art.js'
import { tileToScreen, type Camera, type Size } from './camera.js'
import { relationshipColor, type BadgeLayer, type Relationship, type TokenLayer } from './tokens.js'
import { armyBanners, entityRelationship, residentGroups, type Known } from './units.js'

/** What of the world the unit tokens need. */
export interface UnitWorld {
  map: { size: number }
  home: { realmId: string; leaderId?: string | null }
  residents: readonly Resident[]
  horses: readonly Horse[]
  carriages: readonly Carriage[]
  armies: readonly Pick<Army, 'id' | 'realmId' | 'memberIds'>[]
  caravans: readonly SeenCaravan[]
  cities: readonly Pick<SeenCity, 'id' | 'realmId' | 'tradeOrg'>[]
  buildings: readonly Pick<Building, 'kind' | 'x' | 'y'>[]
  diplomacy: { alliance?: { members: { realmId: string }[] } | null }
}

/** Where a resident's token was drawn this frame, for the selection ring. */
export interface Spot {
  x: number
  y: number
  r: number
}

/**
 * A unit as a token (ADR 0008): a dark round badge, the ring and glyph in the relationship
 * colour. The art's circle has a radius of 11 in its 24-unit box.
 */
function drawUnit(
  tokens: TokenLayer,
  file: string,
  x: number,
  y: number,
  r: number,
  rel: Relationship | undefined,
) {
  const color = relationshipColor(rel)
  const base = (r * 24) / 11
  tokens.place(BASE_ART.round, x, y, base)
  tokens.place(BASE_ART.roundRing, x, y, base, color)
  tokens.place(file, x, y, r * 1.2, color)
}

/**
 * Residents, carriages, horses, Trade Org caravans and armies at middle zoom and closer
 * (ADR 0008): residents on one tile as one token with a count, coloured by the largest group;
 * an army as a banner with its soldier count; carts and caravans; horses not hitched to a cart.
 * Units on a tile with a building or a cart step aside to its corners so both show.
 */
export function drawUnits(
  tokens: TokenLayer,
  badges: BadgeLayer,
  cam: Camera,
  view: Size,
  world: UnitWorld,
): Map<string, Spot> {
  const size = world.map.size
  const tile = cam.scale
  const parts = caravanParts(world.caravans)
  const viewer = {
    realmId: world.home.realmId,
    allies: new Set(world.diplomacy.alliance?.members.map((m) => m.realmId)),
  }
  const known: Known = {
    cities: new Map(world.cities.map((c) => [c.id, c])),
    caravan: new Set([...parts.carriages, ...parts.crew]),
  }
  const key = (e: { x: number; y: number }) => `${e.x},${e.y}`
  const built = new Set(world.buildings.filter((b) => b.kind !== 'road').map(key))
  const carted = new Set(world.carriages.map(key))
  const peopled = new Set(world.residents.map(key))
  const at = (x: number, y: number, dx = 0, dy = 0) =>
    tileToScreen(cam, view, size, x + 0.5 + dx, y + 0.5 + dy)
  const near = ([sx, sy]: readonly number[]) =>
    sx! > -tile * 2 &&
    sy! > -tile * 2 &&
    sx! < view.width + tile * 2 &&
    sy! < view.height + tile * 2
  const badgeSize = Math.max(8, tile * 0.24)
  const badge = (label: string, x: number, y: number, r: number) =>
    badges.place(label, x + r * 0.85, y - r * 0.85, badgeSize)

  // Horses standing free; a hitched one moves with its cart and shows as the cart.
  const hitched = new Set(world.carriages.map((k) => k.horseId))
  for (const h of world.horses) {
    if (hitched.has(h.id)) continue
    const busy = built.has(key(h)) || carted.has(key(h)) || peopled.has(key(h))
    const p = at(h.x, h.y, busy ? -0.28 : 0, busy ? -0.28 : 0)
    if (!near(p)) continue
    drawUnit(
      tokens,
      UNIT_ART.horse,
      ...p,
      Math.max(4.5, tile * 0.24),
      entityRelationship(h, viewer, known),
    )
  }

  for (const k of world.carriages) {
    const p = at(k.x, k.y, built.has(key(k)) ? -0.28 : 0, built.has(key(k)) ? 0.28 : 0)
    if (!near(p)) continue
    const caravan = parts.carriages.has(k.id)
    drawUnit(
      tokens,
      caravan ? UNIT_ART.caravan : UNIT_ART.carriage,
      ...p,
      Math.max(5.5, tile * 0.36),
      entityRelationship(k, viewer, known),
    )
  }

  const spots = new Map<string, Spot>()
  // People step to the lower right of a building or a cart on their tile.
  const place = (x: number, y: number, full: number) => {
    const aside = built.has(`${x},${y}`) || carted.has(`${x},${y}`)
    const [sx, sy] = at(x, y, aside ? 0.3 : 0, aside ? 0.3 : 0)
    return { x: sx, y: sy, r: aside ? Math.max(5, tile * 0.28) : full }
  }

  const banners = armyBanners(world.armies, world.residents)
  const armyById = new Map(world.armies.map((a) => [a.id, a]))
  for (const b of banners) {
    const spot = place(b.x, b.y, Math.max(6, tile * 0.4))
    if (!near([spot.x, spot.y])) continue
    const army = armyById.get(b.armyId)!
    drawUnit(tokens, UNIT_ART.army, spot.x, spot.y, spot.r, entityRelationship(army, viewer, known))
    badge(`${b.soldiers}`, spot.x, spot.y, spot.r)
    for (const id of b.under) spots.set(id, spot)
  }

  const rels = new Map(world.residents.map((r) => [r.id, entityRelationship(r, viewer, known)]))
  const groups = residentGroups(
    world.residents,
    (id) => rels.get(id),
    world.home.leaderId,
    new Set(banners.flatMap((b) => b.under)),
  )
  for (const g of groups) {
    const spot = place(g.x, g.y, Math.max(5.5, tile * 0.36))
    if (!near([spot.x, spot.y])) continue
    drawUnit(tokens, g.leader ? UNIT_ART.leader : UNIT_ART.person, spot.x, spot.y, spot.r, g.rel)
    if (g.ids.length > 1) badge(`×${g.ids.length}`, spot.x, spot.y, spot.r)
    for (const id of g.ids) spots.set(id, spot)
  }
  return spots
}
