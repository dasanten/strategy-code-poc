import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  BATCHES_PER_DAY,
  BUILD_MATERIALS,
  BUILD_WORK,
  DELIVERY_LOAD,
  FOOD_PER_DAY,
  RECIPES,
  SCRIPT_LIBRARY_MAX_SCRIPTS,
  SCRIPT_MAX_VERSIONS,
  TICKS_PER_GAME_DAY,
  WAREHOUSE_BASE_PRICE,
  WORK_OUTPUT_PER_DAY,
  GAME_DAYS_PER_YEAR,
  TRAIN_SKILL_FACTOR,
  buildWork,
  carryCapacity,
  hungerFactor,
  teardownReturns,
  workOutput,
  type Building,
} from '@csp/shared'
import {
  AVERAGE,
  buildCosts,
  carriageCost,
  coinsPerMintWorkerDay,
  daysToWorkSkillMax,
  trainingDays,
  duration,
  goldMinersPerMintWorker,
  jobDays,
  minersPerSmelterWorker,
  residentsPerFarmer,
  transport,
  wikiResident,
  HOW_TO_TRADE_PATH,
  WIKI_PATH,
} from './wiki-view.js'
import { WIKI_TOPICS, Wiki } from './Wiki.js'

const render = () => renderToStaticMarkup(createElement(Wiki))

describe('wiki figures', () => {
  it('works them out for an average resident: no skills, every stat average', () => {
    expect(AVERAGE.skills).toEqual({})
    expect(hungerFactor(AVERAGE, 0)).toBe(1)
    expect(buildWork(AVERAGE, 0)).toBe(1)
    expect(workOutput(AVERAGE, 'food', 'farming', 0) * TICKS_PER_GAME_DAY).toBeCloseTo(
      WORK_OUTPUT_PER_DAY.food!,
    )
  })

  it('counts residents per farmer, miners per smelter worker and gold miners per mint worker', () => {
    expect(residentsPerFarmer()).toBeCloseTo(WORK_OUTPUT_PER_DAY.food! / FOOD_PER_DAY)
    expect(minersPerSmelterWorker()).toBeCloseTo(
      (BATCHES_PER_DAY.smelter! * RECIPES.smelter![0]!.input.ironOre!) /
        WORK_OUTPUT_PER_DAY.ironOre!,
    )
    expect(goldMinersPerMintWorker()).toBeCloseTo(
      (BATCHES_PER_DAY.mint! * RECIPES.mint![0]!.input.goldOre!) / WORK_OUTPUT_PER_DAY.goldOre!,
    )
    expect(coinsPerMintWorkerDay()).toBeCloseTo(
      BATCHES_PER_DAY.mint! * RECIPES.mint![0]!.output.coins!,
    )
  })

  it('prices a worker-day at the base price, and the value a smelter adds', () => {
    const [farmer] = jobDays()
    expect(farmer!.sell).toBeCloseTo(WORK_OUTPUT_PER_DAY.food! * WAREHOUSE_BASE_PRICE.food)
    expect(farmer!.buy).toBeLessThan(farmer!.sell)
    const smelter = jobDays().find((j) => j.job === 'Smelter worker')!
    const iron = BATCHES_PER_DAY.smelter! * RECIPES.smelter![0]!.output.iron!
    const ore = BATCHES_PER_DAY.smelter! * RECIPES.smelter![0]!.input.ironOre!
    expect(smelter.added).toBeCloseTo(
      iron * WAREHOUSE_BASE_PRICE.iron - ore * WAREHOUSE_BASE_PRICE.ironOre,
    )
  })

  it('times building for one average builder and returns what tearing down leaves', () => {
    for (const b of buildCosts()) {
      expect(b.buildTicks).toBeCloseTo(BUILD_WORK[b.kind]! / buildWork(AVERAGE, 0))
      expect(b.teardownTicks).toBeLessThan(b.buildTicks)
      expect(b.returned).toEqual(teardownReturns({ kind: b.kind } as Building))
    }
  })

  it('lists a carriage apart from the buildings, timed like them', () => {
    expect(buildCosts().map((b) => b.kind)).not.toContain('carriage')
    expect(carriageCost()).toEqual({
      materials: BUILD_MATERIALS.carriage,
      buildTicks: BUILD_WORK.carriage! / buildWork(AVERAGE, 0),
    })
  })

  it('moves more goods by carriage on plains than on foot, and none into mountains', () => {
    const plains = transport().find((t) => t.terrain === 'Plains')!
    expect(plains.footKgTiles).toBeCloseTo(plains.footTiles * carryCapacity(AVERAGE, 0))
    expect(plains.carriageKgTiles).toBeGreaterThan(plains.footKgTiles)
    expect(transport().find((t) => t.terrain === 'Mountain')!.carriageTiles).toBe(0)
  })

  it('takes stronger, skilled workers into account', () => {
    const strong = wikiResident({ strength: 15 }, { mining: 10 })
    expect(workOutput(strong, 'ironOre', 'mining', 0) * TICKS_PER_GAME_DAY).toBeCloseTo(
      WORK_OUTPUT_PER_DAY.ironOre! * 1.5 * 1.1,
    )
  })

  it('says game time first and real time after', () => {
    expect(duration(4 * TICKS_PER_GAME_DAY)).toBe('4 game days (1 h 36 min)')
    expect(duration(TICKS_PER_GAME_DAY)).toBe('1 game day (24 min)')
    expect(duration(TICKS_PER_GAME_DAY / 8)).toBe('3 game hours (3 min)')
    expect(duration(2)).toBe('2 game minutes (2 s)')
  })
})

describe('wiki page', () => {
  it('has a section with an anchor for every topic', () => {
    const html = render()
    for (const t of WIKI_TOPICS) expect(html).toContain(`id="${t.id}"`)
    expect(html).toContain('href="#food"')
  })

  it('types no number itself: every figure comes from the balance', () => {
    let source = fs.readFileSync(new URL('./Wiki.tsx', import.meta.url), 'utf8')
    source = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    // Drop every {…} expression, innermost first, then the tags: what is left is the page's text.
    let before
    do {
      before = source
      source = source.replace(/\{[^{}]*\}/g, '')
    } while (source !== before)
    const text = source.replace(/<[^>]*>/g, ' ')
    expect(text.match(/[^\n]*\d[^\n]*/g) ?? []).toEqual([])
  })

  it('changes when a balance number changes', () => {
    const food = WORK_OUTPUT_PER_DAY.food!
    const house = BUILD_MATERIALS.house
    try {
      WORK_OUTPUT_PER_DAY.food = 9
      BUILD_MATERIALS.house = { wood: 77 }
      const html = render()
      expect(html).toContain(`One average farmer feeds ${9 / FOOD_PER_DAY} residents`)
      expect(html).toContain('77 wood')
    } finally {
      WORK_OUTPUT_PER_DAY.food = food
      BUILD_MATERIALS.house = house
    }
    expect(render()).toContain(`One average farmer feeds ${food / FOOD_PER_DAY} residents`)
  })
})

describe('the Wiki’s Scripting budgets topic', () => {
  it('lists the library caps from the balance (`CONTEXT.md`: Library cap)', () => {
    const html = render()
    expect(html).toContain(`holds at most ${SCRIPT_LIBRARY_MAX_SCRIPTS} scripts`)
    expect(html).toContain(`keeps at most ${SCRIPT_MAX_VERSIONS} versions`)
  })
})

describe('training pace', () => {
  it('takes an average learner a stat’s bonus to its cap in a game year, a skill twice as fast as doing', () => {
    expect(trainingDays('strength')).toBeCloseTo(GAME_DAYS_PER_YEAR)
    expect(trainingDays('mining')).toBeCloseTo(daysToWorkSkillMax / TRAIN_SKILL_FACTOR)
    expect(trainingDays('combat')).toBeCloseTo(GAME_DAYS_PER_YEAR / TRAIN_SKILL_FACTOR)
  })
})

describe('the Wiki’s How to trade topic (`CONTEXT.md`: Trade section)', () => {
  it('is a section the trade section’s link lands on', () => {
    const [path, anchor] = HOW_TO_TRADE_PATH.split('#')
    expect(path).toBe(WIKI_PATH)
    expect(WIKI_TOPICS.map((t) => t.id)).toContain(anchor)
    const html = render()
    expect(html).toContain(`id="${anchor}"`)
    expect(html).toContain('How to trade')
  })

  it('covers where trade happens, sending a trader, NPC cities, delivery and transfer', () => {
    const html = render()
    const section = html.slice(html.indexOf('id="how-to-trade"'), html.indexOf('id="trade"'))
    for (const heading of [
      'Sending a trader',
      'Buying and selling',
      'What an NPC city buys and sells',
      'Delivery',
      'Transfer',
    ]) {
      expect(section).toContain(`<h3>${heading}</h3>`)
    }
    expect(section).toContain('Trade here')
    expect(section).toContain(`at most ${DELIVERY_LOAD} kg`)
  })
})
