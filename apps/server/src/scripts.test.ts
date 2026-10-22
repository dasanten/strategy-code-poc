import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_COOKIE } from '@csp/shared'
import { buildApp } from './app.js'
import { createSession } from './auth.js'
import { openDb, schema, type Db, type OpenDb } from './db/index.js'
import { loadOrCreateWorld, saveWorld } from './saves.js'
import {
  activateVersion,
  activeSource,
  checkScriptLibrary,
  createScript,
  defaultScriptId,
  deleteScript,
  getScript,
  listScripts,
  renameScript,
  saveScript,
} from './scripts.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { dieAll } from './survival.js'
import { worldWithCity } from './test-terrain.js'

const VALID = 'let x = 1\n'
const VALID_2 = 'let x = 2\n'
// The Player's own scripts, not their default scripts (default-scripts.test.ts has those).
const own = (s: { task: unknown }) => s.task === null
const OWN = { task: null, followsDefault: false }
const BROKEN = 'let = \n'

let opened: OpenDb
let db: Db

function addUser(name: string): number {
  return db.insert(schema.users).values({ name }).returning().get().id
}

beforeEach(async () => {
  opened = await openDb(':memory:')
  db = opened.db
})
afterEach(() => opened.close())

describe('script library', () => {
  it('saves new versions, keeping every one', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    expect(s).toMatchObject({ name: 'miners', activeVersion: 1, latestVersion: 1 })

    saveScript(db, mara, s.id, { source: VALID_2 })
    const after = saveScript(db, mara, s.id, { source: VALID })
    expect(after.versions.map((v) => [v.version, v.source])).toEqual([
      [1, VALID],
      [2, VALID_2],
      [3, VALID],
    ])
    expect(after.activeVersion).toBe(3)
    expect(activeSource(db, s.id)).toBe(VALID)
    expect(checkScriptLibrary(db)).toEqual([])
  })

  it('renames a script, keeping its history; names are unique per Player regardless of case', () => {
    const mara = addUser('Mara')
    const tobin = addUser('Tobin')
    const a = createScript(db, mara, { name: 'miners', source: VALID })
    saveScript(db, mara, a.id, { source: VALID_2 })
    createScript(db, mara, { name: 'farmers', source: VALID })
    // Another Player may use the same name.
    createScript(db, tobin, { name: 'Miners', source: VALID })

    const renamed = renameScript(db, mara, a.id, { name: '  diggers ' })
    expect(renamed).toMatchObject({ name: 'diggers', activeVersion: 2, latestVersion: 2 })
    expect(() => renameScript(db, mara, a.id, { name: 'FARMERS' })).toThrow(
      expect.objectContaining({ code: 'name-taken' }),
    )
    expect(() => createScript(db, mara, { name: 'Diggers', source: VALID })).toThrow(
      expect.objectContaining({ code: 'name-taken' }),
    )
    // Changing only the case of its own name is fine.
    expect(renameScript(db, mara, a.id, { name: 'Diggers' }).name).toBe('Diggers')
    expect(
      listScripts(db, mara)
        .filter(own)
        .map((s) => s.name),
    ).toEqual(['Diggers', 'farmers'])
  })

  it('deletes a script with its history', () => {
    const mara = addUser('Mara')
    const a = createScript(db, mara, { name: 'miners', source: VALID })
    saveScript(db, mara, a.id, { source: VALID_2 })
    const b = createScript(db, mara, { name: 'farmers', source: VALID })
    deleteScript(db, mara, a.id)
    expect(
      listScripts(db, mara)
        .filter(own)
        .map((s) => s.id),
    ).toEqual([b.id])
    expect(
      db
        .select()
        .from(schema.scriptVersions)
        .all()
        .map((v) => v.scriptId)
        .filter((id) => id !== defaultScriptId(db, mara, 'work')),
    ).toEqual([b.id])
    expect(activeSource(db, a.id)).toBeUndefined()
    expect(() => getScript(db, mara, a.id)).toThrow(expect.objectContaining({ code: 'not-found' }))
  })

  it("keeps Players out of each other's scripts", () => {
    const mara = addUser('Mara')
    const tobin = addUser('Tobin')
    const a = createScript(db, mara, { name: 'miners', source: VALID })
    const notFound = expect.objectContaining({ code: 'not-found' })
    expect(() => getScript(db, tobin, a.id)).toThrow(notFound)
    expect(() => saveScript(db, tobin, a.id, { source: VALID_2 })).toThrow(notFound)
    expect(() => renameScript(db, tobin, a.id, { name: 'mine' })).toThrow(notFound)
    expect(() => activateVersion(db, tobin, a.id, { version: 1 })).toThrow(notFound)
    expect(() => deleteScript(db, tobin, a.id)).toThrow(notFound)
    expect(listScripts(db, tobin).filter(own)).toEqual([])
    expect(getScript(db, mara, a.id).latestVersion).toBe(1)
  })

  it('rejects empty or overlong names and overlong sources', () => {
    const mara = addUser('Mara')
    const invalid = expect.objectContaining({ code: 'invalid-input' })
    expect(() => createScript(db, mara, { name: '  ', source: VALID })).toThrow(invalid)
    expect(() => createScript(db, mara, { name: 'x'.repeat(41), source: VALID })).toThrow(invalid)
    expect(() => createScript(db, mara, { name: 'a', source: 'x'.repeat(20_001) })).toThrow(invalid)
    expect(() => createScript(db, mara, { name: 'a', source: 3 })).toThrow(invalid)
  })
})

describe('active version', () => {
  it('keeps a version with syntax errors in the history but never makes it active', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    const after = saveScript(db, mara, s.id, { source: BROKEN })
    expect(after).toMatchObject({ activeVersion: 1, latestVersion: 2 })
    expect(after.versions[1]!.errors).toHaveLength(1)
    expect(activeSource(db, s.id)).toBe(VALID)

    expect(() => activateVersion(db, mara, s.id, { version: 2 })).toThrow(
      expect.objectContaining({ code: 'script-has-errors' }),
    )
    expect(getScript(db, mara, s.id).activeVersion).toBe(1)
    expect(checkScriptLibrary(db)).toEqual([])
  })

  it('has no active version while every version has syntax errors', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'miners', source: BROKEN })
    expect(s.activeVersion).toBeNull()
    expect(activeSource(db, s.id)).toBeUndefined()
    expect(saveScript(db, mara, s.id, { source: VALID }).activeVersion).toBe(2)
  })

  it('goes back to an earlier version without syntax errors', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    saveScript(db, mara, s.id, { source: VALID_2 })
    expect(activateVersion(db, mara, s.id, { version: 1 }).activeVersion).toBe(1)
    expect(activeSource(db, s.id)).toBe(VALID)
    // Going back adds no version.
    expect(getScript(db, mara, s.id).latestVersion).toBe(2)
    expect(() => activateVersion(db, mara, s.id, { version: 7 })).toThrow(
      expect.objectContaining({ code: 'not-found' }),
    )
  })
})

describe('checkScriptLibrary', () => {
  it('reports an active version with syntax errors or one that is missing', () => {
    const mara = addUser('Mara')
    const a = createScript(db, mara, { name: 'a', source: VALID })
    const b = createScript(db, mara, { name: 'b', source: VALID })
    db.update(schema.scriptVersions)
      .set({ source: BROKEN })
      .where(eq(schema.scriptVersions.scriptId, a.id))
      .run()
    db.update(schema.scripts).set({ activeVersion: 5 }).where(eq(schema.scripts.id, b.id)).run()
    expect(checkScriptLibrary(db)).toEqual([
      expect.objectContaining({ invariant: 'active-scripts-valid', entityIds: [`script-${a.id}`] }),
      expect.objectContaining({ invariant: 'active-scripts-valid', entityIds: [`script-${b.id}`] }),
    ])
  })
})

describe('scripts last', () => {
  it('survive a server restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-scripts-'))
    const file = path.join(dir, 'game.db')
    try {
      const first = await openDb(file)
      const mara = first.db.insert(schema.users).values({ name: 'Mara' }).returning().get().id
      const s = createScript(first.db, mara, { name: 'miners', source: VALID })
      saveScript(first.db, mara, s.id, { source: BROKEN })
      const before = getScript(first.db, mara, s.id)
      first.close()

      const second = await openDb(file)
      expect(getScript(second.db, mara, s.id)).toEqual(before)
      expect(activeSource(second.db, s.id)).toBe(VALID)
      second.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("survive the Leader's death and the Player's new city", () => {
    const { world, terrain } = worldWithCity()
    const realm = world.realms[0]!
    db.insert(schema.users).values({ id: realm.userId, name: 'Mara' }).run()
    const s = createScript(db, realm.userId, { name: 'miners', source: VALID })

    const leader = world.residents.find((r) => r.id === realm.leaderId)!
    expect(dieAll(world, [leader], 'oldAge', terrain.size).map((x) => x.id)).toEqual([realm.id])
    expect(world.realms).toEqual([])
    saveWorld(db, world)
    const { world: loaded } = loadOrCreateWorld(db, () => terrain)
    foundStartingCity(loaded, terrain, realm.userId)
    expect(realmOf(loaded, realm.userId)).toBeDefined()

    expect(listScripts(db, realm.userId).filter(own)).toEqual([
      { id: s.id, name: 'miners', activeVersion: 1, latestVersion: 1, ...OWN },
    ])
    expect(activeSource(db, s.id)).toBe(VALID)
  })
})

describe('migration 0005', () => {
  it('turns the old one-row-per-save table into scripts with their versions', async () => {
    const all = fileURLToPath(new URL('../drizzle', import.meta.url))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-migrate-'))
    const old = path.join(dir, 'migrations')
    const file = path.join(dir, 'game.db')
    try {
      // The migrations up to 0004, as the database stood before the script library.
      fs.mkdirSync(path.join(old, 'meta'), { recursive: true })
      const journal = JSON.parse(fs.readFileSync(path.join(all, 'meta/_journal.json'), 'utf8'))
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 4)
      fs.writeFileSync(path.join(old, 'meta/_journal.json'), JSON.stringify(journal))
      for (const e of journal.entries as { tag: string }[]) {
        fs.copyFileSync(path.join(all, `${e.tag}.sql`), path.join(old, `${e.tag}.sql`))
      }
      const sqlite = new Database(file)
      migrate(drizzle(sqlite), { migrationsFolder: old })
      sqlite.exec(`
        INSERT INTO users (id, name) VALUES (1, 'Mara'), (2, 'Tobin');
        INSERT INTO scripts (user_id, name, version, source) VALUES
          (1, 'miners', 1, 'a'), (1, 'miners', 2, 'b'), (1, 'Miners', 3, 'c'),
          (2, 'miners', 1, 'd');
      `)
      sqlite.close()

      const opened = await openDb(file)
      const lib = (userId: number) =>
        listScripts(opened.db, userId)
          .filter(own)
          .map((s) => ({
            ...getScript(opened.db, userId, s.id),
            id: 0,
            versions: getScript(opened.db, userId, s.id).versions.map((v) => [v.version, v.source]),
          }))
      expect(lib(1)).toEqual([
        {
          id: 0,
          name: 'Miners',
          activeVersion: null,
          latestVersion: 3,
          ...OWN,
          versions: [
            [1, 'a'],
            [2, 'b'],
            [3, 'c'],
          ],
        },
      ])
      expect(lib(2)).toMatchObject([{ name: 'miners', versions: [[1, 'd']] }])
      opened.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('script library API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => {
    app = await buildApp({ db, logger: false, secureCookies: false, trustProxy: false })
  })
  afterEach(() => app.close())

  function as(userId: number) {
    const cookies = { [SESSION_COOKIE]: createSession(db, userId) }
    return (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
      app.inject({ method, url, cookies, payload })
  }

  it('saves, renames, activates and deletes over HTTP', async () => {
    const call = as(addUser('Mara'))
    const created = await call('POST', '/api/scripts', { name: 'miners', source: VALID })
    expect(created.statusCode).toBe(201)
    const id = created.json().id as number

    const broken = await call('POST', `/api/scripts/${id}/versions`, { source: BROKEN })
    expect(broken.statusCode).toBe(201)
    expect(broken.json()).toMatchObject({ activeVersion: 1, latestVersion: 2 })

    const refused = await call('POST', `/api/scripts/${id}/active`, { version: 2 })
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toBe('script-has-errors')

    expect((await call('POST', `/api/scripts/${id}/name`, { name: 'diggers' })).json().name).toBe(
      'diggers',
    )
    expect((await call('GET', '/api/scripts')).json().filter(own)).toEqual([
      { id, name: 'diggers', activeVersion: 1, latestVersion: 2, ...OWN },
    ])
    expect((await call('GET', `/api/scripts/${id}`)).json().versions).toHaveLength(2)
    expect((await call('DELETE', `/api/scripts/${id}`)).statusCode).toBe(204)

    // A default script can't be deleted, only reset.
    const list = (await call('GET', '/api/scripts')).json() as { id: number; task: string }[]
    const work = list.find((s) => s.task === 'work')!
    const refusedDelete = await call('DELETE', `/api/scripts/${work.id}`)
    expect(refusedDelete.statusCode).toBe(409)
    expect(refusedDelete.json().error).toBe('default-script')
    await call('POST', `/api/scripts/${work.id}/versions`, { source: VALID })
    const reset = await call('POST', `/api/scripts/${work.id}/reset`)
    expect(reset.json()).toMatchObject({ followsDefault: true, latestVersion: 3 })
    expect((await call('GET', `/api/scripts/${id}`)).statusCode).toBe(404)
  })

  it('needs a login and hides other Players’ scripts', async () => {
    const mara = as(addUser('Mara'))
    const tobin = as(addUser('Tobin'))
    const id = (await mara('POST', '/api/scripts', { name: 'miners', source: VALID })).json().id
    expect((await app.inject({ method: 'GET', url: '/api/scripts' })).statusCode).toBe(401)
    expect((await tobin('GET', `/api/scripts/${id}`)).statusCode).toBe(404)
    expect((await tobin('DELETE', `/api/scripts/${id}`)).statusCode).toBe(404)
  })
})
