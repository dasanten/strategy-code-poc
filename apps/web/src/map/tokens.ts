import { Container, Sprite } from 'pixi.js'
import type { City, ResourceKind } from '@csp/shared'
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

/** The viewer: the Player's realm and the realms in their alliance. */
export interface Viewer {
  realmId: string
  allies: ReadonlySet<string>
}

/**
 * How the viewer stands to a city and what belongs to it: a Trade Organization city, an NPC city
 * (no realm), the viewer's own, an alliance member's or another realm's. Undefined for no city.
 */
export function cityRelationship(
  city: Pick<City, 'realmId' | 'tradeOrg'> | undefined,
  viewer: Viewer,
): Relationship | undefined {
  if (!city) return undefined
  if (city.tradeOrg) return 'trade'
  if (city.realmId === null) return 'npc'
  if (city.realmId === viewer.realmId) return 'own'
  return viewer.allies.has(city.realmId) ? 'alliance' : 'other'
}

export const relationshipColor = (rel: Relationship | undefined) =>
  rel ? RELATIONSHIP_COLORS[rel] : UNOWNED_COLOR

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
