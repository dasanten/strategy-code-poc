import { sharingSight, type RealmLabel } from './alliance.js'
import { DEMANDS_PER_GAME_DAY, DEMAND_NOTE_MAX_LENGTH } from './balance.js'
import { organizationLabel } from './standing.js'
import {
  TICKS_PER_GAME_DAY,
  type Demand,
  type DemandTerms,
  type Realm,
  type WorldState,
} from './world.js'

/** World queries about demands (`CONTEXT.md`: Demand; ADR 0002: the API orders and scripts share). */

/** Control characters but tab and line breaks: they mean nothing in a note and can garble a page. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/

/**
 * What is wrong with a demand's note, if anything: it must be text, trimmed not empty, at most
 * `DEMAND_NOTE_MAX_LENGTH` characters and free of control characters. It is kept and shown as
 * plain text, so markup in it is only ever read as the words it is.
 */
export function demandNoteProblem(note: unknown): string | undefined {
  if (typeof note !== 'string' || note.trim() === '') return 'a demand needs a note'
  if (note.trim().length > DEMAND_NOTE_MAX_LENGTH) {
    return `a note is at most ${DEMAND_NOTE_MAX_LENGTH} characters`
  }
  if (CONTROL_CHARACTERS.test(note)) return 'a note can’t hold control characters'
  return undefined
}

/** When the realm sent the demands that still count against `DEMANDS_PER_GAME_DAY`. */
export function demandsCounted(realm: Pick<Realm, 'demandsSentAt'>, tick: number): number[] {
  return (realm.demandsSentAt ?? []).filter((at) => tick - at < TICKS_PER_GAME_DAY)
}

/** How many more demands the realm may send now. */
export function demandsLeft(realm: Pick<Realm, 'demandsSentAt'>, tick: number): number {
  return Math.max(0, DEMANDS_PER_GAME_DAY - demandsCounted(realm, tick).length)
}

/**
 * The other realms a realm knows of (`CONTEXT.md`: Demand): those it sees residents of
 * (`seenRealms`, which may hold anything else too), its allies, those whose cities it has seen
 * (Last seen), those with a standing toward it or it toward them, and its sides in contracts and
 * demands.
 */
export function realmsKnownTo(
  world: Pick<
    WorldState,
    'realms' | 'alliances' | 'lastSeen' | 'standings' | 'contracts' | 'demands'
  >,
  realmId: string,
  seenRealms: Iterable<string>,
): string[] {
  const known = new Set<string>(seenRealms)
  for (const id of sharingSight(world, realmId)) known.add(id)
  const userId = world.realms.find((r) => r.id === realmId)?.userId
  const remembered = userId === undefined ? undefined : world.lastSeen[userId]
  for (const m of remembered ?? []) {
    if (m.is === 'city' && m.realmId !== null) known.add(m.realmId)
  }
  for (const s of world.standings) {
    if (s.of === realmId) known.add(s.toward)
    if (s.toward === realmId) known.add(s.of)
  }
  for (const c of world.contracts) {
    if (c.lenderId === realmId) known.add(c.hirerId)
    if (c.hirerId === realmId) known.add(c.lenderId)
  }
  for (const d of world.demands) {
    if (d.fromId === realmId) known.add(d.toId)
    if (d.toId === realmId) known.add(d.fromId)
  }
  return world.realms.map((r) => r.id).filter((id) => id !== realmId && known.has(id))
}

/** A demand as one of its sides sees it. */
export interface DemandView {
  id: string
  from: RealmLabel
  to: RealmLabel
  terms: DemandTerms
  /** The sender's words: plain text, never markup. */
  note: string
  sentAt: number
  deadline: number
}

/** The demands waiting for an answer that the realm sent or was sent, oldest first. */
export function demandsFor(
  world: Pick<WorldState, 'demands' | 'realms' | 'residents' | 'cities'>,
  realmId: string,
): DemandView[] {
  const label = (id: string): RealmLabel => ({ realmId: id, realm: organizationLabel(world, id) })
  return world.demands
    .filter((d: Demand) => d.fromId === realmId || d.toId === realmId)
    .map((d) => ({
      id: d.id,
      from: label(d.fromId),
      to: label(d.toId),
      terms: d.terms,
      note: d.note,
      sentAt: d.sentAt,
      deadline: d.deadline,
    }))
}
