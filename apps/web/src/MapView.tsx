import { useEffect, useRef } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import { OFF_MAP, Terrain, type MapInfo } from '@csp/shared'
import type { ClientWorld } from './useWorld.js'

const TILE = 24
const TERRAIN_COLORS: Record<number, number> = {
  [Terrain.Plains]: 0x9fbf5f,
  [Terrain.Forest]: 0x2f5d34,
  [Terrain.Hills]: 0x9c8457,
  [Terrain.Mountain]: 0x6b6464,
  [Terrain.Lake]: 0x4f8fd0,
  [Terrain.Sea]: 0x1e4690,
  [OFF_MAP]: 0x111111,
}
const OWNER_COLORS: Record<string, number> = { red: 0xe0524a, blue: 0x4aa3e0 }

export function MapView({ world }: { world: ClientWorld }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<{ app: Application; tiles: Graphics; units: Container } | null>(null)
  const { map } = world

  // Create the Pixi application once per map window.
  useEffect(() => {
    const host = hostRef.current!
    const app = new Application()
    let disposed = false
    void app
      .init({ width: map.width * TILE, height: map.height * TILE, background: 0x111111 })
      .then(() => {
        if (disposed) {
          app.destroy(true)
          return
        }
        host.appendChild(app.canvas)
        const tiles = new Graphics()
        const units = new Container()
        app.stage.addChild(tiles, units)
        appRef.current = { app, tiles, units }
        drawTiles(tiles, map)
        drawUnits(units, world)
      })
    return () => {
      disposed = true
      if (appRef.current?.app === app) {
        appRef.current = null
        app.destroy(true, { children: true })
      }
    }
  }, [map])

  useEffect(() => {
    if (appRef.current) drawUnits(appRef.current.units, world)
  }, [world])

  return <div ref={hostRef} className="map" />
}

function drawTiles(g: Graphics, map: MapInfo) {
  g.clear()
  map.terrain.forEach((terrain, i) => {
    const x = (i % map.width) * TILE
    const y = Math.floor(i / map.width) * TILE
    g.rect(x, y, TILE - 1, TILE - 1).fill(TERRAIN_COLORS[terrain] ?? 0xff00ff)
  })
}

/** Units are drawn relative to the map window; ones that walked out of it are not drawn. */
function drawUnits(layer: Container, { map, units }: ClientWorld) {
  layer.removeChildren().forEach((c) => c.destroy())
  for (const u of units) {
    const x = u.x - map.x
    const y = u.y - map.y
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
    const g = new Graphics()
      .circle(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE / 2 - 3)
      .fill(OWNER_COLORS[u.owner] ?? 0xffffff)
      .stroke({ width: 2, color: 0x000000 })
    layer.addChild(g)
  }
}
