import { firstDayShown } from '../realm/first-day.js'
import type { Account } from '@csp/shared-types'
import { CreativeBar } from '../creative/CreativeBar.js'
import { showsCreativeBar } from '../creative/creative-bar.js'
import { HORSE_GRANT_HORSES } from '@csp/balance'
import { openDiplomacy } from './hud-view.js'
import {
  FirstDayCard,
  GroupReportNotice,
  HorseOfferNotice,
  TraderVisitNotice,
  IncomingNotice,
  NoticeLane,
} from './Hud.js'
import { laneNotices, visitKey } from './notices-view.js'
import { pickHint, picksWallLine, pickPrompt, useTouchScreen } from '../pick/pick-mode.js'
import { PickBanner } from '../pick/PickBanner.js'

import type { ClientWorld } from '../world/useWorld.js'
import { type GroupOrders } from '../residents/useGroupOrders.js'
import { useFirstDay, type Notices } from './useNotices.js'
import { type Live, type Picker, type OpenCity, type SidebarTabs } from './game-wiring.js'

interface GameNoticesProps {
  world: ClientWorld | null
  account: Account
  phone: boolean
  picker: Picker
  /** What the pick waiting for a tile would do under the pointer (`usePick`). */
  preview: ReturnType<Picker['preview']>
  tabs: SidebarTabs
  notices: Notices
  firstDay: ReturnType<typeof useFirstDay>
  groupOrders: Pick<GroupOrders, 'groupReport' | 'setGroupReport'>
  city: OpenCity
  sendOrder: Live['sendOrder']
  showOnMap: (x: number, y: number) => void
}

/** Every notice in one lane under the top bar (`CONTEXT.md`: Notices). */
export function GameNotices(props: GameNoticesProps) {
  const { world, account, phone, picker, preview, sendOrder, showOnMap } = props
  const { openTab, setOpenTab, setSidebar } = props.tabs
  const { demandNotice, putDemandsAway, incomingNotice, putIncomingAway } = props.notices
  const { dismissedVisits, setDismissedVisits } = props.notices
  const { reportFirstDay, dismissFirstDay } = props.firstDay
  const { groupReport, setGroupReport } = props.groupOrders
  const { setOpenCityId, setTradeAt } = props.city
  // What the map waits for while an order that needs a target is given (ADR 0012: pick mode).
  const touch = useTouchScreen()
  const pick = picker.target
  const cancelPick = picker.cancel
  return (
    <NoticeLane phone={phone}>
      {/* First in the lane under the top bar, so the notices stack below it. */}
      {showsCreativeBar(account) && <CreativeBar tick={world?.tick} />}
      {laneNotices({
        pick: pick !== undefined,
        horseOffer: world?.horseOffer,
        demand: demandNotice !== undefined,
        incoming: incomingNotice !== undefined,
        firstDay: world !== null && firstDayShown(world.firstDay),
        traderVisit: world?.traderVisits.some((v) => !dismissedVisits.has(visitKey(v))),
        groupReport: groupReport !== undefined,
      }).map((kind) =>
        kind === 'pick' && pick ? (
          <PickBanner
            key={kind}
            prompt={pickPrompt(pick, touch)}
            hint={pickHint(pick)}
            material={
              picksWallLine(pick)
                ? { value: picker.wallMaterial, onChange: picker.setWallMaterial }
                : undefined
            }
            under={pick.kind === 'plan' && pick.error ? undefined : preview?.label}
            onConfirm={
              picker.pickAt?.tapped
                ? () => picker.pickTile(picker.pickAt!.x, picker.pickAt!.y)
                : undefined
            }
            onWaypoints={
              world && world.waypoints.length > 0 && openTab !== 'waypoints'
                ? () => setOpenTab('waypoints')
                : undefined
            }
            onCancel={cancelPick}
          />
        ) : kind === 'horseOffer' ? (
          <HorseOfferNotice
            key={kind}
            horses={HORSE_GRANT_HORSES}
            onClaim={() => sendOrder({ kind: 'claimHorses' })}
          />
        ) : kind === 'demand' && demandNotice ? (
          <IncomingNotice
            key={kind}
            line={demandNotice}
            onOpen={() => setSidebar((s) => openDiplomacy(s, 'demands'))}
            onDismiss={putDemandsAway}
          />
        ) : kind === 'incoming' && incomingNotice ? (
          <IncomingNotice
            key={kind}
            line={incomingNotice}
            onOpen={() => setSidebar((s) => openDiplomacy(s, 'directOffers'))}
            onDismiss={putIncomingAway}
          />
        ) : kind === 'firstDay' && world ? (
          <FirstDayCard
            key={kind}
            card={world.firstDay}
            onWiki={() => reportFirstDay('openWiki')}
            onDismiss={dismissFirstDay}
          />
        ) : kind === 'traderVisit' && world ? (
          world.traderVisits
            .filter((v) => !dismissedVisits.has(visitKey(v)))
            .map((v) => (
              <TraderVisitNotice
                key={visitKey(v)}
                visit={v}
                tick={world.tick}
                onShow={() => showOnMap(v.x, v.y)}
                onTrade={() => {
                  setOpenCityId(v.cityId)
                  setTradeAt({ buildingId: v.traderId })
                  setOpenTab('cities')
                }}
                onDismiss={() => setDismissedVisits((seen) => new Set([...seen, visitKey(v)]))}
              />
            ))
        ) : kind === 'groupReport' && groupReport ? (
          <GroupReportNotice
            key={kind}
            report={groupReport}
            onDismiss={() => setGroupReport(undefined)}
          />
        ) : null,
      )}
    </NoticeLane>
  )
}
