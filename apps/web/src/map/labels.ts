import { Container, Graphics, Text } from 'pixi.js'
import { THEME } from '../theme.js'
import { GLYPH_COLOR } from './tokens.js'

/** Label text size in pixels; labels keep their size at every zoom. */
const LABEL_SIZE = 12
/** The pill behind a label: dark like the token badges (ADR 0008). */
const PILL_COLOR = 0x0e1419
const PILL_ALPHA = 0.82

interface Label {
  root: Container
  pill: Graphics
  text: Text
}

/**
 * Name labels on dark pills, such as the cities' in the far tier, redrawn every frame like
 * `TokenLayer`: `begin`, `place` each, `end`.
 */
/** How a layer's labels look: city names and waypoints on pills; region names larger, without. */
export interface LabelStyle {
  size: number
  pill: boolean
  italic?: boolean
}

export class LabelLayer {
  readonly container = new Container()
  private labels: Label[] = []
  private used = 0

  constructor(private readonly style: LabelStyle = { size: LABEL_SIZE, pill: true }) {}

  begin() {
    this.used = 0
  }

  /** A label centred at a screen point. */
  place(text: string, x: number, y: number) {
    let label = this.labels[this.used]
    if (!label) {
      const root = new Container()
      const pill = new Graphics()
      const t = new Text({
        text: '',
        anchor: 0.5,
        style: {
          fontFamily: THEME.font.ui,
          fontSize: this.style.size,
          fontWeight: '600',
          fontStyle: this.style.italic ? 'italic' : 'normal',
          fill: GLYPH_COLOR,
          // Without a pill the text keeps a dark edge, to read on any terrain.
          ...(this.style.pill ? {} : { stroke: { color: PILL_COLOR, width: 3 } }),
        },
      })
      root.addChild(pill, t)
      this.container.addChild(root)
      label = { root, pill, text: t }
      this.labels.push(label)
    }
    this.used++
    if (label.text.text !== text) {
      label.text.text = text
      label.pill.clear()
      if (this.style.pill) {
        const w = label.text.width + this.style.size * 0.9
        const h = this.style.size * 1.4
        label.pill
          .roundRect(-w / 2, -h / 2, w, h, 4)
          .fill({ color: PILL_COLOR, alpha: PILL_ALPHA })
      }
    }
    label.root.position.set(Math.round(x), Math.round(y))
    label.root.visible = true
  }

  end() {
    for (let i = this.used; i < this.labels.length; i++) this.labels[i]!.root.visible = false
  }
}
