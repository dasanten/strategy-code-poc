import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { formatGameTime, type FirstDay, type TraderVisit } from '@csp/shared'
import { DrawerStatus } from './drawer-head.js'
import {
  DRAWERS,
  DRAWER_WIDTH,
  KEY_GOODS,
  drawerWidth,
  isWide,
  rememberedDrawerWidth,
  type DrawerId,
  type KeyGood,
  type OpenDrawer,
} from './hud-view.js'
import { groupSentLine, type Skipped } from './group-orders.js'
import { firstDayView, laneSpot, skippedByWhy, traderVisitLine } from './notices-view.js'
import type { ConnectionStatus } from './useWorld.js'
import { WIKI_PATH } from './wiki-view.js'

/** The HUD over the full-screen map (ADR 0008): top bar, tool rail, drawers and dialogs. */

/** Line-art icons, 24×24 in `currentColor`, for the rail and the top bar. */
const ICONS: Record<DrawerId | KeyGood | 'crown', ReactNode> = {
  residents: (
    <>
      <circle cx="12" cy="6" r="3.2" fill="currentColor" />
      <path d="M6 22c0-6 2.5-10 6-10s6 4 6 10z" fill="currentColor" />
    </>
  ),
  horses: (
    <>
      <path d="M7 22l2-7-4-2 1-4 6-6 1 3c3 1 6 5 6 9v7" />
      <path d="M12 3l3-1" />
      <circle cx="10" cy="8" r="0.8" fill="currentColor" />
    </>
  ),
  waypoints: (
    <>
      <path d="M12 22s-7-7.5-7-13a7 7 0 0 1 14 0c0 5.5-7 13-7 13z" />
      <circle cx="12" cy="9" r="2.5" fill="currentColor" />
    </>
  ),
  armies: (
    <>
      <path d="M6 22V2" />
      <path d="M6 3h13l-3 4 3 4H6z" fill="currentColor" />
    </>
  ),
  contracts: (
    <>
      <path d="M6 4h12v14a2 2 0 0 1-2 2H6" />
      <path d="M6 4a2 2 0 0 0 0 4h2M6 20a2 2 0 0 1 0-4h10" />
      <path d="M10 8h6M10 12h6" />
    </>
  ),
  directOffers: (
    <>
      <path d="M3 6h18v12H3z" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  alliance: (
    <>
      <path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" />
      <path d="M12 6v12M7 11h10" />
    </>
  ),
  standing: (
    <>
      <path d="M12 3v18M7 21h10M4 7h16" />
      <path d="M4 7l-3 7a3 3 0 0 0 6 0zM20 7l-3 7a3 3 0 0 0 6 0z" />
    </>
  ),
  cities: (
    <>
      <path d="M3 21V8h3v2h2V8h3v13M13 21V8h3v2h2V8h3v13" />
      <path d="M10 21v-4a2 2 0 0 1 4 0v4" />
      <path d="M2 21h20" />
    </>
  ),
  scripts: <path d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16" />,
  realmLog: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  food: (
    <>
      <path d="M12 22V8" />
      <path d="M12 9c-3-1-4-3-4-6 3 0 4 2 4 6zM12 9c3-1 4-3 4-6-3 0-4 2-4 6z" />
      <path d="M12 15c-3-1-4-3-4-5 3 0 4 2 4 5zM12 15c3-1 4-3 4-5-3 0-4 2-4 5z" />
    </>
  ),
  wood: (
    <>
      <ellipse cx="18" cy="12" rx="3" ry="5" />
      <path d="M18 7H6a3 5 0 0 0 0 10h12" />
    </>
  ),
  stone: (
    <>
      <path d="M3 19l3-7 5-2 3 3 2-1 5 7z" />
      <path d="M11 10l1 4-3 5" />
    </>
  ),
  coins: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
    </>
  ),
  crown: <path d="M3 18l1-11 5 5 3-7 3 7 5-5 1 11z" fill="currentColor" />,
}

const GOOD_LABELS: Record<KeyGood, string> = {
  food: 'Food',
  wood: 'Wood',
  stone: 'Stone',
  coins: 'Coins',
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  open: 'live',
  connecting: 'connecting…',
  closed: 'offline',
  throttled: 'too many requests',
}

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

/**
 * The thin bar along the top: the realm's name and home city, game clock, connection, home city
 * goods, Leader, and the Player's account by Log out.
 */
export function TopBar({
  realm,
  account,
  cityName,
  tick,
  status,
  goods,
  leader,
  onLogout,
  onWiki,
}: {
  /** The realm's name (`CONTEXT.md`: Realm name), once the world has come. */
  realm?: string
  account: string
  cityName?: string
  tick?: number
  status: ConnectionStatus
  goods?: Record<KeyGood, number>
  leader?: string
  onLogout: () => void
  /** The Wiki link was followed (`CONTEXT.md`: First day). */
  onWiki?: () => void
}) {
  return (
    <header className="hud-top">
      {realm && <b title="Your realm">{realm}</b>}
      {cityName && (
        <span className="hud-muted" title="Your home city">
          {realm && '· '}
          {cityName}
        </span>
      )}
      <span className="hud-sep" />
      {tick !== undefined && (
        <span
          className="hud-clock"
          title="1 game day = 24 real minutes; 1 game year = 420 game days = 1 real week"
        >
          {formatGameTime(tick)}
        </span>
      )}
      <span className={`hud-status ${status}`} title={tick !== undefined ? `tick ${tick}` : ''}>
        ● {STATUS_LABELS[status]}
      </span>
      <span className="hud-grow" />
      {goods && (
        <span className="hud-goods" aria-label={`Goods in ${cityName ?? 'your home city'}`}>
          {KEY_GOODS.map((g) => (
            <span key={g} className="hud-good" title={GOOD_LABELS[g]}>
              <Icon name={g} size={15} /> {Math.floor(goods[g])}
            </span>
          ))}
        </span>
      )}
      {leader && (
        <>
          <span className="hud-sep" />
          <span className="hud-leader" title="Your Leader">
            <Icon name="crown" size={15} /> {leader}
          </span>
        </>
      )}
      <span className="hud-sep" />
      {/* A new tab, so the game keeps running behind it (`CONTEXT.md`: Wiki). */}
      <a className="hud-wiki" href={WIKI_PATH} target="_blank" rel="noopener" onClick={onWiki}>
        Wiki
      </a>
      <span className="hud-muted" title="Your account">
        {account}
      </span>
      <button type="button" className="hud-logout" onClick={onLogout}>
        Log out
      </button>
    </header>
  )
}

/** The narrow icon rail on the left; each button opens its drawer over the map. */
export function ToolRail({
  open,
  onToggle,
}: {
  open: OpenDrawer
  onToggle: (id: DrawerId) => void
}) {
  return (
    <nav className="hud-rail" aria-label="Tools">
      {DRAWERS.map((d) => (
        <button
          key={d.id}
          type="button"
          className={open === d.id ? 'on' : ''}
          aria-pressed={open === d.id}
          aria-label={d.label}
          data-tip={d.label}
          onClick={() => onToggle(d.id)}
        >
          <Icon name={d.id} size={20} />
        </button>
      ))}
    </nav>
  )
}

/**
 * On a phone the tool rail and the top bar's goods, Leader, Wiki and Log out fold into one menu
 * button at the top left (ADR 0012); picking a drawer from it opens that drawer full-screen.
 */
export function PhoneMenu({
  open,
  onToggle,
  goods,
  cityName,
  leader,
  account,
  onLogout,
  onWiki,
}: {
  open: OpenDrawer
  onToggle: (id: DrawerId) => void
  goods?: Record<KeyGood, number>
  cityName?: string
  leader?: string
  account: string
  onLogout: () => void
  /** The Wiki link was followed (`CONTEXT.md`: First day). */
  onWiki?: () => void
}) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShown(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown])
  return (
    <>
      <button
        type="button"
        className="hud-menu-button"
        aria-label="Menu"
        aria-expanded={shown}
        onClick={() => setShown((s) => !s)}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {shown && (
        <>
          <div className="hud-menu-backdrop" onClick={() => setShown(false)} />
          <nav className="hud-menu" aria-label="Menu">
            {DRAWERS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={open === d.id ? 'on' : ''}
                aria-pressed={open === d.id}
                onClick={() => {
                  onToggle(d.id)
                  setShown(false)
                }}
              >
                <Icon name={d.id} size={18} /> {d.label}
              </button>
            ))}
            {goods && (
              <div
                className="hud-menu-goods"
                aria-label={`Goods in ${cityName ?? 'your home city'}`}
              >
                {KEY_GOODS.map((g) => (
                  <span key={g} className="hud-good" title={GOOD_LABELS[g]}>
                    <Icon name={g} size={15} /> {Math.floor(goods[g])}
                  </span>
                ))}
              </div>
            )}
            {leader && (
              <span className="hud-leader" title="Your Leader">
                <Icon name="crown" size={15} /> {leader}
              </span>
            )}
            <div className="hud-menu-links">
              <a
                className="hud-wiki"
                href={WIKI_PATH}
                target="_blank"
                rel="noopener"
                onClick={onWiki}
              >
                Wiki
              </a>
              <span className="hud-account" title="Your account">
                {account}
              </span>
              <button type="button" className="hud-logout" onClick={onLogout}>
                Log out
              </button>
            </div>
          </nav>
        </>
      )}
    </>
  )
}

/**
 * A drawer sliding over the map. Every drawer stays mounted and only the open one shows, so a
 * panel keeps what the Player typed into it, and the script library its list, while closed.
 */
export function Drawer({
  id,
  open,
  onClose,
  full = false,
  children,
}: {
  id: DrawerId
  open: OpenDrawer
  onClose: () => void
  /** Across the whole screen, whatever the drawer's usual width (the full Residents list). */
  full?: boolean
  children: ReactNode
}) {
  const label = DRAWERS.find((d) => d.id === id)!.label
  // Where the panel's head puts its count, right of the title (`PanelHead`).
  const [status, setStatus] = useState<HTMLElement | null>(null)
  return (
    <section
      className={`hud-drawer${isWide(id) || full ? ' wide' : ''}${full ? ' full' : ''}`}
      aria-label={`${label} drawer`}
      hidden={open !== id}
    >
      <div className="hud-drawer-head">
        <h2>{label}</h2>
        <span className="hud-drawer-status" ref={setStatus} />
        <button type="button" onClick={onClose} aria-label={`Close ${label}`}>
          ✕
        </button>
      </div>
      <DrawerStatus.Provider value={status}>{children}</DrawerStatus.Provider>
    </section>
  )
}

/** Where the browser remembers how wide the Player dragged the drawers. */
const WIDTH_KEY = 'csp.drawerWidth'

function rememberedWidth(): number {
  try {
    return rememberedDrawerWidth(localStorage.getItem(WIDTH_KEY))
  } catch {
    return DRAWER_WIDTH.initial
  }
}

function rememberWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // Without storage it just isn't remembered.
  }
}

/** How far one arrow key press moves the drawer's edge. */
const KEY_STEP = 16

/**
 * The drag handle on the open drawer's right edge: it sets every (not wide) drawer's width, as
 * `--drawer-w` on the page, within `DRAWER_WIDTH`. The width is remembered in the browser; a
 * double click goes back to the initial one. It keeps its own state, so a drag re-renders only it.
 */
export function DrawerEdge({ open }: { open: OpenDrawer }) {
  const [width, setWidth] = useState(rememberedWidth)
  const dragging = useRef(false)

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--drawer-w', `${width}px`)
  }, [width])

  if (!open || isWide(open)) return null
  const settle = (to: number) => {
    setWidth(to)
    rememberWidth(to)
  }
  // The rail fixes the drawer's left edge; the pointer is where its right edge goes.
  const toPointer = (x: number) =>
    drawerWidth(
      x - (document.querySelector('.hud-drawer:not([hidden])')?.getBoundingClientRect().left ?? 0),
    )
  return (
    <div
      className="hud-drawer-edge"
      role="separator"
      aria-orientation="vertical"
      aria-label="Drawer width"
      aria-valuemin={DRAWER_WIDTH.min}
      aria-valuemax={DRAWER_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = true
      }}
      onPointerMove={(e) => {
        if (dragging.current) setWidth(toPointer(e.clientX))
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        settle(toPointer(e.clientX))
      }}
      onPointerCancel={() => {
        dragging.current = false
        rememberWidth(width)
      }}
      onDoubleClick={() => settle(DRAWER_WIDTH.initial)}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0
        if (!step) return
        e.preventDefault()
        settle(drawerWidth(width + step))
      }}
    />
  )
}

/**
 * How many pixels of the map the open drawer covers from the left and the selection card from
 * the right, 0 for each that isn't showing. The map fills the window, so screen edges measure it.
 */
export function mapCovered(): { left: number; right: number } {
  // A bottom sheet covers the bottom of the map, not its right side; a hidden card none of it.
  const card = document
    .querySelector('.game-selection:not(.sheet):not([hidden])')
    ?.getBoundingClientRect()
  return {
    left: document.querySelector('.hud-drawer:not([hidden])')?.getBoundingClientRect().right ?? 0,
    right: card ? window.innerWidth - card.left : 0,
  }
}

/** Closes the open drawer on Escape, unless the Player is typing somewhere. */
export function useEscapeCloses(open: OpenDrawer, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof Element && e.target.closest('input, textarea, select, .cm-editor')
      if (e.key === 'Escape' && !typing) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])
}

/** A dialog in the middle of the screen, over a dimmed map. */
export function CentredDialog({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="hud-backdrop">
      <div className="hud-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** A small number as a capitalised word, for a sentence's start; larger ones stay digits. */
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six']

/**
 * The Horse offer's notice under the top bar (`CONTEXT.md`: Horse offer): shown while the Player
 * may claim it; `onClaim` sends the claim and answers with the server's refusal, if any.
 */
export function HorseOfferNotice({
  horses,
  onClaim,
}: {
  horses: number
  onClaim: () => Promise<string | undefined>
}) {
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string>()
  async function claim() {
    setBusy(true)
    const reason = await onClaim()
    setRefused(reason)
    // On success the notice goes once the server says the offer is claimed, a tick later.
    if (reason) setBusy(false)
  }
  return (
    <aside className="notice hud-offer" role="status">
      <span className="notice-text">
        {NUMBER_WORDS[horses] ?? horses} horses are waiting for you
        {refused && <span className="hud-offer-refused"> — {refused}</span>}
      </span>
      <button type="button" disabled={busy} onClick={() => void claim()}>
        Claim
      </button>
    </aside>
  )
}

/**
 * What others sent the Player and they haven't seen yet (`CONTEXT.md`: Notices): who sent what.
 * Opening its drawer or dismissing it puts it away; the things themselves wait in the drawer.
 */
export function IncomingNotice({
  line,
  onOpen,
  onDismiss,
}: {
  line: string
  onOpen: () => void
  onDismiss: () => void
}) {
  return (
    <aside className="notice incoming-notice" role="status">
      <span className="notice-text" title={line}>
        {line}
      </span>
      <button type="button" onClick={onOpen}>
        Open
      </button>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </aside>
  )
}

/** The gap, in pixels, above and below the lane while it is a band across the screen. */
const BAND_PAD = 6

/**
 * The lane under the top bar every notice shows in (`CONTEXT.md`: Notices): one stack, centred
 * over the map between the open drawer and the card and never over either (`laneSpot`). While it
 * is a band across the screen (on a phone, or with too little map between them) it sets
 * `--lane-h` on the game, and the drawers and the card start below it.
 */
export function NoticeLane({ phone, children }: { phone: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<{ left: number; right: number; band: boolean }>()
  const watch = useRef<ResizeObserver>(undefined)
  const place = useRef(() => {})
  place.current = () => {
    const lane = ref.current
    const game = lane?.closest<HTMLElement>('.game')
    if (!lane || !game) return
    const rail = parseFloat(getComputedStyle(game).getPropertyValue('--rail-w')) || 0
    const next = laneSpot(window.innerWidth, rail, mapCovered(), phone)
    setSpot((was) =>
      was && was.left === next.left && was.right === next.right && was.band === next.band
        ? was
        : next,
    )
    const height = next.band && lane.offsetHeight ? lane.offsetHeight + 2 * BAND_PAD : 0
    game.style.setProperty('--lane-h', `${height}px`)
  }
  useEffect(() => {
    const lane = ref.current
    const again = () => place.current()
    watch.current = new ResizeObserver(again)
    window.addEventListener('resize', again)
    return () => {
      watch.current?.disconnect()
      window.removeEventListener('resize', again)
      lane?.closest<HTMLElement>('.game')?.style.removeProperty('--lane-h')
    }
  }, [])
  // Drawers, cards and notices come and go with the game's renders, and so the lane's; a drawer
  // dragged wider or a notice growing shows only in their sizes.
  useLayoutEffect(() => {
    place.current()
    const lane = ref.current
    const w = watch.current
    if (!lane || !w) return
    w.disconnect()
    w.observe(lane)
    for (const el of document.querySelectorAll('.hud-drawer, .game-selection')) w.observe(el)
  })
  return (
    <div
      ref={ref}
      className={`notice-lane${spot?.band ? ' band' : ''}`}
      style={spot && { left: spot.left, right: spot.right }}
    >
      {children}
    </div>
  )
}

/**
 * A group order's report in the lane (`CONTEXT.md`: Group, Notices): how many it went to and who
 * was skipped or turned down and why, until the Player dismisses it or gives the next order.
 */
/**
 * A wandering trader standing at one of the realm's cities (`CONTEXT.md`: Trader stop, Notices): the
 * place, with a way to see it and to open the city's Trade section there.
 */
export function TraderVisitNotice({
  visit,
  tick,
  onShow,
  onTrade,
  onDismiss,
}: {
  visit: TraderVisit
  tick: number
  onShow: () => void
  onTrade: () => void
  onDismiss: () => void
}) {
  return (
    <aside className="notice trader-visit" role="status">
      <span className="notice-text">{traderVisitLine(visit, tick)}</span>
      <span className="notice-actions">
        <button type="button" onClick={onShow}>
          Show
        </button>
        <button type="button" onClick={onTrade}>
          Trade
        </button>
        <button
          type="button"
          aria-label={`Dismiss the trader at ${visit.city}`}
          onClick={onDismiss}
        >
          OK
        </button>
      </span>
    </aside>
  )
}

export function GroupReportNotice({
  report,
  onDismiss,
}: {
  report: { sent: number; of: number; skipped: Skipped[] }
  onDismiss: () => void
}) {
  const sent = groupSentLine(report.sent, report.of)
  const skipped = skippedByWhy(report.skipped)
  return (
    <aside
      className={`notice group-report${skipped.length ? ' skipped' : ''}`}
      role="status"
      aria-label="Last group order"
      title={[sent, ...skipped.map((s) => `Skipped ${s.names.join(', ')}: ${s.why}`)].join('\n')}
    >
      <span className="notice-text">
        {sent}
        {skipped.map((s) => (
          <span key={s.why}>
            {' · '}Skipped <strong>{s.names.join(', ')}</strong>: {s.why}
          </span>
        ))}
      </span>
      <button type="button" aria-label="Dismiss the group order's report" onClick={onDismiss}>
        OK
      </button>
    </aside>
  )
}

/**
 * The first-day card in the lane, under the Horse offer (`CONTEXT.md`: First day): a new realm's
 * checklist, each line ticked once the game sees it done, with ✕ to dismiss it for good. On a
 * phone it is one line: how far along, and the first line still to do.
 */
export function FirstDayCard({
  card,
  onWiki,
  onDismiss,
}: {
  card: FirstDay
  onWiki: () => void
  onDismiss: () => void
}) {
  const { lines, next, ticked } = firstDayView(card)
  return (
    <aside className="notice first-day" aria-label="First day">
      <div className="notice-text">
        <strong>First day</strong>{' '}
        <span className="first-day-count">
          {ticked} of {lines.length}
        </span>
        <ul>
          {lines.map((l) => (
            <li
              key={l.line}
              className={l.done ? 'done' : l.line === next ? 'next' : undefined}
              aria-label={l.done ? `${l.label}: done` : undefined}
            >
              <span className="first-day-tick" aria-hidden="true">
                {l.done ? '✓' : '○'}
              </span>{' '}
              {l.line === 'openWiki' ? (
                // A new tab, so the game keeps running behind it (`CONTEXT.md`: Wiki).
                <a href={WIKI_PATH} target="_blank" rel="noopener" onClick={onWiki}>
                  {l.label}
                </a>
              ) : (
                l.label
              )}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="first-day-dismiss"
        aria-label="Don't show again"
        title="Don't show again"
        onClick={onDismiss}
      >
        ✕
      </button>
    </aside>
  )
}
