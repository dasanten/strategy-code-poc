/** HTTP API shapes shared by server and client (ADR 0005). */
import type { AdminDirectiveView } from './directive.js'

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
  | 'script-has-errors'

export interface ApiError {
  error: ApiErrorCode
  message: string
}

export const NAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/
export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 200

/** A script in a Player's library (`CONTEXT.md`: Script). */
export interface ScriptSummary {
  id: number
  name: string
  /** The version that runs, always one without syntax errors; null while there is none. */
  activeVersion: number | null
  latestVersion: number
}

/** One saved version of a script, with the syntax errors it has (at most one). */
export interface ScriptVersion {
  version: number
  source: string
  /** Seconds since the epoch. */
  savedAt: number
  errors: { message: string; line: number; column: number }[]
}

/** A script with its whole history, oldest version first. */
export interface ScriptDetail extends ScriptSummary {
  versions: ScriptVersion[]
}

export interface CreateScriptRequest {
  name: string
  source: string
}

export interface SaveScriptRequest {
  source: string
}

export interface RenameScriptRequest {
  name: string
}

export interface ActivateScriptRequest {
  version: number
}

export const SCRIPT_NAME_MAX_LENGTH = 40
/** Longest script source the server stores, in characters. */
export const SCRIPT_MAX_LENGTH = 20_000

/** An admin gives a directive (`CONTEXT.md`: Admin directive). */
export interface GiveDirectiveRequest {
  /** The Organization it names: a realm's or an NPC city's id. */
  target: string
  withAlliance: boolean
  reason: string
}

/** An Organization an admin can name in a directive. */
export interface DirectiveTarget {
  org: string
  /** A realm's Leader's name, or an NPC city's name. */
  name: string
  is: 'realm' | 'city'
  /** A realm's Player's account name. */
  account?: string
}

/** What the admin panel shows of directives: those in force and whom one can name. */
export interface AdminDirectives {
  directives: AdminDirectiveView[]
  targets: DirectiveTarget[]
}
