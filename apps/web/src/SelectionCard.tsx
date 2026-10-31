import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  CITY_NAME_MAX_LENGTH,
  nameProblem,
  type Building,
  type BuildingKind,
  type Resident,
  type ResourceKind,
} from '@csp/shared'
import { BuildingInfo } from './BuildingInfo.js'
import { ART_FILES, BUILDING_ART, NODE_ART, UNIT_ART } from './map/art.js'
import type { Relationship } from './theme.js'
import {
  actionForKey,
  tileActions,
  unhitcherOf,
  type CardAction,
  type TileCard as TileCardData,
} from './selection-view.js'
import { SHEET_OPENS_AT, nextSheet, snapSheet, stepSheet, type SheetHeight } from './sheet-view.js'
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
  head,
  onClose,
  collapsed = false,
  children,
}: {
  rel: Relationship | undefined
  /** An SVG from the map's art registry, drawn in the relationship colour. */
  icon?: string
  title: string
  badge?: string
  lines: ReactNode[]
  /** More of the header under the title, such as a resident's health and hunger. */
  head?: ReactNode
  onClose: () => void
  /** Shrunk to its header while the map waits for a target (ADR 0012: pick mode). */
  collapsed?: boolean
  children: ReactNode
}) {
  const peek = useContext(SheetPeek)
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
      {head}
      {!collapsed && !peek && children}
    </aside>
  )
}

/** Whether the card is in a bottom sheet dropped to its header, so only the header shows. */
const SheetPeek = createContext(false)

const SHEET_LABELS: Record<SheetHeight, string> = {
  peek: 'header only',
  half: 'half the screen',
  full: 'full screen',
}

/** How far, in pixels, the handle moves before a press counts as a drag rather than a tap. */
const DRAG_SLOP = 6

/**
 * Where the selection card sits over the map: docked top right on a desktop, a bottom sheet on a
 * phone (ADR 0012). The sheet opens at half; dragging its handle moves it between peek (just the
 * header), half and full, and a tap goes one height up. Pick mode drops it to peek, and it comes
 * back to where it was once the target is picked.
 */
export function CardSheet({
  phone,
  pinnedPeek,
  children,
}: {
  phone: boolean
  /** Held at peek while the map waits for a target for this card. */
  pinnedPeek: boolean
  children: ReactNode
}) {
  const [height, setHeight] = useState<SheetHeight>(SHEET_OPENS_AT)
  // The sheet's height in pixels while its handle is dragged.
  const [dragged, setDragged] = useState<number>()
  const press = useRef<{ y: number; from: number; moved: boolean }>(undefined)
  const ref = useRef<HTMLDivElement>(null)
  if (!phone) return <div className="game-selection">{children}</div>
  const shown = pinnedPeek ? 'peek' : height
  const screen = () => ref.current?.parentElement?.clientHeight ?? window.innerHeight
  const settle = (to: SheetHeight) => {
    setHeight(to)
    setDragged(undefined)
  }
  return (
    <div
      ref={ref}
      className={`game-selection sheet sheet-${dragged === undefined ? shown : 'dragged'}`}
      style={dragged === undefined ? undefined : { height: dragged }}
    >
      <button
        type="button"
        className="sheet-handle"
        aria-label={`Card height: ${SHEET_LABELS[shown]}. Drag or tap to change it.`}
        disabled={pinnedPeek}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          press.current = {
            y: e.clientY,
            from: ref.current?.getBoundingClientRect().height ?? 0,
            moved: false,
          }
        }}
        onPointerMove={(e) => {
          const p = press.current
          if (!p) return
          const dy = e.clientY - p.y
          if (!p.moved && Math.abs(dy) < DRAG_SLOP) return
          p.moved = true
          setDragged(Math.max(0, Math.min(screen(), p.from - dy)))
        }}
        onPointerUp={(e) => {
          const p = press.current
          if (!p?.moved) return
          settle(snapSheet(p.from - (e.clientY - p.y), screen()))
        }}
        onPointerCancel={() => {
          press.current = undefined
          setDragged(undefined)
        }}
        onClick={() => {
          // A drag ends in a click too; only a press that stayed put is a tap.
          const moved = press.current?.moved
          press.current = undefined
          if (!moved) settle(nextSheet(shown))
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          settle(stepSheet(shown, e.key === 'ArrowUp'))
        }}
      >
        <span aria-hidden="true" />
      </button>
      <SheetPeek.Provider value={dragged === undefined && shown === 'peek'}>
        {children}
      </SheetPeek.Provider>
    </div>
  )
}

/**
 * The banner over the map while an order waits for its target (ADR 0012; `CONTEXT.md`: Picking a
 * target): what to pick, and Cancel, which Escape does too.
 */
export function PickBanner({
  prompt,
  hint,
  onCancel,
}: {
  prompt: string
  hint?: string
  onCancel: () => void
}) {
  return (
    <div className="pick-banner" role="status">
      <div className="pick-banner-text">
        <strong>{prompt}</strong>
        {hint && <span className="small">{hint}</span>}
      </div>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** The tabs under a card's header (ADR 0012): one open at a time. */
export function CardTabs<T extends string>({
  tabs,
  labels,
  tab,
  onTab,
}: {
  tabs: readonly T[]
  labels: Record<T, string>
  tab: T
  onTab: (tab: T) => void
}) {
  return (
    <div className="tabs sel-tabs" role="tablist" aria-label="Card">
      {tabs.map((t) => (
        <button type="button" key={t} role="tab" aria-selected={tab === t} onClick={() => onTab(t)}>
          {labels[t]}
        </button>
      ))}
    </div>
  )
}

/** The card's actions as rows, each with its key; a row that opens a panel shows it pressed. */
export function ActionRows({
  actions,
  open,
  onAction,
  label = 'Actions',
  keys = true,
}: {
  actions: CardAction[]
  /** The action whose panel is open, if any. */
  open: string | undefined
  onAction: (a: CardAction) => void
  label?: string
  /** Whether the rows run on their keys; off where the card listens for all its actions itself. */
  keys?: boolean
}) {
  useActionKeys(keys ? actions : [], onAction)
  return (
    <div className="sel-actions" role="group" aria-label={label}>
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
export function useActionKeys(actions: CardAction[], onAction: (a: CardAction) => void) {
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
  tick,
  orderError,
  onClose,
  onSendHere,
  onBuildHere,
  onSetGate,
  onOpenCity,
  onRenameCity,
  onSelectResident,
  onUnhitch,
}: {
  card: TileCardData
  /** The building the card is named after, for its icon. */
  building: Building | undefined
  nodeKind: keyof typeof NODE_ART | undefined
  /** The node under the building's footprint, which picks what a mine yields. */
  buildingNode?: ResourceKind
  /** The resident picked last, to send here. */
  actor: Resident | undefined
  tick: number
  orderError: string | undefined
  onClose: () => void
  onSendHere: () => void
  /** Has the actor build a node's workplace with the north-west tile of its footprint `at`. */
  onBuildHere: (building: BuildingKind, at: { x: number; y: number }) => void
  onSetGate: (gateId: string, open: boolean) => void
  /** Opens the city inspector at a city. */
  onOpenCity: (cityId: string) => void
  /** Renames a city of the Player's realm (`CONTEXT.md`: Renaming a city). */
  onRenameCity: (cityId: string, name: string) => void
  /** Picks one of the Player's residents, such as a carriage's passenger. */
  onSelectResident: (id: string) => void
  /** Orders a resident to unhitch the horse from a carriage (`CONTEXT.md`: Hitched horse). */
  onUnhitch: (carriageId: string, residentId: string) => void
}) {
  const actions = tileActions(card, actor, tick)
  const [open, setOpen] = useState<string | undefined>()
  const shown = actions.some((a) => a.id === open) ? open : undefined
  const icon =
    card.what === 'building' && building
      ? BUILDING_ART[building.kind]
      : card.what === 'node' && nodeKind
        ? NODE_ART[nodeKind]
        : card.what === 'horses'
          ? UNIT_ART.horse
          : undefined
  return (
    <SelectionCard
      rel={card.rel}
      icon={icon}
      title={card.title}
      lines={card.lastSeen ? [card.lastSeen.when] : card.lines.slice(0, 1)}
      onClose={onClose}
    >
      {card.lastSeen && (
        <ul className="sel-facts sel-past" aria-label="As last seen">
          {card.lastSeen.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {card.lines.length > (card.lastSeen ? 0 : 1) && (
        <ul className="sel-facts">
          {/* By place, not text: horses alike give the same line twice. */}
          {card.lines.map((l, i) =>
            i === 0 && !card.lastSeen ? null : i === card.passengers?.line ? (
              <li key={i}>
                Passengers:{' '}
                {card.passengers.residents.map((p, j) => (
                  <Fragment key={p.id}>
                    {j > 0 && ', '}
                    {p.pick ? (
                      <button type="button" className="link" onClick={() => onSelectResident(p.id)}>
                        {p.name}
                      </button>
                    ) : (
                      p.name
                    )}
                  </Fragment>
                ))}{' '}
                · {card.passengers.weight}
              </li>
            ) : (
              <li key={i}>{l}</li>
            ),
          )}
        </ul>
      )}
      {card.occupation && (
        <p className={`occupation${card.occupation.warning ? ' warn' : ''}`}>
          {card.occupation.text}
        </p>
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
          open={shown}
          onAction={(a) => {
            if (a.opens) setOpen(shown === a.id ? undefined : a.id)
            if (a.id === 'sendHere') onSendHere()
            if (a.id === 'build' && card.buildHere?.at)
              onBuildHere(card.buildHere.kind, card.buildHere.at)
            if (a.id === 'gate' && card.gate) onSetGate(card.gate.id, !!card.gate.closed)
            if (a.id === 'openCity' && card.city) onOpenCity(card.city.id)
            const unhitcher = unhitcherOf(card, actor)
            if (a.id === 'unhitch' && card.unhitch && unhitcher)
              onUnhitch(card.unhitch.carriageId, unhitcher)
          }}
        />
      )}
      {shown === 'renameCity' && card.renameCity && (
        <CityRenameBlock
          // Starts again from the new name once the rename comes back.
          key={card.renameCity.name}
          name={card.renameCity.name}
          onRename={(name) => {
            setOpen(undefined)
            onRenameCity(card.renameCity!.id, name)
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

/**
 * Renaming a city (`CONTEXT.md`): a new name for a city of the Player's realm. Others learn it
 * only when they see the city again.
 */
function CityRenameBlock({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [value, setValue] = useState(name)
  const problem = nameProblem(value, CITY_NAME_MAX_LENGTH)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (problem) return
    onRename(value.trim())
  }
  return (
    <section className="inspector-block" aria-label="Rename the city">
      <div className="panel-head">
        <h3>Rename the city</h3>
        <span className="small muted">free, at once</span>
      </div>
      <form onSubmit={submit}>
        <div className="order-buttons">
          <input
            value={value}
            maxLength={CITY_NAME_MAX_LENGTH}
            aria-label="New city name"
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </div>
        <p className="small muted">
          Others go on knowing it by its old name until they see it again.
        </p>
        <div className="order-buttons">
          <button type="submit" className="primary" disabled={!!problem}>
            Rename
          </button>
        </div>
      </form>
    </section>
  )
}
