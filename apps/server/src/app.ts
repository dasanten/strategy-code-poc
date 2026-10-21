import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { eq } from 'drizzle-orm'
import {
  SESSION_COOKIE,
  type Account,
  type AdminDirectives,
  type ApiError,
  type InviteCreated,
  type WorldState,
} from '@csp/shared'
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
import { schema, type Db } from './db/index.js'
import {
  adminDirectives,
  directiveTargetChoices,
  giveDirective,
  liftDirective,
  setDirectivePrice,
} from './directives.js'
import type { ExploredTerrain } from './explored.js'
import type { Logger } from './log.js'
import {
  activateVersion,
  createScript,
  deleteScript,
  getScript,
  listScripts,
  renameScript,
  saveScript,
} from './scripts.js'

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
  /** The running world, for admin directives. Without it there is no directive API. */
  world?: WorldState
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
  'script-has-errors': 422,
}

function fail(reply: FastifyReply, code: ApiError['error'], message: string) {
  const body: ApiError = { error: code, message }
  return reply.code(STATUS[code]).send(body)
}

const publicAccount = (u: SessionUser): Account => ({ name: u.name, isAdmin: u.isAdmin })

/**
 * The HTTP side of the server: accounts (ADR 0005), the script library, health and, in
 * production, the client.
 */
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

  // The Player's script library (`CONTEXT.md`: Script).
  app.register(async (lib) => {
    lib.addHook('preHandler', async (req, reply) => {
      if (!req.user) return fail(reply, 'not-logged-in', 'Not logged in.')
    })
    type ById = { Params: { id: string } }
    const id = (req: FastifyRequest<ById>) => Number(req.params.id)
    lib.get('/api/scripts', async (req) => listScripts(db, req.user!.id))
    lib.post('/api/scripts', async (req, reply) => {
      const b = body(req)
      return reply
        .code(201)
        .send(createScript(db, req.user!.id, { name: b.name, source: b.source }))
    })
    lib.get<ById>('/api/scripts/:id', async (req) => getScript(db, req.user!.id, id(req)))
    lib.post<ById>('/api/scripts/:id/versions', async (req, reply) => {
      const b = body(req)
      return reply.code(201).send(saveScript(db, req.user!.id, id(req), { source: b.source }))
    })
    lib.post<ById>('/api/scripts/:id/name', async (req) =>
      renameScript(db, req.user!.id, id(req), { name: body(req).name }),
    )
    lib.post<ById>('/api/scripts/:id/active', async (req) =>
      activateVersion(db, req.user!.id, id(req), { version: body(req).version }),
    )
    lib.delete<ById>('/api/scripts/:id', async (req, reply) => {
      deleteScript(db, req.user!.id, id(req))
      return reply.code(204).send()
    })
  })

  // Admin routes: invite codes, password resets and admin directives.
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

    // Admin directives (`CONTEXT.md`: Admin directive), given and lifted between ticks.
    const { world } = opts
    if (!world) return
    const accountOf = (userId: number) =>
      db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get()?.name
    admin.get('/api/admin/directives', async () => {
      const shown: AdminDirectives = {
        directives: adminDirectives(world),
        targets: directiveTargetChoices(world, accountOf),
      }
      return shown
    })
    admin.post('/api/admin/directives', async (req, reply) => {
      const b = body(req)
      const given = giveDirective(
        world,
        {
          target: b.target,
          withAlliance: b.withAlliance,
          reason: b.reason,
          goals: b.goals,
          price: b.price,
        },
        req.user!.name,
      )
      if (typeof given === 'string') return fail(reply, 'invalid-input', given)
      return reply.code(201).send(adminDirectives(world).find((d) => d.id === given.id))
    })
    admin.patch<{ Params: { id: string } }>('/api/admin/directives/:id', async (req, reply) => {
      const set = setDirectivePrice(world, req.params.id, body(req).price)
      if (typeof set === 'string') {
        return fail(reply, set === 'No such directive.' ? 'not-found' : 'invalid-input', set)
      }
      return adminDirectives(world).find((d) => d.id === set.id)
    })
    admin.delete<{ Params: { id: string } }>('/api/admin/directives/:id', async (req, reply) => {
      if (!liftDirective(world, req.params.id)) {
        return fail(reply, 'not-found', 'No such directive.')
      }
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
