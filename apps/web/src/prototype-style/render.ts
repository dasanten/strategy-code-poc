// PROTOTYPE (T17.1, #203): throwaway. Draws the scene in one style at the three zoom tiers of
// ADR 0008 with a plain 2D canvas (the real build uses the Pixi atlas from T17.4).
import { NODE_WORKPLACE, Terrain } from '@csp/shared'
import { hash } from '../../../server/src/terrain-gen.js'
import type { GlyphName } from './glyphs.js'
import type { MapStyle } from './map-styles.js'
import type { Person, Rel, Scene } from './scene.js'

export interface Cam {
  x: number
  y: number
  s: number
}
export type Tier = 'far' | 'middle' | 'close'
export const FAR_BELOW = 8
export const CLOSE_FROM = 20
export const tierOf = (s: number): Tier =>
  s < FAR_BELOW ? 'far' : s < CLOSE_FROM ? 'middle' : 'close'

export type Selection =
  { kind: 'city'; name: string } | { kind: 'tile'; x: number; y: number } | undefined

/** Terrain at 4 px per tile, with ragged organic edges between terrain types. */
export function terrainTexture(scene: Scene, style: MapStyle): HTMLCanvasElement {
  const { size, tiles } = scene.map
  const k = 4
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size * k
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size * k, size * k)
  const rgb = Object.fromEntries(
    Object.entries(style.terrain).map(([t, c]) => [
      t,
      [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)),
    ]),
  ) as Record<number, number[]>
  // Smooth noise on a lattice every 6 px bends the tile borders into ragged, organic edges.
  const smooth = (px: number, py: number, seed: number) => {
    const [gx, gy] = [px / 6, py / 6]
    const [ix, iy] = [Math.floor(gx), Math.floor(gy)]
    const [fx, fy] = [gx - ix, gy - iy]
    const [ux, uy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)]
    const a = hash(ix, iy, seed) + (hash(ix + 1, iy, seed) - hash(ix, iy, seed)) * ux
    const b = hash(ix, iy + 1, seed) + (hash(ix + 1, iy + 1, seed) - hash(ix, iy + 1, seed)) * ux
    return a + (b - a) * uy
  }
  for (let py = 0; py < size * k; py++)
    for (let px = 0; px < size * k; px++) {
      const jx = (smooth(px, py, 21) - 0.5) * 1.3
      const jy = (smooth(px, py, 22) - 0.5) * 1.3
      const tx = Math.min(size - 1, Math.max(0, Math.floor(px / k + jx)))
      const ty = Math.min(size - 1, Math.max(0, Math.floor(py / k + jy)))
      const c = rgb[tiles[ty * size + tx]!] ?? [0, 0, 0]
      const shade = 1 + (smooth(px * 2, py * 2, 23) - 0.5) * 0.08
      const i = (py * size * k + px) * 4
      img.data[i] = c[0]! * shade
      img.data[i + 1] = c[1]! * shade
      img.data[i + 2] = c[2]! * shade
      img.data[i + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
  return canvas
}

const ACTIVITY_GLYPH: Partial<Record<Person['activity'], GlyphName>> = {
  walk: 'walk',
  carry: 'carry',
  work: 'work',
  fight: 'fight',
}

export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: Scene,
  style: MapStyle,
  terrain: HTMLCanvasElement,
  cam: Cam,
  selected: Selection,
  redraw: () => void,
) {
  const { size, tiles } = scene.map
  const s = cam.s
  const tier = tierOf(s)
  const sx = (tx: number) => (tx - cam.x) * s + w / 2
  const sy = (ty: number) => (ty - cam.y) * s + h / 2
  const x0 = Math.max(0, Math.floor(cam.x - w / 2 / s) - 1)
  const x1 = Math.min(size - 1, Math.ceil(cam.x + w / 2 / s) + 1)
  const y0 = Math.max(0, Math.floor(cam.y - h / 2 / s) - 1)
  const y1 = Math.min(size - 1, Math.ceil(cam.y + h / 2 / s) + 1)
  const visible = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1

  ctx.fillStyle = style.void
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(terrain, sx(0), sy(0), size * s, size * s)

  // Terrain marks: trees, hill arcs, peaks and waves, so terrain reads as terrain.
  if (s >= 10) {
    ctx.save()
    ctx.strokeStyle = style.mark
    ctx.fillStyle = style.mark
    ctx.globalAlpha = style.markAlpha
    ctx.lineWidth = Math.max(1, s / 22)
    ctx.lineCap = 'round'
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const t = tiles[y * size + x]
        const r = hash(x, y, 31)
        const cx = sx(x) + s * (0.3 + 0.4 * r)
        const cy = sy(y) + s * (0.3 + 0.4 * hash(x, y, 32))
        const m = s * 0.18
        ctx.beginPath()
        if (t === Terrain.Forest) {
          for (const [dx, dy] of r < 0.5
            ? [[0, 0]]
            : [
                [-0.6, 0.2],
                [0.6, -0.1],
              ]) {
            const [ax, ay] = [cx + dx! * m * 1.6, cy + dy! * m * 1.6]
            ctx.moveTo(ax, ay - m * 1.4)
            ctx.lineTo(ax + m, ay + m * 0.6)
            ctx.lineTo(ax - m, ay + m * 0.6)
            ctx.closePath()
          }
          ctx.fill()
        } else if (t === Terrain.Hills && r < 0.7) {
          ctx.arc(cx, cy + m, m * 1.4, Math.PI * 1.15, Math.PI * 1.85)
          ctx.stroke()
        } else if (t === Terrain.Mountain && r < 0.8) {
          ctx.moveTo(cx - m * 1.6, cy + m)
          ctx.lineTo(cx, cy - m * 1.4)
          ctx.lineTo(cx + m * 1.6, cy + m)
          ctx.moveTo(cx - m * 0.4, cy - m * 0.6)
          ctx.lineTo(cx + m * 0.3, cy + m)
          ctx.stroke()
        } else if ((t === Terrain.Lake || t === Terrain.Sea) && r < 0.35) {
          ctx.moveTo(cx - m * 1.4, cy)
          ctx.quadraticCurveTo(cx - m * 0.7, cy - m * 0.8, cx, cy)
          ctx.quadraticCurveTo(cx + m * 0.7, cy + m * 0.8, cx + m * 1.4, cy)
          ctx.stroke()
        } else if (t === Terrain.Plains && r < 0.12) {
          ctx.moveTo(cx - m * 0.5, cy)
          ctx.lineTo(cx - m * 0.2, cy - m * 0.7)
          ctx.moveTo(cx + m * 0.4, cy)
          ctx.lineTo(cx + m * 0.1, cy - m * 0.8)
          ctx.stroke()
        }
      }
    ctx.restore()
  }

  // Territory: a soft wash of the relationship colour around each city, strongest when far out.
  ctx.save()
  ctx.globalAlpha = tier === 'far' ? 0.35 : 0.12
  for (const c of scene.cities) {
    const rad = (c.size === 'village' ? 9 : c.size === 'town' ? 12 : 15) * s
    const g = ctx.createRadialGradient(
      sx(c.x + 0.5),
      sy(c.y + 0.5),
      rad * 0.3,
      sx(c.x + 0.5),
      sy(c.y + 0.5),
      rad,
    )
    g.addColorStop(0, style.rel[c.rel])
    g.addColorStop(1, 'transparent')
    ctx.fillStyle = g
    ctx.fillRect(sx(c.x) - rad, sy(c.y) - rad, rad * 2 + s, rad * 2 + s)
  }
  ctx.restore()

  // Roads.
  ctx.save()
  ctx.strokeStyle = style.road.color
  ctx.lineWidth = tier === 'far' ? 1.2 : Math.max(style.road.width, s * (style.road.width / 14))
  ctx.lineCap = 'round'
  if (style.road.dash && tier !== 'far') ctx.setLineDash(style.road.dash.map((d) => (d * s) / 14))
  ctx.beginPath()
  for (const t of scene.roads) {
    const [x, y] = [t % size, Math.floor(t / size)]
    for (const [nx, ny] of [
      [x + 1, y],
      [x, y + 1],
    ] as const)
      if (scene.roads.has(ny * size + nx)) {
        ctx.moveTo(sx(x + 0.5), sy(y + 0.5))
        ctx.lineTo(sx(nx + 0.5), sy(ny + 0.5))
      }
  }
  ctx.stroke()
  ctx.restore()

  const tok = (
    x: number,
    y: number,
    r: number,
    glyph: GlyphName,
    role: Parameters<MapStyle['token']>[1]['role'],
    rel?: Rel,
    extra = {},
  ) => style.token(ctx, { x, y, r, glyph, role, rel, ...extra }, redraw)

  if (tier === 'far') {
    for (const a of scene.armies) tok(sx(a.x + 0.5), sy(a.y + 0.5), 6, 'banner', 'marker', a.rel)
    for (const c of scene.carts.filter((c) => c.caravan))
      tok(sx(c.x + 0.5), sy(c.y + 0.5), 6, 'caravan', 'marker', c.rel)
    for (const c of scene.cities) {
      const r = c.size === 'village' ? 9 : c.size === 'town' ? 12 : 15
      tok(sx(c.x + 0.5), sy(c.y + 0.5), r, 'castle', 'emblem', c.rel)
      style.label(ctx, c.name, sx(c.x + 0.5), sy(c.y + 0.5) + r + 13, 13)
    }
    if (selected?.kind === 'city') {
      const c = scene.cities.find((c) => c.name === selected.name)
      if (c) ring(ctx, style, sx(c.x + 0.5), sy(c.y + 0.5), 20)
    }
    return
  }

  // Walls: joined lines in the owner's colour rather than one token per tile.
  const wallAt = new Map<number, Rel>()
  for (const b of scene.buildings)
    if (b.kind === 'wall' || b.kind === 'gate') wallAt.set(b.y * size + b.x, b.rel)
  ctx.save()
  ctx.lineCap = 'square'
  for (const b of scene.buildings) {
    if ((b.kind !== 'wall' && b.kind !== 'gate') || !visible(b.x, b.y)) continue
    const [cx, cy] = [sx(b.x + 0.5), sy(b.y + 0.5)]
    for (const [nx, ny] of [
      [b.x + 1, b.y],
      [b.x, b.y + 1],
    ] as const) {
      if (!wallAt.has(ny * size + nx)) continue
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(sx(nx + 0.5), sy(ny + 0.5))
      ctx.strokeStyle = '#2a1d12'
      ctx.lineWidth = s * 0.34
      ctx.stroke()
      ctx.strokeStyle = style.rel[b.rel]
      ctx.lineWidth = s * 0.22
      ctx.stroke()
    }
    if (b.kind === 'gate') tok(cx, cy, s * 0.3, 'gate', 'building', b.rel)
  }
  ctx.restore()

  const built = new Set(scene.buildings.map((b) => b.y * size + b.x))
  // At middle zoom tokens keep a readable minimum size, even if neighbours touch.
  const nodeR = tier === 'close' ? s * 0.4 : Math.max(6, s * 0.38)
  for (const n of scene.nodes) {
    if (!visible(n.x, n.y) || built.has(n.y * size + n.x)) continue
    tok(sx(n.x + 0.5), sy(n.y + 0.5), nodeR, n.kind, 'node', undefined, { node: n.kind })
  }
  const bR = tier === 'close' ? s * 0.42 : Math.max(6.5, s * 0.42)
  for (const b of scene.buildings) {
    if (b.kind === 'wall' || b.kind === 'gate' || b.kind === 'road' || !visible(b.x, b.y)) continue
    const node = scene.nodes.find(
      (n) => n.x === b.x && n.y === b.y && NODE_WORKPLACE[n.kind] === b.kind,
    )
    tok(
      sx(b.x + 0.5),
      sy(b.y + 0.5),
      bR,
      b.kind,
      'building',
      b.rel,
      node ? { node: node.kind } : {},
    )
  }
  for (const p of scene.piles)
    if (visible(p.x, p.y))
      tok(sx(p.x + 0.5), sy(p.y + 0.5), s * 0.3, 'pile', 'node', undefined, { node: 'goldOre' })

  // Horses and carts.
  for (const hr of scene.horses)
    if (visible(hr.x, hr.y) && tier === 'close')
      tok(sx(hr.x + 0.25), sy(hr.y + 0.75), s * 0.17, 'horse', 'unit', 'own')
  for (const c of scene.carts)
    if (visible(c.x, c.y))
      tok(
        sx(c.x + 0.5),
        sy(c.y + 0.5),
        s * (tier === 'close' ? 0.3 : 0.36),
        c.caravan ? 'caravan' : 'cart',
        'unit',
        c.rel,
      )

  // People: grouped per tile at middle zoom, single figures (up to 4) when close.
  const byTile = new Map<number, Person[]>()
  for (const p of scene.people) {
    if (!visible(p.x, p.y)) continue
    const k = p.y * size + p.x
    byTile.set(k, [...(byTile.get(k) ?? []), p])
  }
  const armyAt = new Map(scene.armies.map((a) => [a.y * size + a.x, a]))
  const cartAt = new Set(scene.carts.map((c) => c.y * size + c.x))
  for (const [k, group] of byTile) {
    const [x, y] = [k % size, Math.floor(k / size)]
    const army = armyAt.get(k)
    if (army) {
      const [cx, cy] = [sx(x + 0.5), sy(y + 0.5)]
      tok(cx, cy, s * 0.4, 'banner', 'unit', army.rel)
      style.badge(ctx, `${army.soldiers}`, cx + s * 0.38, cy - s * 0.38, Math.max(10, s * 0.3))
      continue
    }
    if (tier === 'middle') {
      const counts = new Map<Rel, number>()
      for (const p of group) counts.set(p.rel, (counts.get(p.rel) ?? 0) + 1)
      const rel = [...counts].sort((a, b) => b[1] - a[1])[0]![0]
      const leader = group.some((p) => p.leader)
      const off = built.has(k) || cartAt.has(k) ? s * 0.32 : 0
      const [cx, cy] = [sx(x + 0.5) + off, sy(y + 0.5) + off]
      tok(cx, cy, Math.max(5.5, s * (off ? 0.28 : 0.36)), leader ? 'crown' : 'person', 'unit', rel)
      if (group.length > 1)
        style.badge(ctx, `×${group.length}`, cx + s * 0.28, cy - s * 0.28, Math.max(9, s * 0.28))
    } else {
      const slots: [number, number][] = [
        [0.26, 0.74],
        [0.74, 0.74],
        [0.26, 0.26],
        [0.74, 0.26],
      ]
      const shown = group.slice(0, group.length > 4 ? 3 : 4)
      shown.forEach((p, i) => {
        const [fx, fy] = slots[i]!
        const [cx, cy] = [sx(x + fx), sy(y + fy)]
        tok(cx, cy, s * 0.23, p.leader ? 'crown' : 'person', 'unit', p.rel)
        const act = ACTIVITY_GLYPH[p.activity]
        if (act && s >= 28)
          tok(cx + s * 0.19, cy + s * 0.17, Math.max(5, s * 0.11), act, 'marker', p.rel)
        if (p.leader) style.label(ctx, p.name, cx, cy - s * 0.3, Math.max(10, s * 0.22))
      })
      if (group.length > 4)
        style.badge(ctx, `+${group.length - 3}`, sx(x + 0.76), sy(y + 0.24), Math.max(9, s * 0.22))
    }
  }

  // City names over their town halls.
  for (const c of scene.cities)
    if (visible(c.x, c.y))
      style.label(
        ctx,
        c.name,
        sx(c.x + 0.5),
        sy(c.y) - s * 0.35,
        Math.max(12, Math.min(18, s * 0.5)),
      )

  if (selected?.kind === 'tile')
    ring(ctx, style, sx(selected.x + 0.5), sy(selected.y + 0.5), s * 0.62)
  else if (selected?.kind === 'city') {
    const c = scene.cities.find((c) => c.name === selected.name)
    if (c) ring(ctx, style, sx(c.x + 0.5), sy(c.y + 0.5), s * 0.62)
  }
}

function ring(ctx: CanvasRenderingContext2D, style: MapStyle, x: number, y: number, r: number) {
  ctx.save()
  ctx.strokeStyle = style.select
  ctx.lineWidth = 2.5
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** What the click at a tile picks: a city when far out, else the tile and what is on it. */
export function pick(scene: Scene, cam: Cam, tx: number, ty: number): Selection {
  if (tierOf(cam.s) === 'far') {
    const c = scene.cities
      .map((c) => ({ c, d: Math.hypot(c.x - tx, c.y - ty) }))
      .sort((a, b) => a.d - b.d)[0]
    return c && c.d * cam.s < 24 ? { kind: 'city', name: c.c.name } : undefined
  }
  return { kind: 'tile', x: Math.floor(tx), y: Math.floor(ty) }
}

/** Everything on a tile, for the selection card. */
export function onTile(scene: Scene, x: number, y: number) {
  const size = scene.map.size
  return {
    terrain: scene.map.tiles[y * size + x]!,
    road: scene.roads.has(y * size + x),
    building: scene.buildings.find((b) => b.x === x && b.y === y),
    node: scene.nodes.find((n) => n.x === x && n.y === y),
    people: scene.people.filter((p) => p.x === x && p.y === y),
    cart: scene.carts.find((c) => c.x === x && c.y === y),
    army: scene.armies.find((a) => a.x === x && a.y === y),
    city: scene.cities.find((c) => c.x === x && c.y === y),
  }
}
