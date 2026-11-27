import { AlliancePanel } from './Alliance.js'
import { ContractsPanel } from './Contracts.js'
import { DemandsPanel } from './Demands.js'
import { DirectOffersPanel } from './DirectOffers.js'
import { StandingPanel } from './Standing.js'
import { openDiplomacy } from '../screen/hud-view.js'
import { DiplomacyTabs } from '../screen/Hud.js'

import { type ResidentOrders } from '../residents/useResidentOrders.js'
import { type Notices } from '../screen/useNotices.js'
import { type GameSeen, type Live, type Ground, type SidebarTabs } from '../screen/game-wiring.js'

interface DiplomacyTabProps {
  seen: GameSeen
  tabs: SidebarTabs
  /** The marks on the Diplomacy tabs (`useNotices`). */
  marks: Notices['marks']
  sendOrder: Live['sendOrder']
  giveOrder: ResidentOrders['giveOrder']
  arrivesIn: Ground['arrivesIn']
  showOnMap: (x: number, y: number) => void
}

/** The Diplomacy tab (`CONTEXT.md`: Sidebar): contracts, demands, direct offers, alliance, standing. */
export function DiplomacyTab(props: DiplomacyTabProps) {
  const { world, own, realms, scripts } = props.seen
  const { sidebar, setSidebar } = props.tabs
  const { marks, sendOrder, giveOrder, arrivesIn, showOnMap } = props
  return (
    <DiplomacyTabs
      tab={sidebar.tab}
      onTab={(tab) => setSidebar((s) => openDiplomacy(s, tab))}
      marked={marks.tabs}
      panels={{
        contracts: (
          <ContractsPanel
            contracts={world.diplomacy.contracts}
            realmId={world.home.realmId}
            own={own}
            inSight={world.residents}
            horses={world.horses}
            buildings={world.buildings}
            cities={world.cities}
            realms={realms}
            scripts={scripts}
            tick={world.tick}
            sendOrder={sendOrder}
          />
        ),
        demands: (
          <DemandsPanel
            demands={world.diplomacy.demands}
            realmId={world.home.realmId}
            knownRealms={world.diplomacy.knownRealms}
            knownNpcOrgs={world.diplomacy.knownNpcOrgs}
            cities={world.cities}
            buildings={world.buildings}
            carriedWays={world.diplomacy.carriedWays ?? []}
            noCaravans={world.diplomacy.noCaravans === true}
            lastSeen={world.lastSeen.cities}
            tick={world.tick}
            sendOrder={sendOrder}
          />
        ),
        directOffers: (
          <DirectOffersPanel
            offers={world.diplomacy.directOffers}
            knownRealms={world.diplomacy.directOfferRealms}
            carriedWays={world.diplomacy.carriedWays ?? []}
            buildings={world.buildings}
            cities={world.cities}
            residents={world.residents}
            carriages={world.carriages}
            horses={world.horses}
            realmId={world.home.realmId}
            tick={world.tick}
            mapSize={world.map.size}
            noCaravans={world.diplomacy.noCaravans === true}
            arrivesIn={arrivesIn || undefined}
            onShowPlace={showOnMap}
            giveOrder={giveOrder}
            sendOrder={sendOrder}
          />
        ),
        alliance: (
          <AlliancePanel
            diplomacy={world.diplomacy}
            residents={world.residents}
            carriages={world.carriages}
            realmId={world.home.realmId}
            sendOrder={sendOrder}
          />
        ),
        standing: (
          <StandingPanel
            standings={world.diplomacy.standings}
            joinRequests={world.diplomacy.joinRequests}
            directives={world.diplomacy.directives}
            sendOrder={sendOrder}
          />
        ),
      }}
    />
  )
}
