import { describe, expect, it } from 'vitest'
import {
  ART_STYLES,
  ART_STYLE_NAMES,
  DEFAULT_ART_STYLE,
  rememberArtStyle,
  rememberedArtStyle,
} from './art-style.js'

describe('art style', () => {
  it('names every style', () => {
    for (const style of ART_STYLES) expect(ART_STYLE_NAMES[style]).toBeTruthy()
  })

  it('is the default in a browser that picked none, or kept something else', () => {
    expect(rememberedArtStyle(() => ({ getItem: () => null }))).toBe(DEFAULT_ART_STYLE)
    expect(rememberedArtStyle(() => ({ getItem: () => 'watercolour' }))).toBe(DEFAULT_ART_STYLE)
  })

  it('is Pixel in a fresh browser (ADR 0044)', () => {
    expect(DEFAULT_ART_STYLE).toBe('pixel')
    expect(rememberedArtStyle(() => ({ getItem: () => null }))).toBe('pixel')
  })

  it('keeps a stored pick over the default', () => {
    expect(rememberedArtStyle(() => ({ getItem: () => 'painted' }))).toBe('painted')
    expect(rememberedArtStyle(() => ({ getItem: () => 'tokens' }))).toBe('tokens')
  })

  it('is the default when storage is off', () => {
    const off = () => {
      throw new Error('no storage')
    }
    expect(rememberedArtStyle(off)).toBe(DEFAULT_ART_STYLE)
    expect(() => rememberArtStyle('pixel', off)).not.toThrow()
  })

  it('is what the browser remembers', () => {
    const kept = new Map<string, string>()
    const storage = () => ({
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    })
    rememberArtStyle('pixel', storage)
    expect(rememberedArtStyle(storage)).toBe('pixel')
    rememberArtStyle('tokens', storage)
    expect(rememberedArtStyle(storage)).toBe('tokens')
  })
})
