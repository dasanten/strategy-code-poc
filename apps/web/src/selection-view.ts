import {
  BUILD_WORK,
  BUILDABLE,
  CARRIAGE_CAPACITY,
  GOODS,
  MAX_WORKERS,
  NODE_GOOD,
  NODE_WORKPLACE,
  RECIPES,
  WORKPLACE_SKILL,
  stockWeight,
  type Building,
  type Carriage,
  type City,
  type KnownNode,
  type Pile,
  type Resident,
  type Stock,
} from '@csp/shared'
import type { Relationship } from './theme.js'
import { cityRelationship, type Viewer } from './map/tokens.js'
import { BUILDING_NAMES, NODE_NAMES } from './map/palette.js'

/**
 * What the selection card shows (ADR 0008): one of the Player's residents, or a tile of the map
 * with whatever stands on it (a building or site, a carriage, a pile, a resource node).
 */
export type Selection = { kind: 'resident'; id: string } | { kind: 'tile'; x: number; y: number }

/** An action the selection card offers. */
export type ActionId =
  | 'walk'
  | 'stop'
  | 'drive'
  | 'haul'
  | 'build'
  | 'roadTo'
  | 'work'
  | 'tearDown'
  | 'goods'
  | 'pair'
  | 'attack'
  | 'walls'
  | 'script'
  | 'sendHere'
  | 'gate'

/** The key that runs each action; fixed per action, so it is the same whatever is selected. */
export const ACTION_KEYS: Record<ActionId, string> = {
  walk: 'W',
  stop: 'S',
  drive: 'D',
  haul: 'H',
  build: 'B',
  roadTo: 'R',
  work: 'E',
  tearDown: 'T',
  goods: 'G',
  pair: 'P',
  attack: 'A',
  walls: 'C',
  script: 'X',
  sendHere: 'W',
  gate: 'O',
}

/**
 * One row of actions on the card. An action either acts at once (or starts picking a tile on the
 * map) or `opens` a panel below the rows with what it needs: goods, a partner, a target, a script.
 */
export interface CardAction {
  id: ActionId
  label: string
  key: string
  opens?: true
  disabled?: true
  /** The map is waiting for a tile for this action. */
  active?: true
}

/** What a resident's card needs to know about them and their tile. */
export interface ResidentHere {
  /** A child can't build, work, carry goods, drive or pair (`CONTEXT.md`: Child). */
  adult: boolean
  /** They have an order or run a script, so there is something to stop. */
  busy: boolean
  /** They belong to a city, so they can pair. */
  inCity: boolean
  carrying: boolean
  carriage?: Carriage
  pile?: Pile
  storage?: Building
  /** The building or construction site on their tile, not a road. */
  building?: Building
  road?: Building
  node?: KnownNode
  /** Residents of other realms, or of none, in sight. */
  othersInSight: number
  /** Walls and gates of other realms' cities, or of none, in sight. */
  wallsInSight: number
  /** What the map is waiting for a tile for. */
  picking: false | 'walk' | 'drive' | 'haul' | 'road'
}

/**
 * Whether a building can be worked: a finished workplace with something to make (`CONTEXT.md`:
 * Workplace), on its node for a node's workplace.
 */
export function isWorkable(building: Building | undefined, node: KnownNode | undefined): boolean {
  if (!building || building.site || MAX_WORKERS[building.kind] === undefined) return false
  if (!WORKPLACE_SKILL[building.kind]) return false
  const good = building.kind === 'farm' ? 'food' : node && NODE_GOOD[node.kind]
  return !!good || (RECIPES[building.kind] ?? []).length > 0
}

/** The actions a resident's card offers, in the order it shows them. */
export function residentActions(h: ResidentHere): CardAction[] {
  const row = (id: ActionId, label: string, more: Partial<CardAction> = {}): CardAction => ({
    id,
    label,
    key: ACTION_KEYS[id],
    ...more,
  })
  const child = h.adult ? {} : { disabled: true as const }
  const picks = (mode: ResidentHere['picking'], label: string) =>
    h.picking === mode ? { label: 'Pick a tile…', active: true as const } : { label }
  const actions: CardAction[] = []
  const add = (a: CardAction) => actions.push(a)
  add(row('walk', '', picks('walk', 'Walk to')))
  if (h.busy) add(row('stop', 'Stop'))
  if (h.carriage) {
    add(row('drive', '', { ...picks('drive', 'Drive carriage to'), ...child }))
    add(row('haul', h.picking === 'haul' ? 'Pick the other stop…' : 'Haul route…', { opens: true }))
  }
  if (isWorkable(h.building, h.node)) {
    add(
      row('work', `Work at the ${BUILDING_NAMES[h.building!.kind].toLowerCase()}…`, {
        opens: true,
      }),
    )
  }
  const site = h.building?.site ? h.building : h.road?.site ? h.road : undefined
  add(
    row('build', site ? `Help build the ${BUILDING_NAMES[site.kind].toLowerCase()}…` : 'Build…', {
      opens: true,
    }),
  )
  add(row('roadTo', '', { ...picks('road', 'Build road to'), ...child }))
  const torn = [h.building, h.road].filter((b) => b && BUILDABLE.includes(b.kind))
  if (torn.length > 0) add(row('tearDown', 'Tear down…', { opens: true }))
  const goodsHere = h.pile || h.storage || site || h.carriage
  if (h.carrying || goodsHere) add(row('goods', 'Goods…', { opens: true }))
  if (h.adult && h.inCity) add(row('pair', 'Pair…', { opens: true }))
  if (h.othersInSight > 0) add(row('attack', 'Attack…', { opens: true }))
  if (h.wallsInSight > 0) add(row('walls', 'Break or climb a wall…', { opens: true }))
  add(row('script', 'Run script…', { opens: true }))
  return actions
}

/** The relationship of a carriage's or a resident's owner (ADR 0008), seen from the viewer. */
function realmRelationship(
  realmId: string | null,
  cityId: string | null,
  cities: Pick<City, 'id' | 'realmId' | 'tradeOrg'>[],
  viewer: Viewer,
): Relationship | undefined {
  if (realmId === viewer.realmId) return 'own'
  if (realmId !== null) return viewer.allies.has(realmId) ? 'alliance' : 'otherRealm'
  return themeRelationship(
    cityRelationship(
      cities.find((c) => c.id === cityId),
      viewer,
    ),
  )
}

/** The map's short relationship names to the theme's. */
function themeRelationship(rel: ReturnType<typeof cityRelationship>): Relationship | undefined {
  if (!rel) return undefined
  return (
    {
      own: 'own',
      alliance: 'alliance',
      other: 'otherRealm',
      npc: 'npcCity',
      trade: 'tradeOrg',
    } as const
  )[rel]
}

/** Owner names for the card's lines. */
export const RELATIONSHIP_NAMES: Record<Relationship, string> = {
  own: 'Yours',
  alliance: 'Alliance',
  otherRealm: 'Another realm',
  npcCity: 'NPC city',
  tradeOrg: 'Trade Organization',
}

/** What the card's head shows: a name, the owner's colour, and a few lines about it. */
export interface TileCard {
  title: string
  rel?: Relationship
  /** What the card is named after, which picks its icon. */
  what: 'building' | 'carriage' | 'pile' | 'node' | 'residents' | 'tile'
  lines: string[]
  /** An own gate on the tile, to open or close. */
  gate?: Building
}

/** What the Player sees on a tile, for the tile card. */
export interface TileThings {
  x: number
  y: number
  buildings: Building[]
  carriages: Carriage[]
  piles: Pile[]
  node: KnownNode | undefined
  /** Residents in sight on the tile that are not the Player's to command. */
  strangers: Resident[]
  cities: Pick<City, 'id' | 'name' | 'realmId' | 'tradeOrg'>[]
  viewer: Viewer
  /** Residents in sight working each building, by building id. */
  workers: (b: Building) => number
}

/** Goods in words: "4 iron ore, 2 wood". */
function goodsText(stock: Stock | undefined, labels: Record<string, string>): string {
  const parts = GOODS.filter((g) => (stock?.[g] ?? 0) > 0).map(
    (g) => `${stock![g]} ${labels[g]!.toLowerCase()}`,
  )
  return parts.length > 0 ? parts.join(', ') : 'nothing'
}

/**
 * The card for a tile: named after the most important thing on it (a building or site, then a
 * carriage, goods on the ground, a resource node, strangers), with a line for everything there.
 */
export function describeTile(t: TileThings, goodLabels: Record<string, string>): TileCard {
  const here = <T extends { x: number; y: number }>(xs: T[]) =>
    xs.filter((v) => v.x === t.x && v.y === t.y)
  const buildings = here(t.buildings)
  const building = buildings.find((b) => b.kind !== 'road')
  const road = buildings.find((b) => b.kind === 'road')
  const carriage = here(t.carriages)[0]
  const pile = here(t.piles)[0]
  const cityOf = (b: Building) => t.cities.find((c) => c.id === b.cityId)
  const lines: string[] = []
  let card: Omit<TileCard, 'lines'> | undefined
  if (building) {
    const city = cityOf(building)
    const rel = themeRelationship(cityRelationship(city, t.viewer))
    const name = BUILDING_NAMES[building.kind]
    card = {
      title: building.site ? `${name} site` : city ? `${city.name} ${name.toLowerCase()}` : name,
      rel,
      what: 'building',
      gate: building.kind === 'gate' && !building.site && rel === 'own' ? building : undefined,
    }
    lines.push(rel ? RELATIONSHIP_NAMES[rel] : 'Nobody’s')
    if (building.site) {
      const work = BUILD_WORK[building.kind] ?? 0
      const done = work > 0 ? Math.floor((building.site.work / work) * 100) : 100
      lines.push(
        `${done}% of the work done · delivered ${goodsText(building.site.delivered, goodLabels)}`,
      )
    } else {
      const max = MAX_WORKERS[building.kind]
      if (max !== undefined) lines.push(`${t.workers(building)} / ${max} workers`)
      if (building.stock) lines.push(`Holds ${goodsText(building.stock, goodLabels)}`)
      if (building.kind === 'gate') lines.push(building.closed ? 'Closed' : 'Open')
    }
  }
  if (carriage) {
    const rel = realmRelationship(carriage.realmId, carriage.cityId, t.cities, t.viewer)
    card ??= { title: 'Carriage', rel, what: 'carriage' }
    lines.push(
      `Carriage${rel ? ` (${RELATIONSHIP_NAMES[rel].toLowerCase()})` : ''} · ${Math.round(stockWeight(carriage.load))} / ${CARRIAGE_CAPACITY} kg${carriage.horseId ? '' : ' · no horse hitched'}`,
    )
  }
  if (pile) {
    card ??= { title: 'Goods on the ground', what: 'pile' }
    lines.push(`On the ground: ${goodsText(pile.goods, goodLabels)}`)
  }
  if (t.node) {
    card ??= { title: `${NODE_NAMES[t.node.kind]} node`, what: 'node' }
    const workplace = BUILDING_NAMES[NODE_WORKPLACE[t.node.kind]].toLowerCase()
    lines.push(
      building
        ? `On a ${NODE_NAMES[t.node.kind].toLowerCase()} node`
        : `Resource node · a ${workplace} can be built here`,
    )
  }
  if (t.strangers.length > 0) {
    const r = t.strangers[0]!
    const rel = realmRelationship(r.owner, r.cityId, t.cities, t.viewer)
    card ??= {
      title: t.strangers.length === 1 ? r.name : `${t.strangers.length} residents`,
      rel,
      what: 'residents',
    }
    lines.push(
      t.strangers.length === 1
        ? `${r.name}${rel ? ` · ${RELATIONSHIP_NAMES[rel]}` : ''}`
        : `${t.strangers.length} residents of other realms`,
    )
  }
  if (road) lines.push(road.site ? 'Road site' : 'Road')
  lines.push(`Tile ${t.x}, ${t.y}`)
  return {
    ...(card ?? { title: road && !road.site ? 'Road' : 'Open ground', what: 'tile' }),
    lines,
  }
}

/**
 * The actions a tile's card offers: send the resident picked last there, and open or close an own
 * gate. Everything else a resident does on the tile is on their own card once they stand there.
 */
export function tileActions(card: TileCard, actor: Resident | undefined): CardAction[] {
  const actions: CardAction[] = []
  if (actor)
    actions.push({ id: 'sendHere', label: `Send ${actor.name} here`, key: ACTION_KEYS.sendHere })
  if (card.gate)
    actions.push({
      id: 'gate',
      label: card.gate.closed ? 'Open the gate' : 'Close the gate',
      key: ACTION_KEYS.gate,
    })
  return actions
}

/**
 * The action a key press runs, if one of the shown actions has that key and can run. Keys typed
 * into a field never run actions.
 */
export function actionForKey(actions: CardAction[], key: string): CardAction | undefined {
  const k = key.toUpperCase()
  return actions.find((a) => a.key === k && !a.disabled)
}
