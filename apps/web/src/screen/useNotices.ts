import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { firstDayShown } from '../realm/first-day.js'
import type { ClientFirstDayLine } from '@csp/shared-types'
import { demandNoticeLine, demandSides } from '../diplomacy/demand-view.js'
import { incomingItems, incomingNoticeLine } from '../diplomacy/incoming-view.js'
import {
  NOTHING_SEEN,
  newestLine,
  rememberLogSeen,
  rememberedLogSeen,
  seeTab,
  sentToRealm,
  unseenMarks,
  type SeenIds,
} from './unseen-view.js'
import { api } from '../world/api.js'
import { showsTab } from './hud-view.js'
import { heirTakeover, rememberTakeoverSeen, rememberedTakeoverSeen } from '../realm/realm-log.js'

import type { ClientWorld } from '../world/useWorld.js'
import type { Sidebar as SidebarState } from './hud-view.js'

/**
 * The notices of what was sent to the realm and of the heir's takeover, until the Player puts them
 * away (`CONTEXT.md`: Notices), and the marks on the sidebar's strip and Diplomacy tabs for what
 * they haven't seen yet (`CONTEXT.md`: Sidebar).
 */
export function useNotices(world: ClientWorld | null, sidebar: SidebarState) {
  const openTab = sidebar.open
  const demandsShown = showsTab(sidebar, 'demands')
  const offersShown = showsTab(sidebar, 'directOffers')
  // The notice of demands sent to the realm (`CONTEXT.md`: Demand), until the Player dismisses it
  // or has them in front of them in the sidebar.
  const [demandsPutAway, setDemandsPutAway] = useState<ReadonlySet<string>>(new Set())
  const demands = world?.diplomacy.demands
  const homeRealm = world?.home.realmId
  const putDemandsAway = useCallback(() => {
    if (demands && homeRealm) {
      setDemandsPutAway(new Set(demandSides(demands, homeRealm).incoming.map((d) => d.id)))
    }
  }, [demands, homeRealm])
  useEffect(() => {
    if (demandsShown) putDemandsAway()
  }, [demandsShown, putDemandsAway])
  const demandNotice =
    demands && homeRealm
      ? demandNoticeLine(demands, homeRealm, demandsPutAway, demandsShown)
      : undefined
  // The notice of what others sent the realm (`CONTEXT.md`: Notices), until the Player dismisses it
  // or has it in front of them in the sidebar.
  const [incomingPutAway, setIncomingPutAway] = useState<ReadonlySet<string>>(new Set())
  const incoming = useMemo(
    () => (world ? incomingItems(world.diplomacy, world.home.realmId) : []),
    [world],
  )
  const putIncomingAway = useCallback(
    () => setIncomingPutAway(new Set(incoming.map((i) => i.id))),
    [incoming],
  )
  useEffect(() => {
    if (offersShown) putIncomingAway()
  }, [offersShown, putIncomingAway])
  const incomingNotice = incomingNoticeLine(incoming, incomingPutAway, offersShown)
  // What the Player hasn't seen in a sidebar tab yet, for the marks on its strip and the Diplomacy tabs
  // (`CONTEXT.md`: Sidebar): what was sent to the realm, seen once its tab was in front of them,
  // and realm log lines newer than the last one they had open.
  const [seenIds, setSeenIds] = useState<SeenIds>(NOTHING_SEEN)
  const sent = useMemo(
    () =>
      world
        ? sentToRealm(world.diplomacy, world.home.realmId)
        : { contracts: [], demands: [], directOffers: [] },
    [world],
  )
  const tabShown = openTab === 'diplomacy' ? sidebar.tab : undefined
  useEffect(() => {
    if (tabShown === 'contracts' || tabShown === 'demands' || tabShown === 'directOffers') {
      setSeenIds((s) => seeTab(s, tabShown, sent[tabShown]))
    }
  }, [tabShown, sent])
  const [logSeenUpTo, setLogSeenUpTo] = useState<number | null>(null)
  const events = world?.events
  useEffect(() => {
    if (!events || !homeRealm) return
    const newest = newestLine(events)
    if (openTab === 'realmLog' && newest !== null) {
      setLogSeenUpTo((upTo) => {
        if (upTo !== null && upTo >= newest) return upTo
        rememberLogSeen(homeRealm, newest)
        return newest
      })
    } else {
      // Until the log was open in this browser, what it held on arrival counts as seen.
      setLogSeenUpTo((upTo) => upTo ?? rememberedLogSeen(homeRealm) ?? newest ?? -1)
    }
  }, [events, homeRealm, openTab])
  const marks = unseenMarks(sent, seenIds, events ?? [], logSeenUpTo)
  // The notice that the heir took over (`CONTEXT.md`: Leader death with an heir), until the Player
  // puts it away; remembered in this browser, so it shows at once or on their next login.
  const [takeoverSeen, setTakeoverSeen] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    if (homeRealm) setTakeoverSeen((seen) => seen ?? rememberedTakeoverSeen(homeRealm))
  }, [homeRealm])
  const takeover =
    events && takeoverSeen !== undefined ? heirTakeover(events, takeoverSeen) : undefined
  const putTakeoverAway = () => {
    if (!takeover || !homeRealm) return
    rememberTakeoverSeen(homeRealm, takeover.seq)
    setTakeoverSeen(takeover.seq)
  }
  // The wandering traders' stops whose notice the Player dismissed (`CONTEXT.md`: Trader stop).
  const [dismissedVisits, setDismissedVisits] = useState<ReadonlySet<string>>(new Set())
  return {
    demandNotice,
    putDemandsAway,
    incomingNotice,
    putIncomingAway,
    marks,
    takeover,
    putTakeoverAway,
    dismissedVisits,
    setDismissedVisits,
  }
}

/** The notices and sidebar marks (`useNotices`). */
export type Notices = ReturnType<typeof useNotices>

/**
 * The first-day card (`CONTEXT.md`: First day): the lines only the client sees done, reported
 * once each, and its dismissal.
 */
export function useFirstDay(
  world: ClientWorld | null,
  setFirstDay: (card: ClientWorld['firstDay']) => void,
  selectedIds: string[],
) {
  // The first-day lines reported and not turned down, so each goes out once (`reportFirstDay`).
  const firstDayReported = useRef(new Set<ClientFirstDayLine>())
  /**
   * Reports a first-day line only the client sees done, once, while the card shows
   * (`CONTEXT.md`: First day); the server ticks the others itself.
   */
  const reportFirstDay = (line: ClientFirstDayLine) => {
    const card = world?.firstDay
    if (!card || !firstDayShown(card) || card.done.includes(line)) return
    if (firstDayReported.current.has(line)) return
    firstDayReported.current.add(line)
    api.firstDayDone(line).then(setFirstDay, () => firstDayReported.current.delete(line))
  }
  // Picking a resident, however it happened: on the map, in a list, a saved group.
  const residentPicked = selectedIds.length > 0
  useEffect(() => {
    if (residentPicked) reportFirstDay('pickResident')
  })
  /** Hides the first-day card at once; the server keeps it dismissed for good. */
  const dismissFirstDay = () => {
    if (world) setFirstDay({ ...world.firstDay, dismissed: true })
    api.dismissFirstDay().then(setFirstDay, () => {})
  }
  return { reportFirstDay, dismissFirstDay }
}
