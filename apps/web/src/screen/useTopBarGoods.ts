import type { SeenCity } from '@csp/shared-types'
import { useState } from 'react'
import {
  goodsOldText,
  goodsPickCities,
  goodsPickOf,
  keyGoods,
  rememberGoodsPick,
  rememberedGoodsPick,
  type GoodsPick,
} from './hud-view.js'

import type { ClientWorld } from '../world/useWorld.js'

/**
 * The goods in the top bar (`CONTEXT.md`: Goods in the top bar): their totals in the cities
 * picked, and the pick, kept per browser.
 */
export function useTopBarGoods(world: ClientWorld | null, knownCities: SeenCity[]) {
  // The goods in the top bar (`CONTEXT.md`: Goods in the top bar). The pick stays remembered while
  // its city is lost, as a city just out of sight can be missing from what the Player knows.
  const [goodsPicked, setGoodsPicked] = useState(() => rememberedGoodsPick())
  const goods = (() => {
    if (!world) return undefined
    const cities = goodsPickCities(knownCities, world.home.realmId)
    const pick = goodsPickOf(goodsPicked, cities)
    const onPick = (next: GoodsPick) => {
      setGoodsPicked(next)
      rememberGoodsPick(next)
    }
    const seen = {
      buildings: world.buildings,
      lastSeen: world.lastSeen.buildings,
      cities: knownCities,
    }
    const { totals, old } = keyGoods(seen, world.home.realmId, pick)
    return { totals, oldText: goodsOldText(old, world.tick), cities, pick, onPick }
  })()
  return goods
}
