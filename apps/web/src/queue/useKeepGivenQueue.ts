import { useEffect } from 'react'
import type { Resident } from '@csp/shared-types'
import { planOf } from './queue-view.js'
import { browserStorage, keepGivenQueue } from './saved-queues.js'

/**
 * A queue the game gave under a name (the stable hand's "Farm and feed") goes into the saved
 * queues once (`CONTEXT.md`: Starting city, Saved queue), when the Player's resident first shows
 * with it, whichever tab of their card is open.
 */
export function useKeepGivenQueue(r: Pick<Resident, 'owner' | 'queue'>, realmId: string) {
  const given = r.owner === realmId && r.queue?.name ? r.queue : undefined
  useEffect(() => {
    if (given?.name && realmId) {
      keepGivenQueue(browserStorage(), realmId, given.name, planOf(given).items, Date.now())
    }
    // Once a name, not every tick: the steps are read when it first shows.
  }, [given?.name, realmId])
}
