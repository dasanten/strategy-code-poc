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
  type Building,
  type KnownNode,
  type Resident,
  type ResourceKind,
} from '@csp/shared'
import {
  CLOSE_SCALE,
  zoomTier,
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
import { TerrainLayer } from './map/terrain-layer.js'
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
  CARAVAN_COLOR,
  PILE_COLOR,
  LEADER_COLOR,
  CITY_AREA_COLOR,
  ROAD_COLOR,
  TERRAIN_COLORS,
  TERRAIN_NAMES,
  VOID_COLOR,
  css,
} from './map/palette.js'
import { BASE_ART, BUILDING_ART, CITY_ART, NODE_ART } from './map/art.js'
import { EMBLEM_RADIUS, MARKER_RADIUS, cityEmblems, emblemAt, farMarkers } from './map/far.js'
import { LabelLayer } from './map/labels.js'
import { destroyAtlas, loadAtlas, type Atlas } from './map/atlas.js'
import {
  GLYPH_COLOR,
  NODE_GLYPH_COLORS,
  BadgeLayer,
  TokenLayer,
  cityRelationship,
  relationshipColor,
  type Relationship,
  type Viewer,
} from './map/tokens.js'
import type { ClientWorld } from './useWorld.js'
import { caravanAt, caravanParts } from './caravans.js'
import { drawUnits, type Spot } from './map/unit-tokens.js'

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
  /** A Trade Org caravan stands there (`CONTEXT.md`: Caravan). */
  caravan?: boolean
}

/** What the map shows: the terrain, or territory over it (`CONTEXT.md`: Region map). */
type MapMode = 'terrain' | 'region'

/**
 * The world map (T1.5): explored terrain loaded in chunks as the view needs them, painted per
 * chunk with its terrain marks (`map/terrain-layer.ts`) and drawn only while on screen. Zoomed out
 * it draws only terrain; closer in it adds resource nodes and residents, and up close the tile
 * grid.
 * Drag or swipe to pan; wheel, pinch or the buttons to zoom.
 */
export function MapView({
  world,
  selectedId,
  onSelect,
  onSelectTile,
  selectedCityId,
  onSelectCity,
  picking = false,
  onPickTile,
  onNodesLoaded,
  focus,
}: {
  world: ClientWorld
  /** The resident shown with a ring, if any. */
  selectedId?: string
  /** Called with a resident of the Player's realm clicked on the map. */
  onSelect?: (id: string) => void
  /** Called with a tile clicked where there is no resident of the Player's realm. */
  onSelectTile?: (x: number, y: number) => void
  /** The city whose emblem shows with a ring in the far tier, if any. */
  selectedCityId?: string
  /** Called with a city whose emblem was clicked in the far tier. */
  onSelectCity?: (id: string) => void
  /** Waiting for a tile: the next click picks one instead of selecting. */
  picking?: boolean
  /** Called with a tile picked by click (while `picking`) or by right-click. */
  onPickTile?: (x: number, y: number) => void
  /** Called with a lookup of known resource nodes by tile, and again whenever more load. */
  onNodesLoaded?: (nodeAt: (x: number, y: number) => KnownNode | undefined) => void
  /** A tile to centre the view on, such as a place named in the realm log; a new object each time. */
  focus?: { x: number; y: number }
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef(world)
  const selectedRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onSelectTileRef = useRef(onSelectTile)
  onSelectTileRef.current = onSelectTile
  const selectedCityRef = useRef(selectedCityId)
  const onSelectCityRef = useRef(onSelectCity)
  onSelectCityRef.current = onSelectCity
  const pickingRef = useRef(picking)
  pickingRef.current = picking
  const onPickTileRef = useRef(onPickTile)
  onPickTileRef.current = onPickTile
  const onNodesLoadedRef = useRef(onNodesLoaded)
  onNodesLoadedRef.current = onNodesLoaded
  const redrawRef = useRef<() => void>(() => {})
  const forgetRef = useRef<(chunks: readonly number[]) => void>(() => {})
  const regionRef = useRef<(region: RegionState | null) => void>(() => {})
  const controlsRef = useRef<{
    zoom(factor: number): void
    centre(): void
    goTo(x: number, y: number): void
  } | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [scale, setScale] = useState(START_SCALE)
  const [mode, setMode] = useState<MapMode>('terrain')
  const modeRef = useRef(mode)
  const mapSize = world.map.size

  useEffect(() => {
    modeRef.current = mode
    redrawRef.current()
  }, [mode])

  useEffect(() => {
    if (focus) controlsRef.current?.goTo(focus.x, focus.y)
  }, [focus])

  // The Region map changes once a game hour, and where explored terrain grows.
  useEffect(() => regionRef.current(world.region), [world.region])

  // What is in sight changes every tick; the scene reads the latest through the ref.
  useEffect(() => {
    selectedRef.current = selectedId
    redrawRef.current()
  }, [selectedId])

  useEffect(() => {
    selectedCityRef.current = selectedCityId
    redrawRef.current()
  }, [selectedCityId])

  useEffect(() => {
    worldRef.current = world
    if (world.grownChunks.length > 0) forgetRef.current(world.grownChunks)
    redrawRef.current()
  }, [world])

  useEffect(() => {
    const host = hostRef.current!
    const across = chunksAcross(mapSize)
    const app = new Application()
    const nodes: KnownNode[][] = []
    const terrainLayer = new TerrainLayer(mapSize, (i) => worldRef.current.exploredChunks.has(i))
    // The Region map: territory over the terrain, one small texture per chunk like the terrain.
    const regionSprites = new Map<number, Sprite>()
    const regionLayer = new Container()
    // Under the tokens: grid, city areas, roads and walls; over them: piles, carts and residents.
    const under = new Graphics()
    const tokens = new TokenLayer()
    const badges = new BadgeLayer()
    let atlas: Atlas | undefined
    const overlay = new Graphics()
    const labels = new LabelLayer()
    // Where each resident's token was drawn last frame; up close each has its own figure.
    let drawnSpots = new Map<string, Spot>()
    const size = (): Size => ({ width: app.screen.width, height: app.screen.height })
    let cam: Camera = { ...homeCentre(worldRef.current), scale: START_SCALE }
    let disposed = false
    let ready = false
    let frame = 0

    const store = new ChunkStore(
      () => worldRef.current.exploredChunks,
      across,
      (chunk) => {
        terrainLayer.set(chunk)
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
      // Far out, territory always shows (ADR 0008: far tier).
      regionLayer.visible = modeRef.current === 'region' || zoomTier(cam.scale) === 'far'
      // Terrain whose edges still wait to be redone asks for another frame.
      if (terrainLayer.draw(cam, view, shown)) redraw()
      for (const [i, sprite] of regionSprites) {
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
      under.clear()
      tokens.begin()
      badges.begin()
      labels.begin()
      if (zoomTier(cam.scale) === 'far') drawFar(g, cam, view)
      else drawMiddle(g, cam, view, onScreen)
      labels.end()
      tokens.end()
      badges.end()
    }

    /** Far out: an emblem with a name per city, armies and caravans as small markers. */
    function drawFar(g: Graphics, cam: Camera, view: Size) {
      const world = worldRef.current
      for (const m of farMarkers(world)) {
        const [sx, sy] = tileToScreen(cam, view, mapSize, m.x + 0.5, m.y + 0.5)
        g.circle(sx, sy, MARKER_RADIUS)
          .fill(relationshipColor(m.rel))
          .stroke({ width: 1.5, color: 0x0e1419 })
      }
      for (const e of cityEmblems(world, viewerOf(world), mapSize)) {
        const [sx, sy] = tileToScreen(cam, view, mapSize, e.x + 0.5, e.y + 0.5)
        const r = EMBLEM_RADIUS[e.size]
        if (sx < -r * 8 || sy < -r * 4 || sx > view.width + r * 8 || sy > view.height + r * 4)
          continue
        drawEmblem(tokens, sx, sy, r, e.rel)
        labels.place(e.name, sx, sy + r + 12)
        if (e.id === selectedCityRef.current)
          g.circle(sx, sy, r + 6).stroke({ width: 2.5, color: 0xffffff })
      }
    }

    function drawMiddle(g: Graphics, cam: Camera, view: Size, onScreen: number[]) {
      if (cam.scale >= CLOSE_SCALE) {
        const { x0, y0, x1, y1 } = visibleTiles(cam, view)
        for (let x = x0; x <= x1 + 1; x++) {
          const sx = (x - cam.x) * cam.scale + view.width / 2
          under.moveTo(sx, 0).lineTo(sx, view.height)
        }
        for (let y = y0; y <= y1 + 1; y++) {
          const sy = (y - cam.y) * cam.scale + view.height / 2
          under.moveTo(0, sy).lineTo(view.width, sy)
        }
        under.stroke({ width: 1, color: 0x000000, alpha: 0.12 })
      }

      // A node under a building shows as the building.
      const built = new Set(
        worldRef.current.buildings.filter((b) => b.kind !== 'road').map((b) => `${b.x},${b.y}`),
      )
      const r = tokenRadius(cam.scale)
      for (const i of onScreen) {
        for (const n of nodes[i] ?? []) {
          if (built.has(`${n.x},${n.y}`)) continue
          const [sx, sy] = tileToScreen(cam, view, mapSize, n.x + 0.5, n.y + 0.5)
          drawNode(tokens, n.kind, sx, sy, r)
        }
      }

      drawStructures(under, g, tokens, cam, view, worldRef.current)

      const spots = drawUnits(tokens, badges, cam, view, worldRef.current)
      drawnSpots = spots
      const selected = worldRef.current.residents.find((u) => u.id === selectedRef.current)
      const spot = selected && spots.get(selected.id)
      if (selected && spot) {
        g.circle(spot.x, spot.y, spot.r * 1.3).stroke({ width: 2.5, color: LEADER_COLOR })
        drawPath(g, cam, view, mapSize, selected)
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
        caravan: caravanAt(caravanParts(worldRef.current.caravans), worldRef.current, wx, wy),
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
      // picks the own resident under it, or else the tile. A right-click always picks the tile.
      if (wasPressed && e.type === 'pointerup' && pointers.size === 0 && dragged < 6) {
        const p = local(e)
        const [tx, ty] = screenToTile(cam, size(), mapSize, p.x, p.y).map(Math.floor) as [
          number,
          number,
        ]
        if (pickingRef.current || e.button === 2) {
          onPickTileRef.current?.(tx, ty)
          return
        }
        // Far out, a click picks the city whose emblem it falls on.
        if (zoomTier(cam.scale) === 'far') {
          const world = worldRef.current
          const emblems = cityEmblems(world, viewerOf(world), mapSize)
          const city = emblemAt(emblems, cam, size(), mapSize, p.x, p.y)
          if (city) onSelectCityRef.current?.(city.id)
          return
        }
        const id = residentAt(p.x, p.y)
        if (id) onSelectRef.current?.(id)
        else onSelectTileRef.current?.(tx, ty)
      }
    }

    function residentAt(sx: number, sy: number): string | undefined {
      const view = size()
      const { home, residents } = worldRef.current
      const close = zoomTier(cam.scale) === 'close'
      let best: { id: string; d: number } | undefined
      for (const r of residents) {
        if (r.owner !== home.realmId) continue
        // Up close, the figure under the pointer; further out, the tile's token.
        const spot = close ? drawnSpots.get(r.id) : undefined
        if (close && !spot) continue
        const [rx, ry] = spot
          ? [spot.x, spot.y]
          : tileToScreen(cam, view, mapSize, r.x + 0.5, r.y + 0.5)
        const reach = spot ? Math.max(8, spot.r * 1.4) : Math.max(10, cam.scale * 0.6)
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
      goTo: (x, y) => setCam({ ...cam, x: x + 0.5, y: y + 0.5 }),
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
      app.stage.addChild(
        terrainLayer.container,
        regionLayer,
        under,
        tokens.container,
        overlay,
        labels.container,
        badges.container,
      )
      ready = true
      void loadAtlas().then((loaded) => {
        if (disposed) return destroyAtlas(loaded)
        atlas = loaded
        tokens.atlas = loaded
        redraw()
      })
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
        terrainLayer.destroy()
        for (const sprite of regionSprites.values()) sprite.texture.destroy(true)
        app.destroy(true, { children: true })
      }
      if (atlas) destroyAtlas(atlas)
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
            (hover.caravan ? ' · Trade Org caravan' : '') +
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
      <div>
        <span className="swatch" style={{ background: css(CARAVAN_COLOR) }} />
        <span>Caravan</span>
        <span className="rule">Trade Org</span>
      </div>
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
 * Token radius at a zoom: up close a building's hex fills its tile (ADR 0008: close tier), further
 * out a little less, but never smaller than readable.
 */
const tokenRadius = (scale: number) =>
  zoomTier(scale) === 'close' ? scale * 0.48 : Math.max(6.5, scale * 0.42)

/**
 * A building as a token (ADR 0008): a dark hex badge, its ring in the owner's relationship colour
 * and a light glyph. The art's hex has a radius of 11 in its 24-unit box.
 */
function drawBuilding(
  tokens: TokenLayer,
  file: string,
  x: number,
  y: number,
  r: number,
  rel: Relationship | undefined,
  alpha = 1,
  glyph = GLYPH_COLOR,
) {
  const base = (r * 1.08 * 24) / 11
  tokens.place(BASE_ART.hex, x, y, base, 0xffffff, alpha)
  tokens.place(BASE_ART.hexRing, x, y, base, relationshipColor(rel), alpha)
  tokens.place(file, x, y, r * 1.2, glyph, alpha)
}

/** A city's emblem in the far tier (ADR 0008): a castle on a dark hex badge with a wide ring. */
function drawEmblem(tokens: TokenLayer, x: number, y: number, r: number, rel: Relationship) {
  const base = (r * 1.08 * 24) / 11
  tokens.place(BASE_ART.hex, x, y, base)
  tokens.place(CITY_ART.ring, x, y, base, relationshipColor(rel))
  tokens.place(CITY_ART.glyph, x, y, r * 1.2, GLYPH_COLOR)
}

/** The Player's realm and its allies, for relationship colours. */
const viewerOf = (world: ClientWorld): Viewer => ({
  realmId: world.home.realmId,
  allies: new Set(world.diplomacy.alliance?.members.map((m) => m.realmId)),
})

/** A resource node as a token: a dark diamond with the glyph in the node's colour. */
function drawNode(tokens: TokenLayer, kind: ResourceKind, x: number, y: number, r: number) {
  tokens.place(BASE_ART.diamond, x, y, (r * 24) / 11)
  tokens.place(NODE_ART[kind], x, y, r * 1.15, NODE_GLYPH_COLORS[kind])
}

/**
 * City areas, roads, walls, buildings and piles, at mid zoom and closer.
 * `under` lies below the tokens, `over` above them.
 */
function drawStructures(
  under: Graphics,
  over: Graphics,
  tokens: TokenLayer,
  cam: Camera,
  view: Size,
  world: ClientWorld,
) {
  const { cities, buildings, piles } = world
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
      if (onScreen(b)) under.rect(...b)
    }
    under.fill({ color: CITY_AREA_COLOR, alpha: 0.18 })
  }
  // Roads under the buildings, as a wide light band through the middle of the tile joined to the
  // roads next to it (`CONTEXT.md`: Road, ADR 0008); a road site, and the step onto it, are faint.
  const roads = new Map(
    buildings.filter((b) => b.kind === 'road').map((b) => [`${b.x},${b.y}`, b] as const),
  )
  const roadAt = (x: number, y: number) => roads.get(`${(x + size) % size},${(y + size) % size}`)
  const w = Math.max(3, tile * 0.36)
  const inSight = ([sx, sy]: readonly number[]) =>
    sx! > -tile && sy! > -tile && sx! < view.width + tile && sy! < view.height + tile
  for (const site of [false, true]) {
    const style = { color: ROAD_COLOR, alpha: site ? 0.4 : 1 }
    for (const r of roads.values()) {
      const c = centre(cam, view, size, r)
      if (!!r.site === site && inSight(c)) under.circle(c[0], c[1], w / 2)
    }
    under.fill(style)
    // Each join once, from the road to its right or below; faint if either end is a site.
    for (const r of roads.values()) {
      const [sx, sy] = centre(cam, view, size, r)
      if (!inSight([sx, sy])) continue
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const next = roadAt(r.x + dx, r.y + dy)
        if (next && !!(r.site || next.site) === site) {
          under.moveTo(sx, sy).lineTo(sx + dx * tile, sy + dy * tile)
        }
      }
    }
    under.stroke({ ...style, width: w })
  }

  const cityById = new Map(cities.map((c) => [c.id, c]))
  const viewer = {
    realmId: world.home.realmId,
    allies: new Set(world.diplomacy.alliance?.members.map((m) => m.realmId)),
  }
  const relOf = (b: Building) =>
    cityRelationship(b.cityId === null ? undefined : cityById.get(b.cityId), viewer)
  const near = (sx: number, sy: number) =>
    sx > -tile * 2 && sy > -tile * 2 && sx < view.width + tile * 2 && sy < view.height + tile * 2

  // Walls and gates as joined lines in the owner's colour over a dark edge (ADR 0008); a wall
  // site shows faintly.
  const walls = new Set(
    buildings.filter((b) => b.kind === 'wall' || b.kind === 'gate').map((b) => `${b.x},${b.y}`),
  )
  const wallAt = (x: number, y: number) => walls.has(`${(x + size) % size},${(y + size) % size}`)
  const edge = Math.max(3, tile * 0.34)
  const band = Math.max(1.5, tile * 0.22)
  const lines = new Map<string, [number, number, number, number][]>()
  for (const b of buildings) {
    if (b.kind !== 'wall' && b.kind !== 'gate') continue
    const [cx, cy] = centre(cam, view, size, b)
    if (!near(cx, cy)) continue
    const key = `${relationshipColor(relOf(b))},${b.site ? 0.35 : 1}`
    const list = lines.get(key) ?? []
    lines.set(key, list)
    // A dot on every wall tile, so one standing alone shows, and a line to each wall right or below.
    list.push([cx, cy, cx, cy])
    if (wallAt(b.x + 1, b.y)) list.push([cx, cy, cx + tile, cy])
    if (wallAt(b.x, b.y + 1)) list.push([cx, cy, cx, cy + tile])
  }
  const stroke = (width: number, color: number, alpha: number, segments: number[][]) => {
    const dots = segments.filter(([x0, y0, x1, y1]) => x0 === x1 && y0 === y1)
    for (const [x, y] of dots) under.rect(x! - width / 2, y! - width / 2, width, width)
    under.fill({ color, alpha })
    for (const [x0, y0, x1, y1] of segments)
      if (x0 !== x1 || y0 !== y1) under.moveTo(x0!, y0!).lineTo(x1!, y1!)
    under.stroke({ width, color, alpha, cap: 'square' })
  }
  for (const [key, segments] of lines)
    stroke(edge, 0x0e1419, Number(key.split(',')[1]) * 0.85, segments)
  for (const [key, segments] of lines) {
    const [color, alpha] = key.split(',').map(Number) as [number, number]
    stroke(band, color, alpha, segments)
  }

  // Buildings as icon tokens; a gate sits on its wall, smaller, its glyph in the owner's colour
  // while closed. A construction site shows faintly.
  const r = tokenRadius(tile)
  for (const b of buildings) {
    if (b.kind === 'road' || b.kind === 'wall') continue
    const [cx, cy] = centre(cam, view, size, b)
    if (!near(cx, cy)) continue
    const rel = relOf(b)
    const alpha = b.site ? 0.45 : 1
    if (b.kind === 'gate')
      drawBuilding(
        tokens,
        BUILDING_ART.gate,
        cx,
        cy,
        r * 0.75,
        rel,
        alpha,
        b.closed ? relationshipColor(rel) : GLYPH_COLOR,
      )
    else drawBuilding(tokens, BUILDING_ART[b.kind], cx, cy, r, rel, alpha)
  }
  for (const p of piles) {
    // A small heap in the tile's lower corner, so a building on the tile still shows.
    const [sx, sy] = tileToScreen(cam, view, size, p.x, p.y)
    over
      .poly([
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
}

const centre = (cam: Camera, view: Size, size: number, e: { x: number; y: number }) =>
  tileToScreen(cam, view, size, e.x + 0.5, e.y + 0.5)

/** A chunk's RGBA pixels as a texture, one pixel per tile, scaled up crisp. */
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
