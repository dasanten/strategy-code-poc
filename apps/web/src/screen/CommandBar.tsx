import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react'
import { orderColumns } from './command-bar-view.js'
import { panelLeft, type PanelSize } from './order-panel-view.js'
import type { CardAction, OrderGroup } from './selection-view.js'
import type { Relationship } from '../ui/theme.js'
import { ActionRows, useInSheet, useSheetPeek } from './SelectionCard.js'
import { Icon } from '../ui/Icon.js'
import type { UiIconName } from '../ui/ui-icons.js'

/**
 * The panel an order opens (`OrderPanel`): its title (the order's name), a short note beside it,
 * the order's key, how wide it opens, what it holds and what closes it (✕, Escape, the order
 * again).
 */
export interface OrderPanelSpec {
  title: string
  /** Beside the title in the header bar: "12 / 30 kg", "from Ashford", "break or climb". */
  note?: ReactNode
  /** The key of the order that opened it, shown as its key cap. */
  keyCap?: string
  /** How wide it opens (`panelSize`); `md` when left out. */
  size?: PanelSize
  body: ReactNode
  /** The confirm row along its bottom, kept in view while the body scrolls. */
  foot?: ReactNode
  onClose: () => void
}

/**
 * The shell of an order's panel (`CONTEXT.md`: Screen; ADR 0044): a kit panel with a header bar
 * (title, note, key, ✕), a body that scrolls inside itself, and an optional footer. Above the
 * command bar on a desktop (`CommandBar` places it); `inline` under its order in the phone's
 * sheet. The sections inside are `.inspector-block`s, laid out as the kit's sections (`.sec`).
 */
function OrderPanel({
  panel,
  inline = false,
  style,
  panelRef,
}: {
  panel: OrderPanelSpec
  inline?: boolean
  style?: CSSProperties
  panelRef?: Ref<HTMLElement>
}) {
  return (
    <section
      ref={panelRef}
      className={`opanel opanel-${panel.size ?? 'md'} pn${inline ? ' opanel-inline' : ' cmd-panel'}`}
      aria-label={panel.title}
      style={style}
    >
      <div className="hd opanel-head">
        <span className="grow opanel-title">{panel.title}</span>
        {panel.note && <span className="opanel-note">{panel.note}</span>}
        {panel.keyCap && (
          <kbd className="opanel-key" aria-hidden="true">
            {panel.keyCap}
          </kbd>
        )}
        <button
          type="button"
          className="btn sm sq"
          aria-label={`Close ${panel.title}`}
          title="Close (Esc)"
          onClick={panel.onClose}
        >
          ✕
        </button>
      </div>
      <div className="opanel-body cmd-panel-body">{panel.body}</div>
      {panel.foot && <div className="opanel-foot">{panel.foot}</div>}
    </section>
  )
}

/**
 * The confirm row of a section in an order's panel (`.opanel-confirm`): its main button first, as
 * wide as the panel allows, any others beside it. Kept at the bottom of the panel's view while
 * the section scrolls by.
 */
export function PanelFoot({ children }: { children: ReactNode }) {
  return <div className="opanel-confirm order-buttons">{children}</div>
}

/**
 * The command bar (`CONTEXT.md`: Screen, Resident card; ADR 0044): the card of a picked resident
 * or group along the bottom of the screen. Its header on the left (figure, name, badge, the lines
 * under the name, then `head`: meters, what they carry, …), its tabs and the open tab's content
 * beside it, the status line under that. A panel an order opens (`panel`, `OrderPanel`) sits
 * above the bar over the order that opened it. Placed by `CardSheet` with `bar`; on a phone it is
 * the bottom sheet, the panel under its order (`OrderGrid`).
 *
 * In pick mode (`collapsed`) the bar shrinks to its header: the room the rest took stays, drawn
 * dead, so a click there gives no order by accident (`CONTEXT.md`: Picking a target).
 *
 * A tab with more to show (`tall`: the Queue tab) grows the bar upward while it is open, with a
 * button back to bar height and up again. On a phone the sheet is as tall as it is pulled.
 */
export function CommandBar({
  rel,
  icon = 'person',
  title,
  badge,
  lines,
  head,
  tabs,
  status,
  panel,
  onClose,
  collapsed = false,
  tall = false,
  children,
}: {
  rel: Relationship
  /** The UI icon in the figure: a resident by default, an army's banner. */
  icon?: UiIconName
  title: string
  /** Leader or Heir. */
  badge?: string
  /** Under the name: Doing and its second line. */
  lines: ReactNode[]
  /** The rest of the header: meters, carried goods, equipment, … */
  head?: ReactNode
  /** The tabs (`CardTabs`). */
  tabs: ReactNode
  /** The line under the open tab: an order turned down, or how to give one. */
  status?: ReactNode
  /** The open order's panel, above the bar on a desktop (`OrderGrid` puts it under its order on a phone). */
  panel?: OrderPanelSpec
  onClose: () => void
  collapsed?: boolean
  /** The open tab grows the bar upward (the Queue tab's planner). */
  tall?: boolean
  /** The open tab's content. */
  children: ReactNode
}) {
  const peek = useSheetPeek()
  const phone = useInSheet()
  const shrunk = collapsed && !peek
  // Back to bar height: kept while the card is open, from one tall tab to the next.
  const [low, setLow] = useState(false)
  const grown = tall && !low && !phone && !shrunk
  const relClass = `rel-${rel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
  const above = panel && !collapsed && !peek && !phone ? panel : undefined
  const bar = useRef<HTMLElement>(null)
  const box = useRef<HTMLElement>(null)
  const [left, setLeft] = useState(0)
  // Over the order that opened it (its button is expanded), kept inside the bar.
  useLayoutEffect(() => {
    if (!above) return
    const place = () => {
      const b = bar.current
      const p = box.current
      if (!b || !p) return
      const order = b.querySelector<HTMLElement>('.cmd-order > button[aria-expanded="true"]')
      const edge = b.getBoundingClientRect().left
      const at = order ? order.getBoundingClientRect().left - edge : undefined
      setLeft(panelLeft(at, p.offsetWidth, b.clientWidth))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [above?.title, above?.size, !!above])
  return (
    <>
      {above && <OrderPanel panel={above} panelRef={box} style={{ left }} />}
      <section
        ref={bar}
        className={`cmd-bar pn ${relClass}${shrunk ? ' cmd-shrunk' : ''}${grown ? ' cmd-tall' : ''}`}
        aria-label="Selection"
      >
        <div className="cmd-head">
          <div className="cmd-who">
            <span className="cmd-figure" aria-hidden="true">
              <Icon name={icon} size={32} />
            </span>
            <div className="cmd-title">
              <div className="name-line">
                <h2>{title}</h2>
                {badge && <span className="chip y">{badge}</span>}
              </div>
              {lines.map((l, i) => (
                <div key={i} className="sel-line">
                  {l}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn sm sq cmd-close"
              aria-label="Close the selection card"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
          {head}
        </div>
        {shrunk ? (
          <div className="cmd-main sel-dead" aria-hidden="true" />
        ) : (
          !peek && (
            <div className="cmd-main">
              {tabs}
              {tall && !phone && (
                <button
                  type="button"
                  className="btn sm cmd-grow"
                  title={grown ? 'Back to bar height' : 'Grow the bar upward again'}
                  onClick={() => setLow(!low)}
                >
                  {grown ? '▾ Bar height' : '▴ Taller'}
                </button>
              )}
              <div className="cmd-body">{children}</div>
              {status && <div className="cmd-status">{status}</div>}
            </div>
          )
        )}
      </section>
    </>
  )
}

/**
 * The Orders tab of the command bar: each kind of order (`rowGroups`) under its heading, laid out
 * in columns (`orderColumns`), each order a button with its key. Rows keep their slot and greyed
 * ones say why as `ActionRows` does (ADR 0019); `beside` puts Customise by the rows that have it.
 * On a phone the kinds stack, two buttons to a row, and the open order's panel (`OrderPanel`)
 * opens under it.
 */
export function OrderGrid<Id extends string>({
  groups,
  open,
  onAction,
  beside,
  panel,
}: {
  groups: { group: OrderGroup; label: string; actions: CardAction<Id>[] }[]
  /** The action whose panel is open, if any. */
  open: string | undefined
  onAction: (a: CardAction<Id>) => void
  beside?: (a: CardAction<Id>) => ReactNode
  /** The open order's panel, shown under its order on a phone (above the bar otherwise). */
  panel?: OrderPanelSpec
}) {
  const phone = useInSheet()
  const under = phone && panel ? <OrderPanel panel={panel} inline /> : undefined
  return (
    <div className="cmd-orders">
      {orderColumns(groups).map((col) => (
        <div
          className={`cmd-col${col.wide ? ' wide' : ''}`}
          key={col.groups.map((g) => g.group).join()}
        >
          {col.groups.map((g) => (
            <div className="cmd-group" key={g.group}>
              <h3>{g.label}</h3>
              <ActionRows
                actions={g.actions}
                open={open}
                onAction={onAction}
                label={g.label}
                keys={false}
                panel={under}
                beside={beside}
                grid={{ wide: col.wide }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
