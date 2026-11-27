import type { OrderRequest } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import { insertItems, withIds, wrap, type PlanItem } from './plan-blocks.js'
import { newIds, typedMinutes } from './planner-view.js'

const walk = (x: number, y: number): OrderRequest => ({ kind: 'walkTo', x, y })

const steps: PlanItem[] = [
  { id: 1, order: walk(1, 1) },
  { id: 2, order: walk(2, 2) },
]

describe('newIds', () => {
  it('gives the ids of steps added, not of those there before', () => {
    const after = withIds(insertItems(steps, 1, [{ order: walk(3, 3) }]), 3).items
    expect(newIds(steps, after)).toEqual([3])
  })

  it('gives a new block’s id only, not the ids of the steps it holds', () => {
    const block = withIds([{ repeat: 2, items: [{ order: walk(4, 4) }] }], 3).items
    expect(newIds(steps, [...steps, ...block])).toEqual([block[0]!.id])
  })

  it('gives the new block a wrap makes, its steps having been there', () => {
    const wrapped = withIds(wrap(steps, [1, 2])!, 3).items
    expect(newIds(steps, wrapped)).toEqual([3])
  })

  it('gives none when nothing was added', () => {
    expect(newIds(steps, steps)).toEqual([])
  })
})

describe('typedMinutes', () => {
  it('takes whole minutes above zero', () => {
    expect(typedMinutes('10')).toBe(10)
    expect(typedMinutes('7.9')).toBe(7)
  })

  it('gives none for an empty field, zero, less or not a number', () => {
    expect(typedMinutes('')).toBeUndefined()
    expect(typedMinutes('  ')).toBeUndefined()
    expect(typedMinutes('0')).toBeUndefined()
    expect(typedMinutes('0.5')).toBeUndefined()
    expect(typedMinutes('-3')).toBeUndefined()
    expect(typedMinutes('ten')).toBeUndefined()
  })
})
