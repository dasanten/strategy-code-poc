import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { CHUNK_SIZE, chunksAcross, wrap } from '../shared/terrain.js'
import type { TerrainChunk } from '@csp/shared-types'
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
import { ShownTextures } from './shown-textures.js'

/** Marks are drawn at this many pixels per tile and scaled with the view, so curves stay round. */
const MARK_UNIT = 16

interface Entry {
  chunk: TerrainChunk
  sprite: Sprite
  /** The chunk's terrain marks, made the first time they are on screen. */
  marks?: Graphics
}

/** A chunk's painted texture, and the neighbours its edges were waiting for. */
interface Painted {
  texture: Texture
  missing: Set<number>
}

/**
 * The terrain of the loaded chunks (ADR 0006, ADR 0008, ADR 0034): a loaded chunk keeps its
 * terrain bytes, and its texture is painted when it first comes on screen, within a budget a
 * frame; only so many textures are kept (`ShownTextures`). Its terrain marks show above it when
 * zoomed in, both drawn only while on screen. A chunk's edges blend into the chunks around it, so
 * a texture is painted again, while on screen, when a neighbour it waited for arrives.
 */
export class TerrainLayer {
  readonly container = new Container()
  private readonly textures = new Container()
  private readonly marks = new Container()
  private readonly entries = new Map<number, Entry>()
  private readonly painted: ShownTextures<Painted>
  private readonly across: number

  constructor(
    private readonly mapSize: number,
    /** Whether the Player explored the chunk with this index, so it will load at some point. */
    private readonly explored: (index: number) => boolean,
  ) {
    this.across = chunksAcross(mapSize)
    this.container.addChild(this.textures, this.marks)
    this.painted = new ShownTextures<Painted>({
      paint: (i) => this.texture(this.entries.get(i)!.chunk),
      drop: (i, p) => {
        const e = this.entries.get(i)
        if (e?.sprite.texture === p.texture) e.sprite.texture = Texture.EMPTY
        p.texture.destroy(true)
      },
    })
  }

  /** Takes in a chunk that loaded, or its newer picture after explored terrain grew. */
  set(chunk: TerrainChunk): void {
    const index = chunk.cy * this.across + chunk.cx
    const old = this.entries.get(index)
    if (old) {
      old.marks?.destroy({ children: true })
      Object.assign(old, { chunk, marks: undefined })
      this.painted.changed(index)
    } else {
      const sprite = new Sprite(Texture.EMPTY)
      sprite.visible = false
      this.textures.addChild(sprite)
      this.entries.set(index, { chunk, sprite })
    }
    // The chunks around it blend into it: they need it again if they waited for it or it changed.
    for (const n of this.around(chunk.cx, chunk.cy)) {
      const p = this.painted.texture(n)
      if (p && (old || p.missing.has(index))) this.painted.changed(n)
    }
  }

  /** The loaded chunks among `indices` that have no texture yet: the map shows them as loading. */
  unpainted(indices: readonly number[]): number[] {
    return indices.filter((i) => this.entries.has(i) && !this.painted.has(i))
  }

  /** How many chunk textures are painted and kept. */
  get texturesKept(): number {
    return this.painted.size
  }

  /**
   * Paints what is on screen and has no texture yet, or a stale one, as the budget allows, places
   * the chunks in `shown` for the camera and hides the rest. Returns true while chunks on screen
   * still wait to be painted, so the caller draws another frame.
   */
  draw(cam: Camera, view: Size, shown: ReadonlySet<number>): boolean {
    const busy = this.painted.show([...shown].filter((i) => this.entries.has(i)))
    return this.place(cam, view, shown, busy)
  }

  destroy(): void {
    this.painted.clear()
    this.container.destroy({ children: true })
  }

  private place(cam: Camera, view: Size, shown: ReadonlySet<number>, busy: boolean): boolean {
    const marked = cam.scale >= MARK_SCALE
    this.marks.visible = marked
    for (const [i, e] of this.entries) {
      const painted = shown.has(i) ? this.painted.texture(i) : undefined
      const visible = painted !== undefined
      e.sprite.visible = visible
      if (e.marks) e.marks.visible = visible && marked
      if (!visible) continue
      if (e.sprite.texture !== painted.texture) e.sprite.texture = painted.texture
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
