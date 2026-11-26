import { describe, expect, it } from 'vitest'
import { mirrorOf } from './test-mirror.js'
import { breedProblem, keptPair } from './world-rules.js'

/** The checks that read the world, asked of the rules module's mirror (T122.6). */
describe('breeding at a stable (`CONTEXT.md`: Breeding)', () => {
  const stable = { id: 's1', kind: 'stable', cityId: null, x: 4, y: 4 }
  const horse = (id: string, more: object = {}) => ({
    id,
    realmId: 'me',
    x: 4,
    y: 4,
    hunger: 50,
    ...more,
  })
  const breeder = { id: 'b', owner: 'me', x: 4, y: 4 }
  const at = (more: { horses?: object[]; stable?: object; residents?: object[] } = {}) =>
    mirrorOf({
      buildings: [{ ...stable, ...more.stable }],
      horses: more.horses ?? [horse('h1'), horse('h2')],
      residents: more.residents ?? [breeder],
    })
  const me = { realmId: 'me' }

  it('lets two fed horses of the realm in a finished stable be bred', () => {
    at()
    expect(breedProblem('s1', me, 'b', ['h1', 'h2'])).toBeUndefined()
    expect(breedProblem('s1', me, 'b', ['h1'])).toBe('pick two horses')
  })

  it('says why not: unfinished, a horse outside, another realm’s, hungry, taken', () => {
    at({ stable: { site: { delivered: {}, work: 0 } } })
    expect(breedProblem('s1', me, 'b', ['h1', 'h2'])).toBe('the stable isn’t finished')
    at({ horses: [horse('h1'), horse('h2', { x: 20 })] })
    expect(breedProblem('s1', me, 'b', ['h1', 'h2'])).toBe('both horses must stand in the stable')
    at({ horses: [horse('h1'), horse('h2', { realmId: 'them' })] })
    expect(breedProblem('s1', me, 'b', ['h1', 'h2'])).toBe('not horses of your realm')
    at({ horses: [horse('h1'), horse('h2', { hunger: 0 })] })
    expect(breedProblem('s1', me, 'b', ['h1', 'h2'])).toBe('a hungry horse can’t breed')
    const other = {
      id: 'o',
      owner: 'me',
      x: 4,
      y: 4,
      order: {
        kind: 'breed',
        stableId: 's1',
        horseIds: ['h1', 'h2'],
        at: { x: 4, y: 4 },
        progress: 0,
      },
    }
    at({ residents: [breeder, other] })
    expect(breedProblem('s1', me, 'b', ['h1', 'h2'])).toBe('those horses are already being bred')
    expect(breedProblem('s1', me, 'o', ['h1', 'h2'])).toBeUndefined()
    expect(breedProblem('nowhere', me, 'b', ['h1', 'h2'])).toBe('no such stable')
  })

  it('carries on with the pair whose breeding the stable kept', () => {
    const breedings = [{ horseIds: ['h1', 'h2'], progress: 10 }]
    at({ stable: { breedings } })
    expect(keptPair('s1', me, 'b')).toEqual(['h1', 'h2'])
    at()
    expect(keptPair('s1', me, 'b')).toBeUndefined()
  })
})
