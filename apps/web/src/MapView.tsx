import { useEffect, useRef } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import type { Tile, WorldState } from '@csp/shared'

const TILE = 24
const TILE_COLORS: Record<Tile, number> = {
  grass: 0x2f5d34,
  rock: 0x6b6b6b,
  water: 0x2b5c8a,
  resource: 0xc9a227,
}
const OWNER_COLORS: Record<string, number> = { red: 0xe0524a, blue: 0x4aa3e0 }

export function MapView({ world }: { world: WorldState }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<{ app: Application; tiles: Graphics; units: Container } | null>(null)

  // Create the Pixi application once per map size.
  useEffect(() => {
    const host = hostRef.current!
    const app = new Application()
    let disposed = false
    void app
      .init({ width: world.width * TILE, height: world.height * TILE, background: 0x111111 })
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
        drawTiles(tiles, world)
        drawUnits(units, world)
      })
    return () => {
      disposed = true
      if (appRef.current?.app === app) {
        appRef.current = null
        app.destroy(true, { children: true })
      }
    }
  }, [world.width, world.height])

  useEffect(() => {
    if (appRef.current) drawUnits(appRef.current.units, world)
  }, [world])

  return <div ref={hostRef} className="map" />
}

function drawTiles(g: Graphics, world: WorldState) {
  g.clear()
  world.tiles.forEach((tile, i) => {
    const x = (i % world.width) * TILE
    const y = Math.floor(i / world.width) * TILE
    g.rect(x, y, TILE - 1, TILE - 1).fill(TILE_COLORS[tile])
  })
}

function drawUnits(layer: Container, world: WorldState) {
  layer.removeChildren().forEach((c) => c.destroy())
  for (const u of world.units) {
    const g = new Graphics()
      .circle(u.x * TILE + TILE / 2, u.y * TILE + TILE / 2, TILE / 2 - 3)
      .fill(OWNER_COLORS[u.owner] ?? 0xffffff)
      .stroke({ width: 2, color: 0x000000 })
    layer.addChild(g)
  }
}
