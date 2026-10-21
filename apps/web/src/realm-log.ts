import { REALM_LOG_LENGTH, TRADE_ORG_NAME, type DeliveryView, type RealmEvent } from '@csp/shared'
import { BUILDING_NAMES } from './city-view.js'

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

/**
 * One line of the realm log, in the game's words (`CONTEXT.md`). `realmId` is the Player's realm,
 * so alliance events about it say so.
 */
export function describeEvent(e: RealmEvent, realmId?: string): EventLine {
  switch (e.kind) {
    case 'hungry':
      return { text: `${e.name} has nothing to eat and is starving.`, tone: 'warn' }
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
      const goods = Object.entries(e.goods ?? {})
        .map(
          ([g, n]) => `${n} ${g[0]!.toUpperCase()}${g.slice(1).replace(/[A-Z]/g, (c) => ` ${c}`)}`,
        )
        .join(', ')
      const did = {
        theft: `stole ${goods || 'goods'}`,
        attack: `attacked ${e.victim ?? 'one of your residents'}`,
        killing: `killed ${e.victim ?? 'one of your residents'}`,
        tearDown: `tore down your ${e.building ? BUILDING_NAMES[e.building] : 'building'}`,
      }[e.crime]
      return {
        text: `A witness got home: ${e.culprit} of ${e.culpritOrg} ${did} at (${e.x}, ${e.y}).`,
        tone: 'bad',
      }
    }
    case 'punished':
      return e.what === 'coming'
        ? {
            text: `The Trade Organization is sending its army to ${e.city} to take back ${e.worth} Coins' worth.`,
            tone: 'bad',
          }
        : {
            text: `The Trade Organization's army left ${e.city}, taking ${e.took ?? 0} of the ${e.worth} Coins' worth it came for.`,
            tone: 'warn',
          }
    case 'fled':
      return { text: `${e.name} was hit and flees home.`, tone: 'warn' }
    case 'cityCaptured': {
      const people = `${e.residents} resident${e.residents === 1 ? '' : 's'}`
      if (!e.captor) {
        return {
          text: `The realm of ${e.other} captured ${e.city} and its ${people}.`,
          tone: 'bad',
        }
      }
      const from = e.other === null ? '' : ` from the realm of ${e.other}`
      return { text: `You captured ${e.city}${from}, with its ${people}.`, tone: 'info' }
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
      const place = { name: 'the warehouse', x: e.x, y: e.y }
      if (e.units === 0) {
        return {
          text: `${e.name} couldn’t ${e.side} any ${what} at the warehouse.`,
          tone: 'warn',
          places: [place],
        }
      }
      const did = e.side === 'buy' ? 'bought' : 'sold'
      const cut = e.units < e.wanted ? ` (of ${e.wanted} wanted)` : ''
      return {
        text: `${e.name} ${did} ${e.units} ${what}${cut} for ${e.coins} coins at the warehouse.`,
        tone: 'info',
        places: [place],
      }
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
    case 'foodSpoiled':
      return { text: `${e.units} Food spoiled.`, tone: 'info' }
    case 'born':
      return { text: `${e.parents[0]} and ${e.parents[1]} had a child, ${e.name}.`, tone: 'info' }
    case 'grownUp':
      return { text: `${e.name} has grown up and can work now.`, tone: 'info' }
    case 'horseDied':
      return { text: 'A horse starved to death.', tone: 'bad' }
    case 'foaled':
      return { text: 'A foal was born in a stable.', tone: 'info' }
    case 'allianceInvited':
      return { text: `You were invited to join the alliance ${e.name}.`, tone: 'info' }
    case 'allianceJoined': {
      const who = e.realmId === realmId ? 'You' : `The realm of ${e.realm}`
      return { text: `${who} joined the alliance ${e.name}.`, tone: 'info' }
    }
    case 'allianceLeft': {
      const you = e.realmId === realmId
      const who = you ? 'Your realm' : `The realm of ${e.realm}`
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
