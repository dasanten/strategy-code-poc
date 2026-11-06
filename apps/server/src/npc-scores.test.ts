import { NPC_BUILDERS, NPC_JOB_MARGIN, npcReserve, type CityJob } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { FOREST, fillHouses, storageOf, village } from './npc-growth.fixture.js'
import { farmersWanted, planCity } from './npc-plan.js'
import { beats, jobScore, rankJobs, type ScoredJob } from './npc-scores.js'

const ranked = (...jobs: ScoredJob[]) => rankJobs(jobs.map((job) => ({ job }))).map((o) => o.job)

describe('what an NPC city’s jobs are worth', () => {
  it('puts farming first, then the project, then the good shortest', () => {
    expect(
      ranked(
        { kind: 'surplus', full: 0 },
        { kind: 'short', share: 0.2 },
        { kind: 'scout' },
        { kind: 'short', share: 0.9 },
        { kind: 'road' },
        { kind: 'project' },
        { kind: 'farm' },
        { kind: 'back' },
      ),
    ).toEqual([
      { kind: 'farm' },
      { kind: 'project' },
      { kind: 'short', share: 0.9 },
      { kind: 'short', share: 0.2 },
      { kind: 'road' },
      { kind: 'scout' },
      { kind: 'back' },
      { kind: 'surplus', full: 0 },
    ])
  })

  it('keeps goods that lack as much in the order given', () => {
    const first = { job: { kind: 'short', share: 0.5 } as const, name: 'food' }
    const second = { job: { kind: 'short', share: 0.5 } as const, name: 'wood' }
    expect(rankJobs([first, second]).map((o) => o.name)).toEqual(['food', 'wood'])
  })

  it('weighs surplus by how far below its cap, and never above going back', () => {
    const surplus = (full: number) => jobScore({ kind: 'surplus', full })
    expect(surplus(0.2)).toBeGreaterThan(surplus(0.8))
    expect(surplus(-3)).toBeGreaterThan(surplus(-2))
    expect(surplus(-1000)).toBeLessThan(jobScore({ kind: 'back' }))
  })

  it('moves a worker only for more than the margin', () => {
    expect(beats(10 + NPC_JOB_MARGIN + 0.1, 10)).toBe(true)
    expect(beats(10 + NPC_JOB_MARGIN, 10)).toBe(false)
    expect(beats(10, 10)).toBe(false)
  })

  it('has a worker on what is short stay for anything but farming', () => {
    for (const share of [0, 0.01, 0.5, 1]) {
      const held = jobScore({ kind: 'short', share })
      expect(beats(jobScore({ kind: 'farm' }), held)).toBe(true)
      expect(beats(jobScore({ kind: 'farm', foodShort: true }), held)).toBe(true)
      expect(beats(jobScore({ kind: 'project' }), held)).toBe(false)
      expect(beats(jobScore({ kind: 'short', share: 1 }), held)).toBe(false)
      expect(beats(jobScore({ kind: 'road' }), held)).toBe(false)
    }
  })

  it('has a worker let go move for anything above going back', () => {
    const held = jobScore({ kind: 'back' })
    for (const job of [
      { kind: 'project' },
      { kind: 'short', share: 0.01 },
      { kind: 'road' },
      { kind: 'scout' },
    ] satisfies ScoredJob[]) {
      expect(beats(jobScore(job), held)).toBe(true)
    }
  })
})

describe('a city shares out its adults by the scores', () => {
  /** The village, full, with all its adults free at home, a lumber camp and a smithy. */
  function workshop() {
    const staged = village()
    const { world, city, home } = staged
    fillHouses(world, city, home)
    for (const r of world.residents) {
      Object.assign(r, { x: home.x, y: home.y, order: null })
      delete r.script
    }
    world.buildings.push(
      { id: 'camp', kind: 'lumberCamp', cityId: null, ...FOREST },
      { id: 'smithy', kind: 'smithy', cityId: null, x: FOREST.x, y: FOREST.y + 10 },
    )
    city.workplaceIds = ['camp', 'smithy']
    // It knows its limit, so nobody goes scouting (`CONTEXT.md`: Scout).
    city.scouted = { sectors: [], done: true }
    return staged
  }
  const at = (jobs: Record<string, CityJob>, id: string) =>
    Object.values(jobs).filter((j) => j.buildingId === id).length

  it('picks farmers while Food is short', () => {
    const { world, terrain, city } = workshop()
    storageOf(world, city).stock = {}
    const worker = world.residents[0]!
    worker.script = { scriptId: 0, task: 'work', memory: { workplaceId: 'camp' } }
    const plan = planCity(world, city, terrain)
    // Everyone goes to the farm, its room being enough: the worker off the camp too.
    expect(Object.values(plan.jobs).map((j) => j.kind)).toEqual(world.residents.map(() => 'farm'))
  })

  it('picks what is shortest next, filling its crew before the next good', () => {
    const { world, terrain, city } = workshop()
    const wood = Math.ceil((npcReserve(world, city).wood ?? 0) / 2)
    storageOf(world, city).stock = { food: 1000, wood, iron: 10 }
    const plan = planCity(world, city, terrain)
    const jobs = Object.values(plan.jobs)
    const farmers = jobs.filter((j) => j.kind === 'farm').length
    const builders = jobs.filter((j) => j.kind === 'build').length
    expect(farmers).toBe(farmersWanted(world, city))
    expect(builders).toBe(NPC_BUILDERS)
    // Spears lack all of what it wants, Wood half: the rest smith, and the camp gets nobody yet.
    expect(at(plan.jobs, 'smithy')).toBe(jobs.length - farmers - builders)
    expect(at(plan.jobs, 'camp')).toBe(0)
  })

  it('doesn’t move a worker for a small difference', () => {
    const { world, terrain, city } = workshop()
    const wood = (npcReserve(world, city).wood ?? 1) - 1
    storageOf(world, city).stock = { food: 1000, wood, iron: 10 }
    const worker = world.residents[0]!
    worker.script = { scriptId: 0, task: 'work', memory: { workplaceId: 'camp' } }
    const plan = planCity(world, city, terrain)
    // Spears are shorter by far, and their smithy has room; the one on Wood stays there all the same.
    expect(plan.jobs[worker.id]).toEqual({ kind: 'work', buildingId: 'camp' })
    expect(at(plan.jobs, 'smithy')).toBeGreaterThan(0)
  })

  it('moves a worker for what beats theirs by the margin: a farm lacking farmers', () => {
    const { world, terrain, city } = workshop()
    storageOf(world, city).stock = { food: 1000, wood: 0 }
    const worker = world.residents[0]!
    worker.script = { scriptId: 0, task: 'work', memory: { workplaceId: 'camp' } }
    // Everyone else is armed, so the farm has nobody free to take but the worker.
    for (const r of world.residents.slice(1)) r.carried.spear = 1
    const plan = planCity(world, city, terrain)
    expect(plan.jobs[worker.id]?.kind).toBe('farm')
  })
})
