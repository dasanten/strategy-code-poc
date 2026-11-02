import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIRST_DAY_DISMISS_PATH, FIRST_DAY_PATH, SESSION_COOKIE } from '@csp/shared'
import { buildApp } from './app.js'
import { createAdmin, createSession } from './auth.js'
import { openDb, schema, type OpenDb } from './db/index.js'
import { firstDayLineOf, markFirstDay, readFirstDay } from './first-day.js'

let opened: OpenDb
let app: Awaited<ReturnType<typeof buildApp>>
let userId: number

beforeEach(async () => {
  opened = await openDb(':memory:')
  app = await buildApp({ db: opened.db, logger: false, secureCookies: false, trustProxy: false })
  await createAdmin(opened.db, 'Mara', 'correct horse')
  userId = opened.db.select().from(schema.users).get()!.id
})
afterEach(async () => {
  await app.close()
  opened.close()
})

/** A request from a new session of Mara's, as after another login. */
function post(url: string, payload?: object) {
  const cookies = { [SESSION_COOKIE]: createSession(opened.db, userId) }
  return app.inject({ method: 'POST', url, cookies, payload })
}

describe('the first-day card on the account', () => {
  it('starts with nothing ticked for a new Player', () => {
    expect(readFirstDay(opened.db, userId)).toEqual({ done: [], dismissed: false })
  })

  it('ticks a line once, and says so only the first time', () => {
    expect(markFirstDay(opened.db, userId, 'claimHorses')).toEqual({
      done: ['claimHorses'],
      dismissed: false,
    })
    expect(markFirstDay(opened.db, userId, 'claimHorses')).toBeUndefined()
    markFirstDay(opened.db, userId, 'openWiki')
    expect(readFirstDay(opened.db, userId).done).toEqual(['claimHorses', 'openWiki'])
  })

  it('knows which line an accepted order ticks', () => {
    expect(firstDayLineOf({ kind: 'claimHorses' })).toBe('claimHorses')
    expect(firstDayLineOf({ kind: 'walkTo', residentId: 'r1', x: 1, y: 2 })).toBe('giveOrder')
    expect(firstDayLineOf({ kind: 'armyStop', armyId: 'a1' })).toBeUndefined()
  })
})

describe('the first-day requests', () => {
  it('ticks picking a resident and opening the Wiki when the client reports them', async () => {
    const picked = await post(FIRST_DAY_PATH, { line: 'pickResident' })
    expect(picked.statusCode).toBe(200)
    expect(picked.json()).toEqual({ done: ['pickResident'], dismissed: false })
    const wiki = await post(FIRST_DAY_PATH, { line: 'openWiki' })
    expect(wiki.json()).toEqual({ done: ['pickResident', 'openWiki'], dismissed: false })
    // Reported again, nothing changes.
    expect((await post(FIRST_DAY_PATH, { line: 'openWiki' })).json()).toEqual(wiki.json())
  })

  it('ignores a report of a line the server sees itself, or of no line at all', async () => {
    for (const line of ['claimHorses', 'giveOrder', 'constructor', 7, undefined]) {
      const res = await post(FIRST_DAY_PATH, { line })
      expect(res.statusCode, String(line)).toBe(400)
      expect(res.json().error).toBe('invalid-input')
    }
    expect(readFirstDay(opened.db, userId).done).toEqual([])
  })

  it('keeps the card dismissed across logins', async () => {
    expect((await post(FIRST_DAY_DISMISS_PATH)).json()).toEqual({ done: [], dismissed: true })
    expect((await post(FIRST_DAY_PATH, { line: 'openWiki' })).json()).toEqual({
      done: ['openWiki'],
      dismissed: true,
    })
    expect(readFirstDay(opened.db, userId).dismissed).toBe(true)
  })

  it('refuses a request without a session', async () => {
    const res = await app.inject({ method: 'POST', url: FIRST_DAY_DISMISS_PATH })
    expect(res.statusCode).toBe(401)
    expect(readFirstDay(opened.db, userId).dismissed).toBe(false)
  })
})
