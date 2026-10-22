import type {
  Account,
  AdminDirectiveView,
  AdminDirectives,
  ApiError,
  CreateScriptRequest,
  DirectivePriceRequest,
  GiveDirectiveRequest,
  InviteCreated,
  LoginRequest,
  ResetPasswordRequest,
  ScriptDetail,
  ScriptSummary,
  SignUpRequest,
} from '@csp/shared'

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
  createInvite: () => call<InviteCreated>('POST', '/api/admin/invites'),
  resetPassword: (req: ResetPasswordRequest) => call<void>('POST', '/api/admin/password', req),
  // Admin directives (`CONTEXT.md`: Admin directive).
  directives: () => call<AdminDirectives>('GET', '/api/admin/directives'),
  giveDirective: (req: GiveDirectiveRequest) =>
    call<AdminDirectiveView>('POST', '/api/admin/directives', req),
  setDirectivePrice: (id: string, req: DirectivePriceRequest) =>
    call<AdminDirectiveView>('PATCH', `/api/admin/directives/${id}`, req),
  liftDirective: (id: string) => call<void>('DELETE', `/api/admin/directives/${id}`),
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
  deleteScript: (id: number) => call<void>('DELETE', `/api/scripts/${id}`),
}
