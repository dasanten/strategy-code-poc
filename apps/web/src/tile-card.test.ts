import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MAX_HEALTH, MAX_HUNGER, type Building, type Horse } from '@csp/shared'
import { describeTile } from './selection-view.js'
import { GOOD_LABELS } from './Residents.js'
import { TileCard } from './SelectionCard.js'

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
  tile: { x: 10, y: 10 },
  waypoints: [],
  mapSize: 512,
  onAddWaypoint: () => Promise.resolve(undefined),
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
