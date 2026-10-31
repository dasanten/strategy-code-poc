import { describe, expect, it } from 'vitest'
import type { Account, OrderRequest } from '@csp/shared'
import { OrderQueue, type OrderKind } from './orders.js'
import { ClientView, SyncRound } from './sync.js'
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

  it('turns each entity into JSON once per round, and shares the diff of views sent the same', () => {
    const made: string[] = []
    const json = (e: { id: string }) => (made.push(e.id), JSON.stringify(e))
    const views = [new ClientView(), new ClientView(), new ClientView()]
    for (const v of views) v.initial([unit('a', 0), unit('b', 0)])
    const list = [unit('a', 1), unit('c', 0)]
    const round = new SyncRound(json)
    const diffs = views.map((v) => v.diff(list, round))
    expect(made.sort()).toEqual(['a', 'c'])
    expect(diffs[0]).toEqual({ changed: [unit('a', 1), unit('c', 0)], gone: ['b'] })
    // Welcomed apart, they were sent equal strings but not the same: each diffs on its own,
    // then they share what they were sent.
    const next = new SyncRound(json)
    const moved = [unit('a', 2), unit('c', 0)]
    const [first, ...others] = views.map((v) => v.diff(moved, next))
    for (const d of others) expect(d).toBe(first)
    expect(first).toEqual({ changed: [unit('a', 2)], gone: [] })
    expect(next.fragment(first!)).toBe(`"changed":[${JSON.stringify(unit('a', 2))}],"gone":[]`)
  })

  it('gives a view that joined this round its own diff, and keeps it in step after', () => {
    const list = [unit('a', 0), unit('b', 0)]
    const old = new ClientView()
    old.initial([unit('a', 0)])
    const round = new SyncRound()
    const fresh = new ClientView()
    fresh.initial([unit('a', 0), unit('b', 0)])
    expect(old.diff(list, round)).toEqual({ changed: [unit('b', 0)], gone: [] })
    expect(fresh.diff(list, round)).toEqual({ changed: [], gone: [] })
    const next = new SyncRound()
    const after = [unit('a', 1)]
    const diff = fresh.diff(after, next)
    expect(old.diff(after, next)).toBe(diff)
    expect(diff).toEqual({ changed: [unit('a', 1)], gone: ['b'] })
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

  it('rejects a kind named after something inherited from Object.prototype', () => {
    const queue = new OrderQueue({ wait })
    const world = createWorld(terrain)
    for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(queue.receive(world, account, 'r4', { kind })).toEqual({
        type: 'rejected',
        requestId: 'r4',
        reason: `unknown order: ${kind}`,
      })
    }
    expect(queue.receive(world, account, 'r5', { kind: 7 })).toMatchObject({
      type: 'rejected',
      reason: 'unknown order: 7',
    })
    expect(queue.size).toBe(0)
  })
})
