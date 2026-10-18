import type { Account, Unit, WorldState } from '@csp/shared'

/**
 * What a Player currently sees (CONTEXT.md, Sight). Placeholder: everything, until residents
 * with a sight range exist (slice 2). The sync below already sends only what this returns.
 */
export function entitiesInSight(world: WorldState, _account: Account): Unit[] {
  return world.units
}

/**
 * What one connection has been sent so far, so each tick only sends the difference
 * (ADR 0006): entities in sight that changed, and ids that left sight.
 */
export class ClientView {
  private sent = new Map<string, string>()

  /** Everything in sight, for the welcome message; remembers it as sent. */
  initial(entities: Unit[]): Unit[] {
    this.sent.clear()
    for (const e of entities) this.sent.set(e.id, JSON.stringify(e))
    return entities
  }

  diff(entities: Unit[]): { changed: Unit[]; gone: string[] } {
    const changed: Unit[] = []
    const seen = new Set<string>()
    for (const e of entities) {
      seen.add(e.id)
      const json = JSON.stringify(e)
      if (this.sent.get(e.id) !== json) {
        changed.push(e)
        this.sent.set(e.id, json)
      }
    }
    const gone = [...this.sent.keys()].filter((id) => !seen.has(id))
    for (const id of gone) this.sent.delete(id)
    return { changed, gone }
  }
}
