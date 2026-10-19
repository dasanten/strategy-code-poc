import type { Alliance, WorldState } from './world.js'

/** World queries about alliances (ADR 0002: the game API orders and scripts share). */

/** The longest an alliance's name may be. */
export const ALLIANCE_NAME_MAX_LENGTH = 30

/** The alliance the realm is a member of, if any (`CONTEXT.md`: Alliance: at most one). */
export function allianceOf(
  world: Pick<WorldState, 'alliances'>,
  realmId: string,
): Alliance | undefined {
  return world.alliances.find((a) => a.members.some((m) => m.realmId === realmId))
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
  } | null
  /** Alliances whose leader invited the Player's realm. */
  invitations: { allianceId: string; name: string; leader: string }[]
  /** Other realms the Player sees residents of, who could be invited. */
  realmsInSight: RealmLabel[]
}

/**
 * The Player's alliance matters, as their realm sees them. `seenRealms` are the realms whose
 * residents are in the Player's sight.
 */
export function diplomacyFor(
  world: Pick<WorldState, 'alliances' | 'realms' | 'residents'>,
  realmId: string,
  seenRealms: Iterable<string>,
): Diplomacy {
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
  }
  const invitations = world.alliances
    .filter((a) => a.invites.includes(realmId))
    .map((a) => ({ allianceId: a.id, name: a.name, leader: realmName(world, a.leaderId) }))
  const realms = new Set(world.realms.map((r) => r.id))
  const realmsInSight = [...new Set(seenRealms)]
    .filter((id) => id !== realmId && realms.has(id))
    .sort()
    .map(label)
  return { alliance: alliance ?? null, invitations, realmsInSight }
}
