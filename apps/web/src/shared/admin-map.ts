// Ported from packages/shared/src/admin-map.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { AdminInspectTarget, AdminViewRequest } from '@csp/shared-types'

/*
 * What the admin map gets from the server (`CONTEXT.md`: Admin, admin map): the whole world, for
 * admins only, read between ticks. Script sources are never in it.
 */

/** Where an admin loads the map they draw: its seed and size (`MapInfo`). */
export const ADMIN_MAP_INFO_PATH = '/api/admin/map'

/** Where an admin loads every entity in a rectangle of tiles (`adminWorldPath`). */
export const ADMIN_WORLD_PATH = '/api/admin/world'

/** Where an admin loads the jump list's places, for the whole world (`AdminPlaces`). */
export const ADMIN_PLACES_PATH = '/api/admin/places'

/** Where an admin loads the territory of the whole map, as a `RegionMap` of all of it. */
export const ADMIN_TERRITORY_PATH = '/api/admin/territory'

/**
 * The widest and tallest rectangle `ADMIN_WORLD_PATH` gives every entity in, in tiles; the far
 * zoom asks for cities only, which may span the whole map.
 */
export const ADMIN_VIEW_MAX_SIDE = 256

export function adminWorldPath(view: AdminViewRequest): string {
  const { x, y, w, h, citiesOnly } = view
  return `${ADMIN_WORLD_PATH}?x=${x}&y=${y}&w=${w}&h=${h}${citiesOnly ? '&citiesOnly=1' : ''}`
}

/** Where an admin loads one thing on the map for the inspector (`adminInspectPath`). */
export const ADMIN_INSPECT_PATH = '/api/admin/inspect'

/** What the admin map's inspector can show (`CONTEXT.md`: admin map). */
export const ADMIN_INSPECT_KINDS = [
  'resident',
  'city',
  'building',
  'horse',
  'carriage',
  'pile',
  'army',
  'caravan',
  'trader',
] as const

export function adminInspectPath(target: AdminInspectTarget): string {
  return `${ADMIN_INSPECT_PATH}/${target.kind}/${encodeURIComponent(target.id)}`
}
