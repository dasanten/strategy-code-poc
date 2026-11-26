import { QUEUE_MAX_STEPS, SCRIPT_STEP_BUDGET } from '@csp/balance'
import { describe, expect, it } from 'vitest'
import { stepsShare, toolbarCount } from './command-tabs-view.js'

describe('the planner toolbar count', () => {
  it('says nothing with nothing picked and no blocks', () => {
    expect(toolbarCount(0)).toBe('')
  })

  it('counts the picked steps', () => {
    expect(toolbarCount(2)).toBe('2 picked')
  })

  it('counts steps and blocks as written once the queue has blocks', () => {
    expect(toolbarCount(2, { written: 9 })).toBe(
      `2 picked · 9 of ${QUEUE_MAX_STEPS} steps and blocks.`,
    )
    expect(toolbarCount(0, { written: 9 })).toBe(`9 of ${QUEUE_MAX_STEPS} steps and blocks.`)
  })

  it('says why a queue is too long instead', () => {
    expect(toolbarCount(0, { written: 9, over: '3 steps over' })).toBe('Too long: 3 steps over.')
  })
})

describe('the step budget meter', () => {
  it('is the share of the budget used', () => {
    expect(stepsShare({ steps: SCRIPT_STEP_BUDGET / 4 })).toBe(0.25)
    expect(stepsShare({ steps: 0 })).toBe(0)
  })

  it('is full when the script ran out, or past the budget', () => {
    expect(stepsShare({ steps: 10, outOfSteps: 'realm' })).toBe(1)
    expect(stepsShare({ steps: SCRIPT_STEP_BUDGET * 2 })).toBe(1)
  })
})
