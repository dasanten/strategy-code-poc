import { REALM_LOG_LENGTH, type RealmEvent } from '@csp/shared'
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
