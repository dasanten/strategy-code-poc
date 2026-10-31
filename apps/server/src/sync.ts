import type { SeenEntity } from '@csp/shared'

/**
 * What one connection has been sent so far, so each tick only sends the difference
 * (ADR 0006): entities in sight that changed, and ids that left sight. The same keeps a
 * Player's Last seen out of sight in step.
 */
export class ClientView<T extends { id: string } = SeenEntity> {
  private sent = new Map<string, string>()

  /** Everything in sight, for the welcome message; remembers it as sent. */
  initial(entities: readonly T[]): T[] {
    this.sent.clear()
    for (const e of entities) this.sent.set(e.id, JSON.stringify(e))
    return [...entities]
  }

  diff(entities: readonly T[]): { changed: T[]; gone: string[] } {
    const changed: T[] = []
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
