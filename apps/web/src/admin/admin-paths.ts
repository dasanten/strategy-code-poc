// Where the admin map loads the world from (`CONTEXT.md`: Admin, admin map).

import type { AdminInspectTarget, AdminViewRequest } from '@csp/shared-types'
import { ADMIN_WORLD_PATH, ADMIN_INSPECT_PATH } from '@csp/shared-types'

/*
 * What the admin map gets from the server (`CONTEXT.md`: Admin, admin map): the whole world, for
 * admins only, read between ticks. Script sources are never in it.
 */

export function adminWorldPath(view: AdminViewRequest): string {
  const { x, y, w, h, citiesOnly } = view
  return `${ADMIN_WORLD_PATH}?x=${x}&y=${y}&w=${w}&h=${h}${citiesOnly ? '&citiesOnly=1' : ''}`
}

export function adminInspectPath(target: AdminInspectTarget): string {
  return `${ADMIN_INSPECT_PATH}/${target.kind}/${encodeURIComponent(target.id)}`
}
