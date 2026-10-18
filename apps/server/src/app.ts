import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { SESSION_COOKIE, type Account, type ApiError, type InviteCreated } from '@csp/shared'
import { LANGUAGE_VERSION } from '@csp/lang'
import {
  AuthError,
  SESSION_DAYS,
  createInviteCode,
  createSession,
  deleteSession,
  getSessionUser,
  logIn,
  resetPassword,
  signUp,
  type SessionUser,
} from './auth.js'
import type { Db } from './db/index.js'
import type { ExploredTerrain } from './explored.js'
import type { Logger } from './log.js'

export interface AppOptions {
  db: Db
  logger?: Logger | false
  secureCookies: boolean
  trustProxy: boolean
  /** The built client to serve; dev leaves this to Vite. */
  webDist?: string
  /** Current tick, for the health check. */
  tick?: () => number
  /** Every Player's explored terrain, served in chunks. Without it there is no terrain API. */
  explored?: ExploredTerrain
  /** Login and sign-up attempts allowed per IP and minute. */
  authRateLimit?: number
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser
  }
}

const STATUS: Record<ApiError['error'], number> = {
  'invalid-input': 400,
  'name-taken': 409,
  'invalid-invite': 403,
  'wrong-login': 401,
  'not-logged-in': 401,
  'not-admin': 403,
  'not-found': 404,
  'not-explored': 403,
  'rate-limited': 429,
}

function fail(reply: FastifyReply, code: ApiError['error'], message: string) {
  const body: ApiError = { error: code, message }
  return reply.code(STATUS[code]).send(body)
}

const publicAccount = (u: SessionUser): Account => ({ name: u.name, isAdmin: u.isAdmin })

/** The HTTP side of the server: accounts (ADR 0005), health and, in production, the client. */
export async function buildApp(opts: AppOptions) {
  const { db } = opts
  const app = Fastify({ loggerInstance: opts.logger || undefined, trustProxy: opts.trustProxy })

  await app.register(cookie)
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'rate-limited',
      message: `Too many attempts. Try again in ${Math.ceil(ctx.ttl / 1000)} s.`,
    }),
  })
  const authLimit = {
    config: { rateLimit: { max: opts.authRateLimit ?? 10, timeWindow: '1 minute' } },
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthError) return fail(reply, err.code, err.message)
    const e = err as { statusCode?: number; message?: string }
    if (e.statusCode === 429) return fail(reply, 'rate-limited', e.message ?? 'Too many attempts.')
    throw err
  })

  app.addHook('onRequest', async (req: FastifyRequest) => {
    req.user = getSessionUser(db, req.cookies[SESSION_COOKIE])
  })

  function startSession(reply: FastifyReply, user: SessionUser) {
    reply.setCookie(SESSION_COOKIE, createSession(db, user.id), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookies,
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    })
    return publicAccount(user)
  }

  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>

  app.get('/api/health', async () => ({
    ok: true,
    tick: opts.tick?.() ?? 0,
    language: LANGUAGE_VERSION,
  }))

  app.post('/api/signup', authLimit, async (req, reply) => {
    const b = body(req)
    const user = await signUp(db, { name: b.name, password: b.password, inviteCode: b.inviteCode })
    return reply.code(201).send(startSession(reply, user))
  })

  app.post('/api/login', authLimit, async (req, reply) => {
    const b = body(req)
    return startSession(reply, await logIn(db, { name: b.name, password: b.password }))
  })

  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) deleteSession(db, token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.code(204).send()
  })

  app.get('/api/me', async (req, reply) => {
    if (!req.user) return fail(reply, 'not-logged-in', 'Not logged in.')
    return publicAccount(req.user)
  })

  // Explored terrain, one chunk at a time (ADR 0006); unexplored chunks are refused.
  const { explored } = opts
  if (explored) {
    app.get<{ Params: { cx: string; cy: string } }>('/api/terrain/:cx/:cy', async (req, reply) => {
      if (!req.user) return fail(reply, 'not-logged-in', 'Not logged in.')
      const chunk = explored.chunk(req.user, Number(req.params.cx), Number(req.params.cy))
      if (!chunk) return fail(reply, 'not-explored', 'You have not explored that terrain.')
      return reply.type('application/octet-stream').send(Buffer.from(chunk))
    })
  }

  // Admin routes: invite codes and password resets.
  app.register(async (admin) => {
    admin.addHook('preHandler', async (req, reply) => {
      if (!req.user) return fail(reply, 'not-logged-in', 'Not logged in.')
      if (!req.user.isAdmin) return fail(reply, 'not-admin', 'Admins only.')
    })
    admin.post('/api/admin/invites', async (req, reply) => {
      const created: InviteCreated = { code: createInviteCode(db, req.user!.id) }
      return reply.code(201).send(created)
    })
    admin.post('/api/admin/password', async (req, reply) => {
      const b = body(req)
      await resetPassword(db, b.name, b.password)
      return reply.code(204).send()
    })
  })

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    const root = path.resolve(opts.webDist)
    await app.register(fastifyStatic, { root, wildcard: false })
    // Client-side routes fall back to the app; unknown API paths stay 404.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html')
      return fail(reply, 'not-found', 'Not found.')
    })
  }

  return app
}
