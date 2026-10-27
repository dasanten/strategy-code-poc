import {
  BUILD_MATERIALS,
  BUILD_WORK,
  BUILDABLE,
  GOODS,
  HORSE_FOOD_PER_DAY,
  HORSE_HUNGRY_SHARE,
  carriageCapacity,
  horseAgeInYears,
  horseFoodFactor,
  MAX_HEALTH,
  MAX_HUNGER,
  MAX_WORKERS,
  NODE_GOOD,
  NODE_WORKPLACE,
  RECIPES,
  STABLE_BREED_TICKS,
  STABLE_CAPACITY,
  TICKS_PER_GAME_DAY,
  WORK_OUTPUT_PER_DAY,
  WORKPLACE_SKILL,
  buildProblem,
  canWork,
  nodeCorner,
  stockWeight,
  type BuildingKind,
  type TerrainLookup,
  type Building,
  type Carriage,
  type City,
  type KnownNode,
  type Pile,
  type Resident,
  type Stock,
  covers,
  wrap,
  FOOTPRINT,
  handOverProblem,
  type Alliance,
  type Diplomacy,
  type MercenaryContract,
  type SeenResident,
  type SeenCarriage,
  type LoadLevel,
  type Horse,
  type SeenHorse,
  type Good,
  type SeenBuilding,
  type SeenCity,
  FOOD_PER_DAY,
  HOUSING_ROOM,
  PROTECTION,
  TERRAIN_FOOD,
  TERRAIN_SPEED,
  Terrain,
  WEAPONS,
  footprintTiles,
  hungerFactor,
  recipeFor,
  recipeGood,
  teardownWork,
  UNEXPLORED,
} from '@csp/shared'
import type { Relationship } from './theme.js'
import { cityRelationship, rankedAs, type Viewer } from './map/tokens.js'
import { BUILDING_NAMES, NODE_NAMES, TERRAIN_NAMES } from './map/palette.js'
import { faresKnown, horseFaresKnown } from './seen.js'
import { lastSeenText, type LastSeenBuilding } from './last-seen.js'

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
  | 'wallTo'
  | 'work'
  | 'tearDown'
  | 'goods'
  | 'pair'
  | 'attack'
  | 'walls'
  | 'script'
  | 'makeLeader'
  | 'rename'
  | 'sendHere'
  | 'gate'
  | 'openCity'
  | 'renameCity'

/** The key that runs each action; fixed per action, so it is the same whatever is selected. */
export const ACTION_KEYS: Record<ActionId, string> = {
  walk: 'W',
  stop: 'S',
  drive: 'D',
  haul: 'H',
  build: 'B',
  roadTo: 'R',
  wallTo: 'Q',
  work: 'E',
  tearDown: 'T',
  goods: 'G',
  pair: 'P',
  attack: 'A',
  walls: 'C',
  script: 'X',
  makeLeader: 'L',
  rename: 'N',
  sendHere: 'W',
  gate: 'O',
  openCity: 'C',
  renameCity: 'N',
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
  /** Why a disabled action can't run now, shown with it. */
  reason?: string
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
  picking: false | 'walk' | 'drive' | 'haul' | 'road' | 'wall'
  /**
   * For one of the Player's own residents who isn't their Leader: why the Leader can't hand the
   * realm over to them now (`CONTEXT.md`: Leader handover), undefined when they can. Absent for
   * the Leader and for anyone else's resident, who get no Make Leader row.
   */
  makeLeader?: { problem: string | undefined }
  /** One of the Player's own residents, whom they can rename (`CONTEXT.md`: Renaming a resident). */
  renamable?: boolean
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
  add(row('wallTo', '', { ...picks('wall', 'Build wall to'), ...child }))
  const torn = [h.building, h.road].filter((b) => b && BUILDABLE.includes(b.kind))
  if (torn.length > 0) add(row('tearDown', 'Tear down…', { opens: true }))
  // Always there, so the Player sees the carry capacity even with nothing to move.
  add(row('goods', 'Goods…', { opens: true }))
  if (h.adult && h.inCity) add(row('pair', 'Pair…', { opens: true }))
  if (h.othersInSight > 0) add(row('attack', 'Attack…', { opens: true }))
  if (h.wallsInSight > 0) add(row('walls', 'Break or climb a wall…', { opens: true }))
  add(row('script', 'Run script…', { opens: true }))
  if (h.makeLeader) {
    const { problem } = h.makeLeader
    add(
      row('makeLeader', 'Make Leader…', {
        opens: true,
        ...(problem ? { disabled: true as const, reason: problem } : {}),
      }),
    )
  }
  if (h.renamable) add(row('rename', 'Rename…', { opens: true }))
  return actions
}

/** What the Player knows that the handover check needs: their diplomacy and what is in sight. */
export interface HandOverSeen {
  tick: number
  diplomacy: Pick<Diplomacy, 'alliance' | 'contracts'>
  cities: City[]
  buildings: Building[]
  mapSize: number
}

/**
 * The shared handover check (`handOverProblem`, the one the server runs) on what the Player
 * sees: their alliance's army and their realm's contracts stand in for the world's. The server
 * checks again when the order arrives.
 */
export function makeLeaderProblem(
  seen: HandOverSeen,
  realm: { id: string; leaderId: string },
  leader: Resident | undefined,
  target: Resident,
): string | undefined {
  const a = seen.diplomacy.alliance
  const alliances: Alliance[] = a
    ? [
        {
          id: a.id,
          name: a.name,
          leaderId: a.leaderId,
          members: a.members.map((m) => ({
            realmId: m.realmId,
            joinedAt: m.joinedAt,
            leaving: m.leavesAt === null ? null : { at: m.leavesAt, removed: false },
          })),
          invites: a.invites.map((i) => i.realmId),
          army: a.army.map((p) => ({ is: p.is, id: p.id, recallAt: p.recallAt })),
        },
      ]
    : []
  const contracts: MercenaryContract[] = seen.diplomacy.contracts.map((c) => ({
    id: c.id,
    lenderId: c.lender.realmId,
    hirerId: c.hirer.realmId,
    offeredBy: c.offeredBy,
    residentIds: c.residents.map((r) => r.id),
    days: c.days,
    pricePerWeek: c.pricePerWeek,
    storageId: c.storage?.id ?? '',
    startedAt: c.startedAt,
    paidWeeks: c.paidWeeks,
  }))
  const world = {
    tick: seen.tick,
    alliances,
    contracts,
    cities: seen.cities,
    buildings: seen.buildings,
  }
  return handOverProblem(world, realm, leader, target, seen.mapSize)
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
function themeRelationship(tone: ReturnType<typeof cityRelationship>): Relationship | undefined {
  const rel = rankedAs(tone)
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

/** How heavily a carriage looks loaded, when the Player can't see its load (`loadLevel`). */
export const LOAD_LEVEL_NAMES: Record<LoadLevel, string> = {
  empty: 'empty',
  light: 'lightly loaded',
  half: 'half loaded',
  heavy: 'heavily loaded',
  full: 'fully loaded',
}

/** What the card's head shows: a name, the owner's colour, and a few lines about it. */
export interface TileCard {
  title: string
  rel?: Relationship
  /** What the card is named after, which picks its icon. */
  what: 'building' | 'carriage' | 'pile' | 'node' | 'residents' | 'horses' | 'tile'
  lines: string[]
  /** An own gate on the tile, to open or close. */
  gate?: Building
  /**
   * A resource node with nothing built on it: its workplace, and the north-west tile where that
   * fits (`nodeFit`), if anywhere.
   */
  buildHere?: { kind: BuildingKind; at: { x: number; y: number } | undefined }
  /** A city the card links to in the city inspector: an own town hall's, or where prices are. */
  city?: { id: string; label: string }
  /** A city of the Player's own whose town hall is in sight on the tile, which they may rename. */
  renameCity?: { id: string; name: string }
  /**
   * For a building the Player only remembers (`CONTEXT.md`: Last seen): when they last saw it,
   * and what they saw of it then, shown apart from the lines about what is there now.
   */
  lastSeen?: { when: string; lines: string[] }
}

/** What the Player sees on a tile, for the tile card. */
export interface TileThings {
  x: number
  y: number
  buildings: SeenBuilding[]
  carriages: SeenCarriage[]
  horses: SeenHorse[]
  piles: Pile[]
  node: KnownNode | undefined
  /** The known resource node on a tile, to find the one under a workplace's footprint. */
  nodeAt?: (x: number, y: number) => KnownNode | undefined
  /** The tile's explored terrain (`Terrain`), undefined while unknown. */
  terrain?: number
  /** Residents in sight on the tile that are not the Player's to command. */
  strangers: SeenResident[]
  /** Everyone in sight, for who works where and who lives in a city. */
  residents?: SeenResident[]
  cities: Pick<SeenCity, 'id' | 'name' | 'realmId' | 'tradeOrg' | 'trade'>[]
  viewer: Viewer
  tick?: number
  /** Residents in sight working each building, by building id. */
  workers: (b: Building) => number
  /** The buildings the Player remembers out of sight, and the tick now (`CONTEXT.md`: Last seen). */
  lastSeen?: { buildings: LastSeenBuilding[]; tick: number }
  /** Where the node's workplace fits on what the Player knows (`nodeFit`), if anywhere. */
  nodeFit?: { x: number; y: number }
}

/**
 * Where the workplace of a resource node can be laid out, as far as the Player knows
 * (`nodeCorner`, `CONTEXT.md`: Where buildings go): the buildings they see, the nodes and terrain
 * they have explored. The server checks again when the order arrives.
 */
export function nodeFit(
  node: KnownNode,
  seen: { buildings: Building[]; cities: City[] },
  nodeAt: (x: number, y: number) => KnownNode | undefined,
  terrain: TerrainLookup,
): { x: number; y: number } | undefined {
  // The nodes a footprint over this one could also cover.
  const reach = FOOTPRINT[NODE_WORKPLACE[node.kind]] - 1
  const nodes: KnownNode[] = []
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const n = nodeAt(wrap(node.x + dx, terrain.size), wrap(node.y + dy, terrain.size))
      if (n) nodes.push(n)
    }
  }
  return nodeCorner({ ...seen, nodes }, terrain, node)
}

/**
 * Why a building of `kind` can't be laid out from (x, y), its footprint running east and south, as
 * far as the Player knows (`buildProblem`, `CONTEXT.md`: Where buildings go): the buildings and
 * cities they see, the nodes and terrain they have explored. The server checks again when the
 * order arrives.
 */
export function buildHereProblem(
  kind: BuildingKind,
  x: number,
  y: number,
  seen: { buildings: Building[]; cities: City[] },
  nodeAt: (x: number, y: number) => KnownNode | undefined,
  terrain: TerrainLookup,
): string | undefined {
  const nodes: KnownNode[] = []
  for (const [tx, ty] of footprintTiles({ kind, x, y }, terrain.size)) {
    const n = nodeAt(tx, ty)
    if (n) nodes.push(n)
  }
  return buildProblem({ ...seen, nodes }, x, y, kind, terrain)
}

/** A node's kind in words: "forest", "iron ore". */
const nodeKindName = (node: KnownNode) => NODE_NAMES[node.kind].replace(/ node$/, '').toLowerCase()

/** "a mine", "an iron ore node". */
const aOrAn = (words: string) => `${/^[aeiou]/.test(words) ? 'an' : 'a'} ${words}`

const capital = (words: string) => `${words[0]!.toUpperCase()}${words.slice(1)}`

/**
 * What an unbuilt resource node's card says (`CONTEXT.md`: Resource node, Workplace): what can be
 * built on it and whether it fits, what that takes, makes and teaches, and what a worker of
 * average Strength and no skill makes there a game day.
 */
function unbuiltNodeLines(
  node: KnownNode,
  fit: { x: number; y: number } | undefined,
  goodLabels: Record<string, string>,
): string[] {
  const kind = NODE_WORKPLACE[node.kind]
  const name = BUILDING_NAMES[kind].toLowerCase()
  const good = NODE_GOOD[node.kind]
  const goodName = goodLabels[good]!.toLowerCase()
  const materials = BUILD_MATERIALS[kind] ?? {}
  const days = (BUILD_WORK[kind] ?? 0) / TICKS_PER_GAME_DAY
  const skill = WORKPLACE_SKILL[kind]!
  const needs =
    Object.keys(materials).length > 0 ? goodsText(materials, goodLabels) : 'no materials'
  return [
    fit ? `${capital(aOrAn(name))} can be built here` : `No room for ${aOrAn(name)} here`,
    `Needs ${needs} and ${days} game day${days === 1 ? '' : 's'} of one resident’s work`,
    `Makes ${goodName} · teaches ${capital(skill)}`,
    `Up to ${MAX_WORKERS[kind]} workers · about ${WORK_OUTPUT_PER_DAY[good]} ${goodName} each a game day at average Strength`,
  ]
}

/** Goods in words: "4 iron ore, 2 wood". */
function goodsText(stock: Stock | undefined, labels: Record<string, string>): string {
  const parts = GOODS.filter((g) => (stock?.[g] ?? 0) > 0).map(
    (g) => `${stock![g]} ${labels[g]!.toLowerCase()}`,
  )
  return parts.length > 0 ? parts.join(', ') : 'nothing'
}

/** How a horse fares in words: fed, hungry or starving, and healthy or hurt. */
function horseFares(h: Horse): { hunger: 'fed' | 'hungry' | 'starving'; health: string } {
  const hunger =
    h.hunger <= 0 ? 'starving' : h.hunger < HORSE_HUNGRY_SHARE * MAX_HUNGER ? 'hungry' : 'fed'
  return { hunger, health: h.health < MAX_HEALTH ? 'hurt' : 'healthy' }
}

/** A horse's age in words: game days for a foal under a game year, whole game years after. */
export function horseAgeText(h: SeenHorse, tick: number): string {
  const years = Math.floor(horseAgeInYears(h, tick))
  if (years >= 1) return `${years} ${years === 1 ? 'year' : 'years'} old`
  const days = Math.max(0, Math.floor((tick - h.bornAt) / TICKS_PER_GAME_DAY))
  return `${days} game ${days === 1 ? 'day' : 'days'} old`
}

/**
 * A horse's stats and age, and how it fares where the Player knows it (`CONTEXT.md`: Horse stats,
 * Seeing how someone fares): "Speed 12, Strength 8, Endurance 10 · 5 years old · fed, healthy".
 */
function horseDetail(h: SeenHorse, tick: number | undefined): string {
  const { speed, strength, endurance } = h.stats
  const parts = [`Speed ${speed}, Strength ${strength}, Endurance ${endurance}`]
  if (tick !== undefined) parts.push(horseAgeText(h, tick))
  if (horseFaresKnown(h)) {
    const fares = horseFares(h)
    parts.push(`${fares.hunger}, ${fares.health}`)
  }
  return parts.join(' · ')
}

/**
 * Lines for horses standing together, one per owner: "2 horses (yours) · 1 hungry", then one for
 * each of them (`horseDetail`). How they fare only for those the Player knows it of (`CONTEXT.md`:
 * Seeing how someone fares).
 */
function horseLines(
  horses: SeenHorse[],
  rel: (h: SeenHorse) => Relationship | undefined,
  tick: number | undefined,
): string[] {
  const groups = new Map<string, SeenHorse[]>()
  for (const h of horses) {
    const key = `${h.realmId}/${h.cityId}`
    groups.set(key, [...(groups.get(key) ?? []), h])
  }
  return [...groups.values()].flatMap((group) => {
    const r = rel(group[0]!)
    const owner = r ? RELATIONSHIP_NAMES[r].toLowerCase() : 'nobody’s'
    const parts = [`${group.length} ${group.length === 1 ? 'horse' : 'horses'} (${owner})`]
    const known = group.filter(horseFaresKnown).map(horseFares)
    const hungry = known.filter((f) => f.hunger !== 'fed').length
    const hurt = known.filter((f) => f.health === 'hurt').length
    if (hungry > 0) parts.push(`${hungry} hungry`)
    if (hurt > 0) parts.push(`${hurt} hurt`)
    return [parts.join(' · '), ...group.map((h) => `· ${horseDetail(h, tick)}`)]
  })
}

/**
 * Game days until a stable's next foal while two fed horses of one owner stand in it with room
 * for another (`CONTEXT.md`: Stable, `breedingPair`), as far as the Player knows how they fare.
 */
function daysToFoal(stable: Building, inIt: SeenHorse[]): number | undefined {
  if (inIt.length >= STABLE_CAPACITY) return undefined
  const fed = inIt.filter((h) => horseFaresKnown(h) && h.hunger > 0)
  const pair = fed.some((a) =>
    fed.some((b) => b !== a && b.realmId === a.realmId && b.cityId === a.cityId),
  )
  if (!pair) return undefined
  const left = STABLE_BREED_TICKS - (stable.breeding ?? 0)
  return Math.max(1, Math.ceil(left / TICKS_PER_GAME_DAY))
}

/**
 * The card for a tile: named after the most important thing on it (a building or site, then a
 * carriage, goods on the ground, a resource node, strangers), with a line for everything there.
 * Where no building is in sight but the Player remembers one, the card is named after that, says
 * when they last saw it and what they saw then, and offers nothing to do with it.
 */
export function describeTile(t: TileThings, goodLabels: Record<string, string>): TileCard {
  const here = <T extends { x: number; y: number }>(xs: T[]) =>
    xs.filter((v) => v.x === t.x && v.y === t.y)
  // A building shows on every tile of its footprint, with its one pile (`CONTEXT.md`: At a building).
  const live = t.buildings.find((b) => b.kind !== 'road' && covers(b, t.x, t.y))
  const remembered = live
    ? undefined
    : t.lastSeen?.buildings.find((b) => b.kind !== 'road' && covers(b, t.x, t.y))
  const building = live ?? remembered
  const road = here(t.buildings).find((b) => b.kind === 'road')
  const carriage = here(t.carriages)[0]
  const pileTile = live ?? t
  const pile = t.piles.find((p) => p.x === pileTile.x && p.y === pileTile.y)
  const cityOf = (b: Building) => t.cities.find((c) => c.id === b.cityId)
  // Every horse in the stable on the tile, hitched or not, as it breeds and fills up
  // (`breedingPair`); elsewhere the horses on the tile not pulling a carriage.
  const hitched = new Set(t.carriages.map((k) => k.horseId))
  // Who is in or at a building only remembered is not known.
  const stable = live?.kind === 'stable' && !live.site ? live : undefined
  const horsesHere = t.horses.filter((h) =>
    stable ? covers(stable, h.x, h.y) : !hitched.has(h.id) && h.x === t.x && h.y === t.y,
  )
  const horseRel = (h: SeenHorse) => realmRelationship(h.realmId, h.cityId, t.cities, t.viewer)
  const lines: string[] = []
  let card: Omit<TileCard, 'lines'> | undefined
  let buildHere: TileCard['buildHere']
  if (building) {
    const city = cityOf(building)
    const rel = themeRelationship(cityRelationship(city, t.viewer))
    const name = BUILDING_NAMES[building.kind]
    card = {
      title: building.site ? `${name} site` : city ? `${city.name} ${name.toLowerCase()}` : name,
      rel,
      what: 'building',
      gate:
        building === live && building.kind === 'gate' && !building.site && rel === 'own'
          ? building
          : undefined,
    }
    lines.push(rel ? RELATIONSHIP_NAMES[rel] : 'Nobody’s')
    if (building.site) {
      const work = BUILD_WORK[building.kind] ?? 0
      const done = work > 0 ? Math.floor((building.site.work / work) * 100) : 100
      lines.push(
        `${done}% of the work done · delivered ${goodsText(building.site.delivered, goodLabels)}`,
      )
      lines.push(stillNeeded(building, goodLabels))
    } else {
      const max = MAX_WORKERS[building.kind]
      if (max !== undefined && live) lines.push(`${t.workers(live)} / ${max} workers`)
      if (stable) {
        lines.push(
          ...(horsesHere.length > 0
            ? horseLines(horsesHere, horseRel, t.tick)
            : ['No horses in it']),
        )
        lines.push(`Room for ${Math.max(0, STABLE_CAPACITY - horsesHere.length)} more horses`)
      }
      const makes = live && makesLine(live, t, pile, goodLabels)
      if (makes) lines.push(makes)
      if (building.stock) lines.push(`Holds ${goodsText(building.stock, goodLabels)}`)
      const foal = stable && daysToFoal(stable, horsesHere)
      if (foal) lines.push(`Next foal in about ${foal} game ${foal === 1 ? 'day' : 'days'}`)
      if (building.kind === 'gate') lines.push(building.closed ? 'Closed' : 'Open')
      if (building.kind === 'townHall' && (rel === 'own' || rel === 'alliance') && city) {
        if (live) lines.push(...townHallLines(city.id, t))
        if (rel === 'own')
          card.city = { id: city.id, label: `Open ${city.name} in the city inspector` }
        // Renaming a city (`CONTEXT.md`): from its town hall's card, while it is the Player's.
        if (rel === 'own' && live) card.renameCity = { id: city.id, name: city.name }
      }
      if (city && sellsHere(building, city)) {
        lines.push('Buys and sells here · prices in the city inspector')
        card.city = { id: city.id, label: 'See its prices in the city inspector' }
      }
    }
    if (building.teardown) lines.push(teardownLine(building))
    if (remembered && t.lastSeen) {
      card.lastSeen = {
        when: lastSeenText(remembered.seenAt, t.lastSeen.tick),
        lines: lines.splice(0),
      }
    }
  }
  if (carriage) {
    const rel = realmRelationship(carriage.realmId, carriage.cityId, t.cities, t.viewer)
    card ??= { title: 'Carriage', rel, what: 'carriage' }
    // Its load only when the Player sees inside (`CONTEXT.md`: Seeing inside a storage).
    const capacity = carriageCapacity(t, carriage)
    const load = carriage.load
      ? `${Math.round(stockWeight(carriage.load))} / ${Math.round(capacity)} kg`
      : LOAD_LEVEL_NAMES[carriage.loadLevel]
    // How its horse fares only for the Player's own and allies' (`CONTEXT.md`: Seeing how someone fares).
    const horse = t.horses.find((h) => h.id === carriage.horseId)
    const fares = horse && horseFaresKnown(horse) ? horseFares(horse) : undefined
    const ours = rel === 'own' || rel === 'alliance'
    const horseText = !carriage.horseId
      ? ours
        ? ' · no horse hitched'
        : ' · no horse'
      : fares
        ? ''
        : ' · horse hitched'
    lines.push(
      `Carriage${rel ? ` (${RELATIONSHIP_NAMES[rel].toLowerCase()})` : ''} · ${load}${horseText}`,
    )
    if (horse) {
      const parts = [`Horse: ${horseDetail(horse, t.tick)}`]
      if (fares) {
        const food = carriage.load?.food ?? 0
        const days = Math.floor(food / (HORSE_FOOD_PER_DAY * horseFoodFactor(horse)) + 1e-9)
        const feeds =
          days <= 0
            ? 'Food on board for less than a game day'
            : `Food on board for ${days} game ${days === 1 ? 'day' : 'days'}`
        parts.push(food > 0 ? feeds : 'no Food on board')
      }
      lines.push(parts.join(' · '))
    }
  }
  if (pile) {
    card ??= { title: 'Goods on the ground', what: 'pile' }
    lines.push(`On the ground: ${goodsText(pile.goods, goodLabels)}`)
  }
  if (t.node) {
    const kindName = nodeKindName(t.node)
    card ??= { title: `${capital(kindName)} node`, what: 'node' }
    // Only a node's workplace covers a node: one on it, or its site, has built it over.
    if (building) lines.push(`On ${aOrAn(kindName)} node`)
    else {
      lines.push(...unbuiltNodeLines(t.node, t.nodeFit, goodLabels))
      buildHere = { kind: NODE_WORKPLACE[t.node.kind], at: t.nodeFit }
    }
  }
  if (t.strangers.length > 0) {
    const r = t.strangers[0]!
    const rel = realmRelationship(r.owner, r.cityId, t.cities, t.viewer)
    card ??= {
      title: t.strangers.length === 1 ? r.name : `${t.strangers.length} residents`,
      rel,
      what: 'residents',
    }
    if (t.strangers.length === 1) {
      const gear = gearText(r, goodLabels)
      lines.push(
        `${r.name}${rel ? ` · ${RELATIONSHIP_NAMES[rel]}` : ''}${gear ? ` · ${gear}` : ''}`,
      )
    } else lines.push(...strangersLines(t.strangers))
  }
  if (!stable && horsesHere.length > 0) {
    card ??= {
      title: horsesHere.length === 1 ? 'Horse' : `${horsesHere.length} horses`,
      rel: horseRel(horsesHere[0]!),
      what: 'horses',
    }
    lines.push(...horseLines(horsesHere, horseRel, t.tick))
  }
  const terrain = terrainLine(t.terrain, road)
  if (road) {
    lines.push(road.site ? 'Road site' : terrain!)
    if (road.teardown) lines.push(teardownLine(road))
  }
  if (terrain && !(road && !road.site)) lines.push(terrain)
  lines.push(`Tile ${t.x}, ${t.y}`)
  return {
    ...(card ?? {
      title: road && !road.site ? 'Road' : (groundName(t.terrain) ?? 'Open ground'),
      what: 'tile',
    }),
    lines,
    ...(buildHere ? { buildHere } : {}),
  }
}

/** The explored terrain's name, undefined while it is unknown. */
function groundName(terrain: number | undefined): string | undefined {
  return terrain === undefined || terrain === UNEXPLORED ? undefined : TERRAIN_NAMES[terrain]
}

/**
 * How the tile's ground walks and feeds (`CONTEXT.md`: Terrain, Road): "Hills · speed ~70% · food
 * 130%", or a finished road's speed on whatever it lies on.
 */
function terrainLine(terrain: number | undefined, road: Building | undefined): string | undefined {
  const speed = (v: number) => `speed ${v === 1 ? '' : '~'}${Math.round(v * 100)}%`
  const food = (v: number) => `food ${Math.round(v * 100)}%`
  const name = groundName(terrain)
  if (road && !road.site) {
    const on = name ? ` on ${name.toLowerCase()}` : ''
    return `Road${on} · ${speed(TERRAIN_SPEED[Terrain.Road])} · ${food(TERRAIN_FOOD[Terrain.Road])}`
  }
  if (!name) return undefined
  const s = (TERRAIN_SPEED as Partial<Record<number, number>>)[terrain!]
  const f = (TERRAIN_FOOD as Partial<Record<number, number>>)[terrain!]
  return s === undefined || f === undefined
    ? `${name} · impassable`
    : `${name} · ${speed(s)} · ${food(f)}`
}

/** What a construction site still lacks of its materials (`CONTEXT.md`: Construction site). */
function stillNeeded(site: Building, labels: Record<string, string>): string {
  const needs = BUILD_MATERIALS[site.kind] ?? {}
  if (Object.keys(needs).length === 0) return 'Needs no materials, only work'
  const left: Stock = {}
  for (const [good, units] of Object.entries(needs) as [Good, number][]) {
    const missing = units - (site.site?.delivered[good] ?? 0)
    if (missing > 0) left[good] = missing
  }
  return Object.keys(left).length === 0
    ? 'All materials delivered'
    : `Still needs ${goodsText(left, labels)}`
}

/**
 * What a workplace makes and how much of it lies in its pile (`CONTEXT.md`: Workplace); at a
 * smithy, what its workers in sight are making (`CONTEXT.md`: Smithy).
 */
function makesLine(
  b: Building,
  t: TileThings,
  pile: Pile | undefined,
  labels: Record<string, string>,
): string | undefined {
  if (MAX_WORKERS[b.kind] === undefined || !WORKPLACE_SKILL[b.kind]) return undefined
  const label = (g: Good) => labels[g]!.toLowerCase()
  const inPile = (g: Good) => pile?.goods[g] ?? 0
  if ((RECIPES[b.kind]?.length ?? 0) > 1) {
    const making = new Map<Good, number>()
    for (const r of t.residents ?? []) {
      const o = r.order
      if (o?.kind !== 'workAt' || o.buildingId !== b.id) continue
      const recipe = recipeFor(b.kind, o.makes)
      if (recipe) making.set(recipeGood(recipe), (making.get(recipeGood(recipe)) ?? 0) + 1)
    }
    const made = RECIPES[b.kind]!.map(recipeGood)
    const piled = made.filter((g) => inPile(g) > 0).map((g) => `${inPile(g)} ${label(g)}`)
    const pileText = ` · in its pile: ${piled.length > 0 ? piled.join(', ') : 'nothing made'}`
    if (making.size === 0) return `Makes weapons and armour, nobody at it${pileText}`
    const list = [...making].map(([g, n]) => `${label(g)} (${n})`).join(', ')
    return `Its workers make ${list}${pileText}`
  }
  const node =
    NODE_WORKPLACE_KINDS.has(b.kind) && t.nodeAt
      ? footprintTiles(b)
          .map(([x, y]) => t.nodeAt!(x, y))
          .find((n) => n && NODE_WORKPLACE[n.kind] === b.kind)
      : undefined
  const recipe = RECIPES[b.kind]?.[0]
  const good: Good | undefined =
    b.kind === 'farm' ? 'food' : node ? NODE_GOOD[node.kind] : recipe && recipeGood(recipe)
  if (!good) return undefined
  return `Makes ${label(good)} · ${inPile(good)} in its pile`
}

/** The kinds of workplace built on a resource node. */
const NODE_WORKPLACE_KINDS = new Set<string>(Object.values(NODE_WORKPLACE))

/** The weapons and armour a resident carries (`CONTEXT.md`: Weapons and armour), in words. */
function gearText(
  r: Pick<Resident, 'carried'>,
  labels: Record<string, string>,
): string | undefined {
  const has = (g: Good) => (r.carried[g] ?? 0) > 0
  const gear = [...WEAPONS, ...PROTECTION].filter(has).map((g) => labels[g]!.toLowerCase())
  if (gear.length === 0) return undefined
  return WEAPONS.some(has) ? `armed: ${gear.join(', ')}` : `unarmed, with ${gear.join(', ')}`
}

/** The army a resident's order is for, if it is one (`CONTEXT.md`: Army). */
function armyOf(r: SeenResident): string | undefined {
  return (r.order as { army?: string } | null)?.army
}

/**
 * Several strangers on a tile: each army among them as "Army · 12 soldiers" (`CONTEXT.md`:
 * Soldier, Army), then the rest and how many of them are armed.
 */
function strangersLines(strangers: SeenResident[]): string[] {
  const armies = new Map<string, SeenResident[]>()
  const rest: SeenResident[] = []
  for (const r of strangers) {
    const a = armyOf(r)
    if (a) armies.set(a, [...(armies.get(a) ?? []), r])
    else rest.push(r)
  }
  const armed = (rs: SeenResident[]) =>
    rs.filter((r) => WEAPONS.some((w) => (r.carried[w] ?? 0) > 0)).length
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const lines = [...armies.values()].map((rs) => {
    const soldiers = armed(rs)
    const unarmed = rs.length - soldiers
    return `Army · ${plural(soldiers, 'soldier', 'soldiers')}${unarmed > 0 ? ` · ${unarmed} unarmed` : ''}`
  })
  if (rest.length > 0) {
    const n = armed(rest)
    lines.push(
      `${plural(rest.length, 'resident', 'residents')} of other realms${n > 0 ? ` · ${n} armed` : ''}`,
    )
  }
  return lines
}

/**
 * An own or allied city's town hall: its residents, free housing (`CONTEXT.md`: House) and how
 * many game days the Food in its storages lasts them, from what the Player sees of it.
 */
function townHallLines(cityId: string, t: TileThings): string[] {
  const residents = (t.residents ?? []).filter((r) => r.cityId === cityId)
  const mine = t.buildings.filter((b) => b.cityId === cityId && !b.site)
  const room = mine.reduce((n, b) => n + (HOUSING_ROOM[b.kind] ?? 0), 0)
  const lines = [`${residents.length} residents · ${room - residents.length} free housing`]
  const food = mine
    .filter((b) => b.kind === 'storage')
    .reduce((n, b) => n + (b.stock?.food ?? 0), 0)
  const perDay = residents
    .filter(faresKnown)
    .reduce((n, r) => n + FOOD_PER_DAY * hungerFactor(r, t.tick ?? 0), 0)
  if (perDay > 0) {
    const days = Math.floor(food / perDay)
    lines.push(
      days < 1
        ? 'Food for less than a game day'
        : `Food for ${days} game ${days === 1 ? 'day' : 'days'}`,
    )
  }
  return lines
}

/**
 * Whether the building is where the Player trades with a Trade Org warehouse or an NPC city
 * (`CONTEXT.md`: Warehouse prices, Trading with an NPC city), with prices they are shown.
 */
function sellsHere(b: SeenBuilding, city: TileThings['cities'][number]): boolean {
  if (b.kind === 'warehouse') return (b.prices?.length ?? 0) > 0
  return (
    b.kind === 'storage' && city.realmId === null && !city.tradeOrg && (city.trade?.length ?? 0) > 0
  )
}

/** How far tearing a building or site down has come (`CONTEXT.md`: Tearing down). */
function teardownLine(b: Building): string {
  const work = teardownWork(b)
  const done = work > 0 ? Math.min(100, Math.floor(((b.teardown ?? 0) / work) * 100)) : 100
  return `Being torn down · ${done}% done`
}

/**
 * The actions a tile's card offers: send the resident picked last there, or have them build an
 * unbuilt node's workplace there (`buildHere`), open or close an own gate, and open the city
 * inspector at the city the card links to. Everything else a resident does on the tile is on
 * their own card once they stand there. `tick` tells whether the resident is still a child.
 */
export function tileActions(card: TileCard, actor: Resident | undefined, tick = 0): CardAction[] {
  const actions: CardAction[] = []
  if (actor)
    actions.push({ id: 'sendHere', label: `Send ${actor.name} here`, key: ACTION_KEYS.sendHere })
  if (actor && card.buildHere) {
    const name = BUILDING_NAMES[card.buildHere.kind].toLowerCase()
    const reason = !card.buildHere.at
      ? `no room for ${aOrAn(name)} here`
      : !canWork(actor, tick)
        ? 'children can’t build'
        : undefined
    actions.push({
      id: 'build',
      label: `Build ${aOrAn(name)} here`,
      key: ACTION_KEYS.build,
      ...(reason ? { disabled: true as const, reason } : {}),
    })
  }
  if (card.gate)
    actions.push({
      id: 'gate',
      label: card.gate.closed ? 'Open the gate' : 'Close the gate',
      key: ACTION_KEYS.gate,
    })
  if (card.city) actions.push({ id: 'openCity', label: card.city.label, key: ACTION_KEYS.openCity })
  if (card.renameCity)
    actions.push({
      id: 'renameCity',
      label: 'Rename the city…',
      key: ACTION_KEYS.renameCity,
      opens: true,
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
