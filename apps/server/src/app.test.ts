import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_COOKIE } from '@csp/shared'
import { buildApp } from './app.js'
import { createAdmin, createInviteCode, getSessionUser } from './auth.js'
import { openDb, type OpenDb } from './db/index.js'

let opened: OpenDb
let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  opened = await openDb(':memory:')
  app = await buildApp({ db: opened.db, logger: false, secureCookies: false, trustProxy: false })
})
afterEach(async () => {
  await app.close()
  opened.close()
})

const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === SESSION_COOKIE)?.value

function signUp(name: string, inviteCode: string, password = 'correct horse') {
  return app.inject({ method: 'POST', url: '/api/signup', payload: { name, password, inviteCode } })
}

describe('accounts', () => {
  it('signs up with an invite code, which then cannot be reused', async () => {
    const code = createInviteCode(opened.db, null)
    const res = await signUp('Mara', code)
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ name: 'Mara', isAdmin: false })
    expect(cookieOf(res)).toBeTruthy()

    const again = await signUp('Tobin', code)
    expect(again.statusCode).toBe(403)
    expect(again.json().error).toBe('invalid-invite')
  })

  it('refuses sign-up without a valid invite code', async () => {
    const res = await signUp('Mara', 'NOPE')
    expect(res.json().error).toBe('invalid-invite')
  })

  it('treats names as the same regardless of case', async () => {
    await signUp('Mara', createInviteCode(opened.db, null))
    const res = await signUp('mara', createInviteCode(opened.db, null))
    expect(res.statusCode).toBe(409)
  })

  it('rejects short passwords and odd names', async () => {
    const code = createInviteCode(opened.db, null)
    expect((await signUp('Mara', code, 'short')).json().error).toBe('invalid-input')
    expect((await signUp('a b', code)).json().error).toBe('invalid-input')
  })

  it('logs in, knows the session, and logs out', async () => {
    await signUp('Mara', createInviteCode(opened.db, null))
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { name: 'Mara', password: 'wrong password' },
    })
    expect(wrong.statusCode).toBe(401)

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { name: 'mara', password: 'correct horse' },
    })
    expect(login.statusCode).toBe(200)
    const token = cookieOf(login)!

    const me = await app.inject({ url: '/api/me', cookies: { [SESSION_COOKIE]: token } })
    expect(me.json()).toEqual({ name: 'Mara', isAdmin: false })

    await app.inject({ method: 'POST', url: '/api/logout', cookies: { [SESSION_COOKIE]: token } })
    expect(getSessionUser(opened.db, token)).toBeUndefined()
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401)
  })

  it('rate-limits login attempts', async () => {
    const limited = await buildApp({
      db: opened.db,
      logger: false,
      secureCookies: false,
      trustProxy: false,
      authRateLimit: 2,
    })
    const attempt = () =>
      limited.inject({ method: 'POST', url: '/api/login', payload: { name: 'x', password: 'y' } })
    await attempt()
    await attempt()
    const res = await attempt()
    expect(res.statusCode).toBe(429)
    expect(res.json().error).toBe('rate-limited')
    await limited.close()
  })
})

describe('admin', () => {
  async function loginAs(name: string, password: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { name, password },
    })
    return { [SESSION_COOKIE]: cookieOf(res)! }
  }

  it('lets admins create invite codes and reset passwords', async () => {
    await createAdmin(opened.db, 'Daniel', 'admin password')
    const cookies = await loginAs('Daniel', 'admin password')

    const invite = await app.inject({ method: 'POST', url: '/api/admin/invites', cookies })
    expect(invite.statusCode).toBe(201)
    const { code } = invite.json()
    expect((await signUp('Mara', code)).statusCode).toBe(201)

    const reset = await app.inject({
      method: 'POST',
      url: '/api/admin/password',
      cookies,
      payload: { name: 'Mara', password: 'a new password' },
    })
    expect(reset.statusCode).toBe(204)
    expect((await loginAs('Mara', 'a new password'))[SESSION_COOKIE]).toBeTruthy()
  })

  it('keeps Players out of admin routes', async () => {
    await signUp('Mara', createInviteCode(opened.db, null))
    const cookies = await loginAs('Mara', 'correct horse')
    const res = await app.inject({ method: 'POST', url: '/api/admin/invites', cookies })
    expect(res.statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/admin/invites' })).statusCode).toBe(401)
  })
})

describe('sessions', () => {
  it('expire after 30 days unless used, and renew when used', async () => {
    await createAdmin(opened.db, 'Daniel', 'admin password')
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { name: 'Daniel', password: 'admin password' },
    })
    const token = cookieOf(res)!
    const day = 24 * 60 * 60 * 1000
    const now = Date.now()
    // Used on day 20: renewed to 30 days from then, so still valid on day 45.
    expect(getSessionUser(opened.db, token, now + 20 * day)).toBeDefined()
    expect(getSessionUser(opened.db, token, now + 45 * day)).toBeDefined()
    expect(getSessionUser(opened.db, token, now + 80 * day)).toBeUndefined()
  })
})
