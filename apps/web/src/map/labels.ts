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
export class LabelLayer {
  readonly container = new Container()
  private labels: Label[] = []
  private used = 0

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
          fontSize: LABEL_SIZE,
          fontWeight: '600',
          fill: GLYPH_COLOR,
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
      const w = label.text.width + LABEL_SIZE * 0.9
      const h = LABEL_SIZE * 1.4
      label.pill
        .clear()
        .roundRect(-w / 2, -h / 2, w, h, 4)
        .fill({ color: PILL_COLOR, alpha: PILL_ALPHA })
    }
    label.root.position.set(Math.round(x), Math.round(y))
    label.root.visible = true
  }

  end() {
    for (let i = this.used; i < this.labels.length; i++) this.labels[i]!.root.visible = false
  }
}
