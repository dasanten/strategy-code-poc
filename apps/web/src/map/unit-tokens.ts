import {
  SHARES_A_TILE,
  type Army,
  type Building,
  type SeenCaravan,
  type SeenCarriage,
  type SeenCity,
  type SeenHorse,
  type SeenResident,
} from '@csp/shared'
import { caravanParts } from '../caravans.js'
import { ACTIVITY_ART, BASE_ART, PAINTED_UNIT_ART, UNIT_ART, paintedCell } from './art.js'
import { tileToScreen, zoomTier, type Camera, type Size } from './camera.js'
import { residentActivity, tileFigures, type Activity } from './figures.js'
import {
  isLeader,
  relationshipColor,
  type BadgeLayer,
  type Leaders,
  type Tone,
  type TokenLayer,
  type Viewer,
} from './tokens.js'
import {
  armyBanners,
  entityRelationship,
  residentGroups,
  unitRadius,
  type Known,
  type ResidentGroup,
} from './units.js'

/** What of the world the unit tokens need. */
export interface UnitWorld {
  map: { size: number }
  residents: readonly SeenResident[]
  horses: readonly SeenHorse[]
  carriages: readonly SeenCarriage[]
  armies: readonly Pick<Army, 'id' | 'realmId' | 'memberIds'>[]
  caravans: readonly SeenCaravan[]
  cities: readonly Pick<SeenCity, 'id' | 'realmId' | 'tradeOrg'>[]
  buildings: readonly Pick<Building, 'kind' | 'x' | 'y'>[]
}

/**
 * Where a resident's or carriage's token was drawn this frame, for the selection ring and the
 * picked residents' places (`map/places.ts`).
 */
export interface Spot {
  x: number
  y: number
  r: number
}

/**
 * Where a token on a tile is drawn, in tile units (`map/motion.ts`): on its way from the tile it
 * left, or in place.
 */
export type Where = (id: string, x: number, y: number) => readonly [number, number]

/** Every token in place: the map between ticks when nothing moves. */
export const inPlace: Where = (_id, x, y) => [x, y]

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
  rel: Tone | undefined,
) {
  const color = relationshipColor(rel)
  const base = (r * 24) / 11
  const painted = PAINTED_UNIT_ART[file]
  if (painted !== undefined) {
    // Painted art (`docs/art.md`): the figure inside a ring in the relationship colour.
    tokens.place(BASE_ART.roundRing, x, y, base, color)
    tokens.place(paintedCell(painted), x, y, r * 1.7)
    return
  }
  tokens.place(BASE_ART.round, x, y, base)
  tokens.place(BASE_ART.roundRing, x, y, base, color)
  tokens.place(file, x, y, r * 1.2, color)
}

/**
 * Where the horse under a rider is drawn (`CONTEXT.md`: Riding): a horse token the size of the
 * rider's, behind it and out to its lower left, so the rider sits on it.
 */
export function mountSpot(rider: Spot): Spot {
  return { x: rider.x - rider.r * 0.8, y: rider.y + rider.r * 0.6, r: rider.r }
}

/** A rider's horse token, in the rider's relationship colour; drawn before the rider, so beneath. */
function drawMount(tokens: TokenLayer, rider: Spot, rel: Tone | undefined) {
  const { x, y, r } = mountSpot(rider)
  drawUnit(tokens, UNIT_ART.horse, x, y, r, rel)
}

/**
 * Residents, carriages, horses, Trade Org caravans and armies at middle zoom and closer
 * (ADR 0008): residents on one tile as one token with a count, coloured by the largest group,
 * or up close as single figures with their activity (`drawFigures`);
 * an army as a banner with its soldier count; carts and caravans, a cart's passengers inside it
 * as a count; horses not hitched to a cart,
 * and a ridden one as a horse token under its rider (in a group token, under the group).
 * Units on a tile with a building or a cart step aside to its corners so both show.
 * Tokens are coloured as `viewer` sees them; the `leaders` wear the crown. Each token is drawn
 * `where` the motion between ticks puts it (`CONTEXT.md`: Motion on the map); a token for several
 * residents at the mean of where they are.
 */
export function drawUnits(
  tokens: TokenLayer,
  badges: BadgeLayer,
  cam: Camera,
  view: Size,
  world: UnitWorld,
  viewer: Viewer,
  leaders: Leaders,
  where: Where = inPlace,
): Map<string, Spot> {
  const size = world.map.size
  const tile = cam.scale
  const parts = caravanParts(world.caravans)
  const known: Known = {
    cities: new Map(world.cities.map((c) => [c.id, c])),
    caravan: new Set([...parts.carriages, ...parts.crew]),
  }
  const key = (e: { x: number; y: number }) => `${e.x},${e.y}`
  const built = new Set(world.buildings.filter((b) => !SHARES_A_TILE.includes(b.kind)).map(key))
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
  // A token for several residents on a tile is drawn at the mean of where they are on their way.
  const meanOf = (ids: readonly string[], x: number, y: number): readonly [number, number] => {
    let [mx, my] = [0, 0]
    for (const id of ids) {
      const [px, py] = where(id, x, y)
      mx += px
      my += py
    }
    return [mx / ids.length, my / ids.length]
  }

  // Horses standing free; a hitched one moves with its cart and shows as the cart, a ridden one
  // with its rider.
  const hitched = new Set(world.carriages.map((k) => k.horseId))
  const ridden = new Set(world.residents.map((r) => r.riding))
  for (const h of world.horses) {
    if (hitched.has(h.id) || ridden.has(h.id)) continue
    const busy = built.has(key(h)) || carted.has(key(h)) || peopled.has(key(h))
    const p = at(...where(h.id, h.x, h.y), busy ? -0.28 : 0, busy ? -0.28 : 0)
    if (!near(p)) continue
    drawUnit(
      tokens,
      UNIT_ART.horse,
      ...p,
      unitRadius('horse', tile),
      entityRelationship(h, viewer, known),
    )
  }

  const spots = new Map<string, Spot>()
  // Passengers ride inside their carriage (`CONTEXT.md`: Passenger): its badge counts them, and
  // they are found at it.
  const passengers = new Set(world.carriages.flatMap((k) => k.passengerIds ?? []))
  for (const k of world.carriages) {
    const aside = built.has(key(k))
    const p = at(...where(k.id, k.x, k.y), aside ? -0.28 : 0, aside ? 0.28 : 0)
    if (!near(p)) continue
    const caravan = parts.carriages.has(k.id)
    const r = unitRadius('carriage', tile)
    drawUnit(
      tokens,
      caravan ? UNIT_ART.caravan : UNIT_ART.carriage,
      ...p,
      r,
      entityRelationship(k, viewer, known),
    )
    const aboard = k.passengerIds ?? []
    if (aboard.length > 0) badge(`${aboard.length}`, ...p, r)
    for (const id of [k.id, ...aboard]) spots.set(id, { x: p[0], y: p[1], r })
  }

  // People step to the lower right of a building or a cart on their tile.
  const place = (on: { x: number; y: number }, pos: readonly [number, number], full: number) => {
    const aside = built.has(key(on)) || carted.has(key(on))
    const [sx, sy] = at(...pos, aside ? 0.3 : 0, aside ? 0.3 : 0)
    return { x: sx, y: sy, r: aside ? unitRadius('aside', tile) : full }
  }

  const banners = armyBanners(world.armies, world.residents)
  const armyById = new Map(world.armies.map((a) => [a.id, a]))
  for (const b of banners) {
    const spot = place(b, meanOf(b.under, b.x, b.y), unitRadius('army', tile))
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
    leaders,
    new Set([...banners.flatMap((b) => b.under), ...passengers]),
  )
  const close = zoomTier(tile) === 'close'
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  for (const g of groups) {
    const pos = meanOf(g.ids, g.x, g.y)
    if (close) {
      if (!near(at(...pos))) continue
      const figureAt = (dx: number, dy: number, id?: string) =>
        at(...(id === undefined ? ([g.x, g.y] as const) : where(id, g.x, g.y)), dx - 0.5, dy - 0.5)
      drawFigures(tokens, badges, g, figureAt, tile, {
        relOf: (id) => rels.get(id),
        leaders,
        activityOf: (id) => residentActivity(byId.get(id)!),
        rides: (id) => byId.get(id)?.riding !== undefined,
        spots,
      })
      continue
    }
    const spot = place(g, pos, unitRadius('residents', tile))
    if (!near([spot.x, spot.y])) continue
    const rider = g.ids.find((id) => byId.get(id)?.riding !== undefined)
    if (rider !== undefined) drawMount(tokens, spot, rels.get(rider))
    drawUnit(tokens, g.leader ? UNIT_ART.leader : UNIT_ART.person, spot.x, spot.y, spot.r, g.rel)
    if (g.ids.length > 1) badge(`×${g.ids.length}`, spot.x, spot.y, spot.r)
    for (const id of g.ids) spots.set(id, spot)
  }
  return spots
}

/** From this many pixels per tile up, figures get their activity icon; below it they are too small. */
const ACTIVITY_SCALE = 22

/**
 * The residents on one tile as single figures at close zoom (ADR 0008): up to four, each in its
 * own relationship colour with an activity icon at its lower right, and a rider on their horse
 * token; with more, three and a "+N" badge. Residents left out are found at the badge. `at` puts
 * a place on the tile on screen, for the figure `id` where it is on its way; the badge stays put.
 */
function drawFigures(
  tokens: TokenLayer,
  badges: BadgeLayer,
  g: ResidentGroup,
  at: (dx: number, dy: number, id?: string) => readonly [number, number],
  tile: number,
  of: {
    relOf: (id: string) => Tone | undefined
    leaders: Leaders
    activityOf: (id: string) => Activity | undefined
    rides: (id: string) => boolean
    spots: Map<string, Spot>
  },
) {
  const { figures, more } = tileFigures(g.ids, of.relOf, of.leaders)
  const r = unitRadius('figure', tile)
  for (const f of figures) {
    const [x, y] = at(f.dx, f.dy, f.id)
    const rel = of.relOf(f.id)
    const leader = isLeader(of.leaders, f.id)
    if (of.rides(f.id)) drawMount(tokens, { x, y, r }, rel)
    drawUnit(tokens, leader ? UNIT_ART.leader : UNIT_ART.person, x, y, r, rel)
    of.spots.set(f.id, { x, y, r })
    const activity = of.activityOf(f.id)
    if (activity && tile >= ACTIVITY_SCALE) {
      const [ax, ay] = [x + r * 0.85, y + r * 0.8]
      tokens.place(BASE_ART.round, ax, ay, r * 1.05)
      tokens.place(ACTIVITY_ART[activity], ax, ay, r * 0.62, relationshipColor(rel))
    }
  }
  if (more) {
    const [x, y] = at(more.dx, more.dy)
    badges.place(`+${more.ids.length}`, x, y, Math.max(8, tile * 0.22))
    for (const id of more.ids) of.spots.set(id, { x, y, r })
  }
}
