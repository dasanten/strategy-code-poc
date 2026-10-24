import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, schema, type Db, type OpenDb } from './db/index.js'
import { describeUndeclaredReads, undeclaredFieldReads } from './field-check.js'
import { createScript, ensureDefaultScripts, saveScript } from './scripts.js'

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
