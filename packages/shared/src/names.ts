import { REALM_NAME_MAX_LENGTH, RESIDENT_NAME_MAX_LENGTH } from './balance.js'
import type { Realm, Resident } from './world.js'

/**
 * What is wrong with a name a Player gives, if anything: it must be text, and trimmed not empty
 * and at most `maxLength` characters. Names need not be unique.
 */
export function nameProblem(name: unknown, maxLength: number): string | undefined {
  if (typeof name !== 'string') return 'needs a name'
  const trimmed = name.trim()
  if (trimmed === '') return 'needs a name'
  if (trimmed.length > maxLength) return `at most ${maxLength} characters`
  return undefined
}

/**
 * Why the Player of `realm` can't rename `target` to `name` now (`CONTEXT.md`: Renaming a
 * resident, Realm name), or undefined when they can: any living resident of their realm, from
 * anywhere. Renaming the Leader of a realm with no realm name yet needs `realmName` too, which
 * names the realm; a named realm takes none, since its name never changes.
 */
export function renameProblem(
  realm: Pick<Realm, 'id' | 'leaderId' | 'name'>,
  target: Resident | undefined,
  name: unknown,
  realmName?: unknown,
): string | undefined {
  if (!target || target.owner !== realm.id || target.health <= 0) {
    return 'not one of your residents'
  }
  const bad = nameProblem(name, RESIDENT_NAME_MAX_LENGTH)
  if (bad) return `Name: ${bad}`
  const naming = target.id === realm.leaderId && !realm.name
  if (naming) {
    const badRealm = nameProblem(realmName, REALM_NAME_MAX_LENGTH)
    if (badRealm) return `Realm name: ${badRealm}; your realm needs one when you rename your Leader`
  } else if (realmName !== undefined && realmName !== null) {
    return realm.name
      ? 'your realm has its name already'
      : 'only renaming your Leader names your realm'
  }
  return undefined
}
