import { describe, expect, it } from 'vitest'
import { ORDER_LINES, orderColumns } from './command-bar-view.js'

const kind = (name: string, n: number) => ({
  name,
  actions: Array.from({ length: n }, (_, i) => i),
})
const names = (cols: ReturnType<typeof orderColumns<ReturnType<typeof kind>>>) =>
  cols.map((c) => `${c.wide ? 'wide:' : ''}${c.groups.map((g) => g.name).join('+')}`)

describe('orderColumns', () => {
  it('lays out a resident’s usual orders as the artboard does', () => {
    // Move and Work & build two buttons wide, Goods and Scripts stacked, Other on its own.
    const cols = orderColumns([
      kind('move', 8),
      kind('work', 8),
      kind('goods', 1),
      kind('scripts', 1),
      kind('other', 5),
    ])
    expect(names(cols)).toEqual(['wide:move', 'wide:work', 'goods+scripts', 'other'])
  })

  it('keeps small kinds one button wide, stacked while their headings and rows fit', () => {
    const cols = orderColumns([kind('move', 2), kind('goods', 2), kind('other', 3)])
    expect(names(cols)).toEqual(['move+goods', 'other'])
    expect(cols.every((c) => !c.wide)).toBe(true)
  })

  it('makes a kind wide once its heading and rows outgrow a column', () => {
    expect(names(orderColumns([kind('move', ORDER_LINES - 1)]))).toEqual(['move'])
    expect(names(orderColumns([kind('move', ORDER_LINES)]))).toEqual(['wide:move'])
  })

  it('stacks nothing under a wide kind', () => {
    expect(names(orderColumns([kind('move', 9), kind('goods', 1)]))).toEqual(['wide:move', 'goods'])
  })

  it('keeps the kinds in their order and leaves none out', () => {
    const groups = [kind('a', 3), kind('b', 7), kind('c', 1), kind('d', 20), kind('e', 4)]
    const cols = orderColumns(groups)
    expect(cols.flatMap((c) => c.groups)).toEqual(groups)
  })

  it('gives nothing for no orders', () => {
    expect(orderColumns([])).toEqual([])
  })
})
