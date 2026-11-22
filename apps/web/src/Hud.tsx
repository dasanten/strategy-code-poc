import {
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { formatGameTime } from './shared/time.js'
import type { FirstDay, TraderVisit } from '@csp/shared-types'
import { DrawerStatus } from './drawer-head.js'
import { zealShown } from './zeal.js'
import {
  REALM_BAR_HINT,
  REALM_BAR_ORDERS,
  type ControlMode,
  type RealmBarOrder,
} from './control-mode.js'
import {
  DIPLOMACY_TABS,
  sidebarGroups,
  KEY_GOODS,
  goodsLabel,
  type DiplomacyTab,
  type SideTabId,
  type GoodsPick,
  type KeyGood,
  type OpenTab,
} from './hud-view.js'
import { groupSentLine, type Skipped } from './group-orders.js'
import {
  FIRST_DAY_RALLY_TIP,
  firstDayView,
  laneSpot,
  skippedByWhy,
  traderVisitLine,
} from './notices-view.js'
import type { ConnectionStatus } from './useWorld.js'
import { WIKI_PATH } from './wiki-view.js'

/**
 * The HUD over the full-screen map (ADR 0044): the top bar, notices and dialogs; the sidebar is in
 * `Sidebar.tsx`.
 */

/** Line-art icons, 24×24 in `currentColor`, for the sidebar and the top bar. */
const ICONS: Record<SideTabId | DiplomacyTab | KeyGood | 'crown', ReactNode> = {
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
  diplomacy: (
    <>
      <path d="M3 5h12v8H8l-3 3v-3H3z" />
      <path d="M17 9h4v8h-2v3l-3-3h-5v-2" />
    </>
  ),
  demands: (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M12 7v7" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
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
  coal: (
    <>
      <path d="M3 19l2-6 5-2 3 3-1 5z" />
      <path d="M12 19l2-7 5-1 2 8z" />
      <path d="M8 9l2-4 4-1 2 4-3 2z" />
    </>
  ),
  steel: (
    <>
      <path d="M3 19l3-6h12l3 6z" />
      <path d="M9 16h6" />
      <path d="M18 3v4M16 5h4" />
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
  coal: 'Coal',
  steel: 'Steel',
  coins: 'Coins',
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  open: 'live',
  connecting: 'connecting…',
  closed: 'offline',
  throttled: 'too many requests',
  updated: 'updated',
}

/** The kit chip each connection state shows as: live green, on its way gold, else red. */
const STATUS_CHIPS: Record<ConnectionStatus, string> = {
  open: 'g',
  connecting: 'y',
  closed: 'r',
  throttled: 'r',
  updated: 'r',
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

/** The goods the top bar shows and the picker beside them (`CONTEXT.md`: Goods in the top bar). */
export interface GoodsShown {
  totals: Record<KeyGood, number>
  /** How old part of the totals is, in words; null when all of it is in sight now. */
  oldText: string | null
  /** The cities of the realm to pick from, by name. */
  cities: readonly { id: string; name: string }[]
  pick: GoodsPick
  onPick: (pick: GoodsPick) => void
}

/** The goods and their picker, in the top bar and the phone menu alike. */
function Goods({ goods, className }: { goods: GoodsShown; className: string }) {
  const label = goodsLabel(goods.pick, goods.cities, goods.oldText)
  return (
    <div className={className} role="group" aria-label={label}>
      <select
        className="hud-goods-pick"
        aria-label="Show the goods of"
        value={goods.pick ?? ''}
        onChange={(e) => goods.onPick(e.target.value || null)}
      >
        <option value="">Entire realm</option>
        {goods.cities.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {KEY_GOODS.map((g) => (
        <span key={g} className="hud-good mono" title={GOOD_LABELS[g]}>
          <Icon name={g} size={16} /> {Math.floor(goods.totals[g])}
        </span>
      ))}
      {/* The label above says it for those who can't see this. */}
      {goods.oldText && (
        <span className="hud-goods-old" title={goods.oldText} aria-hidden="true">
          <span className="hud-goods-old-mark mono">≈</span>
          <span className="hud-goods-old-words">{goods.oldText}</span>
        </span>
      )}
    </div>
  )
}

/**
 * The thin bar along the top: the realm's name and home city, game clock, connection, the goods
 * of the realm or a city picked beside them, Leader, and the Player's account by Log out.
 */
export function TopBar({
  realm,
  account,
  cityName,
  tick,
  status,
  goods,
  leader,
  heir,
  onPickHeir,
  onLogout,
  onWiki,
  control,
  zeal,
  zealDraining,
}: {
  /** The realm's name (`CONTEXT.md`: Realm name), once the world has come. */
  realm?: string
  account: string
  cityName?: string
  tick?: number
  status: ConnectionStatus
  goods?: GoodsShown
  leader?: string
  /** The heir's name, null with none (`CONTEXT.md`: Heir); absent before the world comes. */
  heir?: string | null
  /** Opens the Residents list to name an heir. */
  onPickHeir?: () => void
  onLogout: () => void
  /** The Wiki link was followed (`CONTEXT.md`: First day). */
  onWiki?: () => void
  /** The Unit | Realm switch (`CONTEXT.md`: Control mode), once the world has come. */
  control?: { mode: ControlMode; onSwitch: (mode: ControlMode) => void }
  /** The Player's own Zeal in game hours (`CONTEXT.md`: Zeal), once the world has come. */
  zeal?: number
  /** The Leader rallies the crew: the Zeal doesn't fill and drains while the crew works (`CONTEXT.md`: Zeal). */
  zealDraining?: boolean
}) {
  return (
    <header className="hud-top bar">
      {control && <ControlSwitch {...control} />}
      {realm && (
        <span className="hud-realm px t18" title="Your realm">
          {realm}
        </span>
      )}
      {cityName && (
        <span className="hud-muted" title="Your home city">
          {realm && '· '}
          {cityName}
        </span>
      )}
      {tick !== undefined && (
        <span
          className="hud-clock mono"
          title="1 game day = 24 real minutes; 1 game year = 420 game days = 1 real week"
        >
          {formatGameTime(tick)}
        </span>
      )}
      <span
        className={`hud-status chip ${STATUS_CHIPS[status]}`}
        title={tick !== undefined ? `tick ${tick}` : ''}
      >
        {STATUS_LABELS[status]}
      </span>
      <span className="grow" />
      {goods && <Goods goods={goods} className="hud-goods" />}
      {leader && (
        <span className="hud-leader" title="Your Leader">
          <Icon name="crown" size={16} /> {leader}
        </span>
      )}
      {zeal !== undefined && <ZealMeter zeal={zeal} draining={zealDraining} />}
      {heir !== undefined && <HeirShown heir={heir} onPickHeir={onPickHeir} />}
      {/* A new tab, so the game keeps running behind it (`CONTEXT.md`: Wiki). */}
      <a
        className="hud-wiki btn sm dk"
        href={WIKI_PATH}
        target="_blank"
        rel="noopener"
        onClick={onWiki}
      >
        Wiki
      </a>
      <span className="hud-muted" title="Your account">
        {account}
      </span>
      <button type="button" className="hud-logout btn sm dk" onClick={onLogout}>
        Log out
      </button>
    </header>
  )
}

/** The Player's Zeal in the top bar (`CONTEXT.md`: Zeal): how full, and about how long until full. */
export function ZealMeter({ zeal, draining = false }: { zeal: number; draining?: boolean }) {
  const shown = zealShown(zeal, draining)
  return (
    <span className={`hud-zeal${shown.draining ? ' draining' : ''}`} title={shown.title}>
      <span aria-hidden="true">Zeal</span>
      <span
        className="hud-zeal-bar mt bl"
        role="meter"
        aria-label="Zeal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(shown.share * 100)}
      >
        <span className="hud-zeal-fill" style={{ width: `${shown.share * 100}%` }} />
      </span>
      <span className="mono">{shown.label}</span>
    </span>
  )
}

/**
 * The Unit | Realm switch at the start of the top bar (`CONTEXT.md`: Control mode), on a phone
 * too; Tab flips it as well.
 */
function ControlSwitch({
  mode,
  onSwitch,
}: {
  mode: ControlMode
  onSwitch: (mode: ControlMode) => void
}) {
  const option = (m: ControlMode, label: string, title: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      className={mode === m ? 'btn sm on' : 'btn sm dk'}
      title={title}
      onClick={() => onSwitch(m)}
    >
      {label}
    </button>
  )
  return (
    <span className="hud-control" role="radiogroup" aria-label="Control mode (Tab)">
      {option('unit', 'Unit', 'Unit control: pick residents, then say what they do (Tab)')}
      {option('realm', 'Realm', 'Realm control: say what is to be done and where, then who (Tab)')}
      <span className="hud-control-key k" aria-hidden="true">
        Tab
      </span>
    </span>
  )
}

/**
 * The realm bar over the map in realm control mode (`CONTEXT.md`: Realm order): where the orders
 * that begin with a kind or a place start, beside a line on what the mode is for.
 */
export function RealmBar({
  open,
  onOpen,
}: {
  /** The realm bar's order being given, if one is. */
  open: RealmBarOrder | undefined
  /** Starts the order, or with it open already, drops it. */
  onOpen: (order: RealmBarOrder) => void
}) {
  return (
    <div className="hud-realm-bar bar" role="toolbar" aria-label="Realm orders">
      {REALM_BAR_ORDERS.map(({ id, label, title }) => (
        <button
          key={id}
          type="button"
          className={open === id ? 'on' : undefined}
          aria-pressed={open === id}
          title={title}
          onClick={() => onOpen(id)}
        >
          {label}
        </button>
      ))}
      <span className="hud-realm-bar-hint">{REALM_BAR_HINT}</span>
    </div>
  )
}

/** No tab marked. */
export const NONE_MARKED: ReadonlySet<never> = new Set()

/** The small mark on a sidebar tab or Diplomacy tab that holds something the Player hasn't seen. */
export function UnseenMark() {
  return <span className="unseen-mark" aria-hidden="true" />
}

/**
 * On a phone the sidebar's strip and the top bar's goods, Leader, Wiki and Log out fold into one
 * menu button at the top left (ADR 0012); picking a tab from it opens that tab full-screen.
 */
export function PhoneMenu({
  open,
  onToggle,
  marked = NONE_MARKED,
  goods,
  leader,
  heir,
  onPickHeir,
  account,
  onLogout,
  onWiki,
}: {
  open: OpenTab
  onToggle: (id: SideTabId) => void
  /** The tabs holding something the Player hasn't seen (`unseenMarks`). */
  marked?: ReadonlySet<SideTabId>
  goods?: GoodsShown
  leader?: string
  /** The heir's name, null with none (`CONTEXT.md`: Heir); absent before the world comes. */
  heir?: string | null
  /** Opens the Residents list to name an heir. */
  onPickHeir?: () => void
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
        aria-label={marked.size > 0 ? 'Menu, something new' : 'Menu'}
        aria-expanded={shown}
        onClick={() => setShown((s) => !s)}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        {marked.size > 0 && <UnseenMark />}
      </button>
      {shown && (
        <>
          <div className="hud-menu-backdrop" onClick={() => setShown(false)} />
          <nav className="hud-menu pn" aria-label="Menu">
            {sidebarGroups().map((g) => (
              <Fragment key={g.id}>
                <h2 className="hud-menu-heading">{g.label}</h2>
                {g.tabs.map((d) => (
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
                    {marked.has(d.id) && <UnseenMark />}
                  </button>
                ))}
              </Fragment>
            ))}
            {goods && <Goods goods={goods} className="hud-menu-goods" />}
            {leader && (
              <span className="hud-leader" title="Your Leader">
                <Icon name="crown" size={15} /> {leader}
              </span>
            )}
            {heir !== undefined && (
              <HeirShown
                heir={heir}
                onPickHeir={() => {
                  setShown(false)
                  onPickHeir?.()
                }}
              />
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
              <button type="button" className="hud-logout btn sm dk" onClick={onLogout}>
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
 * The Diplomacy drawer's tabs (`CONTEXT.md`: Tool rail). Every tab's panel stays mounted and only
 * the picked one shows, so a panel keeps what the Player typed into it; only that one puts its
 * count beside the drawer's title.
 */
export function DiplomacyTabs({
  tab,
  onTab,
  marked = NONE_MARKED,
  panels,
}: {
  tab: DiplomacyTab
  onTab: (tab: DiplomacyTab) => void
  /** The tabs holding something the Player hasn't seen (`unseenMarks`). */
  marked?: ReadonlySet<DiplomacyTab>
  panels: Record<DiplomacyTab, ReactNode>
}) {
  const status = useContext(DrawerStatus)
  return (
    <>
      <div className="tabs diplomacy-tabs" role="tablist" aria-label="Diplomacy">
        {DIPLOMACY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`diplomacy-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`diplomacy-panel-${t.id}`}
            className={tab === t.id ? 'tab on' : 'tab'}
            onClick={() => onTab(t.id)}
          >
            <Icon name={t.id} size={15} /> {t.label}
            {marked.has(t.id) && <UnseenMark />}
          </button>
        ))}
      </div>
      {DIPLOMACY_TABS.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`diplomacy-panel-${t.id}`}
          aria-labelledby={`diplomacy-tab-${t.id}`}
          hidden={tab !== t.id}
        >
          <DrawerStatus.Provider value={tab === t.id ? status : null}>
            {panels[t.id]}
          </DrawerStatus.Provider>
        </div>
      ))}
    </>
  )
}

/**
 * How many pixels of the map the sidebar covers from the left (its strip alone while folded) and
 * the selection card from the right, 0 for each that isn't showing; and how many the strip alone
 * covers, all the sidebar leaves when folded. The map fills the window, so screen edges measure it.
 */
export function mapCovered(): { left: number; right: number; strip: number } {
  // A bottom sheet and the command bar (`.game-command`) cover the bottom of the map, not its right
  // side; a hidden card none of it. Only a tile card or realm order card covers the right.
  const card = document
    .querySelector('.game-selection:not(.sheet):not([hidden])')
    ?.getBoundingClientRect()
  // A folded sidebar on a phone isn't drawn, and measures 0.
  const side = document.querySelector('.side')?.getBoundingClientRect()
  const strip = document.querySelector('.side-strip')?.getBoundingClientRect()
  return {
    left: side?.right ?? 0,
    right: card ? window.innerWidth - card.left : 0,
    strip: strip && strip.width > 0 ? strip.right : 0,
  }
}

/** Folds the open sidebar on Escape, unless the Player is typing somewhere. */
export function useEscapeCloses(open: OpenTab, close: () => void) {
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

/**
 * A dialog in the middle of the screen, over a dimmed map. Its header bar says what kind of news
 * it is: `bad` (red, with a warning sign) for a loss, `news` (navy) for word from the game.
 */
export function CentredDialog({
  title,
  tone,
  children,
}: {
  title: string
  tone?: 'bad' | 'news'
  children: ReactNode
}) {
  return (
    <div className="hud-backdrop">
      <div className="hud-dialog pn" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className={`hd${tone ? ` hd-${tone}` : ''}`}>
          {tone === 'bad' && <span className="ic s24 i-warn" aria-hidden="true" />}
          <span className="grow">{title}</span>
        </h2>
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
    <aside className="pn notice hud-offer" role="status">
      <span className="ic s24 i-horse" aria-hidden="true" />
      <span className="notice-text b">
        {NUMBER_WORDS[horses] ?? horses} horses are waiting for you
        {refused && <span className="hud-offer-refused"> — {refused}</span>}
      </span>
      <button type="button" className="btn sm gold" disabled={busy} onClick={() => void claim()}>
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
    <aside className="pn notice incoming-notice" role="status">
      <span className="notice-text" title={line}>
        {line}
      </span>
      <button type="button" className="btn sm" onClick={onOpen}>
        Open
      </button>
      <button type="button" className="btn sm sq" aria-label="Dismiss" onClick={onDismiss}>
        <span className="ic s16 i-x" aria-hidden="true" />
      </button>
    </aside>
  )
}

/** The gap, in pixels, above and below the lane while it is a band across the screen. */
const BAND_PAD = 6

/**
 * The lane under the top bar every notice shows in (`CONTEXT.md`: Notices): one stack, centred
 * over the map between the sidebar and the card and never over either (`laneSpot`). While it
 * is a band across the screen (on a phone, or with too little map between them) it sets
 * `--lane-h` on the game, and the sidebar and the card start below it.
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
  // The sidebar, cards and notices come and go with the game's renders, and so the lane's; a panel
  // dragged wider or a notice growing shows only in their sizes.
  useLayoutEffect(() => {
    place.current()
    const lane = ref.current
    const w = watch.current
    if (!lane || !w) return
    w.disconnect()
    w.observe(lane)
    for (const el of document.querySelectorAll('.side, .game-selection')) w.observe(el)
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
    <aside className="pn notice trader-visit" role="status">
      <span className="notice-text">{traderVisitLine(visit, tick)}</span>
      <span className="notice-actions">
        <button type="button" className="btn sm" onClick={onShow}>
          Show
        </button>
        <button type="button" className="btn sm gold" onClick={onTrade}>
          Trade
        </button>
        <button
          type="button"
          className="btn sm"
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
      className={`pn notice group-report${skipped.length ? ' skipped' : ''}`}
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
      <button
        type="button"
        className="btn sm"
        aria-label="Dismiss the group order's report"
        onClick={onDismiss}
      >
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
    <aside className="pn notice first-day" aria-label="First day">
      <div className="hd first-day-head">
        <span className="grow">
          First day ·{' '}
          <span className="first-day-count">
            {ticked} of {lines.length}
          </span>
        </span>
        <button
          type="button"
          className="btn sm sq dk first-day-dismiss"
          aria-label="Don't show again"
          title="Don't show again"
          onClick={onDismiss}
        >
          <span className="ic s16 i-x" aria-hidden="true" />
        </button>
      </div>
      <div className="notice-text first-day-body">
        <ul>
          {lines.map((l) => (
            <li
              key={l.line}
              className={l.done ? 'done' : l.line === next ? 'next' : undefined}
              aria-label={l.done ? `${l.label}: done` : undefined}
            >
              <span className={`cb first-day-tick${l.done ? ' on' : ''}`} aria-hidden="true" />{' '}
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
        <p className="first-day-tip small mu">{FIRST_DAY_RALLY_TIP}</p>
      </div>
    </aside>
  )
}

/**
 * The realm's heir beside the Leader (`CONTEXT.md`: Heir): their name, or with none a line that
 * the realm has no heir, a button that opens the Residents list to pick one.
 */
function HeirShown({ heir, onPickHeir }: { heir: string | null; onPickHeir?: () => void }) {
  if (heir !== null) {
    return (
      <span className="hud-leader hud-heir" title="Your heir">
        Heir: {heir}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="hud-heir none btn sm gold"
      title="Your realm has no heir: pick a resident and name them heir"
      onClick={onPickHeir}
    >
      No heir
    </button>
  )
}
