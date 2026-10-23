import {
  GOODS,
  TICKS_PER_GAME_DAY,
  buildingInfo,
  footprintTiles,
  materialsNeeded,
  workNeeded,
  type Building,
  type BuildingKind,
  type Good,
  type KnownNode,
  type ResourceKind,
  type SkillName,
  type Stock,
} from '@csp/shared'

/** The kind of node under a building's footprint, if the Player knows one there. */
export function buildingNodeKind(
  building: Building | undefined,
  nodeAt: ((x: number, y: number) => KnownNode | undefined) | undefined,
): ResourceKind | undefined {
  if (!building || !nodeAt) return undefined
  for (const [x, y] of footprintTiles(building)) {
    const node = nodeAt(x, y)
    if (node) return node.kind
  }
  return undefined
}

/** The names the ⓘ's lines use for goods and skills. */
export interface InfoLabels {
  goods: Record<Good, string>
  skills: Record<SkillName, string>
}

/** Goods in words, in the usual order: "40 stone, 20 wood". */
function goodsText(stock: Stock, labels: Record<Good, string>): string {
  return GOODS.filter((g) => (stock[g] ?? 0) > 0)
    .map((g) => `${stock[g]} ${labels[g].toLowerCase()}`)
    .join(', ')
}

/** Work in game days of one resident, rounded up to a tenth. */
function daysText(work: number): string {
  if (work <= 0) return 'no more work'
  const days = Math.ceil((work / TICKS_PER_GAME_DAY) * 10) / 10
  return `about ${days} game day${days === 1 ? '' : 's'} of one resident’s work`
}

/**
 * The lines of the ⓘ on a building's card (`CONTEXT.md`: Workplace, Footprint, Construction
 * site): what it is for, what it makes, the skill it teaches, up to how many work there, its
 * footprint, and what it takes to build. Given a construction site, the last line says what the
 * site still needs instead. `node` is the node a node's workplace stands on, if known.
 */
export function buildingInfoLines(
  kind: BuildingKind,
  labels: InfoLabels,
  { node, site }: { node?: ResourceKind; site?: Building } = {},
): string[] {
  const info = buildingInfo(kind, node)
  const good = (g: Good) => labels.goods[g].toLowerCase()
  const lines = [info.purpose]
  for (const r of info.recipes)
    lines.push(`${goodsText(r.input, labels.goods)} → ${goodsText(r.output, labels.goods)}`)
  if (info.yields.length > 0) {
    const yields = info.yields.map(good).join(' or ')
    lines.push(kind === 'farm' ? `Makes ${yields}` : `Makes ${yields}, from its node`)
  }
  if (info.skill) lines.push(`Teaches ${labels.skills[info.skill]}`)
  if (info.maxWorkers !== undefined) lines.push(`Up to ${info.maxWorkers} workers`)
  lines.push(`Footprint ${info.footprint} × ${info.footprint} tiles`)
  if (site?.site) {
    const missing = goodsText(materialsNeeded(site), labels.goods)
    lines.push(`Still needs ${missing || 'no more materials'} and ${daysText(workNeeded(site))}`)
  } else if (info.work > 0) {
    // A storage or warehouse costs nothing: the game puts it there, nobody builds one.
    const materials = goodsText(info.materials, labels.goods)
    lines.push(`Built from ${materials || 'no materials'} and ${daysText(info.work)}`)
  }
  return lines
}
