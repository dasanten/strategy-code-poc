import { useEffect, useRef, useState } from 'react'
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import {
  CHUNK_SIZE,
  TERRAIN_SPEED,
  Terrain,
  chunksAcross,
  wrapDelta,
  type KnownNode,
  type TerrainChunk,
} from '@csp/shared'
import {
  CLOSE_SCALE,
  FAR_SCALE,
  chunkToScreen,
  clampScale,
  panBy,
  screenToTile,
  tileToScreen,
  visibleChunks,
  visibleTiles,
  zoomAt,
  type Camera,
  type Size,
} from './map/camera.js'
import { ChunkStore } from './map/chunks.js'
import {
  NODE_COLORS,
  NODE_NAMES,
  BUILDING_COLORS,
  CARRIAGE_COLOR,
  HORSE_COLOR,
  LEADER_COLOR,
  OTHER_COLOR,
  OWN_COLOR,
  WALL_COLOR,
  TERRAIN_COLORS,
  TERRAIN_NAMES,
  VOID_COLOR,
  css,
} from './map/palette.js'
import type { ClientWorld } from './useWorld.js'

/** Starting zoom, in screen pixels per tile. */
const START_SCALE = 12

/** What the pointer is over, for the readout. */
interface Hover {
  x: number
  y: number
  terrain: string
  node?: string
}

/**
 * The world map (T1.5): explored terrain loaded in chunks as the view needs them, one small
 * texture per chunk (one pixel per tile), drawn only while on screen. Zoomed out it draws only
 * terrain; closer in it adds resource nodes and residents, and up close the tile grid.
 * Drag or swipe to pan; wheel, pinch or the buttons to zoom.
 */
export function MapView({
  world,
  selectedId,
  onSelect,
}: {
  world: ClientWorld
  /** The resident shown with a ring, if any. */
  selectedId?: string
  /** Called with a resident of the Player's realm clicked on the map. */
  onSelect?: (id: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef(world)
  const selectedRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const redrawRef = useRef<() => void>(() => {})
  const controlsRef = useRef<{ zoom(factor: number): void; centre(): void } | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [scale, setScale] = useState(START_SCALE)
  const mapSize = world.map.size
  const explored = world.exploredChunks

  // The residents change every tick; the scene reads the latest through the ref.
  useEffect(() => {
    selectedRef.current = selectedId
    redrawRef.current()
  }, [selectedId])

  useEffect(() => {
    worldRef.current = world
    redrawRef.current()
  }, [world])

  useEffect(() => {
    const host = hostRef.current!
    const across = chunksAcross(mapSize)
    const app = new Application()
    const sprites = new Map<number, Sprite>()
    const nodes: KnownNode[][] = []
    const terrainLayer = new Container()
    const overlay = new Graphics()
    const size = (): Size => ({ width: app.screen.width, height: app.screen.height })
    let cam: Camera = { ...homeCentre(worldRef.current), scale: START_SCALE }
    let disposed = false
    let ready = false
    let frame = 0

    const store = new ChunkStore(explored, across, (chunk) => {
      const sprite = new Sprite(chunkTexture(chunk))
      terrainLayer.addChild(sprite)
      sprites.set(chunk.cy * across + chunk.cx, sprite)
      nodes[chunk.cy * across + chunk.cx] = chunk.nodes
      redraw()
    })

    function redraw() {
      if (!ready || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!disposed) draw()
      })
    }
    redrawRef.current = redraw

    function draw() {
      const view = size()
      // Only chunks on screen are drawn, each at its copy nearest the view's centre (the map's
      // sides join); nearer chunks are loaded first.
      const onScreen = visibleChunks(cam, view, mapSize)
      const shown = new Set(onScreen)
      for (const [i, sprite] of sprites) {
        sprite.visible = shown.has(i)
        if (!sprite.visible) continue
        sprite.position.set(
          ...chunkToScreen(cam, view, mapSize, i % across, Math.floor(i / across)),
        )
        sprite.scale.set(cam.scale)
      }
      const away = (i: number) =>
        Math.hypot(
          wrapDelta(cam.x, ((i % across) + 0.5) * CHUNK_SIZE, mapSize),
          wrapDelta(cam.y, (Math.floor(i / across) + 0.5) * CHUNK_SIZE, mapSize),
        )
      store.want([...onScreen].sort((a, b) => away(a) - away(b)))
      drawOverlay(overlay, cam, view, onScreen)
    }

    function drawOverlay(g: Graphics, cam: Camera, view: Size, onScreen: number[]) {
      g.clear()
      if (cam.scale < FAR_SCALE) return

      if (cam.scale >= CLOSE_SCALE) {
        const { x0, y0, x1, y1 } = visibleTiles(cam, view)
        for (let x = x0; x <= x1 + 1; x++) {
          const sx = (x - cam.x) * cam.scale + view.width / 2
          g.moveTo(sx, 0).lineTo(sx, view.height)
        }
        for (let y = y0; y <= y1 + 1; y++) {
          const sy = (y - cam.y) * cam.scale + view.height / 2
          g.moveTo(0, sy).lineTo(view.width, sy)
        }
        g.stroke({ width: 1, color: 0x000000, alpha: 0.12 })
      }

      const r = Math.max(4, Math.min(9, cam.scale * 0.35))
      for (const i of onScreen) {
        for (const n of nodes[i] ?? []) {
          const [sx, sy] = tileToScreen(cam, view, mapSize, n.x + 0.5, n.y + 0.5)
          g.poly([sx, sy - r, sx + r, sy, sx, sy + r, sx - r, sy])
            .fill(NODE_COLORS[n.kind])
            .stroke({ width: 2, color: 0x121518 })
        }
      }

      drawStructures(g, cam, view, worldRef.current)

      const { home } = worldRef.current
      const dot = Math.max(3, Math.min(8, cam.scale * 0.3))
      for (const u of worldRef.current.residents) {
        const [sx, sy] = tileToScreen(cam, view, mapSize, u.x + 0.5, u.y + 0.5)
        if (sx < -dot || sy < -dot || sx > view.width + dot || sy > view.height + dot) continue
        const color =
          u.id === home.leaderId ? LEADER_COLOR : u.owner === home.realmId ? OWN_COLOR : OTHER_COLOR
        g.circle(sx, sy, dot).fill(color).stroke({ width: 2, color: 0x121518 })
        if (u.id === selectedRef.current) {
          g.circle(sx, sy, dot + 4).stroke({ width: 2.5, color: LEADER_COLOR })
        }
      }
    }

    function setCam(next: Camera) {
      cam = next
      setScale(next.scale)
      redraw()
    }

    function hoverAt(sx: number, sy: number) {
      const [tx, ty] = screenToTile(cam, size(), mapSize, sx, sy).map(Math.floor) as [
        number,
        number,
      ]
      const chunk = store.get(Math.floor(ty / CHUNK_SIZE) * across + Math.floor(tx / CHUNK_SIZE))
      const byte = chunk?.tiles[(ty % CHUNK_SIZE) * CHUNK_SIZE + (tx % CHUNK_SIZE)]
      const node = chunk?.nodes.find((n) => n.x === tx && n.y === ty)
      setHover({
        x: tx,
        y: ty,
        terrain: byte === undefined ? 'Unexplored' : (TERRAIN_NAMES[byte] ?? '?'),
        node: node && NODE_NAMES[node.kind],
      })
    }

    // Pointer input: one pointer pans, two pinch-zoom; works for mouse, pen and touch alike.
    const pointers = new Map<number, { x: number; y: number }>()
    let pressedAt = { x: 0, y: 0 }
    let dragged = 0
    const local = (e: PointerEvent | WheelEvent) => {
      const rect = app.canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const onDown = (e: PointerEvent) => {
      // Keep getting moves when the drag leaves the canvas; not every pointer can be captured.
      try {
        app.canvas.setPointerCapture(e.pointerId)
      } catch {
        // dragging still works while over the canvas
      }
      pointers.set(e.pointerId, local(e))
      pressedAt = local(e)
      dragged = 0
    }
    const onMove = (e: PointerEvent) => {
      const p = local(e)
      // A pointer with no button down is hovering, whatever we last heard from it.
      if (e.buttons === 0) pointers.delete(e.pointerId)
      const prev = pointers.get(e.pointerId)
      if (!prev) return hoverAt(p.x, p.y)
      dragged = Math.max(dragged, Math.hypot(p.x - pressedAt.x, p.y - pressedAt.y))
      if (pointers.size === 1) {
        setCam(panBy(cam, mapSize, p.x - prev.x, p.y - prev.y))
      } else if (pointers.size === 2) {
        const other = [...pointers].find(([id]) => id !== e.pointerId)![1]
        const before = Math.hypot(prev.x - other.x, prev.y - other.y)
        const after = Math.hypot(p.x - other.x, p.y - other.y)
        const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 }
        const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }
        const zoomed = zoomAt(cam, size(), mapSize, after / Math.max(1, before), mid.x, mid.y)
        setCam(panBy(zoomed, mapSize, (mid.x - prevMid.x) / 2, (mid.y - prevMid.y) / 2))
      }
      pointers.set(e.pointerId, p)
    }
    const onUp = (e: PointerEvent) => {
      const wasPressed = pointers.delete(e.pointerId)
      // A press that hardly moved is a click: pick the own resident under it, if any.
      if (wasPressed && e.type === 'pointerup' && pointers.size === 0 && dragged < 6) {
        const p = local(e)
        const id = residentAt(p.x, p.y)
        if (id) onSelectRef.current?.(id)
      }
    }

    function residentAt(sx: number, sy: number): string | undefined {
      const view = size()
      const { home, residents } = worldRef.current
      const reach = Math.max(10, cam.scale * 0.6)
      let best: { id: string; d: number } | undefined
      for (const r of residents) {
        if (r.owner !== home.realmId) continue
        const [rx, ry] = tileToScreen(cam, view, mapSize, r.x + 0.5, r.y + 0.5)
        const d = Math.hypot(rx - sx, ry - sy)
        if (d <= reach && (!best || d < best.d)) best = { id: r.id, d }
      }
      return best?.id
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      setCam(zoomAt(cam, size(), mapSize, Math.exp(-e.deltaY * 0.0015), p.x, p.y))
    }

    controlsRef.current = {
      zoom: (factor) => {
        const view = size()
        setCam(zoomAt(cam, view, mapSize, factor, view.width / 2, view.height / 2))
      },
      centre: () => setCam({ ...cam, ...homeCentre(worldRef.current) }),
    }

    void app.init({ resizeTo: host, background: VOID_COLOR, antialias: true }).then(() => {
      if (disposed) {
        app.destroy(true)
        return
      }
      host.appendChild(app.canvas)
      app.canvas.style.touchAction = 'none'
      app.canvas.addEventListener('pointerdown', onDown)
      app.canvas.addEventListener('pointermove', onMove)
      app.canvas.addEventListener('pointerup', onUp)
      app.canvas.addEventListener('pointercancel', onUp)
      app.canvas.addEventListener('lostpointercapture', onUp)
      app.canvas.addEventListener('pointerleave', () => setHover(null))
      app.canvas.addEventListener('wheel', onWheel, { passive: false })
      app.renderer.on('resize', redraw)
      app.stage.addChild(terrainLayer, overlay)
      ready = true
      setCam({ ...cam, scale: clampScale(cam.scale, mapSize, size()) })
    })

    return () => {
      disposed = true
      store.stop()
      cancelAnimationFrame(frame)
      redrawRef.current = () => {}
      controlsRef.current = null
      if (ready) {
        for (const sprite of sprites.values()) sprite.texture.destroy(true)
        app.destroy(true, { children: true })
      }
    }
  }, [mapSize, explored])

  return (
    <div className="map-view">
      <div ref={hostRef} className="map" aria-label="World map" role="img" />
      <div className="map-buttons">
        <button type="button" aria-label="Zoom in" onClick={() => controlsRef.current?.zoom(1.5)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
            <path d="M9 3v12M3 9h12" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => controlsRef.current?.zoom(1 / 1.5)}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
            <path d="M3 9h12" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Centre on my residents"
          onClick={() => controlsRef.current?.centre()}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
            <circle cx="9" cy="9" r="5" />
            <path d="M9 1v3M9 14v3M1 9h3M14 9h3" />
          </svg>
        </button>
      </div>
      <Legend />
      <div className="map-readout">
        {hover
          ? `Tile ${hover.x}, ${hover.y} · ${hover.terrain}${hover.node ? ` · ${hover.node}` : ''}`
          : 'Tile –'}
        {` · zoom ${Math.round((scale / START_SCALE) * 100)}%`}
      </div>
    </div>
  )
}

function Legend() {
  const terrains = [
    Terrain.Plains,
    Terrain.Forest,
    Terrain.Hills,
    Terrain.Mountain,
    Terrain.Lake,
    Terrain.Sea,
  ]
  const speed = (t: number) => {
    const s = (TERRAIN_SPEED as Partial<Record<number, number>>)[t]
    return s ? `${Math.round(s * 100)}% speed` : 'impassable'
  }
  return (
    <div className="map-legend">
      {terrains.map((t) => (
        <div key={t}>
          <span className="swatch" style={{ background: css(TERRAIN_COLORS[t]!) }} />
          <span>{TERRAIN_NAMES[t]}</span>
          <span className="rule">{speed(t)}</span>
        </div>
      ))}
      {(Object.keys(NODE_NAMES) as (keyof typeof NODE_NAMES)[]).map((k) => (
        <div key={k}>
          <span className="swatch diamond" style={{ background: css(NODE_COLORS[k]) }} />
          <span>{NODE_NAMES[k]}</span>
          <span className="rule">node</span>
        </div>
      ))}
    </div>
  )
}

/** Where the view starts and re-centres: the middle of the Player's home city. */
function homeCentre(world: ClientWorld): { x: number; y: number } {
  return { x: world.home.x + 0.5, y: world.home.y + 0.5 }
}

/** Cities' walls and gates, buildings, horses and carriages, at mid zoom and closer. */
function drawStructures(g: Graphics, cam: Camera, view: Size, world: ClientWorld) {
  const { cities, buildings, horses, carriages } = world.structures
  const tile = cam.scale
  const size = world.map.size
  const box = (x: number, y: number, inset = 0) => {
    const [sx, sy] = tileToScreen(cam, view, size, x, y)
    return [
      sx + inset * tile,
      sy + inset * tile,
      tile * (1 - 2 * inset),
      tile * (1 - 2 * inset),
    ] as const
  }
  for (const c of cities) {
    const [sx, sy] = tileToScreen(cam, view, size, c.x, c.y)
    if (sx > view.width || sy > view.height || sx + c.size * tile < 0 || sy + c.size * tile < 0) {
      continue
    }
    // The wall is the ring of edge tiles; drawn as a thick band with the gate left open.
    for (let i = 0; i < c.size; i++) {
      for (const [x, y] of [
        [c.x + i, c.y],
        [c.x + i, c.y + c.size - 1],
        [c.x, c.y + i],
        [c.x + c.size - 1, c.y + i],
      ] as const) {
        if (x === c.gate.x && y === c.gate.y) continue
        g.rect(...box(x, y)).fill(WALL_COLOR)
      }
    }
    const [gx, gy, gw, gh] = box(c.gate.x, c.gate.y)
    g.rect(gx, gy, gw, gh).fill({ color: WALL_COLOR, alpha: 0.35 })
  }
  for (const b of buildings) {
    g.rect(...box(b.x, b.y, 0.08))
      .fill(BUILDING_COLORS[b.kind])
      .stroke({ width: 1, color: 0x4f3a22 })
  }
  for (const h of horses) g.circle(...centre(cam, view, size, h), tile * 0.22).fill(HORSE_COLOR)
  for (const k of carriages) {
    g.rect(...box(k.x, k.y, 0.22))
      .fill(CARRIAGE_COLOR)
      .stroke({ width: 1, color: 0x121518 })
  }
}

const centre = (cam: Camera, view: Size, size: number, e: { x: number; y: number }) =>
  tileToScreen(cam, view, size, e.x + 0.5, e.y + 0.5)

/** One pixel per tile; scaled up with nearest-neighbour sampling, so tiles stay crisp. */
function chunkTexture(chunk: TerrainChunk): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = CHUNK_SIZE
  canvas.height = CHUNK_SIZE
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(CHUNK_SIZE, CHUNK_SIZE)
  chunk.tiles.forEach((t, i) => {
    const c = TERRAIN_COLORS[t] ?? 0xff00ff
    image.data[i * 4] = c >> 16
    image.data[i * 4 + 1] = (c >> 8) & 0xff
    image.data[i * 4 + 2] = c & 0xff
    image.data[i * 4 + 3] = 255
  })
  ctx.putImageData(image, 0, 0)
  const texture = Texture.from(canvas)
  texture.source.scaleMode = 'nearest'
  return texture
}
