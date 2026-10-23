import { Container, Graphics, Sprite, Text } from 'pixi.js'
import type { City, ResourceKind } from '@csp/shared'
import { THEME } from '../theme.js'
import type { Atlas } from './atlas.js'

/** Who owns a token, seen from the Player's realm (ADR 0008). There is no "enemy": no war state. */
export type Relationship = 'own' | 'alliance' | 'other' | 'npc' | 'trade'

/** The fixed relationship colours on token bases (ADR 0008), as 0xRRGGBB. */
export const RELATIONSHIP_COLORS: Record<Relationship, number> = {
  own: 0xf2b630,
  alliance: 0x4f9dff,
  other: 0xff6a48,
  npc: 0xa89c8a,
  trade: 0x2ec8b8,
}
/** The ring of a building of no city (a workplace on a node) or of a city out of sight. */
export const UNOWNED_COLOR = 0x6b7580
/** Building glyphs: light on the dark badge. */
export const GLYPH_COLOR = 0xe8eef4
/** A resource node's glyph, in the node's colour on its dark diamond. */
export const NODE_GLYPH_COLORS: Record<ResourceKind, number> = {
  forest: 0x7bd88f,
  stone: 0xc9ccd1,
  ironOre: 0xff9a6a,
  goldOre: 0xffd34d,
}

/**
 * What colours a token: how the viewer stands to its owner, or on the admin map, which has no
 * viewer, a realm's own colour as 0xRRGGBB (`CONTEXT.md`: admin map). NPC cities and the Trade
 * Organization keep their relationship colours there.
 */
export type Tone = Relationship | number

/** The viewer: the Player's realm and the realms in their alliance. */
export interface Viewer {
  realmId: string
  allies: ReadonlySet<string>
  /** On the admin map: each realm in its own colour instead of by relationship. */
  realmColour?: (realmId: string) => number
}

/**
 * How the viewer stands to a city and what belongs to it: a Trade Organization city, an NPC city
 * (no realm), the viewer's own, an alliance member's or another realm's. Undefined for no city.
 */
export function cityRelationship(
  city: Pick<City, 'realmId' | 'tradeOrg'> | undefined,
  viewer: Viewer,
): Tone | undefined {
  if (!city) return undefined
  if (city.tradeOrg) return 'trade'
  if (city.realmId === null) return 'npc'
  return realmRelationship(city.realmId, viewer)
}

/** How the viewer stands to a realm: their own, an alliance member or another realm. */
export function realmRelationship(realmId: string, viewer: Viewer): Tone {
  if (viewer.realmColour) return viewer.realmColour(realmId)
  if (realmId === viewer.realmId) return 'own'
  return viewer.allies.has(realmId) ? 'alliance' : 'other'
}

export const relationshipColor = (rel: Tone | undefined) =>
  typeof rel === 'number' ? rel : rel ? RELATIONSHIP_COLORS[rel] : UNOWNED_COLOR

/** Where a tone ranks among relationships, for ties and crowded tiles: a realm's colour as other. */
export const rankedAs = (rel: Tone | undefined): Relationship | undefined =>
  typeof rel === 'number' ? 'other' : rel

/**
 * Whose token wears the crown: on the game map the Player's Leader, on the admin map every
 * Leader.
 */
export type Leaders = string | ReadonlySet<string> | null | undefined

export const isLeader = (leaders: Leaders, id: string): boolean =>
  typeof leaders === 'string' ? leaders === id : (leaders?.has(id) ?? false)

/**
 * Sprites from the atlas, redrawn every frame: `begin`, `place` each, `end`. Sprites are reused
 * between frames; ones not placed this frame are hidden.
 */
export class TokenLayer {
  readonly container = new Container()
  /** Nothing is placed until the atlas has loaded. */
  atlas: Atlas | undefined
  private sprites: Sprite[] = []
  private used = 0

  begin() {
    this.used = 0
  }

  /** One art file (`art.ts`) centred at a screen point, `size` pixels across, tinted. */
  place(file: string, x: number, y: number, size: number, tint = 0xffffff, alpha = 1) {
    const texture = this.atlas?.get(file)
    if (!texture) return
    let sprite = this.sprites[this.used]
    if (!sprite) {
      sprite = new Sprite({ texture, anchor: 0.5 })
      this.container.addChild(sprite)
      this.sprites.push(sprite)
    }
    this.used++
    sprite.texture = texture
    sprite.position.set(x, y)
    sprite.width = sprite.height = size
    sprite.tint = tint
    sprite.alpha = alpha
    sprite.visible = true
  }

  end() {
    for (let i = this.used; i < this.sprites.length; i++) this.sprites[i]!.visible = false
  }
}

/** Count badges: light pills with dark figures (ADR 0008). */
const BADGE_COLOR = 0xe8eef4
const BADGE_TEXT_COLOR = 0x0e1419
/** The font size badge text is rasterised at; each badge scales it to its own size. */
const BADGE_FONT = 32

/** Count badges over the tokens, redrawn every frame like `TokenLayer`; texts are reused. */
export class BadgeLayer {
  readonly container = new Container()
  private pills = new Graphics()
  private texts: Text[] = []
  private used = 0

  constructor() {
    this.container.addChild(this.pills)
  }

  begin() {
    this.used = 0
    this.pills.clear()
  }

  /** A pill with `label` centred at a screen point, its text `size` pixels high. */
  place(label: string, x: number, y: number, size: number) {
    let text = this.texts[this.used]
    if (!text) {
      text = new Text({
        text: label,
        anchor: 0.5,
        style: {
          fontFamily: THEME.font.ui,
          fontSize: BADGE_FONT,
          fontWeight: '700',
          fill: BADGE_TEXT_COLOR,
        },
      })
      this.container.addChild(text)
      this.texts.push(text)
    }
    this.used++
    if (text.text !== label) text.text = label
    text.scale.set(size / BADGE_FONT)
    text.position.set(x, y + size * 0.04)
    text.visible = true
    const h = size * 1.3
    const w = Math.max(h, text.width + size * 0.6)
    this.pills.roundRect(x - w / 2, y - h / 2, w, h, h / 2)
  }

  end() {
    this.pills.fill(BADGE_COLOR).stroke({ width: 1, color: BADGE_TEXT_COLOR, alpha: 0.6 })
    for (let i = this.used; i < this.texts.length; i++) this.texts[i]!.visible = false
  }
}
