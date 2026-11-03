import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import type { Good } from '@csp/shared'
import { GOOD_ART, GOOD_FILES, GOOD_LABELS, goodsAmount, type GoodsItem } from './goods-grid.js'
import { LONG_PRESS_MS, longPresses } from './map/gestures.js'

/** How long (in ms) a good's name stays after the long-press that showed it lets go. */
const NAME_STAYS_MS = 1500

/** A good's icon (`GOOD_ART`), in the colour of the text around it. */
export function GoodIcon({ good }: { good: Good }) {
  return (
    <span
      className="good-icon"
      aria-hidden="true"
      // The registry's own SVG source, stroked in currentColor.
      dangerouslySetInnerHTML={{ __html: GOOD_FILES[GOOD_ART[good]] ?? '' }}
    />
  )
}

/**
 * An inventory as a compact grid of icon and amount (`CONTEXT.md`: Goods on cards), the name on
 * hover or long-press. A resident's own food, when given, shows apart after the rest, also at 0.
 */
export function GoodsGrid({
  items,
  ownFood,
  empty,
  label,
}: {
  items: GoodsItem[]
  /** A resident's own food (`carriedItems`), shown apart; left out for anything else. */
  ownFood?: number
  /** What shows with no goods at all. */
  empty?: string
  /** What the grid is, for screen readers: "Carried", "Load". */
  label: string
}) {
  // The cell whose name a long-press shows, by its key.
  const [named, setNamed] = useState<string | undefined>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (items.length === 0 && ownFood === undefined) {
    return empty ? <span className="goods-empty muted">{empty}</span> : null
  }
  const press = (key: string) => ({
    onPointerDown: (e: PointerEvent) => {
      if (!longPresses(e.pointerType)) return
      clearTimeout(timer.current)
      setNamed(undefined)
      timer.current = setTimeout(() => setNamed(key), LONG_PRESS_MS)
    },
    onPointerUp: () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setNamed(undefined), NAME_STAYS_MS)
    },
    onPointerCancel: () => {
      clearTimeout(timer.current)
      setNamed(undefined)
    },
    // A held finger would otherwise open the browser's menu over the name.
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  })
  const cell = (key: string, good: Good, amount: number, name: string, own = false) => (
    <li
      key={key}
      className={`goods-cell${own ? ' goods-own' : ''}${own && amount <= 0 ? ' warn' : ''}${named === key ? ' named' : ''}`}
      aria-label={`${name}: ${goodsAmount(amount)}`}
      {...press(key)}
    >
      {own && <span className="goods-own-tag">own</span>}
      <GoodIcon good={good} />
      <span className="goods-amount mono">{goodsAmount(amount)}</span>
      <span className="goods-name" aria-hidden="true">
        {name}
      </span>
    </li>
  )
  return (
    <ul className="goods-grid" aria-label={label}>
      {items.map((i) => cell(i.good, i.good, i.amount, GOOD_LABELS[i.good]))}
      {ownFood !== undefined && cell('own', 'food', ownFood, 'Own food', true)}
    </ul>
  )
}
