import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { CITY_NAME_MAX_LENGTH, FEED_UNITS, HORSE_NAME_MAX_LENGTH } from '@csp/balance'
import { canHandle } from './shared/stats.js'
import { nameProblem } from './shared/names.js'
import type {
  Building,
  BuildingKind,
  GoodsSpot,
  Resident,
  ResourceKind,
  Stock,
  Waypoint,
} from '@csp/shared-types'
import { BuildingInfo } from './BuildingInfo.js'
import { CustomiseButton, taskStart } from './Customise.js'
import { GoodIcon, GoodsGrid } from './GoodsGrid.js'
import { GOOD_LABELS, goodsItems } from './goods-grid.js'
import { TileGoods } from './Residents.js'
import { ART_FILES, BUILDING_ART, NODE_ART, UNIT_ART } from './map/art.js'
import type { Relationship } from './theme.js'
import {
  actionForKey,
  feedTargetLabel,
  feedTargets,
  keepRows,
  tileActions,
  thiefAmong,
  thiefOf,
  unhitcherOf,
  boaterOf,
  type CardAction,
  type CarriageView,
  type CardList,
  type CardRow,
  type NamedResident,
  type OrderGroup,
  type SiteView,
  type TileCard as TileCardData,
} from './selection-view.js'
import { Meter, meterClass, pct } from './Horses.js'
import { WaypointNameForm, addProblem } from './Waypoints.js'
import { suggestedWaypointName } from './waypoints-view.js'
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
  // How tall the card was before it shrank: while shrunk, the room it took stays dead, so a click
  // there gives no order by accident (`CONTEXT.md`: Picking a target). A bottom sheet at peek
  // shows the map instead; a tap there only previews.
  const ref = useRef<HTMLElement>(null)
  const tall = useRef(0)
  useLayoutEffect(() => {
    if (!collapsed && !peek && ref.current) tall.current = ref.current.offsetHeight
  })
  const dead = collapsed && !peek && tall.current > 0
  return (
    <aside
      ref={ref}
      className={`inspector sel-card${dead ? ' sel-shrunk' : ''}`}
      aria-label="Selection"
      style={{
        ...(colour ? { borderLeftColor: colour } : {}),
        ...(dead ? { minHeight: tall.current } : {}),
      }}
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
      {dead && <div className="sel-dead" aria-hidden="true" />}
    </aside>
  )
}

/** Whether the card is in a bottom sheet dropped to its header, so only the header shows. */
const SheetPeek = createContext(false)

/** Whether the card is hidden behind the wide drawer (`cardHidden`), its keys off with it. */
const CardHidden = createContext(false)

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
 * back to where it was once the target is picked. A hidden card keeps all that until it shows.
 */
export function CardSheet({
  phone,
  pinnedPeek,
  hidden = false,
  children,
}: {
  phone: boolean
  /** Held at peek while the map waits for a target for this card. */
  pinnedPeek: boolean
  /** Hidden behind the wide drawer (`cardHidden`). */
  hidden?: boolean
  children: ReactNode
}) {
  const [height, setHeight] = useState<SheetHeight>(SHEET_OPENS_AT)
  // The sheet's height in pixels while its handle is dragged.
  const [dragged, setDragged] = useState<number>()
  const press = useRef<{ y: number; from: number; moved: boolean }>(undefined)
  const ref = useRef<HTMLDivElement>(null)
  // The map's buttons and readout sit above the sheet: its height goes to the screen as `--sheet-h`.
  useEffect(() => {
    const sheet = ref.current
    const screen = sheet?.parentElement
    if (!sheet || !screen) return
    const observer = new ResizeObserver(() =>
      screen.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`),
    )
    observer.observe(sheet)
    return () => {
      observer.disconnect()
      screen.style.removeProperty('--sheet-h')
    }
  }, [phone])
  if (!phone)
    return (
      <div className="game-selection" hidden={hidden}>
        <CardHidden.Provider value={hidden}>{children}</CardHidden.Provider>
      </div>
    )
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
      hidden={hidden}
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
        <CardHidden.Provider value={hidden}>{children}</CardHidden.Provider>
      </SheetPeek.Provider>
    </div>
  )
}

/**
 * The banner over the map while an order waits for its target (ADR 0012; `CONTEXT.md`: Picking a
 * target): what to pick, what is under the pointer and what the pick would do there (or else
 * more on what picking does), and Cancel, which Escape does too. On a touch screen, once a tap
 * has shown the preview, Confirm picks that tile. Waypoints opens the drawer to pick one of the
 * Player's waypoints instead (`CONTEXT.md`: Waypoint).
 */
export function PickBanner({
  prompt,
  hint,
  under,
  onConfirm,
  onWaypoints,
  onCancel,
}: {
  prompt: string
  hint?: string
  /** What is under the pointer, or the tile tapped, and what the pick would do there. */
  under?: string
  /** Picks the tile previewed by a tap, on a touch screen. */
  onConfirm?: () => void
  /** Opens the Waypoints drawer; absent while the Player holds none or it is open. */
  onWaypoints?: () => void
  onCancel: () => void
}) {
  const line = under ?? hint
  return (
    <div className="notice pick-banner" role="status" title={hint ? `${prompt}\n${hint}` : prompt}>
      <div className="notice-text pick-banner-text">
        <strong>{prompt}</strong>
        {line && <span className="small">{line}</span>}
      </div>
      {onConfirm && (
        <button type="button" className="primary" onClick={onConfirm}>
          Confirm
        </button>
      )}
      {onWaypoints && (
        <button type="button" onClick={onWaypoints}>
          Waypoints
        </button>
      )}
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

/**
 * The card's actions as rows, each with its key; a row that opens a panel shows it pressed, and
 * `panel` opens right under it, scrolled into view when it opens. Each row is a button named by
 * its label, a greyed row's reason its description.
 */
export function ActionRows<Id extends string>({
  actions,
  open,
  onAction,
  label = 'Actions',
  keys = true,
  panel,
  beside,
}: {
  actions: CardAction<Id>[]
  /** The action whose panel is open, if any. */
  open: string | undefined
  onAction: (a: CardAction<Id>) => void
  label?: string
  /** Whether the rows run on their keys; off where the card listens for all its actions itself. */
  keys?: boolean
  /** The open action's panel, shown under its row. */
  panel?: ReactNode
  /** A control beside a row, such as its Customise button. */
  beside?: (a: CardAction<Id>) => ReactNode
}) {
  useActionKeys(keys ? actions : [], onAction)
  const ids = useId()
  return (
    <div className="sel-actions" role="group" aria-label={label}>
      {actions.map((a) => {
        const on = a.active || (a.opens && open === a.id)
        const why = `${ids}-${a.id}`
        return (
          <Fragment key={a.id}>
            <div className="sel-action">
              <button
                type="button"
                className={on ? 'on' : ''}
                aria-label={a.label}
                aria-describedby={a.reason ? why : undefined}
                aria-pressed={a.opens || a.active !== undefined ? !!on : undefined}
                aria-expanded={a.opens ? open === a.id : undefined}
                aria-keyshortcuts={a.key}
                disabled={a.disabled}
                onClick={() => onAction(a)}
              >
                <kbd>{a.key}</kbd>
                <span>
                  {a.label}
                  {a.reason && (
                    <span className="sel-reason" id={why}>
                      {a.reason}
                    </span>
                  )}
                </span>
                {a.opens && (
                  <span className="sel-more" aria-hidden="true">
                    {on ? '▾' : '▸'}
                  </span>
                )}
              </button>
              {beside?.(a)}
            </div>
            {a.opens && open === a.id && panel && <PanelUnder>{panel}</PanelUnder>}
          </Fragment>
        )
      })}
    </div>
  )
}

/** An order's panel under the row that opened it, scrolled into view as it opens. */
export function PanelUnder({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [])
  return (
    <div className="sel-panel-under" ref={ref}>
      {children}
    </div>
  )
}

/**
 * The rows a card shows while it stays open (`keepRows`, ADR 0019): each keeps its slot until
 * the card goes, so a card for something else picked starts sorted afresh.
 */
export function useKeptRows<Id extends string>(
  fresh: readonly CardAction<Id>[],
  missing: Partial<Record<Id, string>>,
  groupOf: (id: Id) => OrderGroup,
): CardAction<Id>[] {
  const kept = useRef<CardAction<Id>[]>(undefined)
  // Keeping the rows again from what it kept gives the same rows, however often React renders.
  const rows = keepRows(kept.current, fresh, missing, groupOf)
  kept.current = rows
  return rows
}

/**
 * What closes each panel open on the shown card, the one opened last at the end, which the
 * game's Escape calls before it leaves the card (`escapeStep`). One card shows at a time.
 */
const openPanels = new Set<() => void>()

/** Lets Escape close a card's panel while it is open (`closeOpenPanel`). */
export function useEscapeClosesPanel(open: boolean, close: () => void) {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    if (!open) return
    const closer = () => latest.current()
    openPanels.add(closer)
    return () => void openPanels.delete(closer)
  }, [open])
}

/** Whether a panel is open on the shown card (`useEscapeClosesPanel`). */
export const panelOpen = () => openPanels.size > 0

/** Closes the panel opened last on the shown card, if one is open. */
export const closeOpenPanel = () => [...openPanels].at(-1)?.()

/**
 * Runs an action on its key, unless the Player is typing somewhere or holds a modifier, or the
 * card is hidden.
 */
export function useActionKeys<Id extends string>(
  actions: readonly CardAction<Id>[],
  onAction: (a: CardAction<Id>) => void,
) {
  const hidden = useContext(CardHidden)
  const latest = useRef({ actions, onAction, hidden })
  latest.current = { actions, onAction, hidden }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (latest.current.hidden) return
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
  onRenameHorse,
  onSelectResident,
  onOpenHorse,
  onUnhitch,
  onBoard,
  onDriveOff,
  onHitchOff,
  onStealHorse,
  tile,
  waypoints,
  workSettings,
  mapSize,
  onAddWaypoint,
  onFeed,
  onPickUp,
}: {
  card: TileCardData
  /** The building the card is named after, for its icon. */
  building: Building | undefined
  /** The Work settings panel of a workplace or site of one (`WorkSettings`), if any. */
  workSettings?: ReactNode
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
  /** Opens the city inspector at a city, scrolled to one of its buildings when given. */
  onOpenCity: (cityId: string, buildingId?: string) => void
  /** Renames a city of the Player's realm (`CONTEXT.md`: Renaming a city). */
  onRenameCity: (cityId: string, name: string) => void
  /** Renames a horse of the Player's realm (`CONTEXT.md`: Renaming a horse). */
  onRenameHorse: (horseId: string, name: string) => void
  /** Picks one of the Player's residents, such as a carriage's passenger. */
  onSelectResident: (id: string) => void
  /** Shows one of the Player's horses in the Horses drawer. */
  onOpenHorse: (id: string) => void
  /** Orders a resident to unhitch the horse from a carriage (`CONTEXT.md`: Hitched horse). */
  onUnhitch: (carriageId: string, residentId: string) => void
  /** Orders a resident to board the boat beside them, or with none to get off (`CONTEXT.md`: Beside a vessel). */
  onBoard?: (vesselId: string | undefined, residentId: string) => void
  /**
   * Has a resident on the tile start driving off in the carriage there, by picking where to
   * (`CONTEXT.md`: Stealing a carriage or horse).
   */
  onDriveOff: (residentId: string) => void
  /**
   * Has a resident on the tile start driving the realm's carriage there off with another
   * organization's horse, by picking where to.
   */
  onHitchOff: (residentId: string) => void
  /** Orders a resident on the tile to steal the horse there by mounting it. */
  onStealHorse: (horseId: string, residentId: string) => void
  /** The tile the card is for. */
  tile: { x: number; y: number }
  /** The Player's waypoints, for a new one's name and the cap (`CONTEXT.md`: Waypoint). */
  waypoints: readonly Waypoint[]
  /** Tiles along each side of the map, to tell who is next to whom. */
  mapSize: number
  /** Puts a waypoint named `name` on the tile; resolves with why it was turned down, if it was. */
  onAddWaypoint: (name: string) => Promise<string | undefined>
  /** Orders the actor to Feed someone Down or a horse on the tile. */
  onFeed?: (targetId: string, units: number) => void
  /** Orders one of the Player's residents to take goods from a spot on their tile. */
  onPickUp: (residentId: string, from: GoodsSpot, goods: Stock) => void
}) {
  const actions = tileActions(card, actor, tick, mapSize)
  const [open, setOpen] = useState<string | undefined>()
  const shown = actions.some((a) => a.id === open) ? open : undefined
  useEscapeClosesPanel(shown !== undefined, () => setOpen(undefined))
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
      {card.lastSeen?.sites?.map((site, i) => (
        <SiteBlock key={i} site={site} past />
      ))}
      {card.lastSeen?.lists.map((list, i) => (
        <CardListBlock key={i} list={list} past onOpen={() => {}} />
      ))}
      {card.lines.length > (card.lastSeen ? 0 : 1) && (
        <ul className="sel-facts">
          {/* By place, not text: horses alike give the same line twice. */}
          {card.lines.map((l, i) => (i === 0 && !card.lastSeen ? null : <li key={i}>{l}</li>))}
        </ul>
      )}
      {card.sites?.map((site, i) => (
        <SiteBlock key={i} site={site} />
      ))}
      {card.carriage && (
        <CarriageBlock
          carriage={card.carriage}
          // On its own card the card's head already names it.
          head={card.what !== 'carriage'}
          onSelectResident={onSelectResident}
          onOpenHorse={onOpenHorse}
        />
      )}
      {card.stableFood && (
        <div className="vital card-food">
          <div className="vital-head">
            <span className="muted">Food</span>
            <span className="mono">{card.stableFood.units}</span>
          </div>
          <span className="meter big" aria-label={`Food ${pct(card.stableFood.share)}`}>
            <span
              className={meterClass(card.stableFood.share)}
              style={{ width: pct(card.stableFood.share) }}
            />
          </span>
          <span className="small muted">{capital(card.stableFood.lasts)}</span>
        </div>
      )}
      {card.lists?.map((list, i) => (
        <CardListBlock
          key={i}
          list={list}
          onOpen={(row) => (row.opens === 'horse' ? onOpenHorse(row.id) : onSelectResident(row.id))}
        />
      ))}
      {card.downGoods?.map((d) => {
        // The resident picked last takes it when they are on the tile, else the first one there.
        const taker = d.takers.find((r) => r.id === actor?.id) ?? d.takers[0]
        return (
          <section
            key={d.residentId}
            className="inspector-block"
            aria-label={`Carried by ${d.name}`}
          >
            <TileGoods
              title={`Carried by ${d.name}, Down${taker ? ` · ${taker.name} picks up` : ''}`}
              stock={d.goods}
              spot={{ kind: 'resident', residentId: d.residentId }}
              onPickUp={(from, goods) => taker && onPickUp(taker.id, from, goods)}
              refused={(good) => !taker || !canHandle(taker, tick, [good])}
            />
            {!taker && <p className="muted small">Anyone of yours on this tile can pick it up.</p>}
          </section>
        )
      })}
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
      {card.what === 'building' && workSettings}
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
            if (a.id === 'tradeHere' && card.tradeHere)
              onOpenCity(card.tradeHere.cityId, card.tradeHere.buildingId)
            const unhitcher = unhitcherOf(card, actor)
            if (a.id === 'unhitch' && card.unhitch && unhitcher)
              onUnhitch(card.unhitch.carriageId, unhitcher)
            const boater = boaterOf(card, actor)
            if (a.id === 'board' && card.boat && boater)
              onBoard?.(boater.getOff ? undefined : card.boat.vesselId, boater.id)
            const thief = thiefOf(card, actor)
            if (a.id === 'driveOff' && thief) onDriveOff(thief.id)
            const hitcher = thiefAmong(card.hitchOff?.residents, actor)
            if (a.id === 'hitchOff' && hitcher) onHitchOff(hitcher.id)
            const rider = thiefAmong(card.stealHorse?.residents, actor)
            if (a.id === 'stealHorse' && rider && card.stealHorse)
              onStealHorse(card.stealHorse.horseId, rider.id)
          }}
          beside={(a) =>
            a.id === 'build' &&
            card.buildHere?.at && (
              <CustomiseButton
                order={taskStart('build')}
                of={a.label}
                disabled={a.disabled}
                give={() => onBuildHere(card.buildHere!.kind, card.buildHere!.at!)}
              />
            )
          }
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
      {shown === 'feed' && actor && onFeed && (
        <FeedBlock
          targets={feedTargets(card, actor)}
          food={actor.carried.food ?? 0}
          onFeed={(targetId, units) => {
            setOpen(undefined)
            onFeed(targetId, units)
          }}
        />
      )}
      {shown === 'renameHorse' && card.renameHorses && (
        <HorseRenameBlock
          // Starts again from the new names once the rename comes back.
          key={card.renameHorses.map((h) => h.name).join('|')}
          horses={card.renameHorses}
          onRename={(horseId, name) => {
            setOpen(undefined)
            onRenameHorse(horseId, name)
          }}
        />
      )}
      {shown === 'addWaypoint' && (
        <section className="inspector-block" aria-label="Add a waypoint">
          <div className="panel-head">
            <h3>Add a waypoint here</h3>
            <span className="small muted">only you see it</span>
          </div>
          <WaypointNameForm
            // Starts again for the next one once a waypoint is added.
            key={waypoints.length}
            initial={suggestedWaypointName(waypoints)}
            submitLabel="Add waypoint"
            problem={addProblem(waypoints, tile.x, tile.y, mapSize)}
            onSubmit={async (name) => {
              const turnedDown = await onAddWaypoint(name)
              if (!turnedDown) setOpen(undefined)
              return turnedDown
            }}
          />
        </section>
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

const capital = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`

/**
 * A construction site on the tile card (`SiteView`): its work done as a meter with how long is
 * left, then a row per material, its icon and name with what was delivered against what it
 * needs and a small bar. `past` for what the Player last saw.
 */
function SiteBlock({ site, past }: { site: SiteView; past?: boolean }) {
  const { work, materials } = site
  return (
    <section
      className={`card-site${past ? ' sel-past' : ''}`}
      aria-label={site.title ?? 'Construction site'}
    >
      {site.title && (
        <div className="panel-head">
          <h3>{site.title}</h3>
        </div>
      )}
      <div className="vital card-work">
        <div className="vital-head">
          <span className="muted">Work</span>
          <span className="mono">{work.text}</span>
        </div>
        <span className="meter big" aria-label={`Work ${work.text}`}>
          <span className="ok" style={{ width: pct(work.share) }} />
        </span>
        {work.left && <span className="small muted">{capital(work.left)}</span>}
      </div>
      {materials.length === 0 ? (
        <p className="muted small">Needs no materials, only work</p>
      ) : (
        <ul className="site-materials" aria-label="Materials">
          {materials.map(({ good, have, need }) => (
            <li key={good} aria-label={`${GOOD_LABELS[good]}: ${have} / ${need}`}>
              <GoodIcon good={good} />
              <span className="site-material-name">{GOOD_LABELS[good]}</span>
              <span className="mono">
                {have} / {need}
              </span>
              <span className="meter" aria-hidden="true">
                <span className={have >= need ? 'ok' : 'mid'} style={{ width: pct(have / need) }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * A carriage on the tile card (`CarriageView`) as labelled rows: its load as a bar over its
 * goods grid, its driver, passengers and route, then its horse as a row with its meters. Names
 * of the Player's residents pick them.
 */
function CarriageBlock({
  carriage,
  head,
  onSelectResident,
  onOpenHorse,
}: {
  carriage: CarriageView
  /** Its own heading, under a building's card. */
  head: boolean
  onSelectResident: (id: string) => void
  onOpenHorse: (id: string) => void
}) {
  const name = (r: NamedResident) =>
    r.pick ? (
      <button type="button" className="link" onClick={() => onSelectResident(r.id)}>
        {r.name}
      </button>
    ) : (
      r.name
    )
  const { load, driver, passengers, route } = carriage
  return (
    <section className="card-carriage" aria-label={carriage.title}>
      {head && (
        <div className="panel-head">
          <h3>{carriage.title}</h3>
        </div>
      )}
      <div className="vital card-load">
        <div className="vital-head">
          <span className="muted">Load</span>
          <span className="mono">{load.text}</span>
        </div>
        {load.share !== undefined && (
          <span className="meter big" aria-label={`Load ${pct(load.share)}`}>
            <span className="ok" style={{ width: pct(load.share) }} />
          </span>
        )}
      </div>
      {carriage.goods && (
        <GoodsGrid label="Load" items={goodsItems(carriage.goods)} empty="Empty" />
      )}
      <dl className="card-rows">
        {driver && (
          <>
            <dt>Driver</dt>
            <dd>{name(driver)}</dd>
          </>
        )}
        {passengers && (
          <>
            <dt>Passengers</dt>
            <dd>
              {passengers.residents.map((p, j) => (
                <Fragment key={p.id}>
                  {j > 0 && ', '}
                  {name(p)}
                </Fragment>
              ))}{' '}
              <span className="muted">· {passengers.weight}</span>
            </dd>
          </>
        )}
        {route && (
          <>
            <dt>Route</dt>
            <dd>
              {route.stops}
              <small className="muted">{route.leg}</small>
            </dd>
          </>
        )}
        {carriage.noHorse && (
          <>
            <dt>Horse</dt>
            <dd>{carriage.noHorse}</dd>
          </>
        )}
      </dl>
      {carriage.horse && (
        <CardListBlock list={carriage.horse} onOpen={(row) => onOpenHorse(row.id)} />
      )}
    </section>
  )
}

/**
 * A list on the tile card (`CardList`): its title with the count on the right, a heading over the
 * meters, then its rows. A row the Player can open is a button. An inventory shows as the goods
 * grid instead of rows (`CONTEXT.md`: Goods on cards). `past` for what the Player last saw.
 */
function CardListBlock({
  list,
  past,
  onOpen,
}: {
  list: CardList
  past?: boolean
  onOpen: (row: CardRow) => void
}) {
  const amounts = list.rows.some((row) => row.amount)
  const columns = `minmax(0, 1fr)${' 56px'.repeat(list.meters.length)}${amounts ? ' auto' : ''}`
  return (
    <section className={`card-list${past ? ' sel-past' : ''}`} aria-label={list.title}>
      <div className="panel-head">
        <h3>{list.title}</h3>
        <span className="small muted">{list.count}</span>
      </div>
      {list.goods && (
        <GoodsGrid label={list.title} items={goodsItems(list.goods)} empty={list.empty} />
      )}
      {!list.goods && list.rows.length === 0 && list.empty && (
        <p className="muted small">{list.empty}</p>
      )}
      {list.rows.length > 0 && list.meters.length > 0 && (
        <div
          className="card-list-row heading"
          style={{ gridTemplateColumns: columns }}
          aria-hidden="true"
        >
          <span />
          {list.meters.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      )}
      {list.rows.map((row) => {
        const cells = (
          <>
            <span className="card-list-name">
              <span>{row.name}</span>
              {row.detail && <small className="muted">{row.detail}</small>}
            </span>
            {list.meters.map((m, i) => (
              <Meter key={m} label={m} share={row.shares?.[i]} />
            ))}
            {row.amount && (
              <span className="card-list-amount">
                <GoodIcon good={row.amount.good} />
                <span className="mono">{row.amount.text}</span>
              </span>
            )}
          </>
        )
        const style = { gridTemplateColumns: columns }
        const says = row.amount ? `${row.detail} ${row.amount.text}, ` : ''
        return row.opens ? (
          <button
            type="button"
            key={row.id}
            className="card-list-row"
            style={style}
            aria-label={`${row.name}: ${says}${row.opens === 'horse' ? 'show in the Horses drawer' : 'open their card'}`}
            onClick={() => onOpen(row)}
          >
            {cells}
          </button>
        ) : (
          <div key={row.id} className="card-list-row" style={style}>
            {cells}
          </div>
        )
      })}
    </section>
  )
}

/**
 * Renaming a horse (`CONTEXT.md`): a new name for one of the Player's horses on the card, picked
 * from a list when there are several. Free and at once, like renaming a resident.
 */
function HorseRenameBlock({
  horses,
  onRename,
}: {
  horses: { id: string; name: string }[]
  onRename: (horseId: string, name: string) => void
}) {
  const [horseId, setHorseId] = useState(horses[0]!.id)
  const picked = horses.find((h) => h.id === horseId) ?? horses[0]!
  const [value, setValue] = useState(picked.name)
  const problem = nameProblem(value, HORSE_NAME_MAX_LENGTH)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (problem) return
    onRename(picked.id, value.trim())
  }
  return (
    <section className="inspector-block" aria-label="Rename a horse">
      <div className="panel-head">
        <h3>Rename {horses.length === 1 ? picked.name : 'a horse'}</h3>
        <span className="small muted">free, at once</span>
      </div>
      <form onSubmit={submit}>
        {horses.length > 1 && (
          <div className="order-buttons">
            <select
              aria-label="Horse"
              value={picked.id}
              onChange={(e) => {
                const h = horses.find((x) => x.id === e.target.value)
                if (!h) return
                setHorseId(h.id)
                setValue(h.name)
              }}
            >
              {horses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="order-buttons">
          <input
            value={value}
            maxLength={HORSE_NAME_MAX_LENGTH}
            aria-label="New name"
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {problem && <p className="small muted">{problem}</p>}
        <div className="order-buttons">
          <button type="submit" className="primary" disabled={!!problem}>
            Rename
          </button>
        </div>
      </form>
    </section>
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

/**
 * Feeding someone Down or a horse (`CONTEXT.md`: Reviving, Feeding a horse): whom, when there is
 * more than one, and how many units of the Food in the resident's hands to give them.
 */
export function FeedBlock({
  targets,
  food,
  onFeed,
}: {
  targets: { id: string; name: string; horse?: true; down?: true }[]
  /** The Food in the feeding resident's hands. */
  food: number
  onFeed: (targetId: string, units: number) => void
}) {
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '')
  const [units, setUnits] = useState(Math.max(1, Math.min(FEED_UNITS, food)))
  const target = targets.find((t) => t.id === targetId) ?? targets[0]
  const fine = !!target && Number.isInteger(units) && units >= 1 && units <= food
  function submit(e: FormEvent) {
    e.preventDefault()
    if (fine) onFeed(target.id, units)
  }
  return (
    <section className="inspector-block" aria-label="Feed">
      <div className="panel-head">
        <h3>Feed</h3>
        <span className="small muted">{food} Food in hand</span>
      </div>
      <form onSubmit={submit}>
        <div className="order-buttons">
          {targets.length > 1 && (
            <select
              aria-label="Whom to feed"
              value={target?.id ?? ''}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {feedTargetLabel(t)}
                </option>
              ))}
            </select>
          )}
          <input
            type="number"
            min={1}
            max={food}
            step={1}
            value={units}
            aria-label="Units of Food"
            onChange={(e) => setUnits(Number(e.target.value))}
          />
          <button type="submit" className="primary" disabled={!fine}>
            {targets.length > 1 ? 'Feed' : `Feed ${target?.name}`}
          </button>
        </div>
        <p className="small muted">
          {target?.horse
            ? 'It eats until it is full, up to that many units, and gets up if it was Down; the rest stays in hand.'
            : 'One unit is eaten at once and wakes them at low health; the rest goes in their hands.'}
        </p>
      </form>
    </section>
  )
}
