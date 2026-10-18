/** HTTP API shapes shared by server and client (ADR 0005). */

export interface Account {
  name: string
  isAdmin: boolean
}

export interface SignUpRequest {
  name: string
  password: string
  inviteCode: string
}

export interface LoginRequest {
  name: string
  password: string
}

export interface InviteCreated {
  code: string
}

export interface ResetPasswordRequest {
  name: string
  password: string
}

export type ApiErrorCode =
  | 'invalid-input'
  | 'name-taken'
  | 'invalid-invite'
  | 'wrong-login'
  | 'not-logged-in'
  | 'not-admin'
  | 'not-found'
  | 'not-explored'
  | 'rate-limited'

export interface ApiError {
  error: ApiErrorCode
  message: string
}

export const NAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/
export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 200
