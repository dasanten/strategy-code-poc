import { REALM_LOG_LENGTH, type RealmEvent } from '@csp/shared'

/** How bad an event is, for its colour in the log. */
export type EventTone = 'bad' | 'warn' | 'info'

/** One line of the realm log, in the game's words (`CONTEXT.md`). */
export function describeEvent(e: RealmEvent): { text: string; tone: EventTone } {
  switch (e.kind) {
    case 'hungry':
      return { text: `${e.name} has nothing to eat and is starving.`, tone: 'warn' }
    case 'died': {
      const how = e.cause === 'starved' ? 'starved to death' : 'died of old age'
      if (e.leader) {
        return { text: `Your Leader ${e.name} ${how}. Your realm has ended.`, tone: 'bad' }
      }
      return { text: `${e.name} ${how}.`, tone: 'bad' }
    }
    case 'foodSpoiled':
      return { text: `${e.units} Food spoiled.`, tone: 'info' }
    case 'born':
      return { text: `${e.parents[0]} and ${e.parents[1]} had a child, ${e.name}.`, tone: 'info' }
    case 'horseDied':
      return { text: 'A horse starved to death.', tone: 'bad' }
    case 'foaled':
      return { text: 'A foal was born in a stable.', tone: 'info' }
  }
}

/** Adds a tick's new events to the log, keeping the latest `REALM_LOG_LENGTH` as the server does. */
export function appendEvents(log: RealmEvent[], events: RealmEvent[]): RealmEvent[] {
  if (events.length === 0) return log
  return [...log, ...events].slice(-REALM_LOG_LENGTH)
}
