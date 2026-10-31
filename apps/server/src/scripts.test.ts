import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SCRIPT_LIBRARY_MAX_SCRIPTS, SCRIPT_MAX_VERSIONS, SESSION_COOKIE, TASKS } from '@csp/shared'
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
  deleteOlderVersions,
  deleteScript,
  deleteVersion,
  getScript,
  listScripts,
  renameScript,
  resetScript,
  saveScript,
} from './scripts.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { dieAll } from './survival.js'
import { worldWithCity } from './test-terrain.js'

const VALID = 'let x = 1\n'
const VALID_2 = 'let x = 2\n'
// The Player's own scripts, not their default scripts (default-scripts.test.ts has those).
const own = (s: { task: unknown }) => s.task === null
const OWN = { task: null, followsDefault: false, params: [] }
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

  it('makes a version with warnings but no syntax errors the active version', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'typos', source: VALID })
    // An unknown field, an unknown name and too few arguments: warnings in the editor only.
    const after = saveScript(db, mara, s.id, { source: 'me.hungr\nresdents()\nwalkTo(3)\n' })
    expect(after).toMatchObject({ activeVersion: 2, latestVersion: 2 })
    expect(after.versions.at(-1)!.errors).toEqual([])
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
        .filter((id) => !TASKS.some((task) => id === defaultScriptId(db, mara, task))),
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

describe('library cap (`CONTEXT.md`: Library cap)', () => {
  it('refuses a script past the cap, default scripts counted, and allows one after a delete', () => {
    const mara = addUser('Mara')
    expect(listScripts(db, mara)).toHaveLength(TASKS.length)
    const made = []
    for (let i = TASKS.length; i < SCRIPT_LIBRARY_MAX_SCRIPTS; i++) {
      made.push(createScript(db, mara, { name: `script ${i}`, source: VALID }))
    }
    expect(listScripts(db, mara)).toHaveLength(SCRIPT_LIBRARY_MAX_SCRIPTS)
    expect(() => createScript(db, mara, { name: 'one more', source: VALID })).toThrow(
      expect.objectContaining({
        code: 'library-full',
        message: expect.stringContaining(`${SCRIPT_LIBRARY_MAX_SCRIPTS} scripts`),
      }),
    )
    deleteScript(db, mara, made[0]!.id)
    expect(createScript(db, mara, { name: 'one more', source: VALID }).name).toBe('one more')
    // Another Player's library is their own.
    expect(createScript(db, addUser('Tobin'), { name: 'mine', source: VALID }).name).toBe('mine')
  })

  it('refuses a save or reset past the version cap, and allows one after a delete', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    for (let v = 2; v <= SCRIPT_MAX_VERSIONS; v++) {
      saveScript(db, mara, s.id, { source: `let x = ${v}\n` })
    }
    expect(getScript(db, mara, s.id).versions).toHaveLength(SCRIPT_MAX_VERSIONS)
    const full = expect.objectContaining({
      code: 'library-full',
      message: expect.stringContaining(`${SCRIPT_MAX_VERSIONS} versions`),
    })
    expect(() => saveScript(db, mara, s.id, { source: VALID_2 })).toThrow(full)
    // Deleting any version makes room; the new one still gets the next number.
    deleteVersion(db, mara, s.id, { version: 1 })
    expect(saveScript(db, mara, s.id, { source: VALID_2 })).toMatchObject({
      activeVersion: SCRIPT_MAX_VERSIONS + 1,
      latestVersion: SCRIPT_MAX_VERSIONS + 1,
    })
    deleteOlderVersions(db, mara, s.id)
    expect(saveScript(db, mara, s.id, { source: VALID }).versions).toHaveLength(2)

    // A default script is capped like any other, Reset included.
    const work = defaultScriptId(db, mara, 'work')
    while (getScript(db, mara, work).versions.length < SCRIPT_MAX_VERSIONS) {
      saveScript(db, mara, work, { source: VALID })
    }
    expect(() => resetScript(db, mara, work)).toThrow(full)
    deleteVersion(db, mara, work, { version: 2 })
    expect(resetScript(db, mara, work).followsDefault).toBe(true)
    expect(checkScriptLibrary(db)).toEqual([])
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

describe('deleting versions', () => {
  const numbers = (s: { versions: { version: number }[] }) => s.versions.map((v) => v.version)

  it('deletes one version for good; the others keep their numbers', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    saveScript(db, mara, s.id, { source: VALID_2 })
    saveScript(db, mara, s.id, { source: VALID })
    const after = deleteVersion(db, mara, s.id, { version: 1 })
    expect(numbers(after)).toEqual([2, 3])
    expect(after).toMatchObject({ activeVersion: 3, latestVersion: 3 })
    expect(() => deleteVersion(db, mara, s.id, { version: 1 })).toThrow(
      expect.objectContaining({ code: 'not-found' }),
    )
    expect(checkScriptLibrary(db)).toEqual([])
  })

  it('keeps counting up after the newest version is deleted', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    saveScript(db, mara, s.id, { source: BROKEN })
    expect(numbers(deleteVersion(db, mara, s.id, { version: 2 }))).toEqual([1])
    expect(listScripts(db, mara).find((x) => x.id === s.id)?.latestVersion).toBe(2)
    const saved = saveScript(db, mara, s.id, { source: VALID_2 })
    expect(numbers(saved)).toEqual([1, 3])
    expect(saved).toMatchObject({ activeVersion: 3, latestVersion: 3 })
  })

  it('refuses the active version', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    saveScript(db, mara, s.id, { source: VALID_2 })
    activateVersion(db, mara, s.id, { version: 1 })
    expect(() => deleteVersion(db, mara, s.id, { version: 1 })).toThrow(
      expect.objectContaining({ code: 'active-version' }),
    )
    // A later version than the active one can go.
    expect(numbers(deleteVersion(db, mara, s.id, { version: 2 }))).toEqual([1])
    expect(activeSource(db, s.id)).toBe(VALID)
  })

  it('deletes every version older than the active one at once', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    saveScript(db, mara, s.id, { source: BROKEN })
    saveScript(db, mara, s.id, { source: VALID_2 })
    saveScript(db, mara, s.id, { source: BROKEN })
    const after = deleteOlderVersions(db, mara, s.id)
    expect(numbers(after)).toEqual([3, 4])
    expect(after).toMatchObject({ activeVersion: 3, latestVersion: 4 })
    expect(activeSource(db, s.id)).toBe(VALID_2)
    expect(saveScript(db, mara, s.id, { source: VALID }).latestVersion).toBe(5)
  })

  it('deletes nothing at once while there is no active version', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'broken', source: BROKEN })
    saveScript(db, mara, s.id, { source: BROKEN })
    expect(numbers(deleteOlderVersions(db, mara, s.id))).toEqual([1, 2])
    // With none active, any version can go.
    expect(numbers(deleteVersion(db, mara, s.id, { version: 2 }))).toEqual([1])
  })

  it("deletes old versions of the Player's default script; Reset still adds the newest", () => {
    const mara = addUser('Mara')
    const work = defaultScriptId(db, mara, 'work')
    saveScript(db, mara, work, { source: VALID })
    saveScript(db, mara, work, { source: VALID_2 })
    const after = deleteOlderVersions(db, mara, work)
    expect(numbers(after)).toEqual([3])
    expect(after.followsDefault).toBe(false)
    const reset = resetScript(db, mara, work)
    expect(numbers(reset)).toEqual([3, 4])
    expect(reset).toMatchObject({ activeVersion: 4, followsDefault: true })
    expect(checkScriptLibrary(db)).toEqual([])
  })

  it("keeps Players out of each other's versions", () => {
    const mara = addUser('Mara')
    const tobin = addUser('Tobin')
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    saveScript(db, mara, s.id, { source: VALID_2 })
    const notFound = expect.objectContaining({ code: 'not-found' })
    expect(() => deleteVersion(db, tobin, s.id, { version: 1 })).toThrow(notFound)
    expect(() => deleteOlderVersions(db, tobin, s.id)).toThrow(notFound)
    expect(numbers(getScript(db, mara, s.id))).toEqual([1, 2])
  })
})

describe('checkScriptLibrary', () => {
  it('reports a version numbered above its latest version', () => {
    const mara = addUser('Mara')
    const a = createScript(db, mara, { name: 'a', source: VALID })
    db.update(schema.scripts).set({ latestVersion: 0 }).where(eq(schema.scripts.id, a.id)).run()
    expect(checkScriptLibrary(db)).toEqual([
      expect.objectContaining({
        invariant: 'script-versions-counted',
        entityIds: [`script-${a.id}`],
      }),
    ])
  })

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

describe('migration 0007', () => {
  it("counts each script's versions up from its highest saved one", async () => {
    const all = fileURLToPath(new URL('../drizzle', import.meta.url))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-migrate-'))
    const old = path.join(dir, 'migrations')
    const file = path.join(dir, 'game.db')
    try {
      // The migrations up to 0006, before the version counter.
      fs.mkdirSync(path.join(old, 'meta'), { recursive: true })
      const journal = JSON.parse(fs.readFileSync(path.join(all, 'meta/_journal.json'), 'utf8'))
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 6)
      fs.writeFileSync(path.join(old, 'meta/_journal.json'), JSON.stringify(journal))
      for (const e of journal.entries as { tag: string }[]) {
        fs.copyFileSync(path.join(all, `${e.tag}.sql`), path.join(old, `${e.tag}.sql`))
      }
      const sqlite = new Database(file)
      migrate(drizzle(sqlite), { migrationsFolder: old })
      sqlite.exec(`
        INSERT INTO users (id, name) VALUES (1, 'Mara');
        INSERT INTO scripts (id, user_id, name, active_version) VALUES
          (1, 1, 'miners', 2), (2, 1, 'empty', NULL);
        INSERT INTO script_versions (script_id, version, source) VALUES
          (1, 1, '${VALID}'), (1, 2, '${VALID_2}'), (1, 3, '${BROKEN}');
      `)
      sqlite.close()

      const opened = await openDb(file)
      expect(getScript(opened.db, 1, 1)).toMatchObject({ activeVersion: 2, latestVersion: 3 })
      expect(getScript(opened.db, 1, 2).latestVersion).toBe(0)
      expect(checkScriptLibrary(opened.db)).toEqual([])
      expect(saveScript(opened.db, 1, 1, { source: VALID }).latestVersion).toBe(4)
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

  it('deletes versions over HTTP, refusing the active one', async () => {
    const call = as(addUser('Mara'))
    const id = (await call('POST', '/api/scripts', { name: 'miners', source: VALID })).json().id
    await call('POST', `/api/scripts/${id}/versions`, { source: VALID_2 })
    await call('POST', `/api/scripts/${id}/versions`, { source: VALID })

    const refused = await call('DELETE', `/api/scripts/${id}/versions/3`)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toBe('active-version')
    const one = await call('DELETE', `/api/scripts/${id}/versions/2`)
    expect(one.statusCode).toBe(200)
    expect(one.json().versions.map((v: { version: number }) => v.version)).toEqual([1, 3])
    const older = await call('POST', `/api/scripts/${id}/delete-older`)
    expect(older.json()).toMatchObject({ activeVersion: 3, latestVersion: 3 })
    expect(older.json().versions.map((v: { version: number }) => v.version)).toEqual([3])
    expect((await call('DELETE', `/api/scripts/${id}/versions/1`)).statusCode).toBe(404)

    const tobin = as(addUser('Tobin'))
    expect((await tobin('POST', `/api/scripts/${id}/delete-older`)).statusCode).toBe(404)
  })

  it('needs a login and hides other Players’ scripts', async () => {
    const mara = as(addUser('Mara'))
    const tobin = as(addUser('Tobin'))
    const id = (await mara('POST', '/api/scripts', { name: 'miners', source: VALID })).json().id
    expect((await app.inject({ method: 'GET', url: '/api/scripts' })).statusCode).toBe(401)
    expect((await tobin('GET', `/api/scripts/${id}`)).statusCode).toBe(404)
    expect((await tobin('DELETE', `/api/scripts/${id}`)).statusCode).toBe(404)
  })

  it('rate-limits a Player’s writes together, not their reads or other Players', async () => {
    const limited = await buildApp({
      db,
      logger: false,
      secureCookies: false,
      trustProxy: false,
      scriptWriteRateLimit: 2,
    })
    try {
      const mara = addUser('Mara')
      const call = (userId: number, method: 'GET' | 'POST', url: string, payload?: object) =>
        limited.inject({
          method,
          url,
          cookies: { [SESSION_COOKIE]: createSession(db, userId) },
          payload,
        })
      const created = await call(mara, 'POST', '/api/scripts', { name: 'a', source: VALID })
      expect(created.statusCode).toBe(201)
      const id = created.json().id as number
      // A second write of another kind counts against the same limit.
      expect(
        (await call(mara, 'POST', `/api/scripts/${id}/versions`, { source: VALID_2 })).statusCode,
      ).toBe(201)
      const res = await call(mara, 'POST', '/api/scripts', { name: 'c', source: VALID })
      expect(res.statusCode).toBe(429)
      expect(res.json().error).toBe('rate-limited')
      expect((await call(mara, 'GET', '/api/scripts')).statusCode).toBe(200)
      const tobin = addUser('Tobin')
      expect(
        (await call(tobin, 'POST', '/api/scripts', { name: 'a', source: VALID })).statusCode,
      ).toBe(201)
    } finally {
      await limited.close()
    }
  })

  it('answers a save past a cap with 409 library-full', async () => {
    const mara = addUser('Mara')
    const call = as(mara)
    const s = createScript(db, mara, { name: 'miners', source: VALID })
    for (let v = 2; v <= SCRIPT_MAX_VERSIONS; v++) saveScript(db, mara, s.id, { source: VALID })
    const res = await call('POST', `/api/scripts/${s.id}/versions`, { source: VALID_2 })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({
      error: 'library-full',
      message: `This script has ${SCRIPT_MAX_VERSIONS} versions, the most it can keep: delete old versions first.`,
    })
  })
})
