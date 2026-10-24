import { checkNames } from '@csp/lang'
import { DEFAULT_SCRIPTS, scriptCheckEnv } from '@csp/shared'
import { describe, expect, it } from 'vitest'

const warnings = (source: string, defaultScript = false) =>
  checkNames(source, scriptCheckEnv({ defaultScript })).warnings.map((w) => w.message)

describe('checking a script against the game API and the script views', () => {
  it('warns of a misspelt query, an action with too few arguments and an unknown field', () => {
    expect(warnings('resdents()')).toEqual(['Unknown name "resdents"'])
    expect(warnings('walkTo(3)')).toEqual(['"walkTo" takes 2 arguments (x, y), not 1'])
    expect(warnings('pickUp({kind: "ground"})')).toEqual([
      '"pickUp" takes 2 arguments (spot, goods), not 1',
    ])
    expect(warnings('me.hungr')).toEqual(['"hungr" is not a field of a resident or an army'])
    expect(warnings('me.hungr', true)).toEqual(['"hungr" is not a field of a resident'])
  })

  it('follows queries, lists and fields to their views', () => {
    expect(
      warnings(`
        for (r of residents()) { r.stats.strength.base + r.helth }
        let b = building("b1")
        b.site.delivered.wood + b.stok
        storages()[0].kind
        directives()[0].goals[0].cout`),
    ).toEqual([
      '"helth" is not a field of a resident',
      '"stok" is not a field of a building',
      '"cout" is not a field of a directive’s goal',
    ])
  })

  it('stays quiet about memory, function parameters and the script’s own objects', () => {
    expect(
      warnings(`
        memory.anything.deep = 1
        let x = memory.anything.deep
        fn at(spot) { return spot.whatever }
        let mine = {a: 1}
        mine.b`),
    ).toEqual([])
  })

  it('offers both APIs to a Player’s script, the resident’s alone to a default script', () => {
    expect(warnings('guard(1, 2)\nme.members\nme.carried')).toEqual([])
    expect(warnings('guard(1, 2)', true)).toEqual(['Unknown name "guard"'])
    expect(warnings('me.members', true)).toEqual(['"members" is not a field of a resident'])
  })

  it.each(Object.entries(DEFAULT_SCRIPTS))('finds nothing in the default script %s', (_, s) => {
    expect(warnings(s.source, true)).toEqual([])
    expect(warnings(s.source)).toEqual([])
  })
})
