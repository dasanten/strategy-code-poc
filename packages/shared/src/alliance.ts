import type { Alliance, AllianceArmyPart, Carriage, Resident, WorldState } from './world.js'

/** World queries about alliances (ADR 0002: the game API orders and scripts share). */

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
 * The realm whose orders the resident takes (`CONTEXT.md`: Alliance army): the alliance leader's
 * while they are handed over, their own realm's otherwise; null for a resident of no realm.
 */
export function commanderOf(world: Pick<WorldState, 'alliances'>, r: Resident): string | null {
  return handedOverTo(world, r.id)?.leaderId ?? r.owner
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
  world: Pick<WorldState, 'alliances'>,
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

/** How a realm is called to other Players: by its Leader's name. */
export function realmName(
  world: Pick<WorldState, 'realms' | 'residents'>,
  realmId: string,
): string {
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

/** A realm as a Player sees it in alliance matters: its id and its Leader's name. */
export interface RealmLabel {
  realmId: string
  realm: string
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
  /** Realms outside their alliance the Player sees residents of, who could be invited. */
  realmsInSight: RealmLabel[]
}

/**
 * The Player's alliance matters, as their realm sees them. `seenRealms` are the realms whose
 * residents are in the Player's sight.
 */
export function diplomacyFor(
  world: Pick<WorldState, 'alliances' | 'realms' | 'residents' | 'carriages'>,
  realmId: string,
  seenRealms: Iterable<string>,
): Diplomacy {
  const ownerOf = (p: AllianceArmyPart) =>
    p.is === 'resident'
      ? world.residents.find((r) => r.id === p.id)?.owner
      : world.carriages.find((k) => k.id === p.id)?.realmId
  const label = (id: string): RealmLabel => ({ realmId: id, realm: realmName(world, id) })
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
    .filter((id) => id !== realmId && !allies.has(id) && realms.has(id))
    .sort()
    .map(label)
  return { alliance: alliance ?? null, invitations, realmsInSight }
}
