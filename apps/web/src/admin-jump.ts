import type { AdminPlace, AdminPlaces } from '@csp/shared'
import { CLOSE_SCALE } from './map/camera.js'
import { ADMIN_LINK_SCALE } from './admin-map.js'

/*
 * The admin map's jump list (`CONTEXT.md`: admin map): the places of the whole world by name,
 * grouped, filtered by a search, each a spot to centre the map on.
 */

/** The zoom a jump to someone (a Leader, an army, a caravan) lands at, in pixels per tile. */
export const ADMIN_JUMP_FIGURE_SCALE = CLOSE_SCALE + 6

/** What an entry on the jump list is. */
export type JumpKind = 'realm' | 'leader' | 'city' | 'npcCity' | 'hq' | 'post' | 'caravan' | 'army'

/** An entry on the jump list; `at` is null for a realm with neither a Leader nor a city. */
export interface JumpEntry {
  /** Unique on the list; a realm and its Leader's entry share no key. */
  key: string
  /** The id of what it names: the realm, resident, city, caravan or army. */
  id: string
  kind: JumpKind
  name: string
  /** A second, quieter line: the account and alliance, what kind of place it is. */
  detail?: string
  /** Listed under the entry before it (a realm's Leader and cities). */
  nested: boolean
  at: { x: number; y: number } | null
}

export interface JumpGroup {
  title: 'Realms' | 'NPC cities' | 'Trade Organization' | 'Armies'
  entries: JumpEntry[]
}

/** The zoom a jump to an entry lands at: a city in the middle tier, a figure close up. */
export function jumpScale(kind: JumpKind): number {
  return kind === 'leader' || kind === 'caravan' || kind === 'army'
    ? ADMIN_JUMP_FIGURE_SCALE
    : ADMIN_LINK_SCALE
}

const byName = <T extends { name: string }>(list: readonly T[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name))

const spot = (p: AdminPlace) => ({ x: p.x, y: p.y })

/**
 * The jump list for a search (by name: account, realm, alliance, city, army; any case). A realm
 * that matches by its own names keeps its Leader and every city; otherwise it shows only those
 * that match. Groups with nothing to show are left out.
 */
export function jumpList(places: AdminPlaces, search: string): JumpGroup[] {
  const q = search.trim().toLocaleLowerCase()
  const hit = (...names: (string | null | undefined)[]) =>
    q === '' || names.some((n) => n?.toLocaleLowerCase().includes(q))

  const realms: JumpEntry[] = []
  for (const r of byName(places.realms)) {
    const whole = hit(r.name, r.account, r.alliance?.name)
    const leader = r.leader && (whole || hit(r.leader.name)) ? r.leader : null
    const cities = byName(r.cities).filter((c) => whole || hit(c.name))
    if (!whole && !leader && cities.length === 0) continue
    const home = r.leader ?? r.cities[0]
    realms.push({
      key: `realm:${r.id}`,
      id: r.id,
      kind: 'realm',
      name: r.name,
      detail: [r.account ?? 'account gone', r.alliance && `[${r.alliance.name}]`]
        .filter(Boolean)
        .join(' '),
      nested: false,
      at: home ? spot(home) : null,
    })
    if (leader)
      realms.push({
        key: `leader:${leader.id}`,
        id: leader.id,
        kind: 'leader',
        name: leader.name,
        detail: 'Leader',
        nested: true,
        at: spot(leader),
      })
    for (const c of cities)
      realms.push({
        key: `city:${c.id}`,
        id: c.id,
        kind: 'city',
        name: c.name,
        nested: true,
        at: spot(c),
      })
  }

  const npcCities = byName(places.npcCities)
    .filter((c) => hit(c.name, c.alliance?.name))
    .map((c): JumpEntry => ({
      key: `city:${c.id}`,
      id: c.id,
      kind: 'npcCity',
      name: c.name,
      detail: [c.selfManaged ? 'self-managed' : undefined, c.alliance && `[${c.alliance.name}]`]
        .filter(Boolean)
        .join(' '),
      nested: false,
      at: spot(c),
    }))

  const { hq, posts, caravans } = places.tradeOrg
  const tradeEntry = (p: AdminPlace, kind: JumpKind, detail: string): JumpEntry => ({
    key: `${kind === 'caravan' ? 'caravan' : 'city'}:${p.id}`,
    id: p.id,
    kind,
    name: p.name,
    detail,
    nested: false,
    at: spot(p),
  })
  const tradeOrg: JumpEntry[] = [
    ...(hq && hit(hq.name) ? [tradeEntry(hq, 'hq', 'HQ')] : []),
    ...byName(posts)
      .filter((p) => hit(p.name))
      .map((p) => tradeEntry(p, 'post', 'trading post')),
    ...byName(caravans)
      .filter((c) => hit(c.name))
      .map((c) =>
        tradeEntry(c, 'caravan', c.heading === 'hq' ? 'caravan to the HQ' : 'caravan to its post'),
      ),
  ]

  const armies = byName(places.armies)
    .filter((a) => hit(a.name, a.realm))
    .map((a): JumpEntry => ({
      key: `army:${a.id}`,
      id: a.id,
      kind: 'army',
      name: a.name,
      detail: a.realm,
      nested: false,
      at: spot(a),
    }))

  const groups: JumpGroup[] = [
    { title: 'Realms', entries: realms },
    { title: 'NPC cities', entries: npcCities },
    { title: 'Trade Organization', entries: tradeOrg },
    { title: 'Armies', entries: armies },
  ]
  return groups.filter((g) => g.entries.length > 0)
}
