import {
  REALM_LOG_LENGTH,
  TRADE_ORG_NAME,
  timeLeft,
  type DeliveryView,
  type RealmEvent,
} from '@csp/shared'
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

/** Goods as the log names them: "5 Food, 2 Iron Ore". */
function goodsLine(goods: Partial<Record<string, number>> | undefined): string {
  return Object.entries(goods ?? {})
    .map(([g, n]) => `${n} ${g[0]!.toUpperCase()}${g.slice(1).replace(/[A-Z]/g, (c) => ` ${c}`)}`)
    .join(', ')
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
      return e.what === 'coming'
        ? {
            text:
              e.directive === undefined
                ? `The Trade Organization is sending its army to ${e.city} to take back ${e.worth} Coins' worth.`
                : `By admin directive (${e.directive}), the Trade Organization is sending its army to ${e.city} to take ${e.worth} Coins' worth.`,
            tone: 'bad',
          }
        : {
            text: `The Trade Organization's army left ${e.city}, taking ${e.took ?? 0} of the ${e.worth} Coins' worth it came for.`,
            tone: 'warn',
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
          text: `The realm of ${e.other} captured ${e.city} and its ${people}.`,
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
            text: `Your town hall in ${e.city} is occupied by the realm of ${e.other}: it falls in ${days} unless you retake it.`,
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
            text: `The occupation of your town hall in ${e.city} by the realm of ${e.other} is broken.`,
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
    case 'offerAccepted': {
      const place = { name: 'the storage', x: e.x, y: e.y }
      if (e.times === 0) {
        return {
          text: `${e.name} couldn’t accept the offer of ${e.realm}.`,
          tone: 'warn',
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
        text: `${e.name} swapped ${e.gave} ${goodText(e.give)} for ${e.units} ${goodText(e.want)}${cut}${back} at ${place.name}.`,
        tone: 'info',
        places: [place],
      }
    }
    case 'offerTaken':
      return {
        text: `${e.by} took your offer: ${e.givesUnits} ${goodText(e.gives)} for ${e.wantsUnits} ${goodText(e.wants)}.`,
        tone: 'info',
        places: [{ name: 'the storage', x: e.x, y: e.y }],
      }
    case 'offerCutDown':
      return {
        text: `Goods gone from the storage cut your offer of ${e.givesUnits} ${goodText(e.gives)} for ${e.wantsUnits} ${goodText(e.wants)} down to ${e.times} ${e.times === 1 ? 'time' : 'times'}.`,
        tone: 'warn',
        places: [{ name: 'the storage', x: e.x, y: e.y }],
      }
    case 'offerEnded': {
      const what = `${e.givesUnits} ${goodText(e.gives)} for ${e.wantsUnits} ${goodText(e.wants)}`
      const yours = e.to
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
      const what = `${e.givesUnits} ${goodText(e.gives)} for ${e.wantsUnits} ${goodText(e.wants)}`
      const place = { name: 'the storage', x: e.x, y: e.y }
      const them = `the realm of ${e.from}`
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
