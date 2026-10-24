import { describe, expect, it } from 'vitest'
import { checkNames, type CheckEnv } from './index.js'

/** A toy game: a `hero` with a `pos`, a `foes()` list of heroes and a `move(x, y, fast?)`. */
const env: CheckEnv = {
  globals: {
    hero: { type: { shape: 'hero' } },
    memory: { type: 'unknown' },
    foes: { type: { list: { shape: 'hero' } }, params: [] },
    move: { type: 'unknown', params: ['x', 'y', 'fast?'] },
  },
  shapes: {
    hero: { name: 'unknown', pos: { shape: 'spot' }, allies: { list: { shape: 'hero' } } },
    spot: { x: 'unknown', y: 'unknown' },
  },
}

const warnings = (source: string) => checkNames(source, env).warnings.map((w) => w.message)

describe('the script checker', () => {
  it('warns of names declared nowhere, at where they are', () => {
    expect(checkNames('let a = 1\nfoo(a)', env).warnings).toEqual([
      { message: 'Unknown name "foo"', line: 2, column: 1 },
    ])
    expect(warnings('missing = 2')).toEqual(['Unknown name "missing"'])
  })

  it('knows locals, parameters, loop variables and functions used before their declaration', () => {
    expect(
      warnings(`
        let n = 1
        fn go(target) { return target + n + later + helper() }
        fn helper() { return 0 }
        for (f of foes()) { go(f) }
        let later = 2
        let anon = fn (a) { return a }`),
    ).toEqual([])
    expect(warnings('if (true) { let inner = 1 }\ninner')).toEqual(['Unknown name "inner"'])
  })

  it('warns of calls with too few or too many arguments', () => {
    expect(warnings('move(1)\nmove(1, 2)\nmove(1, 2, true)\nmove(1, 2, 3, 4)\nfoes(1)')).toEqual([
      '"move" takes 2 to 3 arguments (x, y, fast?), not 1',
      '"move" takes 2 to 3 arguments (x, y, fast?), not 4',
      '"foes" takes 0 arguments, not 1',
    ])
  })

  it('leaves a call alone when a local shadows the name', () => {
    expect(warnings('fn move(a) { return a }\nmove(1)')).toEqual([])
  })

  it('warns of fields a known shape lacks, at the field', () => {
    expect(checkNames('hero.pos.z', env).warnings).toEqual([
      { message: '"z" is not a field of a spot', line: 1, column: 10 },
    ])
    expect(
      warnings(`
        for (f of foes()) { f.nam }
        let first = foes()[0]
        first.pos.x
        first.allies[0].poz
        foes().length
        foes().size`),
    ).toEqual([
      '"nam" is not a field of a hero',
      '"poz" is not a field of a hero',
      'A list has no "size"',
    ])
  })

  it('stays quiet where it isn’t sure of a value', () => {
    expect(
      warnings(`
        memory.anything.deep.down
        fn f(h) { return h.whatever }
        let maybe = hero
        maybe = memory.other
        maybe.unheard
        for (x of memory.list) { x.y.z }
        let built = {a: 1}
        built.b`),
    ).toEqual([])
  })

  it('tells which fields of known shapes a script reads', () => {
    const { reads } = checkNames('hero.pos.x\nhero.nope\nmemory.free', env)
    expect(reads.map((r) => [r.shape, r.field, r.declared])).toEqual([
      ['hero', 'pos', true],
      ['spot', 'x', true],
      ['hero', 'nope', false],
    ])
  })

  it('gives no warnings for a script with a syntax error', () => {
    expect(checkNames('let = foo(', env)).toEqual({ warnings: [], reads: [] })
  })

  it('names shapes the way it is told to', () => {
    const named = { ...env, describeShape: (s: string) => `the ${s}` }
    expect(checkNames('hero.oops', named).warnings[0]!.message).toBe(
      '"oops" is not a field of the hero',
    )
  })
})
