import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MAX_HEALTH, MAX_HUNGER, type Building, type Horse, type SeenResident } from '@csp/shared'
import { describeTile } from './selection-view.js'
import { GOOD_LABELS } from './Residents.js'
import { TileCard } from './SelectionCard.js'
import { PriceList } from './CityInspector.js'

const stable: Building = { id: 'b-stable', kind: 'stable', cityId: 'c-me', x: 5, y: 5 }
// Three foals of one pair, born together: their lines on the card read the same.
const horses: Horse[] = ['h1', 'h2', 'h3'].map((id) => ({
  id,
  realmId: 'me',
  cityId: null,
  x: 5,
  y: 5,
  hunger: MAX_HUNGER,
  health: MAX_HEALTH,
  name: 'Rowan',
  stats: { speed: 12, strength: 8, endurance: 10 },
  bornAt: 0,
}))

const props = {
  card: describeTile(
    {
      x: 5,
      y: 5,
      buildings: [stable],
      carriages: [],
      horses,
      piles: [],
      node: undefined,
      strangers: [],
      cities: [{ id: 'c-me', name: 'Eastmere', realmId: 'me' }],
      viewer: { realmId: 'me', allies: new Set<string>() },
      workers: () => 0,
      tick: 0,
    },
    GOOD_LABELS,
  ),
  building: stable,
  nodeKind: undefined,
  actor: undefined,
  tick: 0,
  orderError: undefined,
  onClose: () => {},
  onSendHere: () => {},
  onBuildHere: () => {},
  onSetGate: () => {},
  onOpenCity: () => {},
  onRenameCity: () => {},
  onRenameHorse: () => {},
  onSelectResident: () => {},
  onOpenHorse: () => {},
  onUnhitch: () => {},
}

/** The keys that two siblings in a list share, anywhere in the tree. */
function sharedKeys(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    const keys = node.flatMap((n) => (isValidElement(n) && n.key !== null ? [n.key] : []))
    const twice = keys.filter((k, i) => keys.indexOf(k) !== i)
    return [...twice, ...node.flatMap(sharedKeys)]
  }
  if (!isValidElement(node)) return []
  return sharedKeys((node.props as { children?: ReactNode }).children)
}

describe('the tile card of a stable', () => {
  it('lists three horses alike once each, with a key of its own for each line', () => {
    // The tree the card renders, before React reconciles it: siblings sharing a key are repeated
    // by React on every update (each tick), so the list grows.
    let tree: ReactNode
    const html = renderToStaticMarkup(
      createElement(() => {
        tree = TileCard(props)
        return tree
      }),
    )
    expect(html).toContain('Horses (yours)')
    expect(html.match(/<span>Rowan<\/span>/g)).toHaveLength(3)
    expect(sharedKeys(tree)).toEqual([])
  })

  it('shows each horse as a row with health and hunger meters, a button to open it', () => {
    const html = renderToStaticMarkup(createElement(TileCard, props))
    expect(html.match(/<button[^>]*class="card-list-row"/g)).toHaveLength(3)
    expect(html.match(/aria-label="Health 100%"/g)).toHaveLength(3)
    expect(html.match(/aria-label="Hunger 100%"/g)).toHaveLength(3)
    expect(html).toContain('Speed 12, Strength 8, Endurance 10 · 0 game days old')
  })
})

/** The goods cells a rendering shows, each as "Name: amount". */
const cells = (html: string) =>
  [...html.matchAll(/class="goods-cell[^"]*" aria-label="([^"]+)"/g)].map((m) => m[1])

describe('inventories on the tile card (`CONTEXT.md`: Goods on cards)', () => {
  const card = (things: Partial<Parameters<typeof describeTile>[0]>, building?: Building) =>
    renderToStaticMarkup(
      createElement(TileCard, {
        ...props,
        building,
        card: describeTile(
          {
            ...{
              x: 5,
              y: 5,
              buildings: [],
              carriages: [],
              horses: [],
              piles: [],
              node: undefined,
              strangers: [],
              cities: [{ id: 'c-me', name: 'Eastmere', realmId: 'me' }],
              viewer: { realmId: 'me', allies: new Set<string>() },
              workers: () => 0,
              tick: 0,
            },
            ...things,
          },
          GOOD_LABELS,
        ),
      }),
    )

  it('shows a storage’s goods and a pile as grid items, not words', () => {
    const storage: Building = {
      id: 'b-storage',
      kind: 'storage',
      cityId: 'c-me',
      x: 5,
      y: 5,
      stock: { wood: 12, food: 3 },
    }
    const html = card(
      { buildings: [storage], piles: [{ id: 'p', x: 5, y: 5, goods: { stone: 4 } }] },
      storage,
    )
    expect(cells(html)).toEqual(['Food: 3', 'Wood: 12', 'Stone: 4'])
    expect(html).not.toMatch(/12 wood|4 stone/)
  })

  it('shows a site’s work as a meter and a have/need row with a bar per material', () => {
    const site: Building = {
      id: 'b-mine',
      kind: 'mine',
      cityId: 'c-me',
      x: 5,
      y: 5,
      site: { work: 0, delivered: { wood: 10 } },
    }
    const html = card({ buildings: [site] }, site)
    expect(html).toContain('aria-label="Work 0%"')
    expect(html).toContain('Nobody is building')
    const rows = [...html.matchAll(/<li aria-label="([^"]+)"><span class="good-icon"/g)]
    expect(rows.map((m) => m[1])).toEqual(['Wood: 10 / 40', 'Stone: 0 / 20'])
    expect(html).toContain('width:25%')
    expect(cells(html)).toEqual([])
  })

  it('shows a workplace’s crew as rows saying what each is doing', () => {
    const farm: Building = { id: 'b-farm', kind: 'farm', cityId: 'c-me', x: 5, y: 5 }
    const ana = {
      id: 'ana',
      name: 'Ana',
      owner: 'me',
      cityId: 'c-me',
      order: { kind: 'workAt', buildingId: farm.id },
    } as unknown as SeenResident
    const html = card({ buildings: [farm], residents: [ana], workers: () => 1 }, farm)
    expect(html).toContain('<h3>Crew</h3>')
    expect(html).toMatch(/<span>Ana<\/span><small class="muted">Working<\/small>/)
  })
})

describe('trade prices (`CONTEXT.md`: Goods on cards)', () => {
  it('give each good its icon beside its name', () => {
    const html = renderToStaticMarkup(
      createElement(PriceList, {
        title: 'You can buy',
        lines: [
          { good: 'food', units: 5, price: 2 },
          { good: 'iron', price: 9 },
        ],
        none: 'Nothing.',
      }),
    )
    expect(html.match(/class="good-label"><span class="good-icon"/g)).toHaveLength(2)
    expect(html).toContain('Iron')
  })
})
