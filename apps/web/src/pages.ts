import type { Account } from '@csp/shared'

/** Where the admin panel lives, apart from the game (`CONTEXT.md`: Admin). */
export const ADMIN_PATH = '/admin'

export type Page = 'login' | 'game' | 'admin' | 'not-admin'

/**
 * Which page to show for a path. The admin panel is its own page: the game screen shows no admin
 * features, and the panel never opens the admin's realm.
 */
export function pageFor(pathname: string, account: Account | null): Page {
  if (!account) return 'login'
  if (pathname.replace(/\/+$/, '') !== ADMIN_PATH) return 'game'
  return account.isAdmin ? 'admin' : 'not-admin'
}
