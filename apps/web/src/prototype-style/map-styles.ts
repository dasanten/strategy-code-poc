// PROTOTYPE (T17.1, #203): throwaway. How each style direction treats the map: terrain colours,
// terrain marks and the base drawn under each glyph. The glyphs themselves are shared.
import { Terrain, type ResourceKind } from '@csp/shared'
import { glyphImage, type GlyphName } from './glyphs.js'
import type { Rel } from './scene.js'

export type Role = 'building' | 'node' | 'unit' | 'emblem' | 'marker'
export interface Token {
  x: number
  y: number
  r: number
  glyph: GlyphName
  role: Role
  rel?: Rel
  node?: ResourceKind
}

export interface MapStyle {
  terrain: Record<number, string>
  void: string
  /** Colour of the tiny marks (trees, hills, waves) drawn on terrain when zoomed in. */
  mark: string
  markAlpha: number
  road: { color: string; width: number; dash?: number[] }
  rel: Record<Rel, string>
  node: Record<ResourceKind, string>
  font: string
  label: (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) => void
  token: (ctx: CanvasRenderingContext2D, t: Token, redraw: () => void) => void
  badge: (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) => void
  select: string
}

const hex = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3
    ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a))
  }
  ctx.closePath()
}
const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
const glyph = (
  ctx: CanvasRenderingContext2D,
  name: GlyphName,
  color: string,
  x: number,
  y: number,
  size: number,
  stroke: number,
  redraw: () => void,
) => {
  const img = glyphImage(name, color, stroke, redraw)
  if (img.complete && img.naturalWidth) ctx.drawImage(img, x - size / 2, y - size / 2, size, size)
}

// A: Parchment cartography — an old map: sepia land, ink line work, wax-seal tokens.
export const PARCHMENT: MapStyle = {
  terrain: {
    [Terrain.Plains]: '#dccb98',
    [Terrain.Forest]: '#a3ab78',
    [Terrain.Hills]: '#cdb07a',
    [Terrain.Mountain]: '#ad9c84',
    [Terrain.Lake]: '#a9c0b4',
    [Terrain.Sea]: '#94afab',
  },
  void: '#e8d9b0',
  mark: '#4a3622',
  markAlpha: 0.55,
  road: { color: '#6b4a2b', width: 2, dash: [6, 4] },
  rel: { own: '#b5832a', alliance: '#3d6694', other: '#a3402d', npc: '#7a6650', trade: '#2e8584' },
  node: { forest: '#3f5a2c', stone: '#5d5850', ironOre: '#8a3f22', goldOre: '#a07a12' },
  font: '"IM Fell English", "Palatino Linotype", Georgia, serif',
  label(ctx, text, x, y, size) {
    ctx.font = `italic ${size}px ${this.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(240,226,190,0.9)'
    ctx.strokeText(text, x, y)
    ctx.fillStyle = '#3b2814'
    ctx.fillText(text, x, y)
  },
  token(ctx, t, redraw) {
    const { x, y, r } = t
    const rel = t.rel ? this.rel[t.rel] : '#7a6650'
    if (t.role === 'building') {
      roundRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.15)
      ctx.fillStyle = '#f2e6c4'
      ctx.fill()
      ctx.lineWidth = Math.max(1.5, r * 0.14)
      ctx.strokeStyle = rel
      ctx.stroke()
      glyph(ctx, t.glyph, '#3b2814', x, y, r * 1.6, 1.8, redraw)
    } else if (t.role === 'node') {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(242,230,196,0.75)'
      ctx.fill()
      glyph(ctx, t.glyph, this.node[t.node ?? 'stone'], x, y, r * 1.7, 2, redraw)
    } else {
      // Wax seal: a slightly lumpy disc in the relationship colour, cream glyph.
      ctx.beginPath()
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI * 2
        const rr = r * (1 + 0.06 * Math.sin(i * 2.7))
        ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a))
      }
      ctx.fillStyle = rel
      ctx.fill()
      ctx.lineWidth = Math.max(1, r * 0.12)
      ctx.strokeStyle = 'rgba(40,20,10,0.55)'
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y, r * 0.75, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,240,210,0.35)'
      ctx.lineWidth = 1
      ctx.stroke()
      glyph(ctx, t.glyph, '#f6ebcf', x, y, r * 1.25, 2, redraw)
    }
  },
  badge(ctx, text, x, y, size) {
    ctx.font = `bold ${size}px ${this.font}`
    const w = ctx.measureText(text).width + size * 0.6
    roundRect(ctx, x - w / 2, y - size * 0.65, w, size * 1.3, 2)
    ctx.fillStyle = '#f2e6c4'
    ctx.fill()
    ctx.strokeStyle = '#3b2814'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#3b2814'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y + 0.5)
  },
  select: '#3b2814',
}

// B: Painted board game — saturated land, chunky pieces in player colours with drop shadows.
export const BOARD: MapStyle = {
  terrain: {
    [Terrain.Plains]: '#93c45a',
    [Terrain.Forest]: '#3f8c3c',
    [Terrain.Hills]: '#c9a65c',
    [Terrain.Mountain]: '#938f8a',
    [Terrain.Lake]: '#45aee0',
    [Terrain.Sea]: '#2f80c6',
  },
  void: '#1d4f7a',
  mark: '#1f3d17',
  markAlpha: 0.5,
  road: { color: '#e8cf97', width: 4 },
  rel: { own: '#f5b52e', alliance: '#3c84f0', other: '#e5523b', npc: '#a58a68', trade: '#1fbaa9' },
  node: { forest: '#2e7d32', stone: '#6d6a66', ironOre: '#b4532a', goldOre: '#d9a400' },
  font: '"Fredoka", "Trebuchet MS", sans-serif',
  label(ctx, text, x, y, size) {
    ctx.font = `600 ${size}px ${this.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width + size
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    roundRect(ctx, x - w / 2 + 2, y - size * 0.7 + 3, w, size * 1.4, size * 0.4)
    ctx.fill()
    ctx.fillStyle = '#7a4f2a'
    roundRect(ctx, x - w / 2, y - size * 0.7, w, size * 1.4, size * 0.4)
    ctx.fill()
    ctx.strokeStyle = '#4a2e17'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#fff6e0'
    ctx.fillText(text, x, y + 1)
  },
  token(ctx, t, redraw) {
    const { x, y, r } = t
    const rel = t.rel ? this.rel[t.rel] : '#a58a68'
    const shadow = () => {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.ellipse(x + r * 0.15, y + r * 0.85, r * 0.95, r * 0.35, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    if (t.role === 'building') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      roundRect(ctx, x - r + r * 0.15, y - r + r * 0.25, r * 2, r * 2, r * 0.3)
      ctx.fill()
      roundRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.3)
      ctx.fillStyle = rel
      ctx.fill()
      ctx.lineWidth = Math.max(1.5, r * 0.12)
      ctx.strokeStyle = '#2a1d12'
      ctx.stroke()
      roundRect(ctx, x - r * 0.8, y - r * 0.85, r * 1.6, r * 0.35, r * 0.15)
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fill()
      glyph(ctx, t.glyph, '#2a1d12', x, y + r * 0.05, r * 1.45, 2.6, redraw)
    } else if (t.role === 'node') {
      shadow()
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = '#fff8e6'
      ctx.fill()
      ctx.lineWidth = Math.max(1.5, r * 0.12)
      ctx.strokeStyle = '#2a1d12'
      ctx.stroke()
      glyph(ctx, t.glyph, this.node[t.node ?? 'stone'], x, y, r * 1.5, 2.8, redraw)
    } else if (t.role === 'emblem') {
      shadow()
      ctx.beginPath()
      ctx.moveTo(x - r, y - r)
      ctx.lineTo(x + r, y - r)
      ctx.lineTo(x + r, y + r * 0.2)
      ctx.quadraticCurveTo(x + r, y + r, x, y + r * 1.3)
      ctx.quadraticCurveTo(x - r, y + r, x - r, y + r * 0.2)
      ctx.closePath()
      ctx.fillStyle = rel
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#2a1d12'
      ctx.stroke()
      glyph(ctx, t.glyph, '#fff8e6', x, y, r * 1.3, 2.6, redraw)
    } else {
      shadow()
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = rel
      ctx.fill()
      ctx.lineWidth = Math.max(1.5, r * 0.16)
      ctx.strokeStyle = '#2a1d12'
      ctx.stroke()
      glyph(ctx, t.glyph, '#fff8e6', x, y, r * 1.3, 2.6, redraw)
    }
  },
  badge(ctx, text, x, y, size) {
    ctx.font = `700 ${size}px ${this.font}`
    const w = Math.max(size * 1.4, ctx.measureText(text).width + size * 0.7)
    roundRect(ctx, x - w / 2, y - size * 0.7, w, size * 1.4, size * 0.7)
    ctx.fillStyle = '#fff8e6'
    ctx.fill()
    ctx.strokeStyle = '#2a1d12'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#2a1d12'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y + 1)
  },
  select: '#ffffff',
}

// C: Clean modern strategy — a muted, darkened map so bright flat icons in hex badges pop.
export const MODERN: MapStyle = {
  terrain: {
    [Terrain.Plains]: '#5d6c48',
    [Terrain.Forest]: '#3a4d37',
    [Terrain.Hills]: '#6e6650',
    [Terrain.Mountain]: '#5b5b5e',
    [Terrain.Lake]: '#2d4a5c',
    [Terrain.Sea]: '#20374a',
  },
  void: '#0e1419',
  mark: '#e8eef4',
  markAlpha: 0.14,
  road: { color: '#c9b98f', width: 2.5 },
  rel: { own: '#f2b630', alliance: '#4f9dff', other: '#ff6a48', npc: '#a89c8a', trade: '#2ec8b8' },
  node: { forest: '#7bd88f', stone: '#c9ccd1', ironOre: '#ff9a6a', goldOre: '#ffd34d' },
  font: '"Inter", "Segoe UI", system-ui, sans-serif',
  label(ctx, text, x, y, size) {
    ctx.font = `600 ${size}px ${this.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width + size * 0.9
    roundRect(ctx, x - w / 2, y - size * 0.65, w, size * 1.3, 4)
    ctx.fillStyle = 'rgba(14,20,25,0.82)'
    ctx.fill()
    ctx.fillStyle = '#e8eef4'
    ctx.fillText(text, x, y + 0.5)
  },
  token(ctx, t, redraw) {
    const { x, y, r } = t
    const rel = t.rel ? this.rel[t.rel] : '#a89c8a'
    if (t.role === 'node') {
      ctx.beginPath()
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r, y)
      ctx.closePath()
      ctx.fillStyle = 'rgba(14,20,25,0.85)'
      ctx.fill()
      glyph(ctx, t.glyph, this.node[t.node ?? 'stone'], x, y, r * 1.15, 2, redraw)
      return
    }
    if (t.role === 'unit' || t.role === 'marker') {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(14,20,25,0.9)'
      ctx.fill()
      ctx.lineWidth = Math.max(1.5, r * 0.18)
      ctx.strokeStyle = rel
      ctx.stroke()
      glyph(ctx, t.glyph, rel, x, y, r * 1.2, 2.2, redraw)
      return
    }
    hex(ctx, x, y, r * 1.08)
    ctx.fillStyle = 'rgba(14,20,25,0.9)'
    ctx.fill()
    ctx.lineWidth = Math.max(1.5, r * (t.role === 'emblem' ? 0.14 : 0.1))
    ctx.strokeStyle = rel
    ctx.stroke()
    glyph(ctx, t.glyph, '#e8eef4', x, y, r * 1.2, 1.8, redraw)
  },
  badge(ctx, text, x, y, size) {
    ctx.font = `700 ${size}px ${this.font}`
    const w = Math.max(size * 1.3, ctx.measureText(text).width + size * 0.6)
    roundRect(ctx, x - w / 2, y - size * 0.62, w, size * 1.24, size * 0.62)
    ctx.fillStyle = '#e8eef4'
    ctx.fill()
    ctx.fillStyle = '#0e1419'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y + 0.5)
  },
  select: '#ffffff',
}

// D: Daniel's pick (T17.1) — the board-game terrain of B under the command-table tokens of C.
export const MIXED: MapStyle = {
  ...MODERN,
  terrain: BOARD.terrain,
  void: BOARD.void,
  mark: BOARD.mark,
  markAlpha: BOARD.markAlpha,
  road: BOARD.road,
}
