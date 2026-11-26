import {
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { formatGameTime } from '@csp/lang-wasm'
import { formatGameTimeShort } from './time.js'
import { useMapDockHeight } from './Dock.js'
import type { FirstDay, TraderVisit } from '@csp/shared-types'
import { PanelStatus } from './panel-head.js'
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
import { dockCovers } from './dock-view.js'
import { groupSentLine, type Skipped } from './group-orders.js'
import {
  FIRST_DAY_RALLY_TIP,
  firstDayView,
  laneSpot,
  skippedByWhy,
  traderVisitLine,
} from './notices-view.js'
import type { ConnectionStatus } from './useWorld.js'
import { WIKI_PATH } from './wiki/wiki-view.js'
import { Icon } from './Icon.js'
import { GoodIcon } from './GoodsGrid.js'
import { TAB_ICONS, type UiIconName } from './ui-icons.js'

/**
 * The HUD over the full-screen map (ADR 0044): the top bar, notices and dialogs; the sidebar is in
 * `Sidebar.tsx`.
 */

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
          <GoodIcon good={g} /> {Math.floor(goods.totals[g])}
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
  phone = false,
}: {
  /** On a phone the bar's height is fixed (`--top-h`); elsewhere it is measured into it. */
  phone?: boolean
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
  // Off a phone the bar wraps to a second row where one has no room (a tablet): its height goes
  // to the screen as `--top-h`, so the sidebar, the dock and the notices start below it.
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const bar = ref.current
    const screen = bar?.parentElement
    if (!bar || !screen || phone) return
    const observer = new ResizeObserver(() => {
      if (bar.offsetHeight > 0) screen.style.setProperty('--top-h', `${bar.offsetHeight}px`)
    })
    observer.observe(bar)
    return () => {
      observer.disconnect()
      screen.style.removeProperty('--top-h')
    }
  }, [phone])
  return (
    <header ref={ref} className="hud-top bar">
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
          {/* A phone has room only for the short form (`formatGameTimeShort`). */}
          <span className="hud-clock-long">{formatGameTime(tick)}</span>
          <span className="hud-clock-short">{formatGameTimeShort(tick)}</span>
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

/** The kit icon beside a realm bar order, where the artboard (`Game-Realm`) draws one. */
const REALM_BAR_ICONS: Partial<Record<RealmBarOrder, UiIconName>> = {
  build: 'build',
  walkTo: 'walk',
  explore: 'sight',
  gather: 'gather',
  runScript: 'script',
}

/** The gap, in pixels, between the realm bar and what stops above it. */
const REALM_BAR_GAP = 8

/**
 * The realm bar in realm control mode (`CONTEXT.md`: Realm order, Screen; ADR 0044): it takes the
 * command bar's place along the bottom, left of the map dock, and is where the orders that begin
 * with a kind or a place start, under a heading and a line on what the mode is for. On a desktop
 * its height, with the gap above it, goes to the screen as `--command-h`, so the sidebar and the
 * dock stop above it as they do above the command bar. On a phone it sits above the map buttons
 * (`--map-dock-h`).
 */
export function RealmBar({
  open,
  onOpen,
  phone = false,
}: {
  /** The realm bar's order being given, if one is. */
  open: RealmBarOrder | undefined
  /** Starts the order, or with it open already, drops it. */
  onOpen: (order: RealmBarOrder) => void
  phone?: boolean
}) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const bar = ref.current
    const screen = bar?.parentElement
    if (!bar || !screen || phone) return
    const observer = new ResizeObserver(() => {
      const tall = bar.offsetHeight
      screen.style.setProperty('--command-h', `${tall > 0 ? tall + REALM_BAR_GAP : 0}px`)
    })
    observer.observe(bar)
    return () => {
      observer.disconnect()
      screen.style.removeProperty('--command-h')
    }
  }, [phone])
  // On a phone it stands above the map's buttons, which give their height as `--map-dock-h`.
  useMapDockHeight(ref, phone)
  return (
    <section ref={ref} className="realm-bar pn" aria-label="Realm bar">
      <div className="realm-bar-head">
        <span className="px t18">Realm orders</span>
        <span className="realm-bar-hint">{REALM_BAR_HINT}</span>
      </div>
      <div className="realm-bar-orders" role="toolbar" aria-label="Realm orders">
        {REALM_BAR_ORDERS.map(({ id, label, title }) => {
          const icon = REALM_BAR_ICONS[id]
          return (
            <button
              key={id}
              type="button"
              className={open === id ? 'btn lg on' : 'btn lg'}
              aria-pressed={open === id}
              title={title}
              onClick={() => onOpen(id)}
            >
              {icon && <Icon name={icon} />}
              {label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** No tab marked. */
export const NONE_MARKED: ReadonlySet<never> = new Set()

/** The small mark on a sidebar tab or Diplomacy tab that holds something the Player hasn't seen. */
export function UnseenMark() {
  return <span className="unseen-mark" aria-hidden="true" />
}

/**
 * On a phone the sidebar's strip and the top bar's goods, Leader, heir, Zeal, Wiki and Log out fold
 * into one menu button at the top left (ADR 0012); picking a tab from it opens that tab
 * full-screen.
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
  zeal,
  zealDraining,
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
  /** The Player's Zeal (`CONTEXT.md`: Zeal): on a phone the top bar has no room for it. */
  zeal?: number
  zealDraining?: boolean
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
            {/* As the artboard (`Phone-Menu`): the goods and the realm's people first, the tabs,
                then Wiki and Log out at the foot. */}
            {goods && <Goods goods={goods} className="hud-menu-goods" />}
            {(leader || heir !== undefined || zeal !== undefined) && (
              <div className="hud-menu-realm">
                {leader && (
                  <span className="hud-leader" title="Your Leader">
                    <Icon name="crown" size={16} /> {leader}
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
                {zeal !== undefined && <ZealMeter zeal={zeal} draining={zealDraining} />}
              </div>
            )}
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
                    <Icon name={TAB_ICONS[d.id]} /> {d.label}
                    {marked.has(d.id) && <UnseenMark />}
                  </button>
                ))}
              </Fragment>
            ))}
            <div className="hud-menu-links">
              <a
                className="hud-wiki btn lg"
                href={WIKI_PATH}
                target="_blank"
                rel="noopener"
                onClick={onWiki}
              >
                Wiki
              </a>
              <button type="button" className="hud-logout btn lg" onClick={onLogout}>
                Log out
              </button>
            </div>
            <span className="hud-account mu" title="Your account">
              Signed in as {account}
            </span>
          </nav>
        </>
      )}
    </>
  )
}

/**
 * The Diplomacy tab's tabs (`CONTEXT.md`: Sidebar). Every tab's panel stays mounted and only
 * the picked one shows, so a panel keeps what the Player typed into it; only that one puts its
 * count beside the tab's title.
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
  const status = useContext(PanelStatus)
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
            <Icon name={TAB_ICONS[t.id]} size={16} /> {t.label}
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
          <PanelStatus.Provider value={tab === t.id ? status : null}>
            {panels[t.id]}
          </PanelStatus.Provider>
        </div>
      ))}
    </>
  )
}

/**
 * How many pixels of the map the sidebar covers from the left (its strip alone while folded) and
 * the cards in the dock from the right, 0 for each that isn't showing; and how many the strip alone
 * covers, all the sidebar leaves when folded. The map fills the window, so screen edges measure it.
 */
export function mapCovered(): { left: number; right: number; strip: number } {
  // A bottom sheet and the command bar (`.game-command`) cover the bottom of the map, not its right
  // side; a hidden card none of it. Only the cards in the dock (`Dock`: a tile card, the who-list,
  // a realm order card) cover the right; the empty dock lets the map through.
  const docked = [...document.querySelectorAll('.game-dock > :not([hidden])')].map(
    (el) => el.getBoundingClientRect().left,
  )
  // A folded sidebar on a phone isn't drawn, and measures 0.
  const side = document.querySelector('.side')?.getBoundingClientRect()
  const strip = document.querySelector('.side-strip')?.getBoundingClientRect()
  return {
    left: side?.right ?? 0,
    right: dockCovers(docked, window.innerWidth),
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
          {tone === 'bad' && <Icon name="warning" size={24} />}
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
      <Icon name="horse" size={24} />
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
 * Opening its sidebar tab or dismissing it puts it away; the things themselves wait in the tab.
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
        <Icon name="close" size={16} />
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
    const strip = parseFloat(getComputedStyle(game).getPropertyValue('--strip-w')) || 0
    const next = laneSpot(window.innerWidth, strip, mapCovered(), phone)
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
    for (const el of document.querySelectorAll('.side, .game-dock > *')) w.observe(el)
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
          <Icon name="close" size={16} />
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
