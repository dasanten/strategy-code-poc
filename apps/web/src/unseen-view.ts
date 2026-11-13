import type { ContractView, DemandView, DirectOfferView, RealmEvent } from '@csp/shared-types'
import type { DiplomacyTab, DrawerId } from './hud-view.js'

/**
 * What the Player hasn't seen yet in a drawer (`CONTEXT.md`: Tool rail): what a notice would
 * announce, and new lines of the realm log. A rail button and a Diplomacy tab show a mark while
 * theirs holds any of it; opening the drawer on that tab clears it.
 */

/** The ids of what was sent to the realm that the Player has had in front of them, by tab. */
export type SeenIds = Readonly<
  Record<'contracts' | 'demands' | 'directOffers', ReadonlySet<string>>
>

export const NOTHING_SEEN: SeenIds = {
  contracts: new Set(),
  demands: new Set(),
  directOffers: new Set(),
}

/** What waits in each Diplomacy tab for the realm's answer, by id. */
export function sentToRealm(
  diplomacy: {
    contracts: readonly ContractView[]
    demands: readonly DemandView[]
    directOffers: readonly DirectOfferView[]
  },
  realmId: string,
): Record<keyof SeenIds, string[]> {
  return {
    // A contract the other side offered that hasn't started: it waits for the realm's answer.
    contracts: diplomacy.contracts
      .filter(
        (c) =>
          c.startedAt === null &&
          (c.lender.realmId === realmId || c.hirer.realmId === realmId) &&
          (c.offeredBy === 'lender' ? c.lender : c.hirer).realmId !== realmId,
      )
      .map((c) => c.id),
    demands: diplomacy.demands.filter((d) => d.to.realmId === realmId).map((d) => d.id),
    directOffers: diplomacy.directOffers.filter((o) => o.direct.toId === realmId).map((o) => o.id),
  }
}

/** The ids the Player has now seen: the open tab's, added to what they saw before. */
export function seeTab(seen: SeenIds, tab: keyof SeenIds, ids: readonly string[]): SeenIds {
  if (ids.every((id) => seen[tab].has(id))) return seen
  return { ...seen, [tab]: new Set([...seen[tab], ...ids]) }
}

/** The newest realm log line's number, or null with an empty log. */
export function newestLine(events: readonly Pick<RealmEvent, 'seq'>[]): number | null {
  return events.reduce<number | null>((max, e) => (max === null || e.seq > max ? e.seq : max), null)
}

/** Where the marks go: the rail buttons and the Diplomacy tabs holding something unseen. */
export interface Marks {
  rail: ReadonlySet<DrawerId>
  tabs: ReadonlySet<DiplomacyTab>
}

/**
 * The marks: a Diplomacy tab whose sent-to-realm ids aren't all seen, the Diplomacy button while
 * any tab has one, and the Realm log button while the log has lines newer than `logSeenUpTo` (null:
 * none seen yet, which counts every line as seen until the log first has a newer one).
 */
export function unseenMarks(
  sent: Record<keyof SeenIds, readonly string[]>,
  seen: SeenIds,
  events: readonly Pick<RealmEvent, 'seq'>[],
  logSeenUpTo: number | null,
): Marks {
  const tabs = new Set<DiplomacyTab>()
  for (const tab of ['contracts', 'demands', 'directOffers'] as const) {
    if (sent[tab].some((id) => !seen[tab].has(id))) tabs.add(tab)
  }
  const rail = new Set<DrawerId>()
  if (tabs.size > 0) rail.add('diplomacy')
  if (logSeenUpTo !== null && events.some((e) => e.seq > logSeenUpTo)) rail.add('realmLog')
  return { rail, tabs }
}

const LOG_SEEN_KEY = 'csp.realmLogSeen'

/** The last realm log line the Player had in front of them, as this browser remembers it. */
export function rememberedLogSeen(
  realmId: string,
  storage: () => Pick<Storage, 'getItem'> = () => localStorage,
): number | null {
  try {
    const n = Number.parseInt(storage().getItem(`${LOG_SEEN_KEY}.${realmId}`) ?? '', 10)
    return Number.isFinite(n) ? n : null
  } catch {
    // Without storage the log counts as seen up to what it held when the page loaded.
    return null
  }
}

/** Remembers the last realm log line seen, if the browser lets us. */
export function rememberLogSeen(
  realmId: string,
  seq: number,
  storage: () => Pick<Storage, 'setItem'> = () => localStorage,
): void {
  try {
    storage().setItem(`${LOG_SEEN_KEY}.${realmId}`, String(seq))
  } catch {
    // Not remembered: after a reload the log counts as seen up to what it then holds.
  }
}
