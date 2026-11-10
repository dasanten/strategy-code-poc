import {
  ADMIN_MAP_INFO_PATH,
  ADMIN_PLACES_PATH,
  ADMIN_TERRITORY_PATH,
  adminInspectPath,
  adminWorldPath,
} from './shared/admin-map.js'
import { ADMIN_TERRAIN_OVERVIEW_PATH } from './shared/terrain.js'
import { FIRST_DAY_DISMISS_PATH, FIRST_DAY_PATH } from './shared/first-day.js'
import type {
  Account,
  AdminDirectiveView,
  AdminDirectives,
  AdminInspectTarget,
  AdminInspection,
  AdminPlaces,
  AdminViewRequest,
  AdminWorldView,
  ApiError,
  ClientFirstDayLine,
  CreateScriptRequest,
  DirectivePriceRequest,
  FirstDay,
  GiveDirectiveRequest,
  HorseOffersReopened,
  InviteCreated,
  LoginRequest,
  MapInfo,
  RegionMap,
  ReopenHorseOffersRequest,
  ResetPasswordRequest,
  ScriptDetail,
  ScriptSummary,
  SignUpRequest,
} from '@csp/shared-types'

/** A failed API call, with the server's message for the user. */
export class ApiFailure extends Error {
  constructor(
    readonly code: ApiError['error'] | 'network',
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiFailure('network', 'Cannot reach the server.')
  }
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => ({}))) as T | ApiError
  if (!res.ok) {
    const err = data as Partial<ApiError>
    throw new ApiFailure(err.error ?? 'network', err.message ?? `Request failed (${res.status}).`)
  }
  return data as T
}

export const api = {
  me: () => call<Account>('GET', '/api/me'),
  login: (req: LoginRequest) => call<Account>('POST', '/api/login', req),
  signUp: (req: SignUpRequest) => call<Account>('POST', '/api/signup', req),
  logout: () => call<void>('POST', '/api/logout'),
  // The first-day card (`CONTEXT.md`: First day): a line only the client sees done, and dismissing.
  firstDayDone: (line: ClientFirstDayLine) => call<FirstDay>('POST', FIRST_DAY_PATH, { line }),
  dismissFirstDay: () => call<FirstDay>('POST', FIRST_DAY_DISMISS_PATH),
  createInvite: () => call<InviteCreated>('POST', '/api/admin/invites'),
  resetPassword: (req: ResetPasswordRequest) => call<void>('POST', '/api/admin/password', req),
  // The admin map (`CONTEXT.md`: admin map): the whole world, for admins only.
  adminMap: () => call<MapInfo>('GET', ADMIN_MAP_INFO_PATH),
  adminWorld: (view: AdminViewRequest) => call<AdminWorldView>('GET', adminWorldPath(view)),
  adminPlaces: () => call<AdminPlaces>('GET', ADMIN_PLACES_PATH),
  adminInspect: (target: AdminInspectTarget) =>
    call<AdminInspection>('GET', adminInspectPath(target)),
  adminTerritory: () => call<RegionMap>('GET', ADMIN_TERRITORY_PATH),
  adminOverview: async () => {
    const res = await fetch(ADMIN_TERRAIN_OVERVIEW_PATH, { credentials: 'same-origin' }).catch(
      () => {
        throw new ApiFailure('network', 'Cannot reach the server.')
      },
    )
    if (!res.ok) throw new ApiFailure('network', `Request failed (${res.status}).`)
    return new Uint8Array(await res.arrayBuffer())
  },
  // Admin directives (`CONTEXT.md`: Admin directive).
  directives: () => call<AdminDirectives>('GET', '/api/admin/directives'),
  giveDirective: (req: GiveDirectiveRequest) =>
    call<AdminDirectiveView>('POST', '/api/admin/directives', req),
  setDirectivePrice: (id: string, req: DirectivePriceRequest) =>
    call<AdminDirectiveView>('PATCH', `/api/admin/directives/${id}`, req),
  liftDirective: (id: string) => call<void>('DELETE', `/api/admin/directives/${id}`),
  // Offering horses again (`CONTEXT.md`: Horse offer).
  reopenHorseOffers: (req: ReopenHorseOffersRequest) =>
    call<HorseOffersReopened>('POST', '/api/admin/horse-offers/reopen', req),
  // The script library: saving keeps every version; one without syntax errors becomes active.
  scripts: () => call<ScriptSummary[]>('GET', '/api/scripts'),
  script: (id: number) => call<ScriptDetail>('GET', `/api/scripts/${id}`),
  createScript: (req: CreateScriptRequest) => call<ScriptDetail>('POST', '/api/scripts', req),
  saveScript: (id: number, source: string) =>
    call<ScriptDetail>('POST', `/api/scripts/${id}/versions`, { source }),
  renameScript: (id: number, name: string) =>
    call<ScriptDetail>('POST', `/api/scripts/${id}/name`, { name }),
  activateScriptVersion: (id: number, version: number) =>
    call<ScriptDetail>('POST', `/api/scripts/${id}/active`, { version }),
  // Resetting a default script makes the game's current default its newest version.
  resetScript: (id: number) => call<ScriptDetail>('POST', `/api/scripts/${id}/reset`),
  // Deleting versions: any but the active one; the others keep their numbers.
  deleteScriptVersion: (id: number, version: number) =>
    call<ScriptDetail>('DELETE', `/api/scripts/${id}/versions/${version}`),
  deleteOlderScriptVersions: (id: number) =>
    call<ScriptDetail>('POST', `/api/scripts/${id}/delete-older`),
  deleteScript: (id: number) => call<void>('DELETE', `/api/scripts/${id}`),
}
