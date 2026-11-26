import { useEffect } from 'react'
import { Icon } from '../ui/Icon.js'
import { AVERAGE_STATS, num } from './wiki-view.js'
import { Section } from './parts.js'
import { ControlsSection } from './controls.js'
import { QueuesSection } from './queues.js'
import { TimeSection } from './time.js'
import { LandSection } from './land.js'
import { WaypointsSection } from './waypoints.js'
import { ExploringSection } from './exploring.js'
import { TerrainSection } from './terrain.js'
import { ResidentsSection } from './residents.js'
import { TrainingSection } from './training.js'
import { FoodSection } from './food.js'
import { WorkSection } from './work.js'
import { ZealSection } from './zeal.js'
import { GatheringSection } from './gathering.js'
import { BuildingSection } from './building.js'
import { TransportSection } from './transport.js'
import { WaterSection } from './water.js'
import { HowToTradeSection } from './how-to-trade.js'
import { TradeSection } from './trade.js'
import { StandingSection } from './standing.js'
import { DemandsSection } from './demands.js'
import { CombatSection } from './combat.js'
import { SiegeSection } from './siege.js'
import { TerritorySection } from './territory.js'
import { LanguageSection } from './language.js'
import { ApiSection } from './api.js'
import { ParamsSection } from './params.js'
import { ScriptsSection } from './scripts.js'
import { ExamplesSection } from './examples.js'

/**
 * The Wiki's topics, in order, each a section with its own anchor (`/wiki#food`). A topic's text
 * is its own file, `wiki/<id>.tsx`.
 */
export const WIKI_TOPICS = [
  { id: 'controls', title: 'Controls', Body: ControlsSection },
  { id: 'queues', title: 'Queues', Body: QueuesSection },
  { id: 'time', title: 'Time & map', Body: TimeSection },
  { id: 'land', title: 'The land', Body: LandSection },
  { id: 'waypoints', title: 'Waypoints', Body: WaypointsSection },
  { id: 'exploring', title: 'Exploring', Body: ExploringSection },
  { id: 'terrain', title: 'Terrain & walking', Body: TerrainSection },
  { id: 'residents', title: 'Residents & stats', Body: ResidentsSection },
  { id: 'training', title: 'Training', Body: TrainingSection },
  { id: 'food', title: 'Food & hunger', Body: FoodSection },
  { id: 'work', title: 'Workplaces & output', Body: WorkSection },
  { id: 'zeal', title: 'Zeal & rallying the crew', Body: ZealSection },
  { id: 'gathering', title: 'Gathering by hand', Body: GatheringSection },
  { id: 'building', title: 'Building & tearing down', Body: BuildingSection },
  { id: 'transport', title: 'Carrying & transport', Body: TransportSection },
  { id: 'water', title: 'Water & havens', Body: WaterSection },
  { id: 'how-to-trade', title: 'How to trade', Body: HowToTradeSection },
  { id: 'trade', title: 'Trade & prices', Body: TradeSection },
  { id: 'standing', title: 'Standing & reactions', Body: StandingSection },
  { id: 'demands', title: 'Demands', Body: DemandsSection },
  { id: 'combat', title: 'Combat & walls', Body: CombatSection },
  { id: 'siege', title: 'Siege machines', Body: SiegeSection },
  { id: 'territory', title: 'Territory', Body: TerritorySection },
  { id: 'language', title: 'Script language', Body: LanguageSection },
  { id: 'api', title: 'Game API', Body: ApiSection },
  { id: 'params', title: 'Script parameters', Body: ParamsSection },
  { id: 'scripts', title: 'Scripting budgets', Body: ScriptsSection },
  { id: 'examples', title: 'Example scripts', Body: ExamplesSection },
] as const

/** The Wiki (`CONTEXT.md`: Wiki): the rules in plain words, with the game's current numbers. */
export function Wiki() {
  // The page renders after the browser looked for the anchor, so go to it once it is there.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])
  const avg = AVERAGE_STATS.strength
  return (
    <main className="wiki">
      {/* A grid: the header bar across the top, the Contents beside the sections on a wide
          screen and above them on a phone (`styles/wiki.css`). */}
      <header className="wiki-head bar">
        <Icon name="book" size={32} />
        <h1 className="px t22">Code Strategy Wiki</h1>
        <span className="grow" />
        <a className="btn dk" href="/">
          To the game
        </a>
      </header>
      <nav className="wiki-toc pn" aria-label="Contents">
        <div className="hd">Contents</div>
        <ol>
          {WIKI_TOPICS.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`}>{t.title}</a>
            </li>
          ))}
        </ol>
      </nav>
      <p className="wiki-intro">
        The game's rules in plain words, with its current numbers and what follows from them.
        Figures are for an average resident (every stat at {num(avg)}, no skills) unless they say
        otherwise. Times are game time first, real time after.
      </p>

      {WIKI_TOPICS.map(({ id, title, Body }) => (
        <Section key={id} id={id} title={title}>
          <Body />
        </Section>
      ))}
    </main>
  )
}
