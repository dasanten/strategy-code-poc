import { THEME } from './theme.js'
import type { Good } from '@csp/shared-types'
import { GoodIcon } from './GoodsGrid.js'
import { GOOD_LABELS } from './goods-grid.js'
import { Icon } from './Icon.js'
import { PIXEL_GOOD } from '../map/pixel-art.js'
import { UI_ICONS, type UiIconName } from './ui-icons.js'

/** The relationship colours (ADR 0008, 0044), each with its token's class. */
const RELATIONSHIPS: [string, string, string, UiIconName][] = [
  ['', 'Yours', 'gold', 'person'],
  ['al', 'Alliance', 'sky', 'person'],
  ['ot', 'Another realm', 'red', 'person'],
  ['np', 'NPC city', 'fog', 'person'],
  ['tr', 'Trade Organization', 'cyan', 'cart'],
]

/**
 * The pixel kit's page (`/kit`, ADR 0044): every atom of `styles/kit.css` laid out as the design's
 * `System` artboard does, so a screen can be built and reviewed against it. Nothing here plays.
 */
export function Kit() {
  return (
    <main className="kit-page">
      <section className="pn kit-wide">
        <div className="hd">
          <span className="grow">Pixel frontier</span>
          <span className="small">hard 2 px edges · no rounded corners · no blur · EDG32</span>
        </div>
        <div className="sec fx wrap">
          {Object.entries(THEME.palette).map(([name, colour]) => (
            <span key={name} className="col kit-swatch">
              <span className="sw" style={{ background: colour }} />
              <span className="mono small">{name}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="pn">
        <h2 className="hd">Type</h2>
        <div className="sec">
          <span className="px t28">Realm of Ashford</span>
          <span className="mu">Pixelify Sans 600 · names, panel titles, big numbers</span>
          <span className="t18 b">Building a house: fetching 10 wood</span>
          <span>IBM Plex Sans 13 / 1.4 · everything a Player reads or presses.</span>
          <span className="mono t16">12 / 30 kg · 2231, 1712 · 14:20</span>
          <span className="mu">IBM Plex Mono · amounts, tiles, clocks, keys and scripts</span>
          <span className="lb">Section label</span>
          <span>
            <span className="ok">ok</span> · <span className="bad">bad</span> ·{' '}
            <span className="accent">yours</span>
          </span>
        </div>
      </section>

      <section className="pn">
        <h2 className="hd">Controls</h2>
        <div className="sec">
          <div className="fx wrap">
            <button type="button" className="btn">
              Order<span className="k">W</span>
            </button>
            <button type="button" className="btn pri">
              Confirm
            </button>
            <button type="button" className="btn gold">
              Claim
            </button>
            <button type="button" className="btn dng">
              Attack
            </button>
            <button type="button" className="btn dk">
              On dark bars
            </button>
          </div>
          <div className="fx wrap">
            <button type="button" className="btn on">
              Pressed
            </button>
            <button type="button" className="btn off why" disabled>
              Mount horse<small>no free horse here</small>
            </button>
            <button type="button" className="btn sm">
              Small
            </button>
            <button type="button" className="btn sq" aria-label="Icon button">
              <Icon name="settings" />
            </button>
            <button type="button" className="btn lg">
              Phone · 44 px
            </button>
          </div>
          <div className="og og2">
            <button type="button" className="btn sm fill">
              Walk to<span className="k">W</span>
            </button>
            <button type="button" className="btn sm fill">
              Stop<span className="k">S</span>
            </button>
          </div>
          <div className="fx wrap">
            <input className="in" defaultValue="Text field" aria-label="Text field" />
            <select className="in" aria-label="Select">
              <option>Pick a city…</option>
            </select>
            <label className="fx">
              <input type="checkbox" defaultChecked /> Loop
            </label>
            <span className="cb" aria-hidden="true" />
          </div>
          <label className="fld">
            Field with its label
            <input className="in" aria-label="Field" />
          </label>
          <div className="tabs" role="tablist" aria-label="Tabs">
            <button type="button" className="tab on" role="tab" aria-selected="true">
              Orders
            </button>
            <button type="button" className="tab" role="tab" aria-selected="false">
              Queue
            </button>
            <button type="button" className="tab" role="tab" aria-selected="false">
              Stats
            </button>
          </div>
          <span className="mu">
            A greyed order keeps its slot and says why. Every order shows its key.
          </span>
        </div>
      </section>

      <section className="pn">
        <h2 className="hd">Meters, chips, rows</h2>
        <div className="sec">
          {(
            [
              ['Health', 'hp', '92%', '46 / 50'],
              ['Hunger', 'fd', '62%', '62% fed'],
              ['Work', '', '38%', 'about 14 min'],
              ['Foal', 'bl', '55%', '1 h'],
            ] as const
          ).map(([label, kind, width, value]) => (
            <div key={label} className="fx">
              <span className="lb kit-label">{label}</span>
              <span className={`mt grow ${kind}`}>
                <i style={{ width }} />
              </span>
              <span className="mono">{value}</span>
            </div>
          ))}
          <div className="chips">
            <span className="chip">neutral</span>
            <span className="chip y">Leader</span>
            <span className="chip g">live</span>
            <span className="chip r">offline</span>
            <span className="chip bl">ally</span>
            <span className="chip d">last seen</span>
            <span className="badge rel-alliance">ally</span>
          </div>
          <div className="well">
            <div className="rw grp">
              <span className="lb grow">Group heading</span>
              <span className="mono">8</span>
            </div>
            <div className="rw">
              <span className="dot rel-own" />
              <span className="grow">A row</span>
            </div>
            <div className="rw sel">
              <span className="grow b">The picked row</span>
            </div>
          </div>
          <table className="tb">
            <thead>
              <tr>
                <th>Good</th>
                <th className="n">Price</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Wood</td>
                <td className="n">4</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="pn kit-wide">
        <h2 className="hd">Icons</h2>
        <div className="sec kit-icons">
          {(Object.keys(UI_ICONS) as UiIconName[]).map((name) => (
            <span key={name} className="col kit-icon">
              <Icon name={name} size={32} />
              {name}
            </span>
          ))}
        </div>
        <div className="sec kit-icons">
          {(Object.keys(PIXEL_GOOD) as Good[]).map((good) => (
            <span key={good} className="col kit-icon">
              <GoodIcon good={good} />
              {GOOD_LABELS[good]}
            </span>
          ))}
        </div>
      </section>

      <section className="pn">
        <h2 className="hd">Relationship colours</h2>
        <div className="sec">
          {RELATIONSHIPS.map(([kind, label, colour, icon]) => (
            <div key={label} className="fx">
              <span className={`tk ${kind}`}>
                <Icon name={icon} />
              </span>
              <span className="grow b">{label}</span>
              <span className="mono mu">{colour}</span>
            </div>
          ))}
          <span className="tag">Ashford</span>
          <span className="mu">Still no enemy colour: there is no war state, only standing.</span>
        </div>
      </section>

      <section className="pn">
        <h2 className="hd">Bars and code</h2>
        <div className="sec">
          <div className="bar fx kit-bar">
            <span className="b">Ashford</span>
            <span className="mu">day 12</span>
            <span className="spacer" />
            <button type="button" className="btn sm dk">
              Wiki
            </button>
            <span className="cnt">4</span>
          </div>
          <pre className="code">
            <span className="ln">1</span>
            <span className="kw">if</span> me.hunger {'<'} <span className="n">20</span>:{' '}
            <span className="c"># eat first</span>
            {'\n'}
            <span className="ln">2</span>
            {'  '}me.say(<span className="s">"food"</span>)
          </pre>
        </div>
      </section>
    </main>
  )
}
