import { useEffect, useRef, useState } from 'react'
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import {
  CHUNK_SIZE,
  TERRAIN_SPEED,
  Terrain,
  UNEXPLORED,
  chunksAcross,
  cityAreaTiles,
  wrap,
  wrapDelta,
  type KnownNode,
  type Resident,
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
  holderAt,
  holderLabel,
  regionChunkPixels,
  regionChunks,
  regionGroups,
  type RegionState,
} from './map/region.js'
import {
  NODE_COLORS,
  NODE_NAMES,
  BUILDING_COLORS,
  CARRIAGE_COLOR,
  HORSE_COLOR,
  PILE_COLOR,
  LEADER_COLOR,
  OTHER_COLOR,
  OWN_COLOR,
  WALL_COLOR,
  CITY_AREA_COLOR,
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
  /** Who holds the tile on the Region map, when it is explored. */
  holder?: string
}

/** What the map shows: the terrain, or territory over it (`CONTEXT.md`: Region map). */
type MapMode = 'terrain' | 'region'

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
  picking = false,
  onPickTile,
  onNodesLoaded,
}: {
  world: ClientWorld
  /** The resident shown with a ring, if any. */
  selectedId?: string
  /** Called with a resident of the Player's realm clicked on the map. */
  onSelect?: (id: string) => void
  /** Waiting for a tile: the next click picks one instead of selecting. */
  picking?: boolean
  /** Called with a tile picked by click (while `picking`) or by right-click. */
  onPickTile?: (x: number, y: number) => void
  /** Called with a lookup of known resource nodes by tile, and again whenever more load. */
  onNodesLoaded?: (nodeAt: (x: number, y: number) => KnownNode | undefined) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef(world)
  const selectedRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const pickingRef = useRef(picking)
  pickingRef.current = picking
  const onPickTileRef = useRef(onPickTile)
  onPickTileRef.current = onPickTile
  const onNodesLoadedRef = useRef(onNodesLoaded)
  onNodesLoadedRef.current = onNodesLoaded
  const redrawRef = useRef<() => void>(() => {})
  const forgetRef = useRef<(chunks: readonly number[]) => void>(() => {})
  const regionRef = useRef<(region: RegionState | null) => void>(() => {})
  const controlsRef = useRef<{ zoom(factor: number): void; centre(): void } | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [scale, setScale] = useState(START_SCALE)
  const [mode, setMode] = useState<MapMode>('terrain')
  const modeRef = useRef(mode)
  const mapSize = world.map.size

  useEffect(() => {
    modeRef.current = mode
    redrawRef.current()
  }, [mode])

  // The Region map changes once a game hour, and where explored terrain grows.
  useEffect(() => regionRef.current(world.region), [world.region])

  // What is in sight changes every tick; the scene reads the latest through the ref.
  useEffect(() => {
    selectedRef.current = selectedId
    redrawRef.current()
  }, [selectedId])

  useEffect(() => {
    worldRef.current = world
    if (world.grownChunks.length > 0) forgetRef.current(world.grownChunks)
    redrawRef.current()
  }, [world])

  useEffect(() => {
    const host = hostRef.current!
    const across = chunksAcross(mapSize)
    const app = new Application()
    const sprites = new Map<number, Sprite>()
    const nodes: KnownNode[][] = []
    const terrainLayer = new Container()
    // The Region map: territory over the terrain, one small texture per chunk like the terrain.
    const regionSprites = new Map<number, Sprite>()
    const regionLayer = new Container()
    const overlay = new Graphics()
    const size = (): Size => ({ width: app.screen.width, height: app.screen.height })
    let cam: Camera = { ...homeCentre(worldRef.current), scale: START_SCALE }
    let disposed = false
    let ready = false
    let frame = 0

    const store = new ChunkStore(
      () => worldRef.current.exploredChunks,
      across,
      (chunk) => {
        const index = chunk.cy * across + chunk.cx
        const old = sprites.get(index)
        if (old) {
          // Explored terrain grew: the same sprite gets the newer picture.
          const stale = old.texture
          old.texture = chunkTexture(chunk)
          stale.destroy(true)
        } else {
          const sprite = new Sprite(chunkTexture(chunk))
          terrainLayer.addChild(sprite)
          sprites.set(index, sprite)
        }
        nodes[chunk.cy * across + chunk.cx] = chunk.nodes
        onNodesLoadedRef.current?.((x, y) =>
          nodes[Math.floor(y / CHUNK_SIZE) * across + Math.floor(x / CHUNK_SIZE)]?.find(
            (n) => n.x === x && n.y === y,
          ),
        )
        redraw()
      },
    )

    function redraw() {
      if (!ready || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!disposed) draw()
      })
    }
    redrawRef.current = redraw
    forgetRef.current = (chunks) => store.forget(chunks)

    /** Redraws the Region map's chunks that changed, or all of them. */
    function updateRegion(region: RegionState | null) {
      if (!ready) return
      const redo = region?.changed ?? [
        ...new Set([...regionSprites.keys(), ...(region ? regionChunks(region, mapSize) : [])]),
      ]
      for (const i of redo) {
        const old = regionSprites.get(i)
        const pixels =
          region && regionChunkPixels(region, mapSize, i % across, Math.floor(i / across))
        if (old) {
          old.texture.destroy(true)
          if (!pixels) {
            old.destroy()
            regionSprites.delete(i)
            continue
          }
          old.texture = pixelTexture(pixels)
        } else if (pixels) {
          const sprite = new Sprite(pixelTexture(pixels))
          regionLayer.addChild(sprite)
          regionSprites.set(i, sprite)
        }
      }
      redraw()
    }
    regionRef.current = updateRegion

    function draw() {
      const view = size()
      // Only chunks on screen are drawn, each at its copy nearest the view's centre (the map's
      // sides join); nearer chunks are loaded first.
      const onScreen = visibleChunks(cam, view, mapSize)
      const shown = new Set(onScreen)
      regionLayer.visible = modeRef.current === 'region'
      for (const [i, sprite] of [...sprites, ...regionSprites]) {
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
          drawPath(g, cam, view, mapSize, u)
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
      const explored = byte !== undefined && byte !== UNEXPLORED
      const [wx, wy] = [wrap(tx, mapSize), wrap(ty, mapSize)]
      setHover({
        x: tx,
        y: ty,
        terrain: byte === undefined ? 'Unexplored' : (TERRAIN_NAMES[byte] ?? '?'),
        node: node && NODE_NAMES[node.kind],
        holder: explored
          ? holderLabel(holderAt(worldRef.current.region, mapSize, wx, wy))
          : undefined,
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
      // A press that hardly moved is a click: while picking it picks the tile, otherwise it
      // picks the own resident under it, if any. A right-click always picks the tile.
      if (wasPressed && e.type === 'pointerup' && pointers.size === 0 && dragged < 6) {
        const p = local(e)
        if (pickingRef.current || e.button === 2) {
          const [tx, ty] = screenToTile(cam, size(), mapSize, p.x, p.y).map(Math.floor) as [
            number,
            number,
          ]
          onPickTileRef.current?.(tx, ty)
          return
        }
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
      app.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
      app.renderer.on('resize', redraw)
      app.stage.addChild(terrainLayer, regionLayer, overlay)
      ready = true
      updateRegion(worldRef.current.region)
      setCam({ ...cam, scale: clampScale(cam.scale, mapSize, size()) })
    })

    return () => {
      disposed = true
      store.stop()
      cancelAnimationFrame(frame)
      redrawRef.current = () => {}
      forgetRef.current = () => {}
      regionRef.current = () => {}
      controlsRef.current = null
      if (ready) {
        for (const sprite of [...sprites.values(), ...regionSprites.values()]) {
          sprite.texture.destroy(true)
        }
        app.destroy(true, { children: true })
      }
    }
  }, [mapSize])

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
        <button
          type="button"
          aria-label="Region map"
          aria-pressed={mode === 'region'}
          title="Region map"
          onClick={() => setMode(mode === 'region' ? 'terrain' : 'region')}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
            <path d="M2 4l4.5-2 5 2L16 2v12l-4.5 2-5-2L2 16zM6.5 2v12M11.5 4v12" />
          </svg>
        </button>
      </div>
      {mode === 'region' ? <RegionLegend region={world.region} /> : <Legend />}
      <div className="map-readout">
        {hover
          ? `Tile ${hover.x}, ${hover.y} · ${hover.terrain}${hover.node ? ` · ${hover.node}` : ''}` +
            (mode === 'region' && hover.holder ? ` · ${hover.holder}` : '')
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
    Terrain.Road,
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

/**
 * The Region map's legend: each colour on it, an alliance with the members holding its parts
 * (`CONTEXT.md`: Region map).
 */
function RegionLegend({ region }: { region: RegionState | null }) {
  const groups = region ? regionGroups(region) : []
  return (
    <div className="map-legend region-legend">
      {groups.length === 0 && <div className="rule">No territory on explored terrain yet</div>}
      {groups.map((g) => (
        <div key={g.key}>
          <span className="swatch" style={{ background: css(g.colour) }} />
          <span>{g.name}</span>
          <span className="rule">{g.members.length > 0 ? g.members.join(', ') : ''}</span>
        </div>
      ))}
    </div>
  )
}

/** The selected resident's way ahead, as a dashed line to the target (design: Main Game Screen). */
function drawPath(g: Graphics, cam: Camera, view: Size, size: number, r: Resident) {
  const o = r.order
  if (o?.kind !== 'walkTo') return
  const [tx, ty] = tileToScreen(cam, view, size, o.target.x + 0.5, o.target.y + 0.5)
  if (o.path) {
    // Dashes: every other step of the way, from the resident on.
    let [px, py] = tileToScreen(cam, view, size, r.x + 0.5, r.y + 0.5)
    o.path.forEach(([x, y], i) => {
      const [nx, ny] = tileToScreen(cam, view, size, x + 0.5, y + 0.5)
      // A step across a join shows up far away on screen; don't draw a line across the map.
      if (i % 2 === 0 && Math.hypot(nx - px, ny - py) < cam.scale * 1.5)
        g.moveTo(px, py).lineTo(nx, ny)
      ;[px, py] = [nx, ny]
    })
    g.stroke({ width: 2.5, color: LEADER_COLOR, cap: 'round' })
  }
  g.circle(tx, ty, 5).fill(LEADER_COLOR)
}

/** Where the view starts and re-centres: the middle of the Player's home city. */
function homeCentre(world: ClientWorld): { x: number; y: number } {
  return { x: world.home.x + 0.5, y: world.home.y + 0.5 }
}

/**
 * City areas, roads, buildings (walls and gates among them), piles, horses and carriages, at mid
 * zoom and closer.
 */
function drawStructures(g: Graphics, cam: Camera, view: Size, world: ClientWorld) {
  const { cities, buildings, horses, carriages, piles } = world
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
  // Each city's area, faintly, from the buildings in sight (`CONTEXT.md`: City area).
  const onScreen = ([sx, sy]: readonly number[]) =>
    sx! > -tile && sy! > -tile && sx! < view.width && sy! < view.height
  for (const c of cities) {
    for (const key of cityAreaTiles(world, c, size)) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      const b = box(x, y)
      if (onScreen(b)) g.rect(...b)
    }
    g.fill({ color: CITY_AREA_COLOR, alpha: 0.18 })
  }
  // Roads under the buildings, as a band through the middle of the tile joined to the roads next
  // to it (`CONTEXT.md`: Road); a road site shows faintly.
  const roads = new Map(
    buildings.filter((b) => b.kind === 'road').map((b) => [`${b.x},${b.y}`, b] as const),
  )
  const joined = (x: number, y: number) => roads.has(`${(x + size) % size},${(y + size) % size}`)
  for (const r of roads.values()) {
    const [sx, sy] = tileToScreen(cam, view, size, r.x, r.y)
    const w = tile * 0.36
    const mid = (tile - w) / 2
    g.rect(sx + mid, sy + mid, w, w)
    if (joined(r.x - 1, r.y)) g.rect(sx, sy + mid, mid, w)
    if (joined(r.x + 1, r.y)) g.rect(sx + mid + w, sy + mid, mid, w)
    if (joined(r.x, r.y - 1)) g.rect(sx + mid, sy, w, mid)
    if (joined(r.x, r.y + 1)) g.rect(sx + mid, sy + mid + w, w, mid)
    g.fill({ color: BUILDING_COLORS.road, alpha: r.site ? 0.4 : 1 })
  }
  for (const b of buildings) {
    if (b.kind === 'road') continue
    // Walls and gates fill their whole tile, so a wall reads as one band; a gate shows lighter.
    if (b.kind === 'wall' || b.kind === 'gate') {
      g.rect(...box(b.x, b.y)).fill({
        color: WALL_COLOR,
        alpha: b.site ? 0.3 : b.kind === 'gate' ? 0.45 : 1,
      })
      continue
    }
    // A construction site shows faintly, as an outline of what it will be.
    g.rect(...box(b.x, b.y, 0.08))
      .fill({ color: BUILDING_COLORS[b.kind], alpha: b.site ? 0.35 : 1 })
      .stroke({ width: b.site ? 2 : 1, color: b.site ? BUILDING_COLORS[b.kind] : 0x4f3a22 })
  }
  for (const p of piles) {
    // A small heap in the tile's lower corner, so a building on the tile still shows.
    const [sx, sy] = tileToScreen(cam, view, size, p.x, p.y)
    g.poly([
      sx + tile * 0.55,
      sy + tile * 0.92,
      sx + tile * 0.92,
      sy + tile * 0.92,
      sx + tile * 0.735,
      sy + tile * 0.6,
    ])
      .fill(PILE_COLOR)
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

/** A chunk's RGBA pixels as a texture, one pixel per tile, kept crisp like `chunkTexture`. */
function pixelTexture(pixels: Uint8ClampedArray): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = CHUNK_SIZE
  canvas.height = CHUNK_SIZE
  const image = new ImageData(CHUNK_SIZE, CHUNK_SIZE)
  image.data.set(pixels)
  canvas.getContext('2d')!.putImageData(image, 0, 0)
  const texture = Texture.from(canvas)
  texture.source.scaleMode = 'nearest'
  return texture
}

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
