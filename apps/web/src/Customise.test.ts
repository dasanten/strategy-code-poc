import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TICKS_PER_GAME_YEAR } from '@csp/balance'
import type { Resident, ScriptSummary } from '@csp/shared-types'
import { AddStep } from './AddStep.js'
import { KindDetail } from './BuildMenu.js'
import { CustomiseContext, type Customising } from './Customise.js'
import { groupOrderStart, groupRequests, type GroupOrder } from './group-orders.js'
import { GroupCard, RunScript } from './Residents.js'
import { canCustomise } from './start-params.js'

const TICK = 100 * TICKS_PER_GAME_YEAR

const summary = (id: number, task: ScriptSummary['task'], names: string[]): ScriptSummary => ({
  id,
  name: `script ${id}`,
  activeVersion: 1,
  latestVersion: 1,
  task,
  followsDefault: task !== null,
  params: names.map((name) => ({ name, type: 'number', default: 1 })),
})

const SCRIPTS = [
  summary(1, 'work', ['rounds']),
  summary(2, 'explore', ['rounds']),
  summary(3, null, ['rounds']),
  summary(4, null, []),
  summary(5, 'build', ['rounds']),
]

const customising: Customising = {
  can: (order) => canCustomise(order, SCRIPTS),
  give: (give) => give(),
}

const inGame = (node: ReactNode) =>
  renderToStaticMarkup(createElement(CustomiseContext.Provider, { value: customising }, node))

const resident = (id: string) =>
  ({
    id,
    name: id.toUpperCase(),
    x: 5,
    y: 5,
    bornAt: 0,
    carried: {},
    owner: 1,
    cityId: 'c1',
  }) as unknown as Resident

describe('the Customise button', () => {
  const card = () =>
    createElement(GroupCard, {
      residents: [resident('a'), resident('b')],
      mapSize: 64,
      tick: TICK,
      scripts: SCRIPTS,
      buildings: [],
      picking: false,
      onPicking: () => {},
      buildAt: undefined,
      onOrder: () => {},
      orderError: undefined,
      onPick: () => {},
      onClose: () => {},
    })

  it('sits beside the group card’s rows whose script has params to show', () => {
    const html = inGame(card())
    expect(html).toContain('aria-label="Customise Work"')
    expect(html).toContain('aria-label="Customise Explore"')
    // Build line's script declares none here, and Walk starts no script.
    expect(html).not.toContain('aria-label="Customise Build line')
    expect(html).not.toContain('aria-label="Customise Walk')
  })

  it('shows nothing outside the game', () => {
    expect(renderToStaticMarkup(card())).not.toContain('Customise')
  })

  it('is offered beside Run script on a resident’s and a group’s card, not an army’s', () => {
    const run = (scriptId: number, customisable: boolean) =>
      inGame(
        createElement(RunScript, {
          script: { scriptId },
          scripts: SCRIPTS,
          onRunScript: () => {},
          customisable,
        }),
      )
    expect(run(3, true)).toContain('aria-label="Customise Run script"')
    // Nothing to show for a script without params.
    expect(run(4, true)).not.toContain('Customise')
    expect(run(3, false)).not.toContain('Customise')
  })

  it('is offered on Add step’s tasks whose script has params to show', () => {
    const html = inGame(
      createElement(AddStep, {
        plan: { kind: 'runScript', picked: [] },
        onStart: () => {},
        onAnswer: () => {},
        onCancel: () => {},
        scripts: SCRIPTS,
        buildTile: { node: undefined, terrain: undefined, problem: () => undefined },
        horses: [],
        tick: 0,
        cities: [],
        onPickCity: () => {},
        open: true,
        onOpen: () => {},
        onPlan: () => {},
        conditionNames: {},
      }),
    )
    expect(html).toContain('aria-label="Customise script 3"')
    expect(html).not.toContain('aria-label="Customise script 4"')
  })

  describe('in the Build menu, beside the tapped kind’s Build', () => {
    const detail = (
      item: { kind: 'storage' | 'house' | 'quarry'; problem?: string; offered?: boolean },
      options: { blocked?: boolean; planning?: boolean } = {},
    ) =>
      inGame(
        createElement(KindDetail, {
          item: { name: item.kind, offered: true, ...item },
          blocked: options.blocked ?? false,
          planning: options.planning ?? false,
          onBuild: () => {},
        }),
      )
    const label = (kind: string) => `aria-label="Customise Build ${kind}"`

    it('is offered on a kind that can go here, and is off while Build is', () => {
      expect(detail({ kind: 'storage' })).toContain(label('storage'))
      expect(detail({ kind: 'storage' }, { blocked: true })).toMatch(
        new RegExp(`${label('storage')} disabled`),
      )
    })

    it('is not offered on a kind that can’t go here', () => {
      expect(detail({ kind: 'house', problem: 'a house goes in a city’s area' })).not.toContain(
        'Customise',
      )
    })

    it('follows what the planner can add', () => {
      const planning = { planning: true }
      const house = { kind: 'house' as const, problem: 'a house goes in a city’s area' }
      expect(detail(house, planning)).toContain(label('house'))
      expect(detail({ ...house, kind: 'quarry', offered: false }, planning)).not.toContain(
        'Customise',
      )
    })

    it('shows nothing when the Build script has no params', () => {
      const none: Customising = { can: (order) => canCustomise(order, []), give: (g) => g() }
      const html = renderToStaticMarkup(
        createElement(
          CustomiseContext.Provider,
          { value: none },
          createElement(KindDetail, {
            item: { kind: 'storage', name: 'Storage', offered: true },
            blocked: false,
            planning: false,
            onBuild: () => {},
          }),
        ),
      )
      expect(html).not.toContain('Customise')
    })
  })
})

describe('a group’s order and the form before it starts', () => {
  const where = { id: 'b1', kind: 'farm' as const, x: 5, y: 5 }

  it('knows the script each order starts, a task’s by its task', () => {
    const starts: [GroupOrder, object | undefined][] = [
      [
        { kind: 'runScript', scriptId: 3 },
        { kind: 'runScript', scriptId: 3 },
      ],
      [
        { kind: 'setDefenceScript', scriptId: 3 },
        { kind: 'setDefenceScript', scriptId: 3 },
      ],
      [
        { kind: 'work', workplace: where, name: 'farm' },
        { kind: 'task', task: 'work', workplaceId: 'b1' },
      ],
      [{ kind: 'explore' }, { kind: 'task', task: 'explore' }],
      [{ kind: 'feedStable' }, { kind: 'task', task: 'feedStable' }],
      [{ kind: 'train' }, { kind: 'task', task: 'train' }],
      [
        { kind: 'tearDown', building: where, name: 'farm' },
        { kind: 'task', task: 'tearDown' },
      ],
      [
        { kind: 'line', building: 'road', from: { x: 1, y: 1 }, to: { x: 2, y: 2 } },
        { kind: 'task', task: 'buildLine' },
      ],
      [{ kind: 'walkTo', x: 1, y: 1 }, undefined],
      [{ kind: 'stop' }, undefined],
    ]
    for (const [order, start] of starts) expect(groupOrderStart(order)).toEqual(start)
  })

  const context = { tick: TICK, size: 64, free: () => true, queued: false }

  it('starting at once, each one’s order has no params, so each goes on with their own', () => {
    const { requests } = groupRequests({ kind: 'explore' }, [resident('a'), resident('b')], context)
    expect(requests).toHaveLength(2)
    for (const { order } of requests) expect(order).not.toHaveProperty('params')
  })

  it('from the form, each one’s order carries the same values', () => {
    const params = { rounds: 4 }
    const { requests } = groupRequests(
      { kind: 'tearDown', building: where, name: 'farm', params },
      [resident('a'), resident('b')],
      context,
    )
    expect(requests).toHaveLength(2)
    for (const { order } of requests) expect(order.params).toEqual(params)
  })
})
