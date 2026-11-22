import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { DrawerStatus } from './drawer-head.js'
import { NONE_MARKED, UnseenMark } from './Hud.js'
import { Icon } from './Icon.js'
import { TAB_ICONS } from './ui-icons.js'
import {
  SIDE_TABS,
  SIDE_WIDTH,
  isScreen,
  rememberedSidebar,
  rememberedSideWidth,
  sideWidth,
  sidebarGroups,
  sidebarToKeep,
  type OpenTab,
  type Sidebar as SidebarState,
  type SideTabId,
} from './hud-view.js'
import { PHONE_QUERY } from './sheet-view.js'

/**
 * The sidebar on the left of the game screen (ADR 0044; `CONTEXT.md`: Screen): a strip of tabs in
 * the groups People, Diplomacy and Realm, and beside it the open tab's panel with its head and
 * count. One tab is open at a time; the fold button, Escape or the open tab's button fold it to
 * its strip. On a phone the strip gives way to the menu button and a tab fills the screen under
 * the top bar.
 *
 * Every tab's content is a `SideTab` child, mounted always and shown only while open, so a panel
 * keeps what the Player typed into it while folded. The Scripts tab is a screen (`isScreen`): its
 * button opens the script workshop over the map, and the sidebar stays folded behind it.
 */

/** What a `SideTab` needs from its sidebar. */
interface Frame {
  open: OpenTab
  close: () => void
  phone: boolean
}

const SideFrame = createContext<Frame>({ open: undefined, close: () => {}, phone: false })

export function Sidebar({
  open,
  marked = NONE_MARKED,
  phone,
  full = false,
  onToggle,
  onFold,
  onClose,
  children,
}: {
  open: OpenTab
  /** The tabs holding something the Player hasn't seen (`unseenMarks`). */
  marked?: ReadonlySet<SideTabId>
  phone: boolean
  /** The open tab across the whole screen beside the strip (the full Residents list). */
  full?: boolean
  /** A tab on the strip was clicked (`toggleTab`). */
  onToggle: (id: SideTabId) => void
  /** The strip's fold button (`foldOrUnfold`). */
  onFold: () => void
  /** The open tab's ✕ on a phone, where there is no strip. */
  onClose: () => void
  /** The `SideTab`s, in any order: the strip has its own. */
  children: ReactNode
}) {
  // A screen (the script workshop) opens over the whole map, not in the panel: behind it the
  // sidebar stays folded to its strip, with the screen's button pressed.
  const panel = open !== undefined && !isScreen(open) ? open : undefined
  const className = ['side pn', panel ? 'unfolded' : 'folded', panel && full && 'full']
    .filter(Boolean)
    .join(' ')
  return (
    <aside className={className} aria-label="Sidebar">
      {!phone && <SideStrip open={open} marked={marked} onToggle={onToggle} onFold={onFold} />}
      <SideFrame.Provider value={{ open: panel, close: onClose, phone }}>
        {children}
      </SideFrame.Provider>
      {!phone && panel && !full && <SideEdge />}
    </aside>
  )
}

/** The strip of tabs, a divider between the groups, and the fold button at its foot. */
function SideStrip({
  open,
  marked,
  onToggle,
  onFold,
}: {
  open: OpenTab
  marked: ReadonlySet<SideTabId>
  onToggle: (id: SideTabId) => void
  onFold: () => void
}) {
  return (
    <nav className="side-strip" aria-label="Tools">
      {sidebarGroups().map((g, i) => (
        <div key={g.id} className="side-group" role="group" aria-label={g.label}>
          {i > 0 && <hr className="side-divider" aria-hidden="true" />}
          {g.tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={open === t.id ? 'btn sq on' : 'btn sq'}
              aria-pressed={open === t.id}
              aria-label={marked.has(t.id) ? `${t.label}, something new` : t.label}
              data-tip={t.label}
              onClick={() => onToggle(t.id)}
            >
              <Icon name={TAB_ICONS[t.id]} />
              {marked.has(t.id) && <UnseenMark />}
            </button>
          ))}
        </div>
      ))}
      <span className="grow" />
      <button
        type="button"
        className="side-fold btn sm sq"
        aria-label={open ? 'Fold the sidebar' : 'Unfold the sidebar'}
        aria-expanded={open !== undefined}
        title={open ? 'Fold the sidebar (Esc)' : 'Unfold the sidebar'}
        onClick={onFold}
      >
        {open ? '«' : '»'}
      </button>
    </nav>
  )
}

/**
 * One tab's panel in the sidebar: its head (the tab's name and, right of it, the count a
 * `PanelHead` inside puts there) and its content under it, which scrolls.
 */
export function SideTab({ id, children }: { id: SideTabId; children: ReactNode }) {
  const { open, close, phone } = useContext(SideFrame)
  const label = SIDE_TABS.find((t) => t.id === id)!.label
  // Where the panel's head puts its count, right of the title (`PanelHead`).
  const [status, setStatus] = useState<HTMLElement | null>(null)
  return (
    <section className="side-panel" data-tab={id} aria-label={label} hidden={open !== id}>
      <div className="side-head hd">
        <h2>{label}</h2>
        <span className="side-status" ref={setStatus} />
        {phone && (
          <button type="button" className="btn sm sq" onClick={close} aria-label={`Close ${label}`}>
            ✕
          </button>
        )}
      </div>
      <div className="side-body">
        <DrawerStatus.Provider value={status}>{children}</DrawerStatus.Provider>
      </div>
    </section>
  )
}

/** Where the browser keeps the sidebar (`sidebarToKeep`) and its panel's width. */
const SIDEBAR_KEY = 'csp.sidebar'
// The drawers' key: a width dragged before the sidebar carries over.
const WIDTH_KEY = 'csp.drawerWidth'

function kept(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function keep(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Without storage it just isn't kept.
  }
}

/**
 * The sidebar's state, as the browser kept it from the last visit (folded on a phone), and kept
 * again whenever a tab opens or it folds.
 */
export function useSidebar(): [SidebarState, Dispatch<SetStateAction<SidebarState>>] {
  const [sidebar, setSidebar] = useState(() =>
    rememberedSidebar(kept(SIDEBAR_KEY), window.matchMedia?.(PHONE_QUERY).matches ?? false),
  )
  const toKeep = sidebarToKeep(sidebar)
  useEffect(() => keep(SIDEBAR_KEY, toKeep), [toKeep])
  return [sidebar, setSidebar]
}

/** How far one arrow key press moves the panel's edge. */
const KEY_STEP = 16

/**
 * The drag handle on the open panel's right edge: it sets the (not wide) panel's width, as
 * `--side-w` on the page, within `SIDE_WIDTH`. The width is kept in the browser; a double click
 * goes back to the initial one. It keeps its own state, so a drag re-renders only it.
 */
function SideEdge() {
  const [width, setWidth] = useState(() => rememberedSideWidth(kept(WIDTH_KEY)))
  const dragging = useRef(false)

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--side-w', `${width}px`)
  }, [width])

  const settle = (to: number) => {
    setWidth(to)
    keep(WIDTH_KEY, String(to))
  }
  // The strip fixes the panel's left edge; the pointer is where its right edge goes.
  const toPointer = (x: number) =>
    sideWidth(
      x - (document.querySelector('.side-panel:not([hidden])')?.getBoundingClientRect().left ?? 0),
    )
  return (
    <div
      className="side-edge"
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      aria-valuemin={SIDE_WIDTH.min}
      aria-valuemax={SIDE_WIDTH.max}
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
        keep(WIDTH_KEY, String(width))
      }}
      onDoubleClick={() => settle(SIDE_WIDTH.initial)}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0
        if (!step) return
        e.preventDefault()
        settle(sideWidth(width + step))
      }}
    />
  )
}
