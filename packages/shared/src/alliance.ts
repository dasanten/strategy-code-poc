import {
  CRIME_MEMORY_DAYS,
  NPC_ALLIANCE_JOIN_STANDING,
  NPC_ALLIANCE_LEAVE_STANDING,
} from './balance.js'
import { contractOf, contractsFor, type ContractView } from './contract.js'
import { organizationLabel, standingOf, standingsFor, type StandingView } from './standing.js'
import { TRADE_ORG, TRADE_ORG_NAME } from './trade-org.js'
import {
  TICKS_PER_GAME_DAY,
  type Alliance,
  type AllianceArmyPart,
  type Carriage,
  type Resident,
  type WorldState,
} from './world.js'

/**
 * World queries about alliances (ADR 0002: the game API orders and scripts share). A member is
 * a Player's realm or an NPC city (`CONTEXT.md`: NPC city in an alliance), named by its id.
 */

/**
 * Whether `id` names an NPC city that can be in an alliance (`CONTEXT.md`: NPC city in an
 * alliance): a city of no realm, never one of the Trade Organization's.
 */
export function isAllianceCity(world: Pick<WorldState, 'cities'>, id: string): boolean {
  return world.cities.some((c) => c.id === id && c.realmId === null && c.tradeOrg === undefined)
}

/** Whether the NPC city `cityId` knows of a crime by `org` against it in the last `CRIME_MEMORY_DAYS`. */
export function knowsRecentCrime(
  world: Pick<WorldState, 'crimes' | 'tick'>,
  cityId: string,
  org: string,
): boolean {
  const since = world.tick - CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY
  return world.crimes.some(
    (c) =>
      c.victimOrg === cityId &&
      c.culprit.org === org &&
      c.knownBy.includes(cityId) &&
      c.tick > since,
  )
}

/**
 * Whether the NPC city `cityId` accepts an invitation to the alliance (`CONTEXT.md`: NPC city in
 * an alliance): it holds every member in at least `NPC_ALLIANCE_JOIN_STANDING` and knows of no
 * recent crime by any of them against it.
 */
export function npcCityAccepts(
  world: Pick<WorldState, 'standings' | 'cities' | 'crimes' | 'tick'>,
  cityId: string,
  alliance: Pick<Alliance, 'members'>,
): boolean {
  return alliance.members.every(
    (m) =>
      standingOf(world, cityId, m.realmId) >= NPC_ALLIANCE_JOIN_STANDING &&
      !knowsRecentCrime(world, cityId, m.realmId),
  )
}

/**
 * Whether the NPC city `cityId` leaves its alliance on its own (`CONTEXT.md`: NPC city in an
 * alliance): its standing toward some other member fell below `NPC_ALLIANCE_LEAVE_STANDING`.
 */
export function npcCityWantsOut(
  world: Pick<WorldState, 'standings' | 'cities'>,
  cityId: string,
  alliance: Pick<Alliance, 'members'>,
): boolean {
  return alliance.members.some(
    (m) =>
      m.realmId !== cityId && standingOf(world, cityId, m.realmId) < NPC_ALLIANCE_LEAVE_STANDING,
  )
}

/** The longest an alliance's name may be. */
export const ALLIANCE_NAME_MAX_LENGTH = 30

/** The alliance whose army holds the resident or carriage `id` (`CONTEXT.md`: Alliance army). */
export function handedOverTo(
  world: Pick<WorldState, 'alliances'>,
  id: string,
): Alliance | undefined {
  return world.alliances.find((a) => a.army.some((p) => p.id === id))
}

/** The part of an alliance army that is the resident or carriage `id`, if any. */
export function armyPartOf(
  world: Pick<WorldState, 'alliances'>,
  id: string,
): AllianceArmyPart | undefined {
  for (const a of world.alliances) {
    const part = a.army.find((p) => p.id === id)
    if (part) return part
  }
  return undefined
}

/**
 * The realm whose orders the resident takes: the alliance leader's while they are handed over to
 * its army (`CONTEXT.md`: Alliance army), the hirer's while a mercenary contract rents them out
 * (`CONTEXT.md`: Mercenary contract), their own realm's otherwise; null for a resident of no
 * realm.
 */
export function commanderOf(
  world: Pick<WorldState, 'alliances' | 'contracts'>,
  r: Pick<Resident, 'id' | 'owner'>,
): string | null {
  return handedOverTo(world, r.id)?.leaderId ?? contractOf(world, r.id)?.hirerId ?? r.owner
}

/** The realm whose orders the carriage takes, as `commanderOf` for a resident. */
export function carriageCommanderOf(
  world: Pick<WorldState, 'alliances'>,
  k: Carriage,
): string | null {
  return handedOverTo(world, k.id)?.leaderId ?? k.realmId
}

/** Whether the realm's Player may give the resident orders. */
export function commands(
  world: Pick<WorldState, 'alliances' | 'contracts'>,
  realmId: string,
  r: Resident | undefined,
): r is Resident {
  return r !== undefined && commanderOf(world, r) === realmId
}

/** Whether the realm's Player may give orders with the carriage. */
export function commandsCarriage(
  world: Pick<WorldState, 'alliances'>,
  realmId: string,
  k: Carriage | undefined,
): k is Carriage {
  return k !== undefined && carriageCommanderOf(world, k) === realmId
}

/** The alliance the realm is a member of, if any (`CONTEXT.md`: Alliance: at most one). */
export function allianceOf(
  world: Pick<WorldState, 'alliances'>,
  realmId: string,
): Alliance | undefined {
  return world.alliances.find((a) => a.members.some((m) => m.realmId === realmId))
}

/**
 * The realm and its allies: every member of its alliance, or just itself when in none. A member
 * that is leaving counts until the leave delay is over (`CONTEXT.md`: Alliance).
 */
export function alliedRealms(world: Pick<WorldState, 'alliances'>, realmId: string): string[] {
  const alliance = allianceOf(world, realmId)
  return alliance ? alliance.members.map((m) => m.realmId) : [realmId]
}

/**
 * Whether two realms stand together: the same realm, or members of one alliance. Allies pass
 * each other's gates, stand on each other's walls, and don't attack each other unless ordered
 * to (`CONTEXT.md`: Alliance).
 */
export function allied(world: Pick<WorldState, 'alliances'>, a: string, b: string): boolean {
  return a === b || alliedRealms(world, a).includes(b)
}

/**
 * The realms whose residents a realm's Player sees through (`CONTEXT.md`: Sight): their own, and
 * every member of their alliance. A member that is leaving shares until the leave delay is over.
 */
export function sharingSight(world: Pick<WorldState, 'alliances'>, realmId: string): string[] {
  return alliedRealms(world, realmId)
}

/**
 * How a realm is called to other Players: by its Leader's name. The Trade Organization, a side
 * like a realm in contracts, by its own.
 */
export function realmName(
  world: Pick<WorldState, 'realms' | 'residents'>,
  realmId: string,
): string {
  if (realmId === TRADE_ORG) return TRADE_ORG_NAME
  const realm = world.realms.find((r) => r.id === realmId)
  const leader = realm && world.residents.find((r) => r.id === realm.leaderId)
  return leader?.name ?? 'a fallen realm'
}

/**
 * The realms that stand together, for weighing strength (such as the Trade Org HQ's check of the
 * strongest Organization): each alliance's members together, and every realm in no alliance on
 * its own.
 */
export function realmsStandingTogether(
  world: Pick<WorldState, 'alliances' | 'realms'>,
): string[][] {
  const groups = world.alliances.map((a) => a.members.map((m) => m.realmId))
  const allied = new Set(groups.flat())
  for (const r of world.realms) if (!allied.has(r.id)) groups.push([r.id])
  return groups
}

/**
 * A member as a Player sees it in alliance matters: its id and its name, a realm's by its
 * Leader's name, an NPC city's (`city`) its own.
 */
export interface RealmLabel {
  realmId: string
  realm: string
  city?: true
}

/** What a Player knows of alliances: their own, the invitations they hold, whom they could invite. */
export interface Diplomacy {
  /** The Player's alliance, with its members in the order they joined; null when in none. */
  alliance: {
    id: string
    name: string
    leaderId: string
    members: (RealmLabel & { joinedAt: number; leavesAt: number | null })[]
    invites: RealmLabel[]
    /** The alliance army: each part with its realm, and when a recall brings it back. */
    army: (RealmLabel & AllianceArmyPart)[]
  } | null
  /** Alliances whose leader invited the Player's realm. */
  invitations: { allianceId: string; name: string; leader: string }[]
  /**
   * Realms outside their alliance the Player sees residents of, and NPC cities outside it they
   * see, who could be invited.
   */
  realmsInSight: RealmLabel[]
  /** Mercenary contracts the realm is a side of, offered or in force (`CONTEXT.md`). */
  contracts: ContractView[]
  /** Standing between the realm and other Organizations (`CONTEXT.md`: Standing), shown only. */
  standings: StandingView[]
}

/**
 * The Player's alliance matters, as their realm sees them. `seenRealms` are the realms whose
 * residents are in the Player's sight, and the cities in it.
 */
export function diplomacyFor(
  world: Pick<
    WorldState,
    | 'alliances'
    | 'realms'
    | 'residents'
    | 'carriages'
    | 'contracts'
    | 'buildings'
    | 'standings'
    | 'cities'
  >,
  realmId: string,
  seenRealms: Iterable<string>,
): Diplomacy {
  const ownerOf = (p: AllianceArmyPart) =>
    p.is === 'resident'
      ? world.residents.find((r) => r.id === p.id)?.owner
      : world.carriages.find((k) => k.id === p.id)?.realmId
  const label = (id: string): RealmLabel => ({
    realmId: id,
    realm: organizationLabel(world, id),
    ...(isAllianceCity(world, id) && { city: true as const }),
  })
  const own = allianceOf(world, realmId)
  const alliance = own && {
    id: own.id,
    name: own.name,
    leaderId: own.leaderId,
    members: own.members.map((m) => ({
      ...label(m.realmId),
      joinedAt: m.joinedAt,
      leavesAt: m.leaving?.at ?? null,
    })),
    invites: own.invites.map(label),
    army: own.army.map((p) => ({ ...label(ownerOf(p) ?? ''), ...p })),
  }
  const invitations = world.alliances
    .filter((a) => a.invites.includes(realmId))
    .map((a) => ({ allianceId: a.id, name: a.name, leader: realmName(world, a.leaderId) }))
  const realms = new Set(world.realms.map((r) => r.id))
  const allies = new Set(sharingSight(world, realmId))
  const realmsInSight = [...new Set(seenRealms)]
    .filter(
      (id) => id !== realmId && !allies.has(id) && (realms.has(id) || isAllianceCity(world, id)),
    )
    .sort()
    .map(label)
  return {
    alliance: alliance ?? null,
    invitations,
    realmsInSight,
    contracts: contractsFor(world, realmId),
    standings: standingsFor(world, realmId),
  }
}
