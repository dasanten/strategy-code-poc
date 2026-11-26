import { useState } from 'react'

/** The city open in the Cities tab, and where in it Trade here scrolls to (`CONTEXT.md`: Cities tab). */
export function useOpenCity() {
  // The city picked on the map or opened in the Cities tab.
  const [openCityId, setOpenCityId] = useState<string>()
  // The warehouse or storage Trade here scrolls the open city to; a new object each press.
  const [tradeAt, setTradeAt] = useState<{ buildingId: string }>()
  return { openCityId, setOpenCityId, tradeAt, setTradeAt }
}
