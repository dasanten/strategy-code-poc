import type { Account } from '@csp/shared'

/** Where the admin panel lives, apart from the game (`CONTEXT.md`: Admin). */
export const ADMIN_PATH = '/admin'

export type Page = 'login' | 'game' | 'admin' | 'not-admin'

/** The admin panel's tabs, each at `/admin/<tab>`; `/admin` itself opens the map. */
export const ADMIN_TABS = ['map', 'accounts', 'directives'] as const
export type AdminTab = (typeof ADMIN_TABS)[number]

/** The path within the admin panel, if `pathname` is in it: '' for `/admin`, 'map' for `/admin/map`. */
function adminSubpath(pathname: string): string | undefined {
  const path = pathname.replace(/\/+$/, '')
  if (path === ADMIN_PATH) return ''
  return path.startsWith(`${ADMIN_PATH}/`) ? path.slice(ADMIN_PATH.length + 1) : undefined
}

/**
 * Which page to show for a path. The admin panel is its own page: the game screen shows no admin
 * features, and the panel never opens the admin's realm.
 */
export function pageFor(pathname: string, account: Account | null): Page {
  if (!account) return 'login'
  if (adminSubpath(pathname) === undefined) return 'game'
  return account.isAdmin ? 'admin' : 'not-admin'
}

/** The admin panel's tab for a path in it; the map for `/admin` and anything unknown. */
export function adminTabFor(pathname: string): AdminTab {
  const sub = adminSubpath(pathname)
  return ADMIN_TABS.find((t) => t === sub) ?? 'map'
}

export const adminTabPath = (tab: AdminTab) => `${ADMIN_PATH}/${tab}`

/**
 * The Directives tab with a target already chosen (`CONTEXT.md`: Admin directive), where the admin
 * map's inspector leads: `/admin/directives?target=<org>`.
 */
export const adminDirectivePath = (org: string) =>
  `${adminTabPath('directives')}?target=${encodeURIComponent(org)}`

/** The directive target chosen in the Directives tab's URL, or '' for none. */
export function directiveTargetFor(search: string): string {
  return new URLSearchParams(search).get('target') ?? ''
}
