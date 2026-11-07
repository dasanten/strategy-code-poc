import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from '../apps/server/src/db/index.js'
import { loadOrCreateWorld, saveWorld } from '../apps/server/src/saves.js'
import { generateTerrain } from '../apps/server/src/terrain-gen.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const run = promisify(execFile)

/** Every file under `dir`, by its path inside it. */
function files(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
    )
    .sort()
}

describe('dump-fixtures', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'csp-dump-fixtures-'))
  const dump = (out: string) =>
    run(
      process.execPath,
      [
        '--import',
        'tsx',
        '--conditions=source',
        'scripts/dump-fixtures.mts',
        '--quick',
        '--out',
        join(scratch, out),
        '--db',
        join(scratch, 'world.db'),
      ],
      { cwd: ROOT },
    )

  beforeAll(async () => {
    // A small world saved the way the server saves it, for the live save.
    const { db, close } = await openDb(join(scratch, 'world.db'))
    const { world } = loadOrCreateWorld(db, (seed) => generateTerrain(seed, 128))
    saveWorld(db, world)
    close()
    // Two runs at once, into two folders.
    await Promise.all([dump('a'), dump('b')])
  }, 120_000)

  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  it('writes every kind of fixture, with a README listing each file', () => {
    const written = files(join(scratch, 'a'))
    expect(written).toEqual(
      expect.arrayContaining([
        '.gitignore',
        'README.md',
        'balance.json',
        'terrain/1-64.bin',
        'nodes/1-64.json',
        'random/mulberry32-1.json',
        'random/mulberry32-2147483647.json',
        'random/mulberry32--5.json',
        'random/hash.json',
        'random/name-hash.json',
        'worlds/village-0.json',
        'worlds/village-60.json',
        'worlds/hq-1.json',
        'worlds/generated-1-128.json',
        'paths/requests.json',
        'lang/cases.json',
        'save/live.json.gz',
        'save/live.json',
        'save/version.json',
      ]),
    )
    const readme = readFileSync(join(scratch, 'a', 'README.md'), 'utf8')
    for (const f of written.filter((f) => f !== 'README.md' && f !== '.gitignore'))
      expect(readme).toContain(`| \`${f}\` |`)
  })

  it('is deterministic: two runs write the same bytes', () => {
    const a = files(join(scratch, 'a'))
    expect(files(join(scratch, 'b'))).toEqual(a)
    for (const f of a) {
      const same = readFileSync(join(scratch, 'a', f)).equals(readFileSync(join(scratch, 'b', f)))
      expect(same, f).toBe(true)
    }
  })

  it('writes what the game computes', () => {
    const at = (f: string) => JSON.parse(readFileSync(join(scratch, 'a', f), 'utf8'))
    expect(at('random/mulberry32-1.json').values).toHaveLength(2000)
    expect(at('random/hash.json')).toHaveLength(500)
    expect(at('worlds/village-60.json').world.tick).toBe(60)
    expect(Buffer.from(at('worlds/village-0.json').terrain.tiles, 'base64')).toHaveLength(200 * 200)
    const { requests } = at('paths/requests.json')
    expect(requests.map((r: { result: { status: string } }) => r.result.status)).toEqual(
      expect.arrayContaining(['found', 'unreachable']),
    )
    expect(at('lang/cases.json').cases.length).toBeGreaterThan(100)
  })
})
