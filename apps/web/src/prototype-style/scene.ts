// PROTOTYPE (T17.1, #203): throwaway, never merged. A made-up scene on real generated terrain so
// three style directions can be judged on the same map. Delete once a style is picked.
import { Terrain, type BuildingKind, type ResourceKind, type TerrainMap } from '@csp/shared'
import { generateTerrain, hash } from '../../../server/src/terrain-gen.js'

/** Who a token belongs to, seen from the viewer (ADR 0008: relationship colours). */
export type Rel = 'own' | 'alliance' | 'other' | 'npc' | 'trade'
export const REL_NAMES: Record<Rel, string> = {
  own: 'Yours',
  alliance: 'Alliance',
  other: 'Other realm',
  npc: 'NPC city',
  trade: 'Trade Organization',
}

export type Activity = 'idle' | 'walk' | 'carry' | 'work' | 'fight'
export type CitySize = 'village' | 'town' | 'large town'

export interface Building {
  kind: BuildingKind
  x: number
  y: number
  rel: Rel
}
export interface Node {
  kind: ResourceKind
  x: number
  y: number
}
export interface Person {
  id: number
  name: string
  x: number
  y: number
  rel: Rel
  leader?: boolean
  activity: Activity
}
export interface Cart {
  x: number
  y: number
  rel: Rel
  caravan?: boolean
}
export interface Army {
  name: string
  x: number
  y: number
  rel: Rel
  soldiers: number
}
export interface City {
  name: string
  x: number
  y: number
  rel: Rel
  size: CitySize
  residents: number
}
export interface Scene {
  map: TerrainMap
  buildings: Building[]
  nodes: Node[]
  people: Person[]
  carts: Cart[]
  horses: { x: number; y: number }[]
  armies: Army[]
  cities: City[]
  roads: Set<number>
  piles: { x: number; y: number }[]
  home: City
}

const SIZE = 320
const SEED = 7

const NAMES = [
  'Ada',
  'Bram',
  'Cora',
  'Dirk',
  'Elsa',
  'Finn',
  'Greta',
  'Hugo',
  'Ilse',
  'Jonas',
  'Kai',
  'Lena',
  'Mats',
  'Nora',
  'Otto',
  'Pia',
  'Rolf',
  'Sina',
  'Tom',
  'Ute',
  'Vera',
  'Wim',
]

export function buildScene(): Scene {
  const map = generateTerrain(SEED, SIZE)
  const at = (x: number, y: number) => map.tiles[y * SIZE + x]!
  const set = (x: number, y: number, t: number) => (map.tiles[y * SIZE + x] = t)
  const count = (x: number, y: number, r: number, t: number) => {
    let n = 0
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const [tx, ty] = [x + dx, y + dy]
        if (tx >= 0 && ty >= 0 && tx < SIZE && ty < SIZE && at(tx, ty) === t) n++
      }
    return n
  }

  // Home: plains with forest, hills and water nearby, away from the edge.
  let home = { x: SIZE / 2, y: SIZE / 2 }
  let best = -1
  for (let y = 40; y < SIZE - 40; y += 3)
    for (let x = 50; x < SIZE - 50; x += 3) {
      if (count(x, y, 5, Terrain.Plains) < 100) continue
      const score =
        Math.min(count(x, y, 16, Terrain.Forest), 60) +
        Math.min(count(x, y, 16, Terrain.Hills), 60) +
        Math.min(count(x, y, 18, Terrain.Lake) + count(x, y, 18, Terrain.Sea), 30) +
        Math.min(count(x, y, 20, Terrain.Mountain), 20)
      if (score > best) [best, home] = [score, { x, y }]
    }

  const buildings: Building[] = []
  const people: Person[] = []
  const cities: City[] = []
  const roads = new Set<number>()
  let id = 0
  const person = (x: number, y: number, rel: Rel, activity: Activity, leader = false) =>
    people.push({
      id: ++id,
      name: NAMES[(id - 1) % NAMES.length]!,
      x,
      y,
      rel,
      activity,
      leader,
    })
  const clear = (cx: number, cy: number, r: number) => {
    for (let dy = -r - 2; dy <= r + 2; dy++)
      for (let dx = -r - 2; dx <= r + 2; dx++)
        if (Math.hypot(dx, dy) <= r + 0.5 + hash(cx + dx, cy + dy, 4) * 2)
          set(cx + dx, cy + dy, Terrain.Plains)
  }

  // A walled city: town hall, houses, storage, wall ring with a gate on the south side.
  const city = (
    cx: number,
    cy: number,
    rel: Rel,
    name: string,
    r: number,
    extra: BuildingKind[],
  ) => {
    clear(cx, cy, r + 2)
    buildings.push({ kind: 'townHall', x: cx, y: cy, rel })
    const inner: [number, number][] = []
    for (let dy = -r + 1; dy <= r - 1; dy++)
      for (let dx = -r + 1; dx <= r - 1; dx++) if (dx || dy) inner.push([cx + dx, cy + dy])
    inner.sort((a, b) => hash(a[0], a[1], 3) - hash(b[0], b[1], 3))
    const kinds: BuildingKind[] = ['storage', ...extra]
    const houses = Math.max(2, Math.floor(inner.length * 0.45) - kinds.length)
    for (let i = 0; i < houses; i++) kinds.push('house')
    kinds.forEach(
      (kind, i) => inner[i] && buildings.push({ kind, x: inner[i][0], y: inner[i][1], rel }),
    )
    for (let d = -r; d <= r; d++) {
      buildings.push({ kind: 'wall', x: cx + d, y: cy - r, rel })
      buildings.push({ kind: d === 0 ? 'gate' : 'wall', x: cx + d, y: cy + r, rel })
      if (Math.abs(d) < r) {
        buildings.push({ kind: 'wall', x: cx - r, y: cy + d, rel })
        buildings.push({ kind: 'wall', x: cx + r, y: cy + d, rel })
      }
    }
    const residents = houses * 4 + 2
    const size: CitySize = residents < 16 ? 'village' : residents < 40 ? 'town' : 'large town'
    const c = { name, x: cx, y: cy, rel, size, residents }
    cities.push(c)
    return c
  }

  const homeCity = city(home.x, home.y, 'own', 'Eastmere', 4, ['warehouse', 'smithy', 'mint'])
  const road = (x0: number, y0: number, x1: number, y1: number) => {
    let [x, y] = [x0, y0]
    while (x !== x1 || y !== y1) {
      if (x !== x1 && (y === y1 || hash(x, y, 9) < 0.5)) x += Math.sign(x1 - x)
      else y += Math.sign(y1 - y)
      if (at(x, y) === Terrain.Lake || at(x, y) === Terrain.Sea || at(x, y) === Terrain.Mountain)
        set(x, y, Terrain.Plains)
      roads.add(y * SIZE + x)
    }
  }

  // Outside the wall: farms, a stable, a pile of goods.
  for (const [dx, dy] of [
    [-3, 6],
    [-2, 6],
    [2, 6],
    [3, 6],
  ] as const)
    buildings.push({ kind: 'farm', x: home.x + dx, y: home.y + dy, rel: 'own' })
  buildings.push({ kind: 'stable', x: home.x + 6, y: home.y + 2, rel: 'own' })
  clear(home.x + 6, home.y + 2, 0)

  // Resource nodes: the nearest fitting tiles around home, plus scattered ones over the map.
  const nodes: Node[] = []
  const nearest = (t: number, minD: number, skip = 0) => {
    const found: [number, number, number][] = []
    for (let y = home.y - 30; y <= home.y + 30; y++)
      for (let x = home.x - 30; x <= home.x + 30; x++) {
        const d = Math.hypot(x - home.x, y - home.y)
        if (d >= minD && at(x, y) === t) found.push([d, x, y])
      }
    found.sort((a, b) => a[0] - b[0])
    const f = found[skip * 7] ?? [0, home.x + minD, home.y]
    return { x: f[1], y: f[2] }
  }
  const forest = nearest(Terrain.Forest, 8)
  const iron = nearest(Terrain.Hills, 11)
  const stone = nearest(Terrain.Hills, 11, 3)
  const gold = nearest(Terrain.Mountain, 16)
  nodes.push({ kind: 'forest', ...forest }, { kind: 'ironOre', ...iron })
  nodes.push({ kind: 'stone', ...stone }, { kind: 'goldOre', ...gold })
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(hash(i, 1, 5) * SIZE)
    const y = Math.floor(hash(i, 2, 5) * SIZE)
    const t = at(x, y)
    const kind: ResourceKind | undefined =
      t === Terrain.Forest
        ? 'forest'
        : t === Terrain.Hills
          ? i % 3
            ? 'stone'
            : 'ironOre'
          : t === Terrain.Mountain
            ? 'goldOre'
            : undefined
    if (kind && Math.hypot(x - home.x, y - home.y) > 12) nodes.push({ kind, x, y })
  }
  buildings.push({ kind: 'lumberCamp', x: forest.x, y: forest.y, rel: 'own' })
  buildings.push({ kind: 'mine', x: iron.x, y: iron.y, rel: 'own' })
  buildings.push({ kind: 'quarry', x: stone.x, y: stone.y, rel: 'npc' })
  buildings.push({ kind: 'smelter', x: home.x + 6, y: home.y - 2, rel: 'own' })
  clear(home.x + 6, home.y - 2, 0)
  road(home.x, home.y + 5, iron.x, iron.y)

  // Residents at home and at work.
  person(home.x, home.y, 'own', 'idle', true)
  for (let i = 0; i < 7; i++)
    person(home.x - 2 + (i % 2) * 4 + (i > 3 ? 1 : 0), home.y + 6, 'own', 'work')
  for (let i = 0; i < 3; i++) person(forest.x, forest.y, 'own', 'work')
  for (let i = 0; i < 2; i++) person(iron.x, iron.y, 'own', 'work')
  for (let i = 0; i < 5; i++) person(home.x + 1, home.y - 1, 'own', 'idle')
  for (let i = 0; i < 3; i++) person(home.x - 2, home.y + 2, 'own', 'idle')
  const roadTiles = [...roads]
  const mid = roadTiles[Math.floor(roadTiles.length / 2)]!
  const carry = roadTiles[Math.floor(roadTiles.length / 4)]!
  person(carry % SIZE, Math.floor(carry / SIZE), 'own', 'carry')
  person(home.x - 5, home.y - 3, 'own', 'walk')
  const carts: Cart[] = [{ x: mid % SIZE, y: Math.floor(mid / SIZE), rel: 'own' }]
  person(mid % SIZE, Math.floor(mid / SIZE), 'own', 'carry')
  const horses = [
    { x: home.x + 7, y: home.y + 2 },
    { x: home.x + 7, y: home.y + 3 },
    { x: mid % SIZE, y: Math.floor(mid / SIZE) },
  ]

  // Neighbours: an allied town, an NPC village, another realm's city with an army out.
  const ally = city(home.x + 24, home.y - 6, 'alliance', 'Brightwater', 3, ['warehouse'])
  const village = city(home.x - 22, home.y + 9, 'npc', 'Oakhollow', 2, [])
  const rival = city(home.x + 6, home.y + 30, 'other', 'Redcliff', 4, ['smithy', 'stable'])
  for (const [c, n, rel] of [
    [ally, 6, 'alliance'],
    [village, 5, 'npc'],
    [rival, 6, 'other'],
  ] as const)
    for (let i = 0; i < n; i++)
      person(c.x + (i % 3) - 1, c.y + (i % 2), rel, i % 2 ? 'idle' : 'work')
  buildings.push({ kind: 'farm', x: village.x, y: village.y + 4, rel: 'npc' })
  road(home.x + 4, home.y, ally.x - 3, ally.y)
  road(village.x + 2, village.y, home.x - 4, home.y)

  const armies: Army[] = [
    { name: 'Redcliff guard', x: iron.x + 3, y: iron.y + 3, rel: 'other', soldiers: 6 },
    { name: 'First company', x: home.x + 2, y: home.y + 8, rel: 'own', soldiers: 4 },
  ]
  for (let i = 0; i < 6; i++) person(iron.x + 3, iron.y + 3, 'other', 'fight')
  for (let i = 0; i < 4; i++) person(home.x + 2, home.y + 8, 'own', 'fight')

  // A Trade Org caravan on the road to the ally.
  const allyRoad = [...roads].filter((t) => t % SIZE > home.x + 8)
  const cv = allyRoad[Math.floor(allyRoad.length / 2)] ?? mid
  carts.push({ x: cv % SIZE, y: Math.floor(cv / SIZE), rel: 'trade', caravan: true })
  for (let i = 0; i < 3; i++) person(cv % SIZE, Math.floor(cv / SIZE), 'trade', 'walk')

  // Far-away cities so the far tier has something to show.
  const far: [string, Rel][] = [
    ['Stonebridge', 'npc'],
    ['Mirefold', 'npc'],
    ['Ashgrove', 'other'],
    ['Highmoor', 'alliance'],
    ['Saltmarsh', 'npc'],
    ['Kettleby', 'other'],
    ['Northwick', 'npc'],
    ['Larkspur', 'npc'],
  ]
  let k = 0
  for (let i = 0; k < far.length && i < 4000; i++) {
    const x = 20 + Math.floor(hash(i, 7, 11) * (SIZE - 40))
    const y = 20 + Math.floor(hash(i, 8, 11) * (SIZE - 40))
    if (count(x, y, 3, Terrain.Plains) < 40) continue
    if (cities.some((c) => Math.hypot(c.x - x, c.y - y) < 40)) continue
    const [name, rel] = far[k++]!
    city(x, y, rel, name, 2 + (i % 3), i % 2 ? ['warehouse'] : [])
  }

  const piles = [{ x: home.x + 5, y: home.y + 5 }]
  return {
    map,
    buildings,
    nodes,
    people,
    carts,
    horses,
    armies,
    cities,
    roads,
    piles,
    home: homeCity,
  }
}
