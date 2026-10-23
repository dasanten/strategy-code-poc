import { useEffect, type ReactNode } from 'react'
import { formatGameTime } from '@csp/shared'
import {
  DRAWERS,
  KEY_GOODS,
  isWide,
  type DrawerId,
  type KeyGood,
  type OpenDrawer,
} from './hud-view.js'
import type { ConnectionStatus } from './useWorld.js'

/** The HUD over the full-screen map (ADR 0008): top bar, tool rail, drawers and dialogs. */

/** Line-art icons, 24×24 in `currentColor`, for the rail and the top bar. */
const ICONS: Record<DrawerId | KeyGood | 'crown', ReactNode> = {
  residents: (
    <>
      <circle cx="12" cy="6" r="3.2" fill="currentColor" />
      <path d="M6 22c0-6 2.5-10 6-10s6 4 6 10z" fill="currentColor" />
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

/** The thin bar along the top: realm, game clock, connection, home city goods, Leader. */
export function TopBar({
  realm,
  cityName,
  tick,
  status,
  goods,
  leader,
  onLogout,
}: {
  realm: string
  cityName?: string
  tick?: number
  status: ConnectionStatus
  goods?: Record<KeyGood, number>
  leader?: string
  onLogout: () => void
}) {
  return (
    <header className="hud-top">
      <b title="Your realm">{realm}</b>
      {cityName && <span className="hud-muted">{cityName}</span>}
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
 * A drawer sliding over the map. Every drawer stays mounted and only the open one shows, so a
 * panel keeps what the Player typed into it, and the script library its list, while closed.
 */
export function Drawer({
  id,
  open,
  onClose,
  children,
}: {
  id: DrawerId
  open: OpenDrawer
  onClose: () => void
  children: ReactNode
}) {
  const label = DRAWERS.find((d) => d.id === id)!.label
  return (
    <section
      className={`hud-drawer${isWide(id) ? ' wide' : ''}`}
      aria-label={`${label} drawer`}
      hidden={open !== id}
    >
      <div className="hud-drawer-head">
        <h2>{label}</h2>
        <button type="button" onClick={onClose} aria-label={`Close ${label}`}>
          ✕
        </button>
      </div>
      {children}
    </section>
  )
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
