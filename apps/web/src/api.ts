import type {
  Account,
  ApiError,
  InviteCreated,
  LoginRequest,
  ResetPasswordRequest,
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

async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
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
}
