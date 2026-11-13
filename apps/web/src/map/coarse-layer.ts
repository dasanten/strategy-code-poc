import { Container, Sprite, Texture } from 'pixi.js'
import { TERRAIN_LEVEL_MAX, chunksAcross, levelChunksAcross } from '../shared/terrain.js'
import type { TerrainChunk } from '@csp/shared-types'
import type { Camera, Size } from './camera.js'
import { coarseTexels, levelChunkRect, levelChunkToScreen, squaresIn } from './levels.js'
import { ShownTextures } from './shown-textures.js'

/** A coarse chunk to draw: its level (1 to `TERRAIN_LEVEL_MAX`) and index on that level. */
export interface LevelChunk {
  level: number
  index: number
}

/**
 * The terrain of coarse levels (ADR 0034, T99.6): zoomed out, each chunk of the level the map
 * draws is one small flat texture, a texel a square, smoothed when scaled. Coarser levels lie
 * under finer ones, so a coarser chunk shows through where a finer one is still loading. Textures
 * are made when a chunk is first shown and only so many kept (`ShownTextures`), as for level 0;
 * a frame touches only the chunks shown in it and in the frame before.
 */
export class CoarseLayer {
  readonly container = new Container()
  private readonly levels: Array<{
    layer: Container
    sprites: Map<number, Sprite>
    textures: ShownTextures<Texture>
  }> = []
  private lastShown: LevelChunk[] = []

  constructor(
    private readonly mapSize: number,
    private readonly chunk: (index: number, level: number) => TerrainChunk | undefined,
  ) {
    // The coarsest at the bottom.
    for (let level = TERRAIN_LEVEL_MAX; level >= 1; level--) {
      const layer = new Container()
      this.container.addChild(layer)
      const sprites = new Map<number, Sprite>()
      this.levels[level] = {
        layer,
        sprites,
        textures: new ShownTextures<Texture>({
          paint: (i) => this.paint(i, level),
          drop: (i, texture) => {
            const s = sprites.get(i)
            if (s?.texture === texture) s.texture = Texture.EMPTY
            texture.destroy(true)
          },
        }),
      }
    }
  }

  /** A coarse chunk loaded again after explored terrain grew: painted again when shown. */
  set(chunk: TerrainChunk, level: number): void {
    const l = this.levels[level]
    if (!l) return
    const across = levelChunksAcross(chunksAcross(this.mapSize), level)
    l.textures.changed(chunk.cy * across + chunk.cx)
  }

  /** The chunks among these that are loaded but not painted yet. */
  unpainted(chunks: readonly LevelChunk[]): LevelChunk[] {
    return chunks.filter(
      (c) => this.chunk(c.index, c.level) && !this.levels[c.level]?.textures.has(c.index),
    )
  }

  /**
   * Shows exactly these loaded chunks for the camera, painting those without a texture as the
   * budget allows, and hides those shown last frame and not now. Returns true while some still
   * wait to be painted.
   */
  draw(cam: Camera, view: Size, chunks: readonly LevelChunk[]): boolean {
    let busy = false
    const now = new Set(chunks.map((c) => `${c.level}:${c.index}`))
    for (const c of this.lastShown) {
      if (!now.has(`${c.level}:${c.index}`)) {
        const s = this.levels[c.level]?.sprites.get(c.index)
        if (s) s.visible = false
      }
    }
    for (let level = 1; level <= TERRAIN_LEVEL_MAX; level++) {
      const l = this.levels[level]!
      const here = chunks.filter((c) => c.level === level && this.chunk(c.index, level))
      if (l.textures.show(here.map((c) => c.index))) busy = true
      for (const { index } of here) {
        const texture = l.textures.texture(index)
        let sprite = l.sprites.get(index)
        if (!texture) {
          if (sprite) sprite.visible = false
          continue
        }
        if (!sprite) {
          sprite = new Sprite(texture)
          l.layer.addChild(sprite)
          l.sprites.set(index, sprite)
        }
        if (sprite.texture !== texture) sprite.texture = texture
        const at = levelChunkToScreen(cam, view, this.mapSize, level, index)
        sprite.position.set(at.x, at.y)
        sprite.width = at.width
        sprite.height = at.height
        sprite.visible = true
      }
    }
    this.lastShown = [...chunks]
    return busy
  }

  destroy(): void {
    for (const l of this.levels) l?.textures.clear()
    this.container.destroy({ children: true })
  }

  /** A coarse chunk's texture: the squares on the map only, so padding is never drawn. */
  private paint(index: number, level: number): Texture {
    const chunk = this.chunk(index, level)!
    const r = levelChunkRect(this.mapSize, level, index)
    const [w, h] = [squaresIn(r.w, level), squaresIn(r.h, level)]
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const image = new ImageData(w, h)
    image.data.set(coarseTexels(chunk.tiles, w, h))
    canvas.getContext('2d')!.putImageData(image, 0, 0)
    const texture = Texture.from(canvas)
    texture.source.scaleMode = 'linear'
    return texture
  }
}
