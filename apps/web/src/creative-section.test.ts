import { describe, expect, it } from 'vitest'
import { creativeAmount, creativeOffer, offersAnything } from './creative-section.js'

describe('the Creative section of a card', () => {
  it('gives and takes goods in a storage and the carriage on its tile', () => {
    const storage = { id: 's1', kind: 'storage' as const }
    expect(creativeOffer(storage, { id: 'k1' }, 'storage').holders).toEqual([
      { id: 's1', label: 'The storage' },
      { id: 'k1', label: 'The carriage' },
    ])
    expect(creativeOffer(undefined, { id: 'k1' }, '').holders).toEqual([
      { id: 'k1', label: 'The carriage' },
    ])
  })

  it('finishes a site now, whatever it becomes, but not a finished building', () => {
    const site = { id: 'b1', kind: 'house' as const, site: { delivered: {}, work: 0 } }
    const offer = creativeOffer(site, undefined, 'house')
    expect(offer.holders).toEqual([])
    expect(offer.finish?.buildingId).toBe('b1')
    expect(offer.finish?.label).toBe('Finish now')
    // A storage site holds no goods until it is built.
    expect(creativeOffer({ ...site, kind: 'storage' }, undefined, 'storage').holders).toEqual([])
    const house = { id: 'b2', kind: 'house' as const }
    expect(offersAnything(creativeOffer(house, undefined, 'house'))).toBe(false)
  })

  it('finishes a site sharing the tile: a ram, a boat on a haven, a road', () => {
    const site = { delivered: {}, work: 0 }
    const ram = { id: 'r1', kind: 'ram' as const, site }
    expect(creativeOffer(undefined, undefined, '', [ram]).finish).toMatchObject({
      buildingId: 'r1',
      label: 'Finish now',
    })
    const haven = { id: 'h1', kind: 'haven' as const }
    const boat = { id: 'v1', kind: 'boat' as const, site }
    const onHaven = creativeOffer(haven, undefined, 'haven', [boat])
    expect(onHaven.finish?.buildingId).toBe('v1')
    expect(onHaven.holders).toEqual([{ id: 'h1', label: 'The haven' }])
    const road = { id: 'd1', kind: 'road' as const, site }
    expect(creativeOffer(undefined, undefined, '', [road]).finish?.buildingId).toBe('d1')
    // A finished road or ship on the tile offers nothing.
    const built = { id: 'd2', kind: 'road' as const }
    expect(offersAnything(creativeOffer(undefined, undefined, '', [built]))).toBe(false)
  })

  it("finishes a training ground's trainings", () => {
    const ground = { id: 'g1', kind: 'trainingGround' as const }
    expect(creativeOffer(ground, undefined, 'training ground').finish?.label).toBe(
      'Finish trainings now',
    )
  })

  it('takes only a whole number of units, at least one', () => {
    expect(creativeAmount('100')).toBe(100)
    expect(creativeAmount(' 7 ')).toBe(7)
    for (const bad of ['', '0', '-3', '1.5', 'many']) expect(creativeAmount(bad)).toBeUndefined()
  })
})
