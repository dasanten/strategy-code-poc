import { describe, expect, it } from 'vitest'
import type { Account, OrderRequest } from '@csp/shared'
import { OrderQueue, type OrderKind } from './orders.js'
import { ClientView } from './sync.js'
import { smallTerrain } from './test-terrain.js'
import { mulberry32, newResident } from './residents.js'
import { createWorld } from './world.js'

const terrain = smallTerrain()

const unit = (id: string, x: number) =>
  newResident(mulberry32(1), { id, owner: 'red', x, y: 0, tick: 0 })

describe('ClientView', () => {
  it('sends only what changed and what left sight', () => {
    const view = new ClientView()
    view.initial([unit('a', 0), unit('b', 0)])
    expect(view.diff([unit('a', 0), unit('b', 0)])).toEqual({ changed: [], gone: [] })
    expect(view.diff([unit('a', 1), unit('c', 0)])).toEqual({
      changed: [unit('a', 1), unit('c', 0)],
      gone: ['b'],
    })
    expect(view.diff([unit('a', 1), unit('c', 0)])).toEqual({ changed: [], gone: [] })
  })
})

describe('OrderQueue', () => {
  const account: Account = { name: 'Mara', isAdmin: false }
  const applied: OrderRequest[] = []
  const wait: OrderKind = {
    validate: (_w, _a, o) => (typeof o.ticks === 'number' ? undefined : 'ticks must be a number'),
    apply: (_w, _a, o) => void applied.push(o),
  }

  it('acks valid orders and applies them on the next tick', () => {
    const queue = new OrderQueue({ wait })
    const world = createWorld(terrain)
    expect(queue.receive(world, account, 'r1', { kind: 'wait', ticks: 3 })).toEqual({
      type: 'ack',
      requestId: 'r1',
    })
    expect(applied).toEqual([])
    queue.applyAll(world)
    expect(applied).toEqual([{ kind: 'wait', ticks: 3 }])
    expect(queue.size).toBe(0)
  })

  it('rejects unknown, invalid and malformed orders', () => {
    const queue = new OrderQueue({ wait })
    const world = createWorld(terrain)
    expect(queue.receive(world, account, 'r2', { kind: 'fly' })).toMatchObject({
      type: 'rejected',
      reason: 'unknown order: fly',
    })
    expect(queue.receive(world, account, 'r3', { kind: 'wait' })).toMatchObject({
      type: 'rejected',
      reason: 'ticks must be a number',
    })
    expect(queue.receive(world, account, 7, null)).toMatchObject({ type: 'rejected' })
    expect(queue.size).toBe(0)
  })
})
