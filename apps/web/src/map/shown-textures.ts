/** How long one frame may spend painting chunk textures, new ones and ones made again. */
export const PAINT_BUDGET_MS = 4

/**
 * How many chunk textures are kept at most, besides those on screen now: 64 KB each, so 64 MB
 * (ADR 0034). Past it, the ones shown least recently are dropped, and painted again when shown.
 */
export const KEPT_TEXTURES = 1024

/** Paints a chunk's texture, and lets one go. */
export interface ChunkPainter<T> {
  paint(index: number): T
  drop(index: number, texture: T): void
}

interface Kept<T> {
  texture: T
  /** The frame it was last on screen in. */
  shownAt: number
  /** Its chunk or a neighbour it blends into changed since it was painted. */
  stale: boolean
}

/**
 * Which loaded chunks have a painted texture (ADR 0034, T99.4): a chunk's texture is painted when
 * it first comes on screen, not when it loads, within a budget per frame; a texture whose chunk or
 * neighbour changed is painted again only while on screen; and only so many are kept, the ones
 * shown least recently let go first.
 */
export class ShownTextures<T> {
  private readonly kept = new Map<number, Kept<T>>()
  private frame = 0

  constructor(
    private readonly painter: ChunkPainter<T>,
    private readonly cap = KEPT_TEXTURES,
    private readonly budgetMs = PAINT_BUDGET_MS,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** The chunk's texture, if it has one. */
  texture(index: number): T | undefined {
    return this.kept.get(index)?.texture
  }

  /** Whether the chunk has a texture. */
  has(index: number): boolean {
    return this.kept.has(index)
  }

  /** How many textures are kept. */
  get size(): number {
    return this.kept.size
  }

  /** The chunk or a neighbour it blends into changed: its texture is painted again when shown. */
  changed(index: number): void {
    const k = this.kept.get(index)
    if (k) k.stale = true
  }

  /**
   * One frame with `shown` on screen, all of them loaded: paints those without a texture or with
   * a stale one, in the order given, until the budget is spent (at least one a frame), then lets the
   * textures over the cap go. Returns true while some on screen still wait to be painted.
   */
  show(shown: Iterable<number>): boolean {
    this.frame++
    const started = this.now()
    let painted = 0
    let waiting = false
    for (const i of shown) {
      const k = this.kept.get(i)
      if (k) k.shownAt = this.frame
      if (k && !k.stale) continue
      if (painted > 0 && this.now() - started > this.budgetMs) {
        waiting = true
        continue
      }
      const texture = this.painter.paint(i)
      painted++
      if (k) {
        this.painter.drop(i, k.texture)
        Object.assign(k, { texture, stale: false })
      } else {
        this.kept.set(i, { texture, shownAt: this.frame, stale: false })
      }
    }
    this.letGo()
    return waiting
  }

  /** Lets every texture go (the layer is destroyed). */
  clear(): void {
    for (const [i, k] of this.kept) this.painter.drop(i, k.texture)
    this.kept.clear()
  }

  /** Over the cap, lets go of the textures shown least recently, never one on screen now. */
  private letGo(): void {
    const over = this.kept.size - this.cap
    if (over <= 0) return
    const old = [...this.kept]
      .filter(([, k]) => k.shownAt < this.frame)
      .sort((a, b) => a[1].shownAt - b[1].shownAt)
      .slice(0, over)
    for (const [i, k] of old) {
      this.painter.drop(i, k.texture)
      this.kept.delete(i)
    }
  }
}
