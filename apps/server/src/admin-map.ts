import {
  ADMIN_VIEW_MAX_SIDE,
  TRADE_ORGANIZATION,
  TRADE_ORG_NAME,
  allianceOf,
  cityOrganization,
  realmName,
  regionMapFor,
  townHallOf,
  wrap,
  type AdminEntity,
  type AdminOrganization,
  type AdminPlace,
  type AdminPlaces,
  type AdminScript,
  type AdminViewRequest,
  type AdminWorldView,
  type RegionMap,
  type RunningScript,
  type Territory,
  type WorldState,
} from '@csp/shared'

/*
 * The admin map's world (`CONTEXT.md`: Admin, admin map): everything in it for admins, read from
 * the running world between ticks and never changing it. The knowledge is the admin's: nothing
 * here feeds a Player's sight-limited sync.
 */

/** Looks up what the world only knows by id: a Player's account name, a script's name. */
export interface AdminLookups {
  accountOf: (userId: number) => string | undefined
  scriptName: (scriptId: number) => string | undefined
}

/**
 * Reads a rectangle from query parameters (`adminWorldPath`), or says what is wrong with it: whole
 * numbers, at most `ADMIN_VIEW_MAX_SIDE` across, or up to the whole map for cities only.
 */
export function parseAdminView(
  query: Record<string, string | undefined>,
  size: number,
): AdminViewRequest | string {
  const [x, y, w, h] = (['x', 'y', 'w', 'h'] as const).map((k) => Number(query[k] ?? NaN))
  if (![x, y, w, h].every(Number.isInteger)) return 'x, y, w and h must be whole numbers.'
  const citiesOnly = query.citiesOnly === '1'
  const most = citiesOnly ? size : ADMIN_VIEW_MAX_SIDE
  if (w! < 1 || h! < 1 || w! > most || h! > most) {
    return `w and h must be from 1 to ${most}.`
  }
  return { x: x!, y: y!, w: w!, h: h!, citiesOnly }
}

/** Whether a tile lies in the rectangle, which wraps around the map's edges. */
function inView(view: AdminViewRequest, size: number, at: { x: number; y: number }): boolean {
  return wrap(at.x - view.x, size) < view.w && wrap(at.y - view.y, size) < view.h
}

/** A running script with its name and memory, its source left out. */
function adminScript(script: RunningScript, lookups: AdminLookups): AdminScript {
  return {
    scriptId: script.scriptId,
    name: lookups.scriptName(script.scriptId) ?? null,
    memory: script.memory,
  }
}

/** An Organization by id as the admin map shows it (`cityOrganization` names them). */
function adminOrganization(
  world: WorldState,
  id: string,
  lookups: AdminLookups,
): AdminOrganization {
  const alliance = allianceOf(world, id)
  const inAlliance = alliance ? { id: alliance.id, name: alliance.name } : null
  if (id === TRADE_ORGANIZATION) {
    return { id, is: 'tradeOrg', name: TRADE_ORG_NAME, alliance: null }
  }
  const realm = world.realms.find((r) => r.id === id)
  if (realm) {
    const account = lookups.accountOf(realm.userId)
    return {
      id,
      is: 'realm',
      name: realmName(world, id),
      ...(account !== undefined ? { account } : {}),
      alliance: inAlliance,
    }
  }
  const name = world.cities.find((c) => c.id === id)?.name ?? 'a lost city'
  return { id, is: 'city', name, alliance: inAlliance }
}

/**
 * Every entity in the rectangle, each with its Organization (`AdminWorldView`): residents, cities
 * (where their town hall stands), buildings, horses, carriages, piles, armies (when any member is
 * in it) and caravans (when their carriage or any of their crew is). With `citiesOnly`, cities
 * alone.
 */
export function adminWorldView(
  world: WorldState,
  size: number,
  view: AdminViewRequest,
  lookups: AdminLookups,
): AdminWorldView {
  const here = (at: { x: number; y: number }) => inView(view, size, at)
  const cities = new Map(world.cities.map((c) => [c.id, c]))
  const cityOrg = (cityId: string | null) => {
    const city = cityId === null ? undefined : cities.get(cityId)
    return city ? cityOrganization(city) : null
  }
  const out: AdminEntity[] = []
  for (const c of world.cities) {
    const hall = townHallOf(world, c)
    if (hall && here(hall))
      out.push({ is: 'city', ...c, x: hall.x, y: hall.y, org: cityOrganization(c) })
  }
  if (!view.citiesOnly) {
    for (const r of world.residents) {
      if (!here(r)) continue
      const { script, ...rest } = r
      out.push({
        is: 'resident',
        ...rest,
        ...(script ? { script: adminScript(script, lookups) } : {}),
        org: r.owner ?? cityOrg(r.cityId),
      })
    }
    for (const b of world.buildings) {
      if (here(b)) out.push({ is: 'building', ...b, org: cityOrg(b.cityId) })
    }
    for (const h of world.horses) {
      if (here(h)) out.push({ is: 'horse', ...h, org: h.realmId ?? cityOrg(h.cityId) })
    }
    for (const k of world.carriages) {
      if (here(k)) out.push({ is: 'carriage', ...k, org: k.realmId ?? cityOrg(k.cityId) })
    }
    for (const p of world.piles) if (here(p)) out.push({ is: 'pile', ...p, org: null })
    const residentHere = new Set(world.residents.filter(here).map((r) => r.id))
    for (const a of world.armies) {
      if (!a.memberIds.some((id) => residentHere.has(id))) continue
      const { script, ...rest } = a
      out.push({
        is: 'army',
        ...rest,
        ...(script ? { script: adminScript(script, lookups) } : {}),
        org: a.realmId,
      })
    }
    const carriageHere = new Set(world.carriages.filter(here).map((k) => k.id))
    for (const c of world.caravans) {
      const crew = [c.driverId, ...c.escortIds]
      if (!carriageHere.has(c.carriageId) && !crew.some((id) => residentHere.has(id))) continue
      out.push({ is: 'caravan', ...c, org: TRADE_ORGANIZATION })
    }
  }
  const orgIds = new Set(out.flatMap((e) => (e.org === null ? [] : [e.org])))
  const orgs = [...orgIds].sort().map((id) => adminOrganization(world, id, lookups))
  return { tick: world.tick, orgs, entities: out }
}

/** The jump list for the whole world (`AdminPlaces`), each list by name. */
export function adminPlaces(world: WorldState, lookups: AdminLookups): AdminPlaces {
  const residents = new Map(world.residents.map((r) => [r.id, r]))
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  const cityPlace = (c: WorldState['cities'][number]): AdminPlace | null => {
    const hall = townHallOf(world, c)
    return hall ? { id: c.id, name: c.name, x: hall.x, y: hall.y } : null
  }
  const placesOf = (cities: WorldState['cities']) =>
    cities.flatMap((c) => cityPlace(c) ?? []).sort(byName)
  const inAlliance = (id: string) => {
    const a = allianceOf(world, id)
    return a ? { id: a.id, name: a.name } : null
  }

  const realms = world.realms
    .map((realm) => {
      const leader = residents.get(realm.leaderId)
      return {
        id: realm.id,
        account: lookups.accountOf(realm.userId) ?? null,
        name: realmName(world, realm.id),
        alliance: inAlliance(realm.id),
        leader: leader ? { id: leader.id, name: leader.name, x: leader.x, y: leader.y } : null,
        cities: placesOf(world.cities.filter((c) => c.realmId === realm.id && !c.tradeOrg)),
      }
    })
    .sort(byName)
  const npcCities = world.cities
    .filter((c) => c.realmId === null && !c.tradeOrg)
    .flatMap((c) => {
      const place = cityPlace(c)
      if (!place) return []
      return [{ ...place, selfManaged: c.formerPlayer !== undefined, alliance: inAlliance(c.id) }]
    })
    .sort(byName)

  const hq = world.cities.find((c) => c.tradeOrg === 'hq')
  const posts = world.cities.filter((c) => c.tradeOrg === 'post')
  const carriages = new Map(world.carriages.map((k) => [k.id, k]))
  const caravans = world.caravans
    .flatMap((c) => {
      const at = carriages.get(c.carriageId) ?? residents.get(c.driverId)
      if (!at) return []
      const name = world.cities.find((p) => p.id === c.postId)?.name ?? 'a lost post'
      return [{ id: c.id, name, x: at.x, y: at.y, postId: c.postId, heading: c.heading }]
    })
    .sort(byName)

  const armies = world.armies
    .flatMap((a) => {
      const member = a.memberIds.map((id) => residents.get(id)).find((r) => r !== undefined)
      if (!member) return []
      const realm = realmName(world, a.realmId)
      return [{ id: a.id, name: a.name, x: member.x, y: member.y, realmId: a.realmId, realm }]
    })
    .sort(byName)

  return {
    tick: world.tick,
    realms,
    npcCities,
    tradeOrg: { hq: (hq && cityPlace(hq)) ?? null, posts: placesOf(posts), caravans },
    armies,
  }
}

/** The whole map's territory (`CONTEXT.md`: Territory): the Region map without the explored filter. */
export function adminTerritory(world: WorldState, territory: Territory, size: number): RegionMap {
  return regionMapFor(world, territory, size, () => true)
}
