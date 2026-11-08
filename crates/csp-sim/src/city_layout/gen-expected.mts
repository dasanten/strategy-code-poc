// Writes expected.json from the frozen TypeScript. Run from the repo root:
//   apps/server/node_modules/.bin/tsx --conditions=source crates/csp-sim/src/city_layout/gen-expected.mts \
//     crates/csp-sim/src/city_layout/expected.json
// For the village and the HQ fixture worlds, each layout and three gate plans: what the plan says
// of every tile within `R` of the home (street, spot and rank for some kinds, spill), and the
// streets the city owes.
import { readFileSync, writeFileSync } from 'node:fs'
import {
  CITY_LAYOUTS,
  type BuildingKind,
  type WorldState,
} from '../../../../packages/shared/src/index.ts'
import { layoutPlan, streetsOwed } from '../../../../apps/server/src/city-layout.ts'
import { npcHome } from '../../../../apps/server/src/npc-behaviour.ts'

const R = 16
const KINDS: BuildingKind[] = ['house', 'storage', 'stable']
const GATES = [undefined, { dx: 0, dy: 15 }, { dx: -14, dy: 2 }, { dx: 9, dy: -13 }]

const revive = (_: string, v: unknown) =>
  v && typeof v === 'object' && '$number' in v ? Number((v as { $number: string }).$number) : v

const out = ['village-0', 'hq-0'].flatMap((name) => {
  const file = JSON.parse(
    readFileSync(`crates/csp-sim/fixtures/worlds/${name}.json`, 'utf8'),
    revive,
  )
  const terrain = {
    size: file.terrain.size,
    tiles: new Uint8Array(Buffer.from(file.terrain.tiles, 'base64')),
  }
  const world = file.world as WorldState
  const city = world.cities[0]!
  const home = npcHome(world, city)!
  return CITY_LAYOUTS.flatMap((layout) =>
    GATES.map((gate) => {
      city.layout = layout
      const plan = layoutPlan(world, city, home, gate, terrain.size)!
      const rows = (f: (x: number, y: number) => string) => {
        const lines: string[] = []
        for (let dy = -R; dy <= R; dy++) {
          let line = ''
          for (let dx = -R; dx <= R; dx++) {
            const x = (((home.x + dx) % terrain.size) + terrain.size) % terrain.size
            const y = (((home.y + dy) % terrain.size) + terrain.size) % terrain.size
            line += f(x, y)
          }
          lines.push(line)
        }
        return lines
      }
      const bit = (b: boolean) => (b ? '1' : '0')
      return {
        name,
        layout,
        gate: gate ?? null,
        home: home.id,
        street: rows((x, y) => bit(plan.street(x, y))),
        spots: Object.fromEntries(KINDS.map((k) => [k, rows((x, y) => bit(plan.spot(k, x, y)))])),
        rank: plan.rank ? rows((x, y) => `${plan.rank!('house', x, y)},`) : null,
        spill: plan.spill
          ? Object.fromEntries(KINDS.map((k) => [k, rows((x, y) => bit(plan.spill!(k, x, y)))]))
          : null,
        streets: streetsOwed(world, city, home, gate, terrain),
      }
    }),
  )
})
writeFileSync(process.argv[2], JSON.stringify(out))
