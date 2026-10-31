import { scrypt } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthError,
  LOGIN_BACKOFF_MAX_MS,
  LOGIN_BACKOFF_MS,
  LOGIN_FAILURES_BEFORE_BACKOFF,
  clearLoginBackoff,
  createAdmin,
  logIn,
} from './auth.js'
import { openDb, type OpenDb } from './db/index.js'

// Counts the password checks: every login attempt must cost one, whether or not the name exists.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, scrypt: vi.fn(actual.scrypt) }
})

let opened: OpenDb
beforeEach(async () => {
  opened = await openDb(':memory:')
  await createAdmin(opened.db, 'Mara', 'correct horse')
  clearLoginBackoff()
  vi.mocked(scrypt).mockClear()
})
afterEach(() => opened.close())

const passwordChecks = () => vi.mocked(scrypt).mock.calls.length

async function failure(name: string, password: string, now?: number) {
  try {
    await logIn(opened.db, { name, password }, now)
  } catch (e) {
    return e as AuthError
  }
  throw new Error('login succeeded')
}

describe('logIn', () => {
  it('checks the password for an unknown name just like for a wrong password', async () => {
    // The first login for an unknown name also makes the dummy hash, once.
    await failure('Warmup', 'correct horse')
    vi.mocked(scrypt).mockClear()

    const unknown = await failure('Nobody', 'correct horse')
    expect(unknown.code).toBe('wrong-login')
    expect(passwordChecks()).toBe(1)

    const wrong = await failure('Mara', 'wrong password')
    expect(wrong.code).toBe('wrong-login')
    expect(wrong.message).toBe(unknown.message)
    expect(passwordChecks()).toBe(2)
  })

  it('refuses a name after repeated failures, with the wrong-password message', async () => {
    const t0 = 1_000_000
    for (let i = 0; i < LOGIN_FAILURES_BEFORE_BACKOFF; i++) {
      expect((await failure('Mara', 'wrong password', t0)).code).toBe('wrong-login')
    }
    const checks = passwordChecks()
    const refused = await failure('mara', 'correct horse', t0 + LOGIN_BACKOFF_MS - 1)
    expect(refused.code).toBe('rate-limited')
    expect(refused.message).toBe('Wrong name or password.')
    expect(passwordChecks()).toBe(checks) // refused before any password check

    const user = await logIn(
      opened.db,
      { name: 'Mara', password: 'correct horse' },
      t0 + LOGIN_BACKOFF_MS,
    )
    expect(user.name).toBe('Mara')
  })

  it('clears the failures on a successful login', async () => {
    const t0 = 1_000_000
    for (let i = 0; i < LOGIN_FAILURES_BEFORE_BACKOFF - 1; i++) {
      await failure('Mara', 'wrong password', t0)
    }
    await logIn(opened.db, { name: 'Mara', password: 'correct horse' }, t0)
    for (let i = 0; i < LOGIN_FAILURES_BEFORE_BACKOFF - 1; i++) {
      expect((await failure('Mara', 'wrong password', t0)).code).toBe('wrong-login')
    }
    await expect(
      logIn(opened.db, { name: 'Mara', password: 'correct horse' }, t0),
    ).resolves.toBeDefined()
  })

  it('doubles the wait with every further failure, up to the cap', async () => {
    const t0 = 1_000_000
    for (let i = 0; i < LOGIN_FAILURES_BEFORE_BACKOFF; i++) {
      await failure('Mara', 'wrong password', t0)
    }
    // One more failure once the first wait is over: the next wait is twice as long.
    const t1 = t0 + LOGIN_BACKOFF_MS
    expect((await failure('Mara', 'wrong password', t1)).code).toBe('wrong-login')
    expect((await failure('Mara', 'wrong password', t1 + 2 * LOGIN_BACKOFF_MS - 1)).code).toBe(
      'rate-limited',
    )
    expect((await failure('Mara', 'wrong password', t1 + 2 * LOGIN_BACKOFF_MS)).code).toBe(
      'wrong-login',
    )
    // Many more failures never wait longer than the cap.
    let t = t1 + 2 * LOGIN_BACKOFF_MS
    for (let i = 0; i < 20; i++) {
      t += LOGIN_BACKOFF_MAX_MS
      expect((await failure('Mara', 'wrong password', t)).code).toBe('wrong-login')
    }
    expect((await failure('Mara', 'wrong password', t + LOGIN_BACKOFF_MAX_MS - 1)).code).toBe(
      'rate-limited',
    )
  })

  it('backs off unknown names too, so the back-off tells nothing about which names exist', async () => {
    const t0 = 1_000_000
    for (let i = 0; i < LOGIN_FAILURES_BEFORE_BACKOFF; i++) {
      expect((await failure('Nobody', 'correct horse', t0)).code).toBe('wrong-login')
    }
    expect((await failure('Nobody', 'correct horse', t0)).code).toBe('rate-limited')
  })
})
