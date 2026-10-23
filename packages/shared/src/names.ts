import { REALM_NAME_MAX_LENGTH, RESIDENT_NAME_MAX_LENGTH } from './balance.js'

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
 * What is wrong with the names a Player gives when founding their realm (`CONTEXT.md`: Realm
 * name, Leader death), if anything. The server founds with the names trimmed.
 */
export function foundingProblem(realmName: unknown, leaderName: unknown): string | undefined {
  const realm = nameProblem(realmName, REALM_NAME_MAX_LENGTH)
  if (realm) return `Realm name: ${realm}`
  const leader = nameProblem(leaderName, RESIDENT_NAME_MAX_LENGTH)
  if (leader) return `Leader name: ${leader}`
  return undefined
}
