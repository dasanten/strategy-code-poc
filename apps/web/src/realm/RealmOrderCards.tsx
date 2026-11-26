import type { Building, Resident, ScriptSummary } from '@csp/shared-types'
import { groupResidents } from '../residents/residents-view.js'
import { mostNote, vehicleMost, vehicleSuggests } from '../transport/vehicle-orders.js'
import { doingLine } from '../residents/doing-view.js'
import { CardSheet, SelectionCard } from '../screen/SelectionCard.js'
import { BuildMenu } from '../building/BuildMenu.js'
import { WhoList } from './WhoList.js'
import { WHO_SUGGESTS } from './who-list-view.js'
import { realmRelocateChoices, relocateAt } from './realm-orders-view.js'
import { RealmRelocateCard, RealmScriptCard } from './RealmOrders.js'
import { useWorld } from '../world/useWorld.js'
import type { useRealmOrder } from './useRealmOrder.js'
import type { useKnownGround } from '../map/useKnownGround.js'
import type { SeenCity } from '@csp/shared-types'

/** The realm order's own cards (`RealmOrderCards`) and what they need of the game. */
interface RealmOrderCardsProps {
  realm: ReturnType<typeof useRealmOrder>
  world: NonNullable<ReturnType<typeof useWorld>['world']>
  own: Resident[]
  scripts: ScriptSummary[]
  knownCities: SeenCity[]
  knownBuildings: Building[]
  ground: Pick<
    ReturnType<typeof useKnownGround>,
    'nodeAt' | 'terrainAt' | 'arrivesIn' | 'realmBuildProblem'
  >
  /** The Residents tab's groups, which the who-list ticks by. */
  groups: ReturnType<typeof groupResidents<Resident>>
  /** A tile's card is open, which the realm order's cards give way to. */
  tileOpen: boolean
  /** The form before a script starts is open, over the Run script card. */
  formOpen: boolean
  sheet: { phone: boolean; dock: HTMLElement | null; hidden: boolean }
}

/**
 * The cards of a realm order being given (`CONTEXT.md`: Realm order, Who-list): the Build menu,
 * the Run script and Relocate cards, and the who-list.
 */
export function RealmOrderCards(props: RealmOrderCardsProps) {
  const { realm, world, own, scripts, knownCities, knownBuildings, ground } = props
  const { realmOrder, setRealmOrder, who, realmTile, realmWho, realmScriptOrder } = realm
  const { confirmRealmOrder, confirmPlace, confirmAbout, confirmVehicle } = realm
  const { nodeAt, terrainAt, arrivesIn, realmBuildProblem } = ground
  const { phone, dock, hidden: hideCard } = props.sheet
  return (
    <>
      {world && realmOrder?.step === 'menu' && !props.tileOpen && (
        <CardSheet phone={phone} dock={dock} pinnedPeek={false} hidden={hideCard}>
          <SelectionCard
            rel="own"
            title={realmOrder.at ? `Build at ${realmOrder.at.x}, ${realmOrder.at.y}` : 'Build'}
            lines={[
              realmOrder.at
                ? 'Pick what to build here, then who builds it.'
                : 'Pick what to build, then where it goes, then who builds it.',
            ]}
            onClose={() => setRealmOrder(undefined)}
          >
            <section className="inspector-block" aria-label="Build">
              {realmOrder.at ? (
                <BuildMenu
                  node={nodeAt?.(realmOrder.at.x, realmOrder.at.y)}
                  terrain={terrainAt?.(realmOrder.at.x, realmOrder.at.y)}
                  buildProblem={(kind, material) =>
                    realmBuildProblem(world, realmOrder.at!.x, realmOrder.at!.y, kind, material)
                  }
                  onBuild={(building, material) => {
                    const at = realmOrder.at!
                    realmTile(at.x, at.y, {
                      step: 'where',
                      building,
                      ...(material ? { material } : {}),
                    })
                  }}
                />
              ) : (
                <BuildMenu
                  node={undefined}
                  // Judged once the tile is picked.
                  buildProblem={() => undefined}
                  anywhere
                  onBuild={(building, material) =>
                    setRealmOrder({ step: 'where', building, ...(material ? { material } : {}) })
                  }
                />
              )}
            </section>
          </SelectionCard>
        </CardSheet>
      )}
      {world && realmOrder?.step === 'script' && !props.tileOpen && !props.formOpen && (
        <CardSheet phone={phone} dock={dock} pinnedPeek={false} hidden={hideCard}>
          <RealmScriptCard
            scripts={scripts}
            onRun={(scriptId) => realmScriptOrder({ kind: 'runScript', scriptId })}
            onClose={() => setRealmOrder(undefined)}
          />
        </CardSheet>
      )}
      {world && realmOrder?.step === 'relocate' && !props.tileOpen && (
        <CardSheet phone={phone} dock={dock} pinnedPeek={false} hidden={hideCard}>
          <RealmRelocateCard
            choices={realmRelocateChoices(
              { cities: knownCities, buildings: knownBuildings, residents: world.residents },
              world.home.realmId,
            )}
            onRelocate={(cityId) => {
              const seen = { cities: knownCities, buildings: knownBuildings }
              const city = knownCities.find((c) => c.id === cityId)
              realmWho(
                { kind: 'relocate', cityId },
                relocateAt(seen, cityId),
                city ? { city: city.name } : {},
              )
            }}
            onClose={() => setRealmOrder(undefined)}
          />
        </CardSheet>
      )}
      {world && who && realmOrder && !props.tileOpen && (
        <CardSheet phone={phone} dock={dock} pinnedPeek={false} hidden={hideCard}>
          <WhoList
            key={who.key}
            title={who.title}
            where={who.where}
            rows={who.rows}
            suggest={
              realmOrder.step === 'vehicle'
                ? vehicleSuggests(realmOrder.order)
                : WHO_SUGGESTS[who.order.kind]
            }
            // Shift on Confirm arms Build, a line and Walk to again (`confirmRealmOrder`, `confirmPlace`).
            armable={
              realmOrder.step === 'who' ||
              realmOrder.step === 'lineWho' ||
              (realmOrder.step === 'place' && realmOrder.order.kind === 'walkTo')
            }
            most={realmOrder.step === 'vehicle' ? vehicleMost(realmOrder.order) : undefined}
            mostNote={
              realmOrder.step === 'vehicle' ? (n) => mostNote(realmOrder.order, n) : undefined
            }
            doing={(id) => {
              const r = own.find((o) => o.id === id)
              return r
                ? doingLine(r, {
                    scripts,
                    buildings: world.buildings,
                    residents: world.residents,
                    horses: world.horses,
                    cities: knownCities,
                    arrives: arrivesIn?.(r),
                  })
                : ''
            }}
            groups={props.groups}
            tick={world.tick}
            onConfirm={(ids, after, again) =>
              void (realmOrder.step === 'vehicle'
                ? confirmVehicle(realmOrder, ids, after)
                : realmOrder.step === 'about'
                  ? confirmAbout(realmOrder.order, realmOrder.target, ids, after)
                  : realmOrder.step === 'place'
                    ? confirmPlace(realmOrder.order, ids, after, again)
                    : (who.order.kind === 'build' || who.order.kind === 'line') &&
                      confirmRealmOrder(who.order, ids, after, again))
            }
            onClose={() => setRealmOrder(undefined)}
          />
        </CardSheet>
      )}
    </>
  )
}
