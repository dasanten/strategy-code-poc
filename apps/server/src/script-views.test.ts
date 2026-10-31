import { parse, run, type ScriptObject } from '@csp/lang'
import {
  AVERAGE_HORSE_STATS,
  ARMY_SCRIPT_API,
  DEFAULT_SCRIPTS,
  SCRIPT_API,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_VALUE_LIMITS,
  SCRIPT_VIEWS,
  SIGHT_RANGE,
  TICKS_PER_GAME_YEAR,
  Terrain,
  scriptValueProblems,
  type Building,
  type ScriptBinding,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { ExploredTerrain } from './explored.js'
import { mulberry32, newResident } from './residents.js'
import { bindScript } from './script-bindings.js'
import { entitiesInSight } from './sight.js'
import { createWorld } from './world.js'

const SIZE = 256
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const sender = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7): a1 running a script as a looping queue's step, paired with a2, who is in army ar1; city c1 with its
 * town hall, a stocked storage and a construction site; an outpost storage; a horse and a carriage. Realm r2
 * (Player 8): b1 next to a1, and city c2 in sight. An NPC city c3 in sight; a pile, a node, an
 * admin directive, and a building and a city Player 7 last saw, out of sight now.
 */
function setup() {
  const world = createWorld(terrain)
  world.tick = 50
  world.nodes = [{ id: 'n1', kind: 'forest', x: 11, y: 12 }]
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 'a1' },
    { id: 'r2', userId: 8, leaderId: 'b1' },
  )
  const building = (b: Omit<Building, 'cityId'> & Partial<Pick<Building, 'cityId'>>) => {
    world.buildings.push({ cityId: null, ...b })
  }
  world.cities.push(
    { id: 'c1', name: 'Ashford', realmId: 'r1', townHallId: 'h1' },
    { id: 'c2', name: 'Brill', realmId: 'r2', townHallId: 'h2' },
    { id: 'c3', name: 'Coldwater', realmId: null, townHallId: 'h3' },
  )
  building({ id: 'h1', kind: 'townHall', cityId: 'c1', x: 12, y: 10 })
  building({ id: 's1', kind: 'storage', cityId: 'c1', x: 13, y: 10, stock: { food: 5, wood: 2 } })
  building({
    id: 'site1',
    kind: 'house',
    cityId: 'c1',
    x: 12,
    y: 11,
    site: { delivered: { wood: 2 }, work: 1 },
  })
  building({ id: 'h2', kind: 'townHall', cityId: 'c2', x: 8, y: 10 })
  building({ id: 's2', kind: 'storage', cityId: 'c2', x: 8, y: 11, stock: { stone: 3 } })
  building({ id: 'h3', kind: 'townHall', cityId: 'c3', x: 14, y: 14 })
  building({ id: 's3', kind: 'storage', cityId: 'c3', x: 15, y: 14, stock: { food: 40 } })
  // An outpost storage of r1 (`CONTEXT.md`: Outpost storage).
  building({ id: 'os1', kind: 'storage', realmId: 'r1', x: 6, y: 8, stock: { food: 3 } })

  const a1 = resident(world, 'a1', 'r1', 'c1', 10, 10)
  const a2 = resident(world, 'a2', 'r1', 'c1', 10, 11)
  resident(world, 'b1', 'r2', 'c2', 9, 10)
  a1.script = { scriptId: 1, memory: { role: 'gatherer' } }
  a1.queue = {
    realmId: 'r1',
    steps: [{ id: 1, order: { kind: 'runScript', scriptId: 1 }, minutes: 30 }],
    current: 0,
    startedAt: 40,
    loop: true,
    nextStepId: 2,
  }
  a1.pair = { partnerId: 'a2', since: 3 }
  a2.pair = { partnerId: 'a1', since: 3 }
  world.armies.push({ id: 'ar1', name: 'Vanguard', realmId: 'r1', memberIds: ['a2'], order: null })
  world.horses.push({
    id: 'hz1',
    realmId: 'r1',
    cityId: null,
    x: 10,
    y: 12,
    hunger: 90,
    health: 100,
    name: 'Rowan',
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  })
  world.carriages.push({
    id: 'cr1',
    realmId: 'r1',
    cityId: null,
    x: 10,
    y: 12,
    horseId: 'hz1',
    load: { food: 4 },
  })
  world.piles.push({ id: 'p1', x: 10, y: 10, goods: { food: 5 } })
  world.directives.push({
    id: 'd1',
    target: 'r2',
    withAlliance: false,
    reason: 'raiding',
    givenBy: 'admin',
    givenAt: 1,
    goals: [
      { kind: 'city', city: 'Brill' },
      { kind: 'soldiers', count: 2, percent: 10 },
    ],
    soldiersKilled: 0,
    price: 50,
  })
  world.lastSeen[7] = [
    { is: 'building', id: 'far1', kind: 'farm', cityId: 'c9', x: 200, y: 200, seenAt: 4 },
    { is: 'city', id: 'c9', name: 'Dunmore', realmId: 'r2', townHallId: 'h9', seenAt: 4 },
  ]
  const explored = new ExploredTerrain(terrain, world.nodes)
  explored.explore(7, 10, 10, SIGHT_RANGE)
  return { world, explored }
}

function resident(
  world: WorldState,
  id: string,
  owner: string,
  cityId: string,
  x: number,
  y: number,
) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  r.cityId = cityId
  r.bornAt = -20 * TICKS_PER_GAME_YEAR
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/**
 * What each expression in `calls` answers in one run of a1's script, or ar1's with `army`;
 * `prepare` changes the world first.
 */
function answers(calls: Record<string, string>, army = false, prepare?: (w: WorldState) => void) {
  const { world, explored } = setup()
  prepare?.(world)
  const memory: ScriptObject = {}
  const bindings = bindScript({
    world,
    terrain,
    sender,
    ...(army ? { armyId: 'ar1' } : { residentId: 'a1' }),
    memory,
    seen: () => entitiesInSight(world, terrain, 'r1'),
    explored: (x, y) => explored.isExplored({ id: 7 }, x, y),
  })
  const fields = Object.entries(calls).map(([key, call]) => `${key}: ${call}`)
  const result = run(parse(`memory.out = {${fields.join(', ')}}`), {
    globals: bindings.globals,
    steps: 100_000,
    maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
    limits: SCRIPT_VALUE_LIMITS,
  })
  expect(result).toMatchObject({ status: 'done' })
  return memory.out as Record<string, unknown>
}

const returnsOf = (api: readonly ScriptBinding[], name: string) =>
  api.find((b) => b.name === name)!.returns

describe('script views', () => {
  it('describe every field of everything the queries and `me` hand a script', () => {
    const calls: Record<string, string> = {
      me: 'me',
      residents: 'residents()',
      buildings: 'buildings()',
      cities: 'cities()',
      horses: 'horses()',
      carriages: 'carriages()',
      piles: 'piles()',
      nodes: 'nodes()',
      lastSeen: 'lastSeen()',
      directives: 'directives()',
      withMemory: 'withMemory("role", "gatherer")',
      building: 'building("s1")',
      buildingAt: 'buildingAt(13, 10)',
      pileAt: 'pileAt(10, 10)',
      outputOf: 'outputOf(building("s1"))',
      materialsNeeded: 'materialsNeeded(building("site1"))',
      terrainAt: 'terrainAt(10, 10)',
      distance: 'distance(me, building("s1"))',
      floor: 'floor(2.5)',
      pickRandom: 'pickRandom(["food"])',
      fits: 'fits("food")',
      breedingPair: 'breedingPair(building("s1"))',
      storages: 'storages()',
      walkTime: 'walkTime(me, building("s1"))',
      tick: 'tick',
      mapSize: 'mapSize',
      random: 'random',
    }
    // Every name in the API but `memory`, `params` (the script's own) and the actions.
    expect(Object.keys(calls).sort()).toEqual(
      SCRIPT_API.filter((b) => b.is !== 'action' && b.name !== 'memory' && b.name !== 'params')
        .map((b) => b.name)
        .sort(),
    )
    const out = answers(calls)
    const ids = (name: string) => (out[name] as { id: string }[]).map((e) => e.id)
    // Own things and others', so both are looked at.
    expect(ids('residents')).toEqual(expect.arrayContaining(['a1', 'b1']))
    expect(ids('buildings')).toEqual(expect.arrayContaining(['s1', 's2', 's3', 'site1']))
    expect(ids('cities')).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']))
    expect(ids('lastSeen')).toEqual(['far1', 'c9'])
    for (const name of ['horses', 'carriages', 'piles', 'nodes', 'directives', 'withMemory']) {
      expect((out[name] as unknown[]).length, name).toBeGreaterThan(0)
    }
    expect(out.materialsNeeded).not.toEqual([])
    expect(ids('storages')).toEqual(['s1', 'os1'])
    // A queue shows where it is, not its steps.
    const queue = {
      step: 1,
      steps: 1,
      loop: true,
      kind: 'runScript',
      task: null,
      scriptId: 1,
      minutes: 30,
      startedAt: 40,
    }
    expect((out.me as { queue: unknown }).queue).toEqual(queue)
    expect(
      (out.residents as { id: string; queue?: unknown }[]).find((r) => r.id === 'a1')!.queue,
    ).toEqual(queue)

    const problems = Object.keys(calls).flatMap((name) =>
      scriptValueProblems(out[name], returnsOf(SCRIPT_API, name), name),
    )
    expect(problems).toEqual([])
  })

  it('hand a script exactly its view: an undeclared field reads null, declared ones as they are', () => {
    let world: WorldState | undefined
    const out = answers(
      {
        mine: 'me.secret',
        params: 'me.scriptParams',
        theirs: 'withMemory("role", "gatherer")[0].secret',
        task: 'withMemory("role", "gatherer")[0].script.task',
        building: 'building("s1").secret',
        storage: 'storages()[0].secret',
        node: 'nodes()[0].secret',
        name: 'me.name',
        strength: 'me.stats.strength.base',
        food: 'building("s1").stock.food',
        role: 'withMemory("role", "gatherer")[0].script.memory.role',
      },
      false,
      (w) => {
        world = w
        const a1 = w.residents.find((r) => r.id === 'a1')!
        // Fields of the server's own that no view declares.
        Object.assign(a1, { secret: 'plans', scriptParams: { home: 's1' } })
        a1.script!.task = 'farmer'
        Object.assign(
          w.buildings.find((b) => b.id === 's1')!,
          { secret: 1 },
        )
        Object.assign(w.nodes[0]!, { secret: 1 })
      },
    )
    for (const name of ['mine', 'params', 'theirs', 'task', 'building', 'storage', 'node']) {
      expect(out[name] ?? null, name).toBeNull()
    }
    const a1 = world!.residents.find((r) => r.id === 'a1')!
    expect(out).toMatchObject({
      name: a1.name,
      strength: a1.stats.strength.base,
      food: 5,
      role: 'gatherer',
    })
  })

  it('find a field outside its view', () => {
    expect(
      scriptValueProblems(
        { id: 'n1', kind: 'forest', x: 1, y: 2, secret: 3 },
        { view: 'node' },
        'n',
      ),
    ).toEqual(['n.secret is not in the node view'])
  })

  it('describe every field of an army’s `me`', () => {
    const out = answers({ me: 'me' }, true)
    expect((out.me as { members: unknown[] }).members).toHaveLength(1)
    expect(scriptValueProblems(out.me, returnsOf(ARMY_SCRIPT_API, 'me'), 'me')).toEqual([])
  })

  it('find a missing field and a value of the wrong kind', () => {
    expect(scriptValueProblems({ id: 'n1', kind: 'forest', x: 1 }, { view: 'node' }, 'n')).toEqual([
      'n.y is missing',
    ])
    expect(
      scriptValueProblems([{ id: 'p', x: 1, y: '2', goods: {} }], { list: { view: 'pile' } }, 'p'),
    ).toEqual(['p[0].y is a string, not a number'])
    expect(scriptValueProblems(null, { view: 'node' }, 'n')).toEqual([])
  })

  it('describe every view and field, and say when a field is null', () => {
    for (const [name, view] of Object.entries(SCRIPT_VIEWS)) {
      expect(view.description, name).not.toBe('')
      const names = view.fields.map((f) => f.name)
      expect(new Set(names).size, `${name} declares a field twice`).toBe(names.length)
      for (const f of view.fields) {
        expect(f.description, `${name}.${f.name}`).not.toBe('')
        if (f.nullWhen !== undefined) expect(f.nullWhen, `${name}.${f.name}`).not.toBe('')
      }
    }
  })

  it('declare every field the game’s default scripts read', () => {
    const declared = new Set(
      Object.values(SCRIPT_VIEWS).flatMap((v) => v.fields.map((f) => f.name)),
    )
    for (const [task, { source }] of Object.entries(DEFAULT_SCRIPTS)) {
      // A simple name scan: every `.name` read, but those of the script's own objects (a key in
      // an object it writes, or assigned to anywhere in it), of `memory`, and a list's `length`.
      const own = new Set([
        ...[...source.matchAll(/(\w+)\s*:/g)].map((m) => m[1]!),
        ...[...source.matchAll(/\.(\w+)\s*=[^=]/g)].map((m) => m[1]!),
        ...[...source.matchAll(/memory\.(\w+)/g)].map((m) => m[1]!),
        'length',
      ])
      const read = [...source.matchAll(/\.([A-Za-z_]\w*)/g)].map((m) => m[1]!)
      const undeclared = [...new Set(read)].filter((n) => !own.has(n) && !declared.has(n))
      expect(undeclared, task).toEqual([])
    }
  })
})
