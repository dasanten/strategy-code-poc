import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { CHUNK_SIZE, chunksAcross, wrap, type TerrainChunk } from '@csp/shared'
import { chunkToScreen, type Camera, type Size } from './camera.js'
import { TERRAIN_MARK_ALPHA, TERRAIN_MARK_COLOR } from './palette.js'
import {
  MARK_SCALE,
  TERRAIN_TEXELS,
  UNEXPLORED_TILES,
  terrainMarks,
  terrainPixels,
  type TerrainMark,
} from './terrain.js'

/** Marks are drawn at this many pixels per tile and scaled with the view, so curves stay round. */
const MARK_UNIT = 16
/** How long one frame may spend making textures again whose edges were waiting for a neighbour. */
const REFRESH_BUDGET_MS = 4

interface Entry {
  chunk: TerrainChunk
  sprite: Sprite
  /** The chunk's terrain marks, made the first time they are on screen. */
  marks?: Graphics
  /** Neighbours the texture's edges were waiting for. */
  missing: Set<number>
}

/**
 * The terrain of the loaded chunks (ADR 0006, ADR 0008): one painted texture per chunk, and its
 * terrain marks above it when zoomed in, both drawn only while on screen. A chunk's edges blend
 * into the chunks around it, so a texture is made again when a neighbour it waited for arrives.
 */
export class TerrainLayer {
  readonly container = new Container()
  private readonly textures = new Container()
  private readonly marks = new Container()
  private readonly entries = new Map<number, Entry>()
  /** Chunks whose texture is out of date because a neighbour arrived or changed. */
  private readonly stale = new Set<number>()
  private readonly across: number

  constructor(
    private readonly mapSize: number,
    /** Whether the Player explored the chunk with this index, so it will load at some point. */
    private readonly explored: (index: number) => boolean,
  ) {
    this.across = chunksAcross(mapSize)
    this.container.addChild(this.textures, this.marks)
  }

  /** Shows a chunk that loaded, or its newer picture after explored terrain grew. */
  set(chunk: TerrainChunk): void {
    const index = chunk.cy * this.across + chunk.cx
    const old = this.entries.get(index)
    const { texture, missing } = this.texture(chunk)
    if (old) {
      old.sprite.texture.destroy(true)
      old.sprite.texture = texture
      old.marks?.destroy({ children: true })
      Object.assign(old, { chunk, marks: undefined, missing })
    } else {
      const sprite = new Sprite(texture)
      this.textures.addChild(sprite)
      this.entries.set(index, { chunk, sprite, missing })
    }
    this.stale.delete(index)
    // The chunks around it blend into it: they need it again if they waited for it or it changed.
    for (const n of this.around(chunk.cx, chunk.cy)) {
      const e = this.entries.get(n)
      if (e && (old || e.missing.has(index))) this.stale.add(n)
    }
  }

  /**
   * Places the chunks in `shown` for the camera and hides the rest. Returns true while textures
   * on screen still wait to be made again, so the caller draws another frame.
   */
  draw(cam: Camera, view: Size, shown: ReadonlySet<number>): boolean {
    const started = performance.now()
    for (const i of this.stale) {
      if (!shown.has(i)) continue
      if (performance.now() - started > REFRESH_BUDGET_MS) return this.place(cam, view, shown, true)
      this.stale.delete(i)
      const e = this.entries.get(i)!
      const { texture, missing } = this.texture(e.chunk)
      e.sprite.texture.destroy(true)
      e.sprite.texture = texture
      e.missing = missing
    }
    return this.place(cam, view, shown, false)
  }

  destroy(): void {
    for (const e of this.entries.values()) e.sprite.texture.destroy(true)
    this.container.destroy({ children: true })
  }

  private place(cam: Camera, view: Size, shown: ReadonlySet<number>, busy: boolean): boolean {
    const marked = cam.scale >= MARK_SCALE
    this.marks.visible = marked
    for (const [i, e] of this.entries) {
      const visible = shown.has(i)
      e.sprite.visible = visible
      if (e.marks) e.marks.visible = visible && marked
      if (!visible) continue
      const [sx, sy] = chunkToScreen(cam, view, this.mapSize, i % this.across, e.chunk.cy)
      e.sprite.position.set(sx, sy)
      e.sprite.scale.set(cam.scale / TERRAIN_TEXELS)
      if (!marked) continue
      e.marks ??= this.marks.addChild(drawMarks(terrainMarks(e.chunk)))
      e.marks.visible = true
      e.marks.position.set(sx, sy)
      e.marks.scale.set(cam.scale / MARK_UNIT)
    }
    return busy
  }

  private texture(chunk: TerrainChunk): { texture: Texture; missing: Set<number> } {
    const { pixels, missing } = terrainPixels(chunk, this.mapSize, (cx, cy) => {
      const i = cy * this.across + cx
      return this.entries.get(i)?.chunk.tiles ?? (this.explored(i) ? undefined : UNEXPLORED_TILES)
    })
    const side = CHUNK_SIZE * TERRAIN_TEXELS
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = side
    const image = new ImageData(side, side)
    image.data.set(pixels)
    canvas.getContext('2d')!.putImageData(image, 0, 0)
    // Smoothly scaled, so the ragged edges stay soft when zoomed in.
    const texture = Texture.from(canvas)
    texture.source.scaleMode = 'linear'
    return { texture, missing: new Set(missing) }
  }

  private around(cx: number, cy: number): number[] {
    const out: number[] = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy)
          out.push(wrap(cy + dy, this.across) * this.across + wrap(cx + dx, this.across))
      }
    }
    return out
  }
}

/** A chunk's terrain marks, `MARK_UNIT` pixels per tile from the chunk's corner. */
function drawMarks(marks: TerrainMark[]): Graphics {
  const g = new Graphics()
  const m = MARK_UNIT * 0.18
  const style = {
    width: MARK_UNIT * 0.07,
    color: TERRAIN_MARK_COLOR,
    alpha: TERRAIN_MARK_ALPHA,
    cap: 'round',
    join: 'round',
  } as const
  const strokes = new Graphics()
  for (const { kind, x, y } of marks) {
    const [cx, cy] = [x * MARK_UNIT, y * MARK_UNIT]
    switch (kind) {
      case 'tree':
      case 'trees':
        for (const [dx, dy] of kind === 'tree'
          ? [[0, 0]]
          : [
              [-0.6, 0.2],
              [0.6, -0.1],
            ]) {
          const [ax, ay] = [cx + dx! * m * 1.6, cy + dy! * m * 1.6]
          g.poly([ax, ay - m * 1.4, ax + m, ay + m * 0.6, ax - m, ay + m * 0.6])
        }
        break
      case 'hill':
        strokes
          .moveTo(...arcStart(cx, cy + m, m * 1.4))
          .arc(cx, cy + m, m * 1.4, Math.PI * 1.15, Math.PI * 1.85)
        break
      case 'peak':
        strokes
          .moveTo(cx - m * 1.6, cy + m)
          .lineTo(cx, cy - m * 1.4)
          .lineTo(cx + m * 1.6, cy + m)
          .moveTo(cx - m * 0.4, cy - m * 0.6)
          .lineTo(cx + m * 0.3, cy + m)
        break
      case 'wave':
        strokes
          .moveTo(cx - m * 1.4, cy)
          .quadraticCurveTo(cx - m * 0.7, cy - m * 0.8, cx, cy)
          .quadraticCurveTo(cx + m * 0.7, cy + m * 0.8, cx + m * 1.4, cy)
        break
      case 'tuft':
        strokes
          .moveTo(cx - m * 0.5, cy)
          .lineTo(cx - m * 0.2, cy - m * 0.7)
          .moveTo(cx + m * 0.4, cy)
          .lineTo(cx + m * 0.1, cy - m * 0.8)
        break
    }
  }
  g.fill({ color: TERRAIN_MARK_COLOR, alpha: TERRAIN_MARK_ALPHA })
  strokes.stroke(style)
  g.addChild(strokes)
  return g
}

/** Where an arc starting at 1.15π begins, so the path doesn't draw a line to it first. */
function arcStart(cx: number, cy: number, r: number): [number, number] {
  return [cx + r * Math.cos(Math.PI * 1.15), cy + r * Math.sin(Math.PI * 1.15)]
}
