import {
  ADMIN_LAND_PATH,
  ADMIN_MAP_INFO_PATH,
  ADMIN_PLACES_PATH,
  ADMIN_TERRITORY_PATH,
} from '@csp/shared-types'
import { adminInspectPath, adminWorldPath } from './admin-paths.js'
import { ADMIN_TERRAIN_OVERVIEW_PATH, LAND_PATH } from '@csp/shared-types'
import { FIRST_DAY_DISMISS_PATH, FIRST_DAY_PATH } from '@csp/shared-types'
import type {
  Account,
  AdminDirectiveView,
  AdminDirectives,
  AdminInspectTarget,
  AdminInspection,
  AdminLand,
  AdminPlaces,
  AdminViewRequest,
  AdminWorldView,
  ApiError,
  Checkpoint,
  CheckpointSaveRequest,
  ClientFirstDayLine,
  CreateScriptRequest,
  CreativeAction,
  CreativeDone,
  CreativeReveal,
  CreativeSkipRequest,
  CreativeSpeed,
  CreativeSpeedRequest,
  CreativeState,
  DirectivePriceRequest,
  FirstDay,
  GiveDirectiveRequest,
  HorseOffersReopened,
  InviteCreated,
  LoginRequest,
  MapInfo,
  PlayerLand,
  RegionMap,
  ReopenHorseOffersRequest,
  ResetPasswordRequest,
  ScriptDetail,
  ScriptSummary,
  SignUpRequest,
  TickHealthResponse,
} from '@csp/shared-types'

/** Where the Creative bar reads and sets the time controls (`CREATIVE_PATH` on the server). */
export const CREATIVE_PATH = '/api/admin/creative'
/** Where the Creative bar keeps checkpoints (`CHECKPOINTS_PATH` on the server). */
export const CHECKPOINTS_PATH = `${CREATIVE_PATH}/checkpoints`

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
  // The land the Player knows (`CONTEXT.md`: Region): in some chunks, or wherever they explored.
  land: (chunks?: readonly number[]) =>
    call<PlayerLand>('POST', LAND_PATH, chunks ? { chunks } : {}),
  adminLand: () => call<AdminLand>('GET', ADMIN_LAND_PATH),
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
  // The live world's tick health, the last minute and the last hour (ADR 0004).
  tickHealth: () => call<TickHealthResponse>('GET', '/api/admin/tick-health'),
  // Creative mode's time controls (`CONTEXT.md`: Creative mode): admins on a creative server only.
  creative: () => call<CreativeState>('GET', CREATIVE_PATH),
  creativePause: () => call<CreativeState>('POST', `${CREATIVE_PATH}/pause`),
  creativeResume: () => call<CreativeState>('POST', `${CREATIVE_PATH}/resume`),
  creativeStep: () => call<CreativeState>('POST', `${CREATIVE_PATH}/step`),
  creativeSpeed: (speed: CreativeSpeed) =>
    call<CreativeState>('POST', `${CREATIVE_PATH}/speed`, { speed } satisfies CreativeSpeedRequest),
  // A creative action from a card's Creative section: goods, finish now (`CONTEXT.md`: Creative mode).
  creativeAct: (action: CreativeAction) =>
    call<CreativeDone>('POST', `${CREATIVE_PATH}/act`, action),
  creativeSkip: (request: CreativeSkipRequest) =>
    call<CreativeState>('POST', `${CREATIVE_PATH}/skip`, request),
  creativeSkipCancel: () => call<CreativeState>('POST', `${CREATIVE_PATH}/skip/cancel`),
  // Reveal (`CONTEXT.md`: Creative mode): this session's game view shows the whole map; switching
  // it reloads the game view.
  creativeReveal: () => call<CreativeReveal>('GET', `${CREATIVE_PATH}/reveal`),
  creativeSetReveal: (on: boolean) =>
    call<CreativeReveal>('POST', `${CREATIVE_PATH}/reveal`, { on } satisfies CreativeReveal),
  // Checkpoints (`CONTEXT.md`: Creative mode): named copies of the world, saved and restored live.
  checkpoints: () => call<Checkpoint[]>('GET', CHECKPOINTS_PATH),
  saveCheckpoint: (name: string) =>
    call<Checkpoint[]>('POST', CHECKPOINTS_PATH, { name } satisfies CheckpointSaveRequest),
  restoreCheckpoint: (id: number) =>
    call<CreativeState>('POST', `${CHECKPOINTS_PATH}/${id}/restore`),
  deleteCheckpoint: (id: number) => call<Checkpoint[]>('DELETE', `${CHECKPOINTS_PATH}/${id}`),
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
