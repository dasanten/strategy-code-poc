import {
  REALM_LOG_LENGTH,
  type RealmEvent,
  type RealmEventWhat,
  type WorldState,
} from '@csp/shared'

/**
 * Writes down something that happened in a realm, in its Player's log; an event for no realm
 * (a resident or city that belongs to nobody) is not kept. Each Player keeps their latest
 * `REALM_LOG_LENGTH` events; the oldest go first.
 */
export function recordEvent(world: WorldState, realmId: string | null, what: RealmEventWhat): void {
  const realm = realmId === null ? undefined : world.realms.find((x) => x.id === realmId)
  if (!realm) return
  const event: RealmEvent = { ...what, seq: world.nextId++, tick: world.tick, userId: realm.userId }
  world.events.push(event)
  const mine = world.events.filter((e) => e.userId === realm.userId)
  if (mine.length > REALM_LOG_LENGTH) {
    const drop = new Set(mine.slice(0, mine.length - REALM_LOG_LENGTH))
    world.events = world.events.filter((e) => !drop.has(e))
  }
}

/** A Player's events numbered after `after`, oldest first: the whole log when `after` is 0. */
export function eventsFor(world: WorldState, userId: number, after = 0): RealmEvent[] {
  return world.events.filter((e) => e.userId === userId && e.seq > after)
}
