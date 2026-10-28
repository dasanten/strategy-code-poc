import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, schema, type Db, type OpenDb } from './db/index.js'
import { SCRIPT_VIEW_CHANGES } from '@csp/shared'
import { eventsFor } from './events.js'
import {
  describeUndeclaredReads,
  noteScriptViewChanges,
  undeclaredFieldReads,
} from './field-check.js'
import { createScript, ensureDefaultScripts, saveScript } from './scripts.js'
import { createWorld } from './world.js'
import { smallTerrain } from './test-terrain.js'

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

describe('the live-world check for undeclared fields', () => {
  it('lists a field an active script reads that the views don’t declare, with its script and Player', () => {
    const mara = addUser('Mara')
    const s = createScript(db, mara, { name: 'feeder', source: 'let h = me.hunger\n' })
    saveScript(db, mara, s.id, {
      source: 'for (r of residents()) {\n  if (r.secretPlan == 1) { walkTo(r.x, r.y) }\n}\n',
    })
    // An older version, no longer active, reads one too: it isn't listed.
    expect(undeclaredFieldReads(db)).toEqual([
      {
        view: 'resident',
        field: 'secretPlan',
        scriptId: s.id,
        script: 'feeder',
        userId: mara,
        player: 'Mara',
        line: 2,
        column: 9,
      },
    ])
    expect(describeUndeclaredReads(undeclaredFieldReads(db))).toBe(
      [
        'resident.secretPlan',
        `  Mara · script "feeder" (${s.id}) · 2:9`,
        '1 undeclared field read by 1 Player.',
      ].join('\n'),
    )
  })

  it('lists nothing for scripts reading only declared fields, the default scripts included', () => {
    const tobin = addUser('Tobin')
    ensureDefaultScripts(db, tobin)
    createScript(db, tobin, { name: 'careful', source: 'me.hunger + me.stats.strength.base\n' })
    // A version with a syntax error never runs, so it isn't checked.
    createScript(db, tobin, { name: 'broken', source: 'me.nope = \n' })
    expect(undeclaredFieldReads(db)).toEqual([])
    expect(describeUndeclaredReads([])).toBe(
      'No active script reads a field the script views don’t declare.',
    )
  })
})

describe('telling Players of a breaking change to the script views', () => {
  const world = (told: number) => ({ ...createWorld(smallTerrain()), scriptViewChanges: told })

  it('notes each dropped field in the realm log of each Player whose active scripts read it, naming the scripts', () => {
    const mara = addUser('Mara')
    const tobin = addUser('Tobin')
    const a = createScript(db, mara, { name: 'feeder', source: 'let h = me.plan\n' })
    const b = createScript(db, mara, { name: 'miner', source: 'me.plan + me.plan\n' })
    createScript(db, tobin, { name: 'careful', source: 'me.hunger\n' })
    const w = world(0)
    // A Player without a realm is told too: the log is theirs, not their realm's.
    expect(noteScriptViewChanges(db, w)).toBe(true)
    expect(w.scriptViewChanges).toBe(SCRIPT_VIEW_CHANGES.length)
    expect(eventsFor(w, mara)).toMatchObject([
      {
        kind: 'scriptFieldDropped',
        field: 'me.plan',
        scripts: [
          { scriptId: a.id, name: 'feeder' },
          { scriptId: b.id, name: 'miner' },
        ],
      },
    ])
    expect(eventsFor(w, tobin)).toEqual([])
    // Once told, never again.
    expect(noteScriptViewChanges(db, w)).toBe(false)
    expect(eventsFor(w, mara)).toHaveLength(1)
  })

  it('notes only the fields a later change drops', () => {
    const mara = addUser('Mara')
    createScript(db, mara, { name: 'feeder', source: 'me.plan + me.scheme\n' })
    const w = world(1)
    const changes = [{ dropped: 'undeclared' as const }, { dropped: ['resident.scheme'] }]
    expect(noteScriptViewChanges(db, w, changes)).toBe(true)
    expect(eventsFor(w, mara).map((e) => e.kind === 'scriptFieldDropped' && e.field)).toEqual([
      'me.scheme',
    ])
  })
})
