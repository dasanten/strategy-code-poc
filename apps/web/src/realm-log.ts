import {
  REALM_LOG_LENGTH,
  TRADE_ORG_NAME,
  timeLeft,
  type DeliveryView,
  type PunishmentEnd,
  type RealmEvent,
  type StandingMove,
} from '@csp/shared'
import { BUILDING_NAMES } from './city-view.js'
import { formatMove } from './standing-view.js'

/** How bad an event is, for its colour in the log. */
export type EventTone = 'bad' | 'warn' | 'info'

/** A place an event names, which the Player can find on the map from the log. */
export interface EventPlace {
  name: string
  x: number
  y: number
}

/** An event in the game's words, with the places it names. */
export interface EventLine {
  text: string
  tone: EventTone
  places?: EventPlace[]
}

/** Goods as the log names them: "5 Food, 2 Iron Ore". */
export function goodsLine(goods: Partial<Record<string, number>> | undefined): string {
  return Object.entries(goods ?? {})
    .map(([g, n]) => `${n} ${g[0]!.toUpperCase()}${g.slice(1).replace(/[A-Z]/g, (c) => ` ${c}`)}`)
    .join(', ')
}

/**
 * A demand for goods accepted, and how they change hands (`CONTEXT.md`: Demand). What went is less
 * than `terms` when the storage was short. An event from before goods changed hands has no way.
 */
function acceptedGoodsLine(
  e: Extract<RealmEvent, { kind: 'demand' }>,
  them: string,
  terms: string,
): EventLine {
  const said = e.mine
    ? `${cap(them)} accepted your demand for ${terms}`
    : `You accepted the demand of ${them} for ${terms}`
  const h = e.handedOver
  if (!h) return { text: `${said}.`, tone: 'info' }
  const goods = goodsLine(h.goods)
  if (h.way === 'transfer') {
    return {
      text: `${said}: a Transfer brings ${goods} from ${h.fromCity} to ${h.toCity}.`,
      tone: 'info',
    }
  }
  const fetch =
    e.otherIs === 'tradeOrg' && !e.mine
      ? 'for its caravan to fetch'
      : e.mine
        ? 'for you to fetch, under Direct offers'
        : 'for them alone to fetch'
  return {
    text: `${said}: ${goods} set aside at the storage, ${fetch}.`,
    tone: 'info',
    places: [{ name: 'the storage', x: h.x, y: h.y }],
  }
}

/** A stolen carriage or horse as the log names it: "a carriage with Rowan", "Rowan". */
function transportLine(e: { carriage?: true; horse?: string }): string {
  if (!e.carriage) return e.horse ?? 'a horse'
  return `a carriage${e.horse === undefined ? '' : ` with ${e.horse}`}`
}

/**
 * One line of the realm log, in the game's words (`CONTEXT.md`). `realmId` is the Player's realm,
 * so alliance events about it say so.
 */
export function describeEvent(e: RealmEvent, realmId?: string): EventLine {
  switch (e.kind) {
    case 'hungry':
      return { text: `${e.name} has nothing to eat and is starving.`, tone: 'warn' }
    case 'down':
      return {
        text: `${e.name} is Down from hunger: ${timeLeft(e.until - e.tick)}.`,
        tone: 'bad',
      }
    case 'woke':
      return { text: `${e.by} fed ${e.name}, who is awake again at low health.`, tone: 'info' }
    case 'died': {
      const how = {
        starved: 'starved to death',
        oldAge: 'died of old age',
        killed: e.by ? `was killed by ${e.by}` : 'was killed',
      }[e.cause]
      if (e.leader) {
        return { text: `Your Leader ${e.name} ${how}. Your realm has ended.`, tone: 'bad' }
      }
      return { text: `${e.name} ${how}.`, tone: 'bad' }
    }
    case 'fight':
      return e.attacker
        ? { text: `${e.name} attacked ${e.other}.`, tone: 'info' }
        : { text: `${e.name} was attacked by ${e.other}.`, tone: 'warn' }
    case 'crimeKnown': {
      const goods = goodsLine(e.goods)
      const transport = e.carriage || e.horse !== undefined
      const did = {
        theft: transport
          ? `stole ${transportLine(e)}${goods ? `, loaded with ${goods}` : ''}`
          : `stole ${goods || 'goods'}${e.victim ? ` from ${e.victim}` : ''}`,
        attack: `attacked ${e.victim ?? 'one of your residents'}`,
        killing: `killed ${e.victim ?? 'one of your residents'}`,
        tearDown: `tore down your ${e.building ? BUILDING_NAMES[e.building] : 'building'}`,
        capture: 'captured a trading post',
      }[e.crime]
      return {
        text: `A witness got home: ${e.culprit} of ${e.culpritOrg} ${did} at (${e.x}, ${e.y}).`,
        tone: 'bad',
      }
    }
    case 'transportGone': {
      const place = `(${e.x}, ${e.y})`
      const what = e.carriage
        ? `Your carriage${e.horse === undefined ? '' : `, with ${e.horse},`}`
        : (e.horse ?? 'Your horse')
      return {
        text: `${what} is gone. It was last at ${place}.`,
        tone: 'bad',
        places: [{ name: place, x: e.x, y: e.y }],
      }
    }
    case 'transportTaken': {
      const place = `(${e.x}, ${e.y})`
      const goods = goodsLine(e.goods)
      const owner = e.from === null ? 'nobody' : e.from
      return {
        text: `${e.name} took ${transportLine(e)}${goods ? `, loaded with ${goods},` : ''} from ${owner} at ${place}. It is yours now.`,
        tone: 'info',
        places: [{ name: place, x: e.x, y: e.y }],
      }
    }
    case 'punished':
      return punishedLine(e)
    case 'wrecked': {
      const place = `${BUILDING_NAMES[e.building]} of ${e.city}`
      const left =
        e.owed > 0
          ? `${e.coins} Coins off your debt: you still owe it ${e.owed} Coins`
          : e.coins > 0
            ? `${e.coins} Coins off your debt, which covers it`
            : 'after your debt was settled'
      return {
        text: `The Trade Organization's army tore down the ${place}, ${left}.`,
        tone: 'bad',
        places: [{ name: place, x: e.x, y: e.y }],
      }
    }
    case 'debt':
      return debtLine(e)
    case 'debtPaid':
      return {
        text:
          e.owed > 0
            ? `${e.name} paid ${e.coins} Coins of your debt at the warehouse. You still owe the Trade Organization ${e.owed} Coins.`
            : `${e.name} paid ${e.coins} Coins at the warehouse. You no longer owe the Trade Organization anything.`,
        tone: 'info',
        places: [{ name: 'the warehouse', x: e.x, y: e.y }],
      }
    case 'boughtOff':
      return {
        text: `${e.name} paid ${e.coins} Coins at the warehouse to buy off the admin directive (${e.reason}). The Trade Organization no longer punishes you for it.`,
        tone: 'info',
        places: [{ name: 'the warehouse', x: e.x, y: e.y }],
      }
    case 'directiveEnded':
      return {
        text: `The admin directive against you (${e.reason}) has ended: all its goals are met.`,
        tone: 'info',
      }
    case 'fled':
      return { text: `${e.name} was hit and flees home.`, tone: 'warn' }
    case 'cityCaptured': {
      const people = `${e.residents} resident${e.residents === 1 ? '' : 's'}`
      if (!e.captor) {
        return {
          text:
            e.other === TRADE_ORG_NAME
              ? `The Trade Organization took ${e.city} and its ${people}: it is a trading post now.`
              : `The realm of ${e.other} captured ${e.city} and its ${people}.`,
          tone: 'bad',
        }
      }
      const from = e.other === null ? '' : ` from the realm of ${e.other}`
      return { text: `You captured ${e.city}${from}, with its ${people}.`, tone: 'info' }
    }
    case 'hallOccupied': {
      const days = `${e.days} game day${e.days === 1 ? '' : 's'}`
      const places = [{ name: `${e.city}’s town hall`, x: e.x, y: e.y }]
      return e.occupier
        ? {
            text: `You hold the town hall of ${e.city}: ${days} to capture it.`,
            tone: 'info',
            places,
          }
        : {
            text: `Your town hall in ${e.city} is occupied by ${realmCalled(e.other)}: it falls in ${days} unless you retake it.`,
            tone: 'bad',
            places,
          }
    }
    case 'occupationBroken': {
      const places =
        e.x === undefined || e.y === undefined
          ? undefined
          : [{ name: `${e.city}’s town hall`, x: e.x, y: e.y }]
      return e.occupier
        ? {
            text: `Your occupation of ${e.city}’s town hall is broken: its days are lost.`,
            tone: 'warn',
            ...(places && { places }),
          }
        : {
            text: `The occupation of your town hall in ${e.city} by ${realmCalled(e.other)} is broken.`,
            tone: 'info',
            ...(places && { places }),
          }
    }
    case 'cityBought': {
      const people = `${e.residents} resident${e.residents === 1 ? '' : 's'}`
      return {
        text: `You bought ${e.city} for ${e.price} coins, with its ${people}.`,
        tone: 'info',
        places: [{ name: e.city, x: e.x, y: e.y }],
      }
    }
    case 'cityNotBought':
      return {
        text: `${e.city} wasn’t bought: it costs ${e.price} coins, and your residents at its town hall carried ${e.coins}.`,
        tone: 'warn',
      }
    case 'joinAsked':
      return {
        text: `${e.city} holds you in high standing and respects your strength: it asks to join your realm. Accept or decline under Standing.`,
        tone: 'info',
        places: [{ name: e.city, x: e.x, y: e.y }],
      }
    case 'cityPersuaded': {
      const people = `${e.residents} resident${e.residents === 1 ? '' : 's'}`
      return {
        text: `${e.city} joined your realm, persuaded, with its ${people}.`,
        tone: 'info',
        places: [{ name: e.city, x: e.x, y: e.y }],
      }
    }
    case 'joinWithdrawn':
      return { text: `${e.city} no longer asks to join your realm.`, tone: 'warn' }
    case 'traded': {
      const what = goodText(e.good)
      const at = e.withTrader
        ? 'the wandering trader'
        : e.atStorage
          ? 'the storage'
          : 'the warehouse'
      const place = { name: at, x: e.x, y: e.y }
      if (e.units === 0) {
        return {
          text: `${e.name} couldn’t ${e.side} any ${what} at ${at}.`,
          tone: 'warn',
          places: [place],
        }
      }
      const did = e.side === 'buy' ? 'bought' : 'sold'
      const cut = e.units < e.wanted ? ` (of ${e.wanted} wanted)` : ''
      return {
        text: `${e.name} ${did} ${e.units} ${what}${cut} for ${e.coins} coins at ${at}.${standingMoved(e.standing)}`,
        tone: 'info',
        places: [place],
      }
    }
    case 'offerAccepted': {
      const place = { name: 'the storage', x: e.x, y: e.y }
      if (e.times === 0) {
        return {
          text: `${e.name} couldn’t accept the offer of ${e.realm}.`,
          tone: 'warn',
          places: [place],
        }
      }
      if (e.wantsUnits === 0) {
        const of = e.times < e.wanted ? ` (of ${e.wanted} wanted)` : ''
        return {
          text: `${e.name} fetched ${e.givesUnits} ${goodText(e.gives)} set aside by ${e.realm}${of}.`,
          tone: 'info',
          places: [place],
        }
      }
      const cut = e.times < e.wanted ? ` (of ${e.wanted} times wanted)` : ''
      return {
        text: `${e.name} took ${e.givesUnits} ${goodText(e.gives)} for ${e.wantsUnits} ${goodText(e.wants)} from the offer of ${e.realm}${cut}.`,
        tone: 'info',
        places: [place],
      }
    }
    case 'swapped': {
      const place = { name: `the ${e.place}`, x: e.x, y: e.y }
      if (e.units === 0) {
        return {
          text: `${e.name} couldn’t swap ${goodText(e.give)} for ${goodText(e.want)} at ${place.name}.`,
          tone: 'warn',
          places: [place],
        }
      }
      const cut = e.units < e.wanted ? ` (of ${e.wanted} wanted)` : ''
      const back = e.coins > 0 ? `, with ${e.coins} ${e.coins === 1 ? 'coin' : 'coins'} back,` : ''
      return {
        text: `${e.name} swapped ${e.gave} ${goodText(e.give)} for ${e.units} ${goodText(e.want)}${cut}${back} at ${place.name}.${standingMoved(e.standing)}`,
        tone: 'info',
        places: [place],
      }
    }
    case 'offerTaken':
      return {
        text:
          e.wantsUnits === 0
            ? `${e.by} fetched the ${e.givesUnits} ${goodText(e.gives)} you set aside.`
            : `${e.by} took your offer: ${e.givesUnits} ${goodText(e.gives)} for ${e.wantsUnits} ${goodText(e.wants)}.${standingMoved(e.standing)}`,
        tone: 'info',
        places: [{ name: 'the storage', x: e.x, y: e.y }],
      }
    case 'offerCutDown':
      return {
        text:
          e.wantsUnits === 0
            ? `Goods gone from the storage cut what you set aside down to ${e.times} ${goodText(e.gives)}.`
            : `Goods gone from the storage cut your offer of ${e.givesUnits} ${goodText(e.gives)} for ${e.wantsUnits} ${goodText(e.wants)} down to ${e.times} ${e.times === 1 ? 'time' : 'times'}.`,
        tone: 'warn',
        places: [{ name: 'the storage', x: e.x, y: e.y }],
      }
    case 'offerEnded': {
      const what = `${e.givesUnits} ${goodText(e.gives)} for ${e.wantsUnits} ${goodText(e.wants)}`
      const yours =
        e.wantsUnits === 0
          ? `The ${goodText(e.gives)} you set aside for ${e.to === TRADE_ORG_NAME ? e.to : `the realm of ${e.to}`}`
          : e.to
            ? `Your direct offer of ${what} to the realm of ${e.to}`
            : `Your offer of ${what}`
      const why = {
        usedUp: `${yours} is used up.`,
        takenDown: `${yours} is taken down.`,
        storageLost: `${yours} ended: the storage is gone or no longer yours.`,
        goodsGone: `${yours} ended: its goods are gone from the storage.`,
        declined: `${yours} was declined.${e.carried ? '' : ' Its goods are ordinary again.'}`,
        lapsed: `${yours} lapsed.${e.carried ? '' : ' Its goods are ordinary again.'}`,
        noCaravans: `${yours} is cancelled: the Trade Org HQ has fallen and no caravans run.`,
      }[e.why]
      return {
        text: why,
        tone:
          e.why === 'storageLost' || e.why === 'goodsGone' || e.why === 'noCaravans'
            ? 'warn'
            : 'info',
        places: [{ name: 'the storage', x: e.x, y: e.y }],
      }
    }
    case 'directOffer': {
      const what =
        e.wantsUnits === 0
          ? goodText(e.gives)
          : `${e.givesUnits} ${goodText(e.gives)} for ${e.wantsUnits} ${goodText(e.wants)}`
      const place = { name: 'the storage', x: e.x, y: e.y }
      const them = e.fromCity ? e.from : `the realm of ${e.from}`
      if (e.carried) {
        const over = e.times === 1 ? '' : `, ${e.times} times over`
        const way = `between ${e.carried.fromCity} and ${e.carried.toCity}${over}`
        const pays = `You pay up to ${e.carried.fee} coins.`
        const told = {
          received: `${cap(them)} sent you a direct offer the Trade Organization carries ${way}: ${what}. ${pays} Accept or decline it under Direct offers.`,
          carriedAccepted: `${cap(them)} accepted your carried direct offer of ${what}: caravans carry both ways ${way}. ${pays}`,
          youAccepted: `You accepted the carried direct offer of ${what} from ${them}: caravans carry both ways ${way}. ${pays}`,
        } as const
        if (e.what in told) {
          return { text: told[e.what as keyof typeof told], tone: 'info', places: [place] }
        }
      }
      if (e.what === 'received') {
        const over = e.times === 1 ? '' : `, ${e.times} times over`
        return {
          text: `${cap(them)} sent you a direct offer: ${what}${over}. Fetch it in person at the storage, or decline it, under Direct offers.`,
          tone: 'info',
          places: [place],
        }
      }
      const text = {
        declined: `You declined the direct offer of ${what} from ${them}.`,
        lapsed: `The direct offer of ${what} from ${them} lapsed.`,
        takenDown: `${cap(them)} took down its direct offer of ${what} to you.`,
        storageLost: `The direct offer of ${what} from ${them} ended: its storage is gone or no longer theirs.`,
        goodsGone: `The direct offer of ${what} from ${them} ended: its goods are gone from the storage.`,
        noCaravans: `The direct offer of ${what} from ${them} is cancelled: the Trade Org HQ has fallen and no caravans run.`,
        carriedAccepted: `${cap(them)} accepted your direct offer of ${what}.`,
        youAccepted: `You accepted the direct offer of ${what} from ${them}.`,
      }[e.what]
      return { text, tone: 'info', places: [place] }
    }
    case 'deliveryOrdered': {
      const what = goodText(e.good)
      const place = { name: 'the warehouse', x: e.x, y: e.y }
      if (e.units === 0) {
        const how = e.side === 'buy' ? `buy any ${what} delivered to` : `sell any ${what} from`
        return {
          text: `${e.name} couldn’t ${how} ${e.city} at the warehouse.`,
          tone: 'warn',
          places: [place],
        }
      }
      if (e.side === 'buy') {
        const cut = e.units < e.wanted ? ` (of ${e.wanted} wanted)` : ''
        return {
          text: `${e.name} bought ${e.units} ${what}${cut} for ${e.coins} coins and a ${e.fee}-coin fee; a caravan brings them to ${e.city}.`,
          tone: 'info',
          places: [place],
        }
      }
      return {
        text: `${e.name} sold up to ${e.units} ${what} from ${e.city}; a caravan picks them up and pays there (about ${e.coins} coins after a ${e.fee}-coin fee at today’s prices).`,
        tone: 'info',
        places: [place],
      }
    }
    case 'delivered': {
      const what = goodText(e.good)
      const place = { name: e.city, x: e.x, y: e.y }
      if (e.delivery === 'delivery') {
        return {
          text: `A caravan delivered ${e.units} ${what} to ${e.city}.`,
          tone: 'info',
          places: [place],
        }
      }
      if (e.units === 0) {
        return {
          text: `A caravan found no ${what} to pick up in ${e.city}.`,
          tone: 'warn',
          places: [place],
        }
      }
      return {
        text: `A caravan picked up ${e.units} ${what} in ${e.city} and paid ${e.coins} coins there (after a ${e.fee}-coin fee).`,
        tone: 'info',
        places: [place],
      }
    }
    case 'deliveryStuck': {
      const what = `${e.units} ${goodText(e.good)}`
      const job = e.delivery === 'delivery' ? `delivering ${what} to` : `picking up ${what} in`
      if (e.cancelled) {
        return {
          text: `A caravan ${job} ${e.city} gave up: the city is no longer yours.`,
          tone: 'bad',
        }
      }
      return {
        text: `A caravan ${job} ${e.city} couldn’t get to its storage and turned back; the next caravan tries again.`,
        tone: 'warn',
      }
    }
    case 'deliveryRobbed':
      return {
        text: `Robbers took ${e.units} ${goodText(e.good)} of your delivery to ${e.city} off a caravan; the Trade Organization sends them again.`,
        tone: 'warn',
      }
    case 'transferOrdered': {
      const what = `${e.units} ${goodText(e.good)}`
      const to = `${e.city} of ${e.toRealm}`
      const place = { name: e.fromCity ?? 'the warehouse', x: e.x, y: e.y }
      if (e.fromCity === null && e.units === 0) {
        return {
          text: `${e.name} couldn’t hand in any ${goodText(e.good)} for ${to} at the warehouse.`,
          tone: 'warn',
          places: [place],
        }
      }
      if (e.fromCity === null) {
        const cut = e.units < e.wanted ? ` (of ${e.wanted} wanted)` : ''
        return {
          text: `${e.name} handed in ${what}${cut} with a ${e.fee}-coin fee; a caravan brings them to ${to}.`,
          tone: 'info',
          places: [place],
        }
      }
      return {
        text: `You sent ${what} from ${e.fromCity} to ${to}; a caravan picks them up there with its fee.`,
        tone: 'info',
        places: [place],
      }
    }
    case 'transferred': {
      const what = `${e.units} ${goodText(e.good)}`
      const place = { name: e.city, x: e.x, y: e.y }
      if (e.back) {
        return {
          text: `A caravan brought ${what} you sent back to ${e.city}.`,
          tone: 'warn',
          places: [place],
        }
      }
      const paid = e.carried ? ', as your carried direct offer agreed' : ` (a ${e.fee}-coin fee)`
      const text =
        e.toRealmId === realmId
          ? `A caravan brought ${what} from ${e.fromRealm} to ${e.city}.`
          : `A caravan brought the ${what} you sent to ${e.city} of ${e.toRealm}${paid}.`
      return { text, tone: 'info', places: [place] }
    }
    case 'transferStuck': {
      const what = `${e.units} ${goodText(e.good)}`
      const text = {
        turnedBack: `A caravan carrying ${what} for ${e.city} couldn’t get to a storage and turned back; the next caravan tries again.`,
        cancelled: `Your transfer of ${what} to ${e.city} was cancelled: the city is no longer theirs. A caravan brings it back.`,
        kept: `Your transfer of ${what} to ${e.city} couldn’t be finished or brought back; the Trade Organization keeps it.`,
        nothing: `A caravan found no ${goodText(e.good)} (or no coins for the fee) to pick up for ${e.city}.`,
        nothingCame: `A caravan found no ${goodText(e.good)} to bring ${e.city} for a carried direct offer.`,
        robbed: `Robbers took ${what} of your transfer to ${e.city} off a caravan; the Trade Organization sends them again.`,
      }[e.why]
      return { text, tone: e.why === 'turnedBack' || e.why === 'robbed' ? 'warn' : 'bad' }
    }
    case 'orderEndedWithHq': {
      const what = `${e.units} ${goodText(e.good)}`
      const order = {
        delivery: `delivery of ${what} to ${e.city}`,
        pickUp: `pick-up of ${what} from ${e.city}`,
        transfer: `transfer of ${what} to ${e.city}`,
      }[e.order]
      const refund = e.order === 'pickUp' ? '' : ', with nothing refunded'
      return {
        text: `The Trade Org HQ has fallen and no caravans run: your ${order} is cancelled${refund}.`,
        tone: 'bad',
      }
    }
    case 'selfManaged': {
      if (e.cities.length === 0) return { text: 'Your realm had no city left.', tone: 'bad' }
      const each = e.cities.map((c) => `${c.name} (${residentsText(c.residents)})`)
      const which = e.cities.length === 1 ? 'Your city' : 'Your cities'
      const now =
        e.cities.length === 1 ? 'is now a self-managed city' : 'are now self-managed cities'
      return {
        text: `${which} ${listText(each)} ${now}.`,
        tone: 'bad',
        places: e.cities.map((c) => ({ name: c.name, x: c.x, y: c.y })),
      }
    }
    case 'founded':
      return {
        text: `Your Leader ${e.name} founded ${e.city}, your realm’s starting city.`,
        tone: 'info',
        places: [{ name: e.city, x: e.x, y: e.y }],
      }
    case 'leaderHandedOver':
      return {
        text: `${e.from} handed your realm over to ${e.to} in ${e.city}; ${e.to} is your Leader now.`,
        tone: 'info',
        places: [{ name: e.city, x: e.x, y: e.y }],
      }
    case 'foodSpoiled':
      return { text: `${e.units} Food spoiled.`, tone: 'info' }
    case 'born':
      return { text: `${e.parents[0]} and ${e.parents[1]} had a child, ${e.name}.`, tone: 'info' }
    case 'grownUp':
      return { text: `${e.name} has grown up and can work now.`, tone: 'info' }
    case 'horseDied':
      // Entries from before horses had names (`CONTEXT.md`: Horse name) say "a horse".
      return {
        text: e.name ? `Your horse ${e.name} starved to death.` : 'A horse starved to death.',
        tone: 'bad',
      }
    case 'horseDown':
      return {
        text: `Your horse ${e.name} is Down from hunger: ${timeLeft(e.until - e.tick)}. Feed it or put Food down by it.`,
        tone: 'bad',
      }
    case 'horseHungry':
      return {
        text: `${e.name}’s horse${e.horseName ? ` ${e.horseName}` : ''} is hungry, and ${e.name} carries no Food to spare for it.`,
        tone: 'warn',
      }
    case 'foaled':
      return {
        text: e.name ? `A foal, ${e.name}, was born in a stable.` : 'A foal was born in a stable.',
        tone: 'info',
      }
    case 'horsesGranted':
    case 'horsesClaimed': {
      const where = {
        stable: `in your stable at ${e.city}`,
        storage: `by the storage of ${e.city}, with Food on the ground by them`,
        leader: 'next to your Leader, with Food on the ground by them',
      }[e.where]
      const what =
        e.kind === 'horsesClaimed'
          ? `You claimed ${e.horseIds.length} new horses`
          : `Your realm had no horses left and was given ${e.horseIds.length} new ones`
      return {
        text: `${what}: they stand ${where}.`,
        tone: 'info',
        places: [{ name: e.city ?? 'your horses', x: e.x, y: e.y }],
      }
    }
    case 'allianceInvited':
      return { text: `You were invited to join the alliance ${e.name}.`, tone: 'info' }
    case 'allianceJoined': {
      const who =
        e.realmId === realmId
          ? 'You'
          : e.city
            ? `The NPC city ${e.realm}`
            : `The realm of ${e.realm}`
      return { text: `${who} joined the alliance ${e.name}.`, tone: 'info' }
    }
    case 'allianceDeclined':
      return {
        text: `The NPC city ${e.realm} declined to join the alliance ${e.name}.`,
        tone: 'info',
      }
    case 'allianceLeft': {
      const you = e.realmId === realmId
      const who = you
        ? 'Your realm'
        : e.city
          ? `The NPC city ${e.realm}`
          : `The realm of ${e.realm}`
      const how = {
        left: 'left',
        removed: 'was removed from',
        leaderDied: 'lost its Leader and left',
      }
      return { text: `${who} ${how[e.why]} the alliance ${e.name}.`, tone: you ? 'warn' : 'info' }
    }
    case 'allianceLeader': {
      const who = e.realmId === realmId ? 'You are' : `The realm of ${e.realm} is`
      return { text: `${who} now the leader of the alliance ${e.name}.`, tone: 'info' }
    }
    case 'scriptError': {
      const at = e.line === undefined ? '' : ` (line ${e.line}, column ${e.column})`
      return { text: `${e.name}’s script stopped with an error${at}: ${e.message}`, tone: 'warn' }
    }
    case 'scriptOutOfSteps':
      return e.realm
        ? {
            text: `${e.name}’s script was cut short: your realm’s scripts used up their steps.`,
            tone: 'warn',
          }
        : { text: `${e.name}’s script ran out of steps this tick.`, tone: 'warn' }
    case 'scriptEnded':
      return { text: `${e.name} stopped running a script: it was deleted.`, tone: 'info' }
    case 'defenceScriptGone':
      return {
        text: `${e.name}’s defence script is gone, so they defend by Defend (default) again.`,
        tone: 'warn',
      }
    case 'scriptStopped':
      return { text: `${e.name} stopped ${e.script}: ${e.reason}`, tone: 'info' }
    case 'waypointAdded':
      return {
        text: `${e.name} put a waypoint “${e.waypoint}” at (${e.x}, ${e.y}).`,
        tone: 'info',
        places: [{ name: e.waypoint, x: e.x, y: e.y }],
      }
    case 'scriptFieldDropped': {
      const names = e.scripts.map((s) => `“${s.name}”`).join(', ')
      const scripts =
        e.scripts.length === 1 ? `Your script ${names} reads` : `Your scripts ${names} read`
      return {
        text: `${scripts} ${e.field}, which scripts no longer see: it is null from now on.`,
        tone: 'warn',
      }
    }
    case 'queueStepSkipped': {
      const ended = e.queueEnded ? ' None of its steps could start, so the queue ended.' : ''
      return {
        text: `${e.name} skipped step ${e.step} of their queue: ${e.reason}.${ended}`,
        tone: 'warn',
      }
    }
    case 'relocateFailed':
      return {
        text:
          e.city === undefined
            ? `${e.name} couldn’t relocate: ${e.reason}.`
            : `${e.name} couldn’t move in to ${e.city}: ${e.reason}.`,
        tone: 'warn',
      }
    case 'demand': {
      const them = e.otherIs ? e.other : `the realm of ${e.other}`
      const terms = e.terms.kind === 'city' ? e.terms.cityName : goodsLine(e.terms.goods)
      // An NPC city demanded of itself is asked to join, not to hand a city over.
      if (e.otherIs === 'city' && e.terms.kind === 'city' && e.what !== 'accepted') {
        return {
          sent: { text: `You demanded that ${terms} join your realm.`, tone: 'info' },
          declined: {
            text: `${terms} declined to join your realm, and thinks less of you.`,
            tone: 'warn',
          },
          lapsed: {
            text: `Your demand that ${terms} join your realm lapsed unanswered.`,
            tone: 'info',
          },
          received: { text: `${terms} was asked to join your realm.`, tone: 'info' },
        }[e.what] as EventLine
      }
      switch (e.what) {
        case 'sent':
          return { text: `You demanded ${terms} of ${them}.`, tone: 'info' }
        case 'received':
          return { text: `${cap(them)} demands ${terms} of you.`, tone: 'warn' }
        case 'accepted':
          if (e.terms.kind === 'city') {
            if (e.otherIs === 'tradeOrg' && !e.mine) {
              return {
                text: `You gave ${terms} back to ${them}: it is a trading post again.`,
                tone: 'info',
              }
            }
            if (e.otherIs) {
              return {
                text: `${terms} gave in to your demand and joined your realm.`,
                tone: 'info',
              }
            }
            return e.mine
              ? {
                  text: `${cap(them)} accepted your demand: ${terms} joined your realm.`,
                  tone: 'info',
                }
              : {
                  text: `You accepted the demand of ${them}: ${terms} joined their realm.`,
                  tone: 'warn',
                }
          }
          return acceptedGoodsLine(e, them, terms)
        case 'declined':
          if (e.otherIs && e.mine) {
            return {
              text: `${cap(them)} declined your demand for ${terms}, and thinks less of you.`,
              tone: 'warn',
            }
          }
          return e.mine
            ? { text: `${cap(them)} declined your demand for ${terms}.`, tone: 'warn' }
            : { text: `You declined the demand of ${them} for ${terms}.`, tone: 'info' }
        case 'lapsed': {
          const demand = e.mine ? `Your demand on ${them}` : `The demand of ${them}`
          if (!e.leaderDied) {
            return { text: `${demand} for ${terms} lapsed unanswered.`, tone: 'info' }
          }
          const whose =
            e.leaderDied === (e.mine ? 'sender' : 'receiver')
              ? 'your Leader died'
              : `the Leader of ${them} died`
          return { text: `${demand} for ${terms} lapsed: ${whose}.`, tone: 'info' }
        }
      }
      break
    }
    case 'contract': {
      const them = e.other === TRADE_ORG_NAME ? e.other : `the realm of ${e.other}`
      const n = e.residents === 1 ? '1 mercenary' : `${e.residents} mercenaries`
      const weeks = e.weeks === 1 ? '1 week' : `${e.weeks} weeks`
      const walk = e.residents === 1 ? 'walks' : 'walk'
      switch (e.what) {
        case 'offered':
          return e.lender
            ? { text: `${cap(them)} asks to hire ${n} from you.`, tone: 'info' }
            : { text: `${cap(them)} offers you ${n} for hire.`, tone: 'info' }
        case 'started':
          return e.lender
            ? { text: `You rented out ${n} to ${them}.`, tone: 'info' }
            : { text: `You hired ${n} from ${them}.`, tone: 'info' }
        case 'paid':
          return e.lender
            ? { text: `${cap(them)} paid ${weeks} for your ${n}.`, tone: 'info' }
            : { text: `You paid ${them} ${weeks} for ${n}.`, tone: 'info' }
        case 'ended':
          if (e.leaderDied) {
            const whose =
              e.leaderDied === (e.lender ? 'lender' : 'hirer')
                ? 'Your Leader died'
                : `The Leader of ${them} died`
            return {
              text: `${whose}, ending the contract for ${n}: the ${n} ${walk} home.`,
              tone: 'warn',
            }
          }
          return {
            text: `The contract with ${them} for ${n} ended: the ${n} ${walk} home.`,
            tone: 'info',
          }
        case 'broken':
          return e.lender
            ? { text: `${cap(them)} left a week unpaid: your ${n} ${walk} home.`, tone: 'warn' }
            : { text: `You left a week unpaid: the ${n} from ${them} ${walk} home.`, tone: 'warn' }
        case 'declined':
          return { text: `${cap(them)} declined to rent you ${n}.`, tone: 'warn' }
      }
    }
  }
}

/** "1 resident", "3 residents". */
function residentsText(n: number): string {
  return `${n} resident${n === 1 ? '' : 's'}`
}

/** "A", "A and B", "A, B and C". */
function listText(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/**
 * Whether the Player's realm has ended since its starting city was founded (`CONTEXT.md`: Leader
 * death): their cities' fate is the newest of the two in their log. They start afresh on their
 * next login.
 */
export function realmEnded(log: RealmEvent[]): boolean {
  const last = log.findLast((e) => e.kind === 'selfManaged' || e.kind === 'founded')
  return last?.kind === 'selfManaged'
}

/** Adds a tick's new events to the log, keeping the latest `REALM_LOG_LENGTH` as the server does. */
export function appendEvents(log: RealmEvent[], events: RealmEvent[]): RealmEvent[] {
  if (events.length === 0) return log
  return [...log, ...events].slice(-REALM_LOG_LENGTH)
}

/** The text with its first letter in capitals. */
function cap(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1)
}

/** A good's name in a sentence: `ironOre` is "iron ore". */
/** How far a trade moved standing, as the end of its line (`CONTEXT.md`: Trade section). */
function standingMoved(moved: StandingMove | undefined): string {
  return moved ? ` Standing with ${moved.name} ${formatMove(moved.by)}.` : ''
}

function goodText(good: string): string {
  return good.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)
}

/**
 * An open delivery or pick-up in the game's words (`CONTEXT.md`: Delivery), for the list above
 * the realm log.
 */
export function describeDelivery(d: DeliveryView): string {
  const what = `${d.units} ${goodText(d.good)}`
  const job = d.kind === 'delivery' ? `${what} to ${d.city}` : `up to ${what} from ${d.city}`
  const state = d.underway ? 'a caravan is on it' : 'waiting for a caravan at the warehouse'
  return `${d.kind === 'delivery' ? 'Delivery' : 'Pick-up'} of ${job}: ${state}.`
}

/** Why the army headed home, to end a sentence about `city`; nothing if it got what it came for. */
function punishmentEnd(why: PunishmentEnd | undefined, city: string): string {
  switch (why) {
    case 'empty':
      return `: the storages of ${city} held nothing`
    case 'gaveUp':
      return ': it ran out of time there'
    case 'cityLost':
      return `: ${city} is no longer yours`
    case 'directiveLifted':
      return ': the admin directive was lifted'
    case 'noWay':
      return `: it found no way to ${city}`
    case 'paid':
      return ': your debt is paid'
    case 'noWorkplaces':
      return `: ${city} has no workplaces left to tear down`
    case 'tookCity':
      return `: ${city} is a trading post of the Trade Organization now`
    default:
      return ''
  }
}

/** Who holds a town hall or took a city, by the name the log has for them: most are a realm. */
const realmCalled = (other: string | null) =>
  other === TRADE_ORG_NAME ? TRADE_ORG_NAME : `the realm of ${other}`

/** A line about what the realm owes the Trade Organization (`CONTEXT.md`: Trade Org debt). */
function debtLine(e: Extract<RealmEvent, { kind: 'debt' }>): EventLine {
  switch (e.what) {
    case 'owed':
      return {
        text: `You owe the Trade Organization ${e.owed} Coins, what its army came for and couldn't take. Pay at any of its warehouses.`,
        tone: 'bad',
      }
    case 'postOwed':
      return {
        text: `The Trade Organization heard you took its trading post: you owe it ${e.owed} Coins, its worth. Pay at any of its warehouses.`,
        tone: 'bad',
      }
    case 'rose':
      return {
        text: `What you cost the Trade Organization adds ${e.coins} Coins to your debt: you owe it ${e.owed} Coins.`,
        tone: 'bad',
      }
    case 'postReturned':
      return {
        text:
          e.owed > 0
            ? `Giving back its trading post took ${e.coins} Coins off your debt. You still owe the Trade Organization ${e.owed} Coins.`
            : `Giving back its trading post settled your debt. You no longer owe the Trade Organization anything.`,
        tone: 'info',
      }
    case 'collected':
      return {
        text:
          e.owed > 0
            ? `A caravan brought ${e.coins} Coins of your debt to the Trade Organization. You still owe it ${e.owed} Coins.`
            : `A caravan brought ${e.coins} Coins of your debt to the Trade Organization. You no longer owe it anything.`,
        tone: 'info',
      }
    case 'overdue':
      return {
        text: `You still owe the Trade Organization ${e.owed} Coins and its demand is over: its next army comes for your workplaces. Paying in full at any of its warehouses stops it.`,
        tone: 'bad',
      }
    case 'cityTaken':
      return {
        text: `Taking your city settled your debt of ${e.coins} Coins to the Trade Organization.`,
        tone: 'bad',
      }
    case 'ended':
      return {
        text: `Your debt of ${e.coins} Coins ended with the fall of the Trade Org HQ.`,
        tone: 'info',
      }
  }
}

/** A line about the Trade Organization's army (`CONTEXT.md`: Punishment trip). */
function punishedLine(e: Extract<RealmEvent, { kind: 'punished' }>): EventLine {
  const army = "The Trade Organization's army"
  const taking = `${e.took ?? 0} of the ${e.worth} Coins' worth it came for`
  const tornDown = `having torn down ${e.took ?? 0} of the ${e.worth} Coins' worth you owed`
  switch (e.what) {
    case 'coming':
      return {
        text: e.takes
          ? `The Trade Organization is sending its army to ${e.city} to hold its town hall and take the city for the ${e.worth} Coins you owe. Paying in full at any of its warehouses stops it.`
          : e.wrecks
          ? `The Trade Organization is sending its army to ${e.city} to tear down workplaces for the ${e.worth} Coins you owe.`
          : e.directive === undefined
            ? `The Trade Organization is sending its army to ${e.city} to take back ${e.worth} Coins' worth.`
            : `By admin directive (${e.directive}), the Trade Organization is sending its army to ${e.city} to take ${e.worth} Coins' worth.`,
        tone: 'bad',
      }
    case 'arrived':
      return { text: `${army} has arrived at ${e.city}.`, tone: 'bad' }
    case 'left':
      return {
        text: e.takes
          ? `${army} left ${e.city}${punishmentEnd(e.why, e.city)}.`
          : `${army} left ${e.city}, ${e.wrecks ? tornDown : `taking ${taking}`}${punishmentEnd(e.why, e.city)}.`,
        tone: 'warn',
      }
    case 'turnedBack':
      return {
        text: `${army} turned back without reaching ${e.city}${punishmentEnd(e.why, e.city)}.`,
        tone: 'info',
      }
    case 'lost':
      return {
        text:
          e.where === 'wayThere'
            ? `${army} was lost on its way to ${e.city}.`
            : e.where === 'atCity'
              ? e.takes
                ? `${army} was lost at ${e.city}.`
                : `${army} was lost at ${e.city}, ${e.wrecks ? tornDown : `having taken ${taking}`}.`
              : e.wrecks || e.takes
                ? `${army} was lost on its way home from ${e.city}.`
                : `${army} was lost on its way home from ${e.city}, with ${taking}.`,
        tone: 'info',
      }
  }
}
