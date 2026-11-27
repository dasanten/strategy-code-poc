import { CentredDialog } from './Hud.js'
import { RealmEnded } from '../realm/Founding.js'
import { realmEnded } from '../realm/realm-log.js'

import type { ClientWorld } from '../world/useWorld.js'
import { type Notices } from './useNotices.js'
import { type Live } from './game-wiring.js'

/**
 * The dialogs over the game: the game updated, the heir's takeover (`CONTEXT.md`: Leader death
 * with an heir), and the realm's end.
 */
export function GameDialogs({
  world,
  status,
  notices,
  showOnMap,
}: {
  world: ClientWorld | null
  status: Live['status']
  notices: Pick<Notices, 'takeover' | 'putTakeoverAway'>
  showOnMap: (x: number, y: number) => void
}) {
  const { takeover, putTakeoverAway } = notices
  return (
    <>
      {status === 'updated' && (
        <CentredDialog title="The game was updated" tone="news">
          <p>A new version of the game is out. Reload the page to play on.</p>
          <div className="hud-dialog-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </CentredDialog>
      )}
      {takeover && (
        <CentredDialog title="Your heir has taken over" tone="bad">
          <p>
            Your Leader has died. {takeover.heir} is your Leader now and leads your realm on from{' '}
            {takeover.city}, under its name, with its standing, contracts and alliance.
            {takeover.cities.length > 0 &&
              ` Your other ${takeover.cities.length === 1 ? 'city is' : 'cities are'} self-managed now and hold you in good standing.`}{' '}
            The realm log says what became of each. Name a new heir to be safe again.
          </p>
          <div className="hud-dialog-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                putTakeoverAway()
                showOnMap(takeover.x, takeover.y)
              }}
            >
              Play on
            </button>
          </div>
        </CentredDialog>
      )}
      {world && realmEnded(world.events) && <RealmEnded />}
    </>
  )
}
