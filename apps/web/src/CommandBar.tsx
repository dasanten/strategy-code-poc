import type { ReactNode } from 'react'
import { orderColumns } from './command-bar-view.js'
import type { CardAction, OrderGroup } from './selection-view.js'
import type { Relationship } from './theme.js'
import { ActionRows, useInSheet, useSheetPeek } from './SelectionCard.js'

/**
 * The command bar (`CONTEXT.md`: Screen, Resident card; ADR 0044): the card of a picked resident
 * or group along the bottom of the screen. Its header on the left (figure, name, badge, the lines
 * under the name, then `head`: meters, what they carry, …), its tabs and the open tab's content
 * beside it, the status line under that. A panel an order opens (`panel`) sits above the bar.
 * Placed by `CardSheet` with `bar`; on a phone it is the bottom sheet, the panel under its order.
 *
 * In pick mode (`collapsed`) the bar shrinks to its header: the room the rest took stays, drawn
 * dead, so a click there gives no order by accident (`CONTEXT.md`: Picking a target).
 */
export function CommandBar({
  rel,
  title,
  badge,
  lines,
  head,
  tabs,
  status,
  panel,
  onClose,
  collapsed = false,
  children,
}: {
  rel: Relationship
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
  panel?: { title: string; body: ReactNode; onClose: () => void }
  onClose: () => void
  collapsed?: boolean
  /** The open tab's content. */
  children: ReactNode
}) {
  const peek = useSheetPeek()
  const phone = useInSheet()
  const shrunk = collapsed && !peek
  const relClass = `rel-${rel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
  return (
    <>
      {panel && !collapsed && !peek && !phone && (
        <section className="cmd-panel pn" aria-label={panel.title}>
          <div className="hd">
            <span className="grow">{panel.title}</span>
            <button
              type="button"
              className="btn sm sq"
              aria-label={`Close ${panel.title}`}
              onClick={panel.onClose}
            >
              ✕
            </button>
          </div>
          <div className="cmd-panel-body">{panel.body}</div>
        </section>
      )}
      <section
        className={`cmd-bar pn ${relClass}${shrunk ? ' cmd-shrunk' : ''}`}
        aria-label="Selection"
      >
        <div className="cmd-head">
          <div className="cmd-who">
            <span className="cmd-figure" aria-hidden="true">
              <span className="ic s32 i-person" />
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
 * On a phone the kinds stack, two buttons to a row, and the open order's panel opens under it.
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
  panel?: ReactNode
}) {
  const phone = useInSheet()
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
                panel={phone ? panel : undefined}
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
