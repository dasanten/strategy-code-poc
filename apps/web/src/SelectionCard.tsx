import { useEffect, useRef, type ReactNode } from 'react'
import type { Building, Resident, ResourceKind } from '@csp/shared'
import { BuildingInfo } from './BuildingInfo.js'
import { ART_FILES, BUILDING_ART, NODE_ART } from './map/art.js'
import type { Relationship } from './theme.js'
import {
  actionForKey,
  tileActions,
  type CardAction,
  type TileCard as TileCardData,
} from './selection-view.js'
import './selection-card.css'

/**
 * The selection card (ADR 0008): docked top right over the map, a dark translucent panel whose
 * edge has the relationship colour of what is selected. The head says what it is; the actions
 * that fit follow as rows with their keys.
 */
export function SelectionCard({
  rel,
  icon,
  title,
  badge,
  lines,
  onClose,
  children,
}: {
  rel: Relationship | undefined
  /** An SVG from the map's art registry, drawn in the relationship colour. */
  icon?: string
  title: string
  badge?: string
  lines: ReactNode[]
  onClose: () => void
  children: ReactNode
}) {
  const colour = rel
    ? `var(--rel-${rel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`
    : undefined
  return (
    <aside
      className="inspector sel-card"
      aria-label="Selection"
      style={colour ? { borderLeftColor: colour } : undefined}
    >
      <div className="sel-head">
        {icon && ART_FILES[icon] && (
          <span
            className="sel-icon"
            aria-hidden="true"
            style={colour ? { color: colour } : undefined}
            // The registry's own SVG source, stroked in currentColor.
            dangerouslySetInnerHTML={{ __html: ART_FILES[icon].replace('color="#fff"', '') }}
          />
        )}
        <div className="sel-title">
          <div className="name-line">
            <h2>{title}</h2>
            {badge && <span className="badge">{badge}</span>}
          </div>
          {lines.map((l, i) => (
            <div key={i} className="sel-line">
              {l}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="sel-close"
          aria-label="Close the selection card"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {children}
    </aside>
  )
}

/** The card's actions as rows, each with its key; a row that opens a panel shows it pressed. */
export function ActionRows({
  actions,
  open,
  onAction,
}: {
  actions: CardAction[]
  /** The action whose panel is open, if any. */
  open: string | undefined
  onAction: (a: CardAction) => void
}) {
  useActionKeys(actions, onAction)
  return (
    <div className="sel-actions" role="group" aria-label="Actions">
      {actions.map((a) => {
        const on = a.active || (a.opens && open === a.id)
        return (
          <button
            type="button"
            key={a.id}
            className={on ? 'on' : ''}
            aria-pressed={a.opens || a.active !== undefined ? !!on : undefined}
            aria-keyshortcuts={a.key}
            disabled={a.disabled}
            onClick={() => onAction(a)}
          >
            <kbd>{a.key}</kbd>
            <span>
              {a.label}
              {a.reason && <span className="sel-reason">{a.reason}</span>}
            </span>
            {a.opens && (
              <span className="sel-more" aria-hidden="true">
                {on ? '▾' : '▸'}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Runs an action on its key, unless the Player is typing somewhere or holds a modifier. */
function useActionKeys(actions: CardAction[], onAction: (a: CardAction) => void) {
  const latest = useRef({ actions, onAction })
  latest.current = { actions, onAction }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const typing =
        e.target instanceof Element && e.target.closest('input, textarea, select, .cm-editor')
      if (typing) return
      const a = actionForKey(latest.current.actions, e.key)
      if (!a) return
      e.preventDefault()
      latest.current.onAction(a)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * The card for a tile with no resident of the Player's picked on it: a building or site, a
 * carriage, goods on the ground, a resource node or strangers, and what can be done from here.
 */
export function TileCard({
  card,
  building,
  nodeKind,
  buildingNode,
  actor,
  orderError,
  onClose,
  onSendHere,
  onSetGate,
  onOpenCity,
}: {
  card: TileCardData
  /** The building the card is named after, for its icon. */
  building: Building | undefined
  nodeKind: keyof typeof NODE_ART | undefined
  /** The node under the building's footprint, which picks what a mine yields. */
  buildingNode?: ResourceKind
  /** The resident picked last, to send here. */
  actor: Resident | undefined
  orderError: string | undefined
  onClose: () => void
  onSendHere: () => void
  onSetGate: (gateId: string, open: boolean) => void
  /** Opens the city inspector at a city. */
  onOpenCity: (cityId: string) => void
}) {
  const actions = tileActions(card, actor)
  const icon =
    card.what === 'building' && building
      ? BUILDING_ART[building.kind]
      : card.what === 'node' && nodeKind
        ? NODE_ART[nodeKind]
        : undefined
  return (
    <SelectionCard
      rel={card.rel}
      icon={icon}
      title={card.title}
      lines={card.lines.slice(0, 1)}
      onClose={onClose}
    >
      {card.lines.length > 1 && (
        <ul className="sel-facts">
          {card.lines.slice(1).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {card.what === 'building' && building && (
        <BuildingInfo
          kind={building.kind}
          node={buildingNode}
          site={building.site ? building : undefined}
        />
      )}
      {actions.length > 0 && (
        <ActionRows
          actions={actions}
          open={undefined}
          onAction={(a) => {
            if (a.id === 'sendHere') onSendHere()
            if (a.id === 'gate' && card.gate) onSetGate(card.gate.id, !!card.gate.closed)
            if (a.id === 'openCity' && card.city) onOpenCity(card.city.id)
          }}
        />
      )}
      <p className="muted small" role="status">
        {orderError
          ? `Order turned down: ${orderError}`
          : actor
            ? `Close this card to go back to ${actor.name}.`
            : 'Pick one of your residents to send them here.'}
      </p>
    </SelectionCard>
  )
}
