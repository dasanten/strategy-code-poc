import type { SeenEntity } from '@csp/shared'

/** What changed for a view since it was last sent, and the ids that left sight. */
export interface Diff<T> {
  changed: T[]
  gone: string[]
}

/** What one connection was last sent, as JSON by id. Never changed once made, so views share it. */
type Sent = ReadonlyMap<string, string>

/**
 * One tick's sync for every connection (Epic 49): each entity in a list is turned into JSON once
 * however many views diff against that list, and views that were sent the same get the same
 * diff, worked out once. A realm's sockets get the same list from the sight cache, so all of a
 * realm's in-step sockets share the work. Made for one broadcast and dropped after it.
 */
export class SyncRound<T extends { id: string } = SeenEntity> {
  /** Each list as JSON by id: what a view that diffed against it was sent afterwards. */
  private readonly lists = new Map<readonly T[], Sent>()
  /** The diff worked out from what views were sent before, and against which list. */
  private readonly diffs = new Map<Sent, { list: readonly T[]; diff: Diff<T> }>()
  /** What a view was sent after each diff, as JSON by id. */
  private readonly afters = new WeakMap<Diff<T>, Sent>()
  /** The tick message's `changed` and `gone` as JSON, for each diff (`fragment`). */
  private readonly fragments = new WeakMap<Diff<T>, string>()

  constructor(private readonly json: (e: T) => string = JSON.stringify) {}

  /** The list as JSON by id, made once. */
  sent(list: readonly T[]): Sent {
    let sent = this.lists.get(list)
    if (!sent) {
      sent = new Map(list.map((e) => [e.id, this.json(e)]))
      this.lists.set(list, sent)
    }
    return sent
  }

  /** The diff of `before` against the list, worked out once per `before` and list. */
  diff(before: Sent, list: readonly T[]): Diff<T> {
    const known = this.diffs.get(before)
    if (known?.list === list) return known.diff
    const after = this.sent(list)
    const changed: T[] = []
    // `!==` on strings checks the reference before the characters: views in step share one
    // diff, so this runs once per group of them, not once per socket.
    for (const e of list) if (before.get(e.id) !== after.get(e.id)) changed.push(e)
    const gone = [...before.keys()].filter((id) => !after.has(id))
    const diff = { changed, gone }
    this.diffs.set(before, { list, diff })
    this.afters.set(diff, after)
    return diff
  }

  /**
   * `"changed":[…],"gone":[…]` for a diff this round made, from the JSON it already has, so the
   * tick message of every socket that shares the diff splices in the same string.
   */
  fragment(diff: Diff<T>): string {
    let out = this.fragments.get(diff)
    if (out === undefined) {
      const after = this.afters.get(diff)
      if (!after) throw new Error('not a diff of this round')
      const json = diff.changed.map((e) => after.get(e.id)!)
      out = `"changed":[${json.join(',')}],"gone":${JSON.stringify(diff.gone)}`
      this.fragments.set(diff, out)
    }
    return out
  }
}

/**
 * What one connection has been sent so far, so each tick only sends the difference
 * (ADR 0006): entities in sight that changed, and ids that left sight. The same keeps a
 * Player's Last seen out of sight in step. Within a `SyncRound` the views that diff against one
 * list end up sharing what they were sent, so from then on they share the work.
 */
export class ClientView<T extends { id: string } = SeenEntity> {
  private sent: Sent = new Map()

  /** Everything in sight, for the welcome message; remembers it as sent. */
  initial(entities: readonly T[]): T[] {
    this.sent = new Map(entities.map((e) => [e.id, JSON.stringify(e)]))
    return [...entities]
  }

  diff(entities: readonly T[], round: SyncRound<T> = new SyncRound<T>()): Diff<T> {
    const diff = round.diff(this.sent, entities)
    this.sent = round.sent(entities)
    return diff
  }
}
