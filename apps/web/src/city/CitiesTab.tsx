import { CityInspector } from './CityInspector.js'
import { cityPlace, cityScale } from './cities-tab-view.js'

import { type ResidentOrders } from '../residents/useResidentOrders.js'
import { useMapFocus } from '../map/useMapFocus.js'
import { type GameSeen, type Live, type Ground, type OpenCity } from '../screen/game-wiring.js'

interface CitiesTabProps {
  seen: GameSeen
  city: OpenCity
  orders: Pick<ResidentOrders, 'giveOrder' | 'setOrderError'>
  sendOrder: Live['sendOrder']
  arrivesIn: Ground['arrivesIn']
  /** Shows a place on the map with a zoom of its own (`useMapFocus`). */
  show: ReturnType<typeof useMapFocus>['show']
}

/**
 * The Cities tab (`CONTEXT.md`: Cities tab): the cities the Player knows, and the orders given
 * from a city's row (gates, trade, buying, offers).
 */
export function CitiesTab(props: CitiesTabProps) {
  const { world, realms, knownCities, knownBuildings } = props.seen
  const { openCityId, setOpenCityId, tradeAt } = props.city
  const { giveOrder, setOrderError } = props.orders
  const { sendOrder, arrivesIn } = props
  const setToShow = props.show
  return (
    <CityInspector
      cities={world.cities}
      lastSeen={world.lastSeen}
      residents={world.residents}
      buildings={world.buildings}
      traders={world.traders}
      traderVisits={world.traderVisits}
      realmId={world.home.realmId}
      realms={realms}
      carriages={world.carriages}
      horses={world.horses}
      tick={world.tick}
      mapSize={world.map.size}
      onSetGate={async (gateId, open) =>
        setOrderError(await giveOrder({ kind: 'setGate', gateId, open }))
      }
      onBuyCity={async (residentId, cityId) =>
        setOrderError(await giveOrder({ kind: 'buyCity', residentId, cityId }))
      }
      onTrade={async ({ side, ...trade }) =>
        setOrderError(await giveOrder({ kind: side, ...trade }))
      }
      onSwap={async (swap) => setOrderError(await giveOrder({ kind: 'swap', ...swap }))}
      onBuyHorse={async (buy) => setOrderError(await giveOrder({ kind: 'buyHorse', ...buy }))}
      onSellHorse={async (sale) => setOrderError(await giveOrder({ kind: 'sellHorse', ...sale }))}
      onTransfer={async (transfer) =>
        setOrderError(await giveOrder({ kind: 'transfer', ...transfer }))
      }
      onSend={async ({ residentId, carriageId, x, y }) =>
        setOrderError(
          await giveOrder(
            carriageId
              ? { kind: 'drive', residentId, carriageId, x, y }
              : { kind: 'walkTo', residentId, x, y },
          ),
        )
      }
      arrivesIn={arrivesIn || undefined}
      directives={world.diplomacy.directives}
      debt={world.diplomacy.debt ?? 0}
      noCaravans={world.diplomacy.noCaravans === true}
      allies={new Set(world.diplomacy.alliance?.members.map((m) => m.realmId))}
      openId={openCityId}
      onOpen={(id) => {
        setOpenCityId(id)
        // Opening a row shows the city on the map, outlined (`CONTEXT.md`: Cities tab).
        const at = id && cityPlace(id, knownCities, knownBuildings)
        if (at) setToShow({ ...at, zoom: cityScale })
      }}
      scrollTo={tradeAt}
      standings={world.diplomacy.standings}
      events={world.events}
      onBuyOff={async (residentId, directiveId, carriageId) =>
        setOrderError(await sendOrder({ kind: 'buyOff', residentId, directiveId, carriageId }))
      }
      onPayDebt={async (residentId, coins, carriageId) =>
        setOrderError(await sendOrder({ kind: 'payDebt', residentId, coins, carriageId }))
      }
      onPostOffer={async (offer) => setOrderError(await sendOrder({ kind: 'postOffer', ...offer }))}
      onTakeDownOffer={async (offerId) =>
        setOrderError(await sendOrder({ kind: 'takeDownOffer', offerId }))
      }
      onAcceptOffer={async (accept) =>
        setOrderError(await giveOrder({ kind: 'acceptOffer', ...accept }))
      }
    />
  )
}
