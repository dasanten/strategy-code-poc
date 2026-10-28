/** HTTP API shapes shared by server and client (ADR 0005). */
import type { Task } from './default-scripts.js'
import type { ScriptParam } from './script-api.js'
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
  | 'default-script'

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
  /**
   * For the Player's version of a default script (`CONTEXT.md`: Default script), its task; it
   * can't be renamed or deleted. Null for the Player's own scripts.
   */
  task: Task | null
  /** A default script the Player hasn't edited, which follows the game's default. */
  followsDefault: boolean
  /** The active version's `param` lines (`CONTEXT.md`: Script parameter); none while there is none. */
  params: ScriptParam[]
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
  /** For a default script: the game's default now and, once edited, the one it was edited from. */
  gameDefault?: GameDefault
}

/**
 * The game's side of a Player's default script. `editedFrom` differs from `source` when the game's
 * default changed after the Player edited theirs; the editor shows them the difference.
 */
export interface GameDefault {
  /** The game's current default. */
  source: string
  /** The game's default when the Player first edited theirs; null while they follow it. */
  editedFrom: string | null
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
  /** What ends it, at least one (`MAX_DIRECTIVE_GOALS` at most). */
  goals: DirectiveGoalRequest[]
  /** The Coins to buy it off with, or null when the target can't. */
  price: number | null
}

/** An admin allows buying off a directive at a price, or stops allowing it (null). */
export interface DirectivePriceRequest {
  price: number | null
}

/**
 * A goal an admin sets: a city of an Organization the directive names destroyed, a number of
 * their soldiers killed, or a share (`percent`) of the soldiers they have now killed.
 */
export type DirectiveGoalRequest =
  | { kind: 'city'; cityId: string }
  | { kind: 'soldiers'; count: number }
  | { kind: 'soldierShare'; percent: number }

/** An Organization an admin can name in a directive. */
export interface DirectiveTarget {
  org: string
  /** A realm's realm name, or an NPC city's name. */
  name: string
  is: 'realm' | 'city'
  /** A realm's Player's account name. */
  account?: string
  /** Its cities, for `city` goals: a realm's, or an NPC city itself. */
  cities: { id: string; name: string }[]
  /** The other members of a realm's alliance, by org, for a directive with its alliance. */
  allies: string[]
}

/** What the admin panel shows of directives: those in force and whom one can name. */
export interface AdminDirectives {
  directives: AdminDirectiveView[]
  targets: DirectiveTarget[]
}
