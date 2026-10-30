import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  NAME_PATTERN,
  type Account,
  type ApiErrorCode,
} from '@csp/shared'
import { schema, type Db } from './db/index.js'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

const KEY_LENGTH = 64
const DAY_MS = 24 * 60 * 60 * 1000
export const SESSION_DAYS = 30

/** A failure the API reports to the client as `{ error, message }`. */
export class AuthError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface SessionUser extends Account {
  id: number
}

/**
 * The open sockets of sessions (`attachRealtime`), closed when a session ends: one session's on
 * logout, all of an account's on a password reset.
 */
export interface SessionSockets {
  disconnectSession(tokenHash: string): void
  disconnectUser(userId: number): void
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

function validateName(name: unknown): string {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new AuthError('invalid-input', 'Names are 3–20 letters, digits, "_" or "-".')
  }
  return name
}

function validatePassword(password: unknown): string {
  if (
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new AuthError(
      'invalid-input',
      `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
  }
  return password
}

function findUserByName(db: Db, name: string) {
  return db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.name}) = lower(${name})`)
    .get()
}

const toAccount = (u: { id: number; name: string; isAdmin: boolean }): SessionUser => ({
  id: u.id,
  name: u.name,
  isAdmin: u.isAdmin,
})

/** Creates an account, using up the invite code. */
export async function signUp(
  db: Db,
  input: { name: unknown; password: unknown; inviteCode: unknown },
): Promise<SessionUser> {
  const name = validateName(input.name)
  const password = validatePassword(input.password)
  const code = typeof input.inviteCode === 'string' ? input.inviteCode.trim() : ''
  const passwordHash = await hashPassword(password)

  return db.transaction((tx) => {
    const invite = tx
      .select()
      .from(schema.inviteCodes)
      .where(and(eq(schema.inviteCodes.code, code), isNull(schema.inviteCodes.usedBy)))
      .get()
    if (!invite) throw new AuthError('invalid-invite', 'That invite code is unknown or used.')
    if (findUserByName(tx as unknown as Db, name)) {
      throw new AuthError('name-taken', 'That name is taken.')
    }
    const user = tx.insert(schema.users).values({ name, passwordHash }).returning().get()
    tx.update(schema.inviteCodes)
      .set({ usedBy: user.id, usedAt: new Date() })
      .where(eq(schema.inviteCodes.code, code))
      .run()
    return toAccount(user)
  })
}

export async function logIn(
  db: Db,
  input: { name: unknown; password: unknown },
): Promise<SessionUser> {
  const wrong = new AuthError('wrong-login', 'Wrong name or password.')
  if (typeof input.name !== 'string' || typeof input.password !== 'string') throw wrong
  const user = findUserByName(db, input.name)
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw wrong
  return toAccount(user)
}

/** The hash a session token is stored and tracked by; the token itself is only in the cookie. */
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('base64url')

/** Starts a session and returns the token for the cookie. */
export function createSession(db: Db, userId: number, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url')
  db.insert(schema.sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(now + SESSION_DAYS * DAY_MS),
    })
    .run()
  return token
}

/**
 * The user a session token belongs to, or undefined if it is unknown or expired. A session in
 * use is extended back to the full 30 days, at most once a day.
 */
export function getSessionUser(
  db: Db,
  token: string | undefined,
  now = Date.now(),
): SessionUser | undefined {
  if (!token) return undefined
  const tokenHash = hashToken(token)
  const row = db
    .select({ user: schema.users, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .get()
  if (!row) return undefined
  if (row.expiresAt.getTime() <= now) {
    db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash)).run()
    return undefined
  }
  if (row.expiresAt.getTime() - now < (SESSION_DAYS - 1) * DAY_MS) {
    db.update(schema.sessions)
      .set({ expiresAt: new Date(now + SESSION_DAYS * DAY_MS) })
      .where(eq(schema.sessions.tokenHash, tokenHash))
      .run()
  }
  return toAccount(row.user)
}

/** Whether the session with this token hash still exists and has not expired. */
export function sessionAlive(db: Db, tokenHash: string, now = Date.now()): boolean {
  const row = db
    .select({ expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .get()
  return row !== undefined && row.expiresAt.getTime() > now
}

/** Ends a session (logout), closing its open sockets. */
export function deleteSession(db: Db, token: string, sockets?: SessionSockets): void {
  const tokenHash = hashToken(token)
  db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash)).run()
  sockets?.disconnectSession(tokenHash)
}

export function deleteExpiredSessions(db: Db, now = Date.now()): void {
  db.delete(schema.sessions)
    .where(lt(schema.sessions.expiresAt, new Date(now)))
    .run()
}

export function createInviteCode(db: Db, createdBy: number | null): string {
  // 10 characters without look-alikes (0/O, 1/l/I), easy to read out or type.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(10)
  const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
  db.insert(schema.inviteCodes).values({ code, createdBy }).run()
  return code
}

/** Sets a new password and logs the account out everywhere, closing its open sockets. */
export async function resetPassword(
  db: Db,
  name: unknown,
  password: unknown,
  sockets?: SessionSockets,
): Promise<void> {
  const pw = validatePassword(password)
  const user = typeof name === 'string' ? findUserByName(db, name) : undefined
  if (!user) throw new AuthError('not-found', 'No account with that name.')
  const passwordHash = await hashPassword(pw)
  db.transaction((tx) => {
    tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id)).run()
    tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id)).run()
  })
  sockets?.disconnectUser(user.id)
}

/** Creates an admin account, or makes an existing account admin and sets its password. */
export async function createAdmin(db: Db, name: unknown, password: unknown): Promise<void> {
  const n = validateName(name)
  const passwordHash = await hashPassword(validatePassword(password))
  const existing = findUserByName(db, n)
  if (existing) {
    db.update(schema.users)
      .set({ isAdmin: true, passwordHash })
      .where(eq(schema.users.id, existing.id))
      .run()
  } else {
    db.insert(schema.users).values({ name: n, passwordHash, isAdmin: true }).run()
  }
}
