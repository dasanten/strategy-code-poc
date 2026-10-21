// PROTOTYPE (T17.1, #203): throwaway. What the three variants share: the map canvas with camera
// and picking, the made-up HUD content, and the floating variant switcher.
import { useEffect, useRef, useState } from 'react'
import { formatGameTime } from '@csp/shared'
import { BUILDING_NAMES, NODE_NAMES, TERRAIN_NAMES } from '../map/palette.js'
import { glyphSvg, type GlyphName } from './glyphs.js'
import type { MapStyle } from './map-styles.js'
import {
  CLOSE_FROM,
  draw,
  onTile,
  pick,
  terrainTexture,
  tierOf,
  type Cam,
  type Selection,
  type Tier,
} from './render.js'
import { REL_NAMES, buildScene, type Rel, type Scene } from './scene.js'

export const scene: Scene = buildScene()

const textures = new Map<MapStyle, HTMLCanvasElement>()
const ZOOM: Record<Tier, number> = { far: 4, middle: 16, close: 38 }

export function useMap(style: MapStyle) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cam, setRawCam] = useState<Cam>({
    x: scene.home.x + 0.5,
    y: scene.home.y + 2,
    s: ZOOM.middle,
  })
  // Keep the map filling the screen: never pan past its edges.
  const setCam = (f: (c: Cam) => Cam) =>
    setRawCam((c) => {
      const n = f(c)
      const size = scene.map.size
      const [hw, hh] = [window.innerWidth / 2 / n.s, window.innerHeight / 2 / n.s]
      const clamp = (v: number, h: number) =>
        h * 2 >= size ? size / 2 : Math.min(size - h, Math.max(h, v))
      return { s: n.s, x: clamp(n.x, hw), y: clamp(n.y, hh) }
    })
  const [sel, setSel] = useState<Selection>({ kind: 'tile', x: scene.home.x, y: scene.home.y })
  const [, setTick] = useState(0)
  const camRef = useRef(cam)
  camRef.current = cam

  useEffect(() => {
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    let terrain = textures.get(style)
    if (!terrain) textures.set(style, (terrain = terrainTexture(scene, style)))
    draw(ctx, w, h, scene, style, terrain, cam, sel, () => setTick((t) => t + 1))
  })

  useEffect(() => {
    const canvas = canvasRef.current!
    let drag: { x: number; y: number; moved: boolean } | undefined
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, moved: false }
      canvas.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y]
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
      if (!drag.moved) return
      drag.x = e.clientX
      drag.y = e.clientY
      setCam((c) => ({ ...c, x: c.x - dx / c.s, y: c.y - dy / c.s }))
    }
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved) {
        const c = camRef.current
        const r = canvas.getBoundingClientRect()
        const tx = c.x + (e.clientX - r.left - r.width / 2) / c.s
        const ty = c.y + (e.clientY - r.top - r.height / 2) / c.s
        setSel(pick(scene, c, tx, ty))
      }
      drag = undefined
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      const [px, py] = [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]
      setCam((c) => {
        const s = Math.min(48, Math.max(2.5, c.s * Math.exp(-e.deltaY * 0.0015)))
        return { s, x: c.x + px / c.s - px / s, y: c.y + py / c.s - py / s }
      })
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    const resize = () => setTick((t) => t + 1)
    window.addEventListener('resize', resize)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('wheel', wheel)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const tier = tierOf(cam.s)
  const zoomTo = (t: Tier) => {
    const focus = sel?.kind === 'tile' ? { x: sel.x + 0.5, y: sel.y + 0.5 } : undefined
    setCam((c) => ({ ...(focus ?? c), s: ZOOM[t] }))
  }
  const zoomBy = (f: number) => setCam((c) => ({ ...c, s: Math.min(48, Math.max(2.5, c.s * f)) }))
  return { canvasRef, sel, setSel, tier, zoomTo, zoomBy, cam, setCam }
}

export const Glyph = ({
  name,
  color,
  size = 20,
  stroke = 2,
}: {
  name: GlyphName
  color: string
  size?: number
  stroke?: number
}) => (
  <img src={glyphSvg(name, color, stroke)} width={size} height={size} alt="" draggable={false} />
)

export const REALM = "Ada's realm"
export const CLOCK = formatGameTime(3 * 24 * 60 * 60 + 11 * 60 * 60 + 1234)
export const GOODS: { name: string; glyph: GlyphName; amount: number }[] = [
  { name: 'Food', glyph: 'farm', amount: 214 },
  { name: 'Wood', glyph: 'forest', amount: 86 },
  { name: 'Stone', glyph: 'stone', amount: 41 },
  { name: 'Iron', glyph: 'smithy', amount: 12 },
  { name: 'Coins', glyph: 'mint', amount: 130 },
]

export type Tool =
  'Residents' | 'Armies' | 'Contracts' | 'Alliance' | 'Standing' | 'Scripts' | 'Realm log'
export const TOOLS: { name: Tool; glyph: GlyphName }[] = [
  { name: 'Residents', glyph: 'person' },
  { name: 'Armies', glyph: 'banner' },
  { name: 'Contracts', glyph: 'scroll' },
  { name: 'Alliance', glyph: 'shield' },
  { name: 'Standing', glyph: 'scales' },
  { name: 'Scripts', glyph: 'code' },
  { name: 'Realm log', glyph: 'log' },
]

/** Made-up rows for a drawer: [main text, side text]. */
export function drawerRows(tool: Tool): [string, string][] {
  switch (tool) {
    case 'Residents':
      return scene.people
        .filter((p) => p.rel === 'own')
        .slice(0, 14)
        .map((p) => [
          `${p.leader ? '♛ ' : ''}${p.name}`,
          p.leader
            ? 'Leader'
            : {
                idle: 'Idle',
                walk: 'Walking',
                carry: 'Carrying',
                work: 'Working',
                fight: 'With an army',
              }[p.activity],
        ])
    case 'Armies':
      return [
        ['First company', '4 soldiers · guarding'],
        ['Iron escort', '2 soldiers · following a carriage'],
      ]
    case 'Contracts':
      return [
        ['Brightwater buys 40 Wood', '3 days left'],
        ['Oakhollow hires out 2 soldiers', '6 days left'],
      ]
    case 'Alliance':
      return [
        ['Brightwater', 'Alliance leader'],
        ['Highmoor', 'Member'],
        [REALM, 'Member · you'],
      ]
    case 'Standing':
      return [
        ['Oakhollow', '+42'],
        ['Trade Organization', '+5'],
        ['Redcliff', '−35'],
      ]
    case 'Scripts':
      return [
        ['haul-iron', 'running on 2 carriages'],
        ['farm-shift', 'idle'],
        ['guard-mine', 'running on First company'],
      ]
    case 'Realm log':
      return [
        ['Day 3, 09:12', 'A child was born in Eastmere'],
        ['Day 3, 07:40', 'Iron ore delivered: 18'],
        ['Day 2, 22:05', 'Redcliff guard sighted near the mine'],
      ]
  }
}

export const SCRIPT_SAMPLE = `// Runs once a tick for each resident or army running it.
if (me.order == null) {
  if (memory.leg == null) { memory.leg = 1; walkTo(13, 10) }
  else if (memory.leg == 1) { memory.leg = 2; walkTo(10, 10) }
}`

export interface Card {
  title: string
  rel?: Rel
  glyph: GlyphName
  lines: string[]
  actions: string[]
}

/** What the selection card shows for the current selection. */
export function describe(sel: Selection): Card | undefined {
  if (!sel) return undefined
  if (sel.kind === 'city') {
    const c = scene.cities.find((c) => c.name === sel.name)!
    return {
      title: c.name,
      rel: c.rel,
      glyph: 'castle',
      lines: [`${REL_NAMES[c.rel]} · ${c.size}`, `${c.residents} residents`],
      actions:
        c.rel === 'own'
          ? ['Zoom in', 'Residents']
          : c.rel === 'npc'
            ? ['Zoom in', 'Buy', 'Standing']
            : ['Zoom in'],
    }
  }
  const t = onTile(scene, sel.x, sel.y)
  const ground = t.road ? 'Road' : TERRAIN_NAMES[t.terrain]!
  if (t.army)
    return {
      title: t.army.name,
      rel: t.army.rel,
      glyph: 'banner',
      lines: [`${REL_NAMES[t.army.rel]} · ${t.army.soldiers} soldiers`, ground],
      actions: t.army.rel === 'own' ? ['Move to', 'Attack', 'Run script'] : ['Attack with army'],
    }
  if (t.people.length && !t.building) {
    const own = t.people.filter((p) => p.rel === 'own')
    const leader = t.people.find((p) => p.leader)
    return {
      title: leader
        ? `${leader.name}, your Leader`
        : t.people.length > 1
          ? `${t.people.length} residents`
          : t.people[0]!.name,
      rel: t.people[0]!.rel,
      glyph: leader ? 'crown' : 'person',
      lines: [
        REL_NAMES[t.people[0]!.rel],
        ground,
        ...(t.cart ? [t.cart.caravan ? 'Trade Org caravan' : 'Carriage with 1 horse'] : []),
      ],
      actions: own.length ? ['Walk to', 'Haul', 'Build', 'Run script'] : ['Attack'],
    }
  }
  if (t.building) {
    const node = t.node ? ` on ${NODE_NAMES[t.node.kind].toLowerCase()}` : ''
    return {
      title: (t.city ? `${t.city.name} ` : '') + BUILDING_NAMES[t.building.kind],
      rel: t.building.rel,
      glyph: t.building.kind === 'road' ? 'walk' : t.building.kind,
      lines: [
        `${REL_NAMES[t.building.rel]}${node}`,
        t.people.length ? `${t.people.length} residents here` : 'Nobody here',
      ],
      actions:
        t.building.rel === 'own'
          ? ['Work here', 'Put residents here', 'Tear down']
          : ['Climb wall', 'Attack'],
    }
  }
  if (t.node)
    return {
      title: NODE_NAMES[t.node.kind],
      glyph: t.node.kind,
      lines: ['Resource node · nobody works it', ground],
      actions: ['Build workplace'],
    }
  return {
    title: ground,
    glyph: 'walk',
    lines: [`Tile ${sel.x}, ${sel.y}`],
    actions: ['Walk here', 'Build road'],
  }
}

export const tierHint = (t: Tier) =>
  t === 'far'
    ? 'Far: cities and territory'
    : t === 'middle'
      ? 'Middle: buildings, groups'
      : 'Close: single residents'
export { CLOSE_FROM }
