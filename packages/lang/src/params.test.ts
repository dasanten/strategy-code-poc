import { describe, expect, it } from 'vitest'
import { checkNames, checkScript, parse, run, scriptParams, type CheckEnv } from './index.js'

describe('param lines', () => {
  it('are read from the top of a script, with their type and where they are', () => {
    const program = parse('// where to\nparam storage: storage\nparam site: building;\nlet x = 1')
    expect(program.params).toEqual([
      { name: 'storage', type: 'storage', line: 2, column: 1 },
      { name: 'site', type: 'building', line: 3, column: 1 },
    ])
    expect(program.body).toHaveLength(1)
    expect(parse('param foodAt: number').params).toEqual([
      { name: 'foodAt', type: 'number', line: 1, column: 1 },
    ])
    expect(parse('let x = 1').params).toEqual([])
  })

  it('are a syntax error anywhere but the top', () => {
    expect(checkScript('let x = 1\nparam storage: storage')).toEqual([
      { message: '"param" lines go at the top of the script', line: 2, column: 1 },
    ])
    expect(checkScript('if (true) {\n  param a: building\n}')).toHaveLength(1)
  })

  it('need a known type and a name only once', () => {
    expect(checkScript('param a: horse')[0]?.message).toBe(
      'Expected "building" or "storage" or "number" after "param a:" but found the name "horse"',
    )
    expect(checkScript('param a: building\nparam a: storage')[0]?.message).toBe(
      'The param "a" appears twice',
    )
  })

  it('may give a number param a default, a whole number of zero or more', () => {
    expect(parse('param foodAt: number = 3\nparam take: number = 0;\nlet x = 1').params).toEqual([
      { name: 'foodAt', type: 'number', default: 3, line: 1, column: 1 },
      { name: 'take', type: 'number', default: 0, line: 2, column: 1 },
    ])
    expect(scriptParams('param rounds: number = 5')).toEqual([
      { name: 'rounds', type: 'number', default: 5, line: 1, column: 1 },
    ])
  })

  it('give no default to a building or storage param, nor one that is no whole number', () => {
    expect(checkScript('param home: building = 3')).toEqual([
      {
        message: 'A "building" param can\'t have a default, only a "number" param',
        line: 1,
        column: 22,
      },
    ])
    expect(checkScript('param s: storage = 1')[0]?.message).toBe(
      'A "storage" param can\'t have a default, only a "number" param',
    )
    expect(checkScript('param n: number = -1')).toEqual([
      {
        message: 'The default of "param n" must be a whole number of zero or more but found "-"',
        line: 1,
        column: 19,
      },
    ])
    expect(checkScript('param n: number = 1.5')[0]?.message).toBe(
      'The default of "param n" must be a whole number of zero or more but found the number 1.5',
    )
    expect(checkScript('param n: number = "3"')[0]?.message).toBe(
      'The default of "param n" must be a whole number of zero or more but found a string',
    )
    expect(checkScript('param n: number =')[0]?.message).toBe(
      'The default of "param n" must be a whole number of zero or more but found the end of the script',
    )
  })

  it('leave "param" free as a name elsewhere', () => {
    expect(checkScript('let param = 1\nparam = param + 1\nfn f(param) { return param }')).toEqual(
      [],
    )
  })

  it('are listed by scriptParams, none for a script with a syntax error', () => {
    expect(scriptParams('param a: building\nlet b = 1')).toEqual([
      { name: 'a', type: 'building', line: 1, column: 1 },
    ])
    expect(scriptParams('param a: building\nlet = 1')).toEqual([])
  })

  it('read as params.name, whatever the host gives', () => {
    const memory: Record<string, never> = {}
    const program = parse('param a: building\nmemory.seen = params.a')
    const result = run(program, {
      globals: { memory, params: { a: null } },
      steps: 100,
      maxCallDepth: 10,
      limits: { maxStringLength: 100, maxListLength: 10, maxObjectKeys: 10 },
    })
    expect(result.status).toBe('done')
    expect(memory).toEqual({ seen: null })
  })
})

describe('checking params', () => {
  const env: CheckEnv = {
    globals: { memory: { type: 'unknown' } },
    shapes: { place: { x: 'unknown', y: 'unknown' } },
    paramTypes: { building: { shape: 'place' } },
  }
  const warnings = (source: string) => checkNames(source, env).warnings.map((w) => w.message)

  it('warns of a param the script has no line for', () => {
    expect(warnings('param home: building\nlet a = params.home\nlet b = params.away')).toEqual([
      'No param "away": declare it with a "param" line at the top',
    ])
  })

  it('knows what a param holds by its type', () => {
    expect(warnings('param home: building\nlet a = params.home.z')).toEqual([
      '"z" is not a field of a place',
    ])
    expect(warnings('param s: storage\nlet a = params.s.anything')).toEqual([])
  })
})
