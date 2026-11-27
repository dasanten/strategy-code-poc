import { KEEPS_GOODS } from '../building/building.js'
import type { Account, Resident } from '@csp/shared-types'
import { carriagePulledBy, carriageOfResident } from '../transport/carriages.js'
import { horseOfResident, riderOf } from '../transport/horse-rules.js'
import { isDown } from '../world/world.js'
import { driveOffProblems, hitchOffProblems, mountOffProblems } from '../world/world-rules.js'
import { isWallOrGate } from '../building/walls.js'
import { showsCreativeBar } from '../creative/creative-bar.js'
import { CreativeResidentActions } from '../creative/CreativeResidents.js'
import { targetParam } from '@csp/lang-wasm'
import { PASSENGER_WEIGHT } from '@csp/balance'
import { besideVessel, vesselOfResident, vesselRoom } from '../transport/vessels.js'
import { storeAll } from '../queue/queue-view.js'
import { InsertPointContext } from '../queue/step-palette-view.js'
import { nextPick } from '../queue/plan-step.js'
import { ResidentCard } from './Residents.js'
import { CardSheet } from '../screen/SelectionCard.js'
import { barBesideTile } from '../screen/dock-view.js'
import { hitchChoice, makeLeaderProblem, nameHeirProblem } from '../screen/selection-view.js'
import { relocateActionProblem, relocateChoices } from './relocate-view.js'
import { ScriptLog } from '../script/ScriptLog.js'
import { ScriptParamFields } from '../script/ScriptParams.js'
import { paramValueLabel } from '../script/script-params-view.js'
import { loadKnown } from './seen.js'
import { paramWorld, targetOnTile } from '../world/seen-world.js'

import { type ResidentOrders } from './useResidentOrders.js'
import { workersHere, heldBy, type WhatsHere } from './whats-here.js'
import {
  leadership,
  type GameSeen,
  type Sheet,
  type Live,
  type Picker,
  type SelectionState,
  type Ground,
  type Planning,
  type Workshop,
  type ResidentPanels,
} from '../screen/game-wiring.js'

interface ResidentCardSheetProps {
  seen: GameSeen
  account: Account
  /** The one resident picked. */
  selected: Resident
  /** The command bar beside an open tile card (`barBesideTile`). */
  besideTile: ReturnType<typeof barBesideTile>
  sheet: Sheet
  setSelectedIds: SelectionState['setSelectedIds']
  picker: Picker
  ground: Ground
  /** What is on or beside their tile (`whatsHere`). */
  here: WhatsHere
  orders: ResidentOrders
  planning: Planning
  workshop: Workshop
  panels: ResidentPanels
  /** The script logs the server sends of the residents watched (`useWorld`). */
  live: Pick<Live, 'scriptLogs' | 'watchScript'>
}

/** The picked resident's card in the command bar (`CONTEXT.md`: Resident card), with its orders. */
export function ResidentCardSheet(props: ResidentCardSheetProps) {
  const { world, own, scripts, knownCities, phone } = props.seen
  const { account, selected, besideTile, setSelectedIds, picker, here } = props
  const { hidden: hideCard } = props.sheet
  const { arrivesIn, buildProblemAt, nodeAt, terrainAt } = props.ground
  const { onTile, isStrangers, ownCarriageHere, stealableHere, unhorsedHere, horseToHitch } = here
  const { looseStrangers, boatToRow, boatToSteal, buildingHere, roadHere, carriageSiteHere } = here
  const { giveOrder, orderError, setOrderError, carry, build, work, tearDown } = props.orders
  const { breed, feedStable, train, explore, gather, teach, runScript, setDefenceScript } =
    props.orders
  const { setAlarmScript, setScriptParam, rally, stop, pair, relocate, makeLeader } = props.orders
  const { nameHeir, clearHeir, rename, attack, feed, equip, ride, boardCarriage, unhitch } =
    props.orders
  const { hitch, climb } = props.orders
  const { insertFor, queueOf, addStep } = props.planning
  const { openScript, scriptRunInfo, scriptMemoryTree } = props.workshop
  const { cardSections, onCardSections } = props.panels
  const { scriptLogs, watchScript } = props.live
  const { leader, heirId, heirName } = leadership(world)
  const pick = picker.target
  const plan = picker.plan.plan
  // A step picking a city keeps the card open: it lists the realm's cities to pick from too.
  const picksCity = plan !== undefined && nextPick(plan)?.pick === 'city'
  /**
   * The cities to relocate them to and why they can't be told to at all, if they can't
   * (`CONTEXT.md`: Relocate), from what the Player knows.
   */
  function relocateFor(r: Resident) {
    if (r.owner !== world.home.realmId) return undefined
    const seen = {
      cities: knownCities,
      buildings: props.seen.knownBuildings,
      residents: world.residents,
    }
    const choices = relocateChoices(seen, world.home.realmId, r)
    return { choices, problem: relocateActionProblem(r, choices) }
  }
  return (
    <CardSheet
      phone={phone}
      pinnedPeek={pick !== undefined && pick.kind !== 'army'}
      bar
      keysOff={!besideTile.keys}
      hidden={hideCard}
    >
      <InsertPointContext.Provider value={insertFor(selected.id)}>
        <ResidentCard
          key={selected.id}
          resident={selected}
          creative={
            showsCreativeBar(account) && (
              <CreativeResidentActions
                resident={selected}
                tick={world.tick}
                move={{
                  picking: picker.resident.mode === 'creativeMove',
                  onPick: () => picker.resident.toggle('creativeMove'),
                }}
              />
            )
          }
          arrivesIn={arrivesIn || undefined}
          leaderId={world.home.leaderId}
          cities={knownCities}
          tick={world.tick}
          picking={picker.resident.mode}
          onWalkTo={() => picker.resident.toggle('walk')}
          carriage={
            onTile(world.carriages.filter(loadKnown).filter((k) => !isStrangers(k))) ??
            onTile(world.carriages.filter(loadKnown))
          }
          boat={world.vessels.find(
            (v) =>
              vesselOfResident(v, selected) &&
              selected.aboard !== v.id &&
              besideVessel(v, selected, world.map.size, world.buildings),
          )}
          carriageTheirs={!ownCarriageHere && !!stealableHere}
          onDriveTo={() => picker.resident.toggle('drive')}
          {...(stealableHere && {
            driveOff: {
              problem: driveOffProblems([selected.id], stealableHere.id, world.home.realmId)[0],
            },
            onDriveOff: () => picker.resident.toggle('driveOff'),
          })}
          {...(unhorsedHere &&
            horseToHitch && {
              hitchOff: {
                problem: hitchOffProblems(
                  [selected.id],
                  unhorsedHere.id,
                  world.home.realmId,
                  horseToHitch,
                )[0],
              },
              onHitchOff: () => picker.resident.toggle('hitchOff'),
            })}
          {...(looseStrangers && {
            stealHorse: {
              problem: mountOffProblems([selected.id], looseStrangers.id, world.home.realmId)[0],
            },
            onStealHorse: () =>
              void giveOrder(
                { kind: 'mount', residentId: selected.id, horseId: looseStrangers.id },
                false,
              ).then(setOrderError),
          })}
          onRoadTo={() => picker.resident.toggle('roadFrom')}
          onWallTo={() => picker.resident.toggle('wallFrom')}
          onHaulTo={picker.resident.toggleHaul}
          onStop={stop}
          onRally={rally}
          zeal={world.zeal}
          horseToRide={onTile(
            world.horses.filter(
              (h) =>
                horseOfResident(h, selected) &&
                !carriagePulledBy(world, h) &&
                !riderOf(world, h) &&
                !isDown(h),
            ),
          )}
          onRide={ride}
          carriageToBoard={onTile(world.carriages.filter((k) => carriageOfResident(k, selected)))}
          boatToBoard={world.vessels.find(
            (v) =>
              vesselOfResident(v, selected) &&
              besideVessel(v, selected, world.map.size, world.buildings) &&
              // A ship with no room left still takes crew (`CONTEXT.md`: Crew).
              (v.kind === 'ship' || (vesselRoom(v) ?? PASSENGER_WEIGHT) >= PASSENGER_WEIGHT - 1e-9),
          )}
          onBoard={(id, asCrew) => void boardCarriage(id, undefined, asCrew)}
          {...(boatToRow ? { boatToRow } : {})}
          onRowTo={() => picker.resident.toggle('row')}
          {...(boatToSteal && {
            rowOff: { problem: boatToSteal.problem },
            onRowOff: () => picker.resident.toggle('rowOff'),
          })}
          carriageToUnhitch={onTile(
            world.carriages.filter((k) => carriageOfResident(k, selected) && k.horseId),
          )}
          onUnhitch={unhitch}
          toHitch={hitchChoice(world, selected)}
          onHitch={hitch}
          scripts={scripts}
          buildings={world.buildings}
          lastSeen={world.lastSeen.buildings}
          waypoints={world.waypoints}
          onRunScript={runScript}
          onSetDefenceScript={setDefenceScript}
          onSetAlarmScript={setAlarmScript}
          onEditScript={(id) => openScript(id)}
          orderError={orderError}
          pile={world.piles.find(
            (p) => p.x === (buildingHere ?? selected).x && p.y === (buildingHere ?? selected).y,
          )}
          storage={
            buildingHere && KEEPS_GOODS.includes(buildingHere.kind) && !buildingHere.site
              ? buildingHere
              : undefined
          }
          building={buildingHere}
          road={roadHere}
          terrain={terrainAt?.(selected.x, selected.y)}
          carriageSite={carriageSiteHere}
          node={nodeAt?.(selected.x, selected.y)}
          onPickUp={(spot, goods) => carry('pickUp', spot, goods)}
          onLoad={async (vesselId, goods, unload) =>
            setOrderError(
              await giveOrder({
                kind: 'load',
                residentId: selected.id,
                vesselId,
                goods,
                unload,
              }),
            )
          }
          onDrop={(spot, goods) => carry('drop', spot, goods)}
          onBuild={build}
          buildProblem={buildProblemAt(world, selected.x, selected.y)}
          workers={workersHere(world.residents, buildingHere)}
          holders={heldBy(world.residents, buildingHere)}
          realmId={world.home.realmId}
          onWork={work}
          onFeedStable={feedStable}
          onTrain={train}
          onExplore={explore}
          onGather={gather}
          onTeach={teach}
          onTearDown={tearDown}
          horses={world.horses}
          onBreed={breed}
          residents={own}
          onPair={pair}
          others={world.residents.filter((r) => !own.some((o) => o.id === r.id))}
          mapSize={world.map.size}
          onAttack={attack}
          onFeed={(targetId, units) => void feed(targetId, units)}
          onEquip={(slot, good) => void equip(slot, good)}
          walls={world.buildings.filter(
            (b) =>
              isWallOrGate(b) &&
              world.cities.find((c) => c.id === b.cityId)?.realmId !== world.home.realmId,
          )}
          onClimb={climb}
          makeLeader={(() => {
            if (selected.owner !== world.home.realmId || selected.id === world.home.leaderId) {
              return undefined
            }
            const realm = { id: world.home.realmId, leaderId: world.home.leaderId }
            return {
              problem: makeLeaderProblem(world.diplomacy, realm, selected.id),
              heir: {
                problem: nameHeirProblem(world.diplomacy, realm, selected.id),
                named: selected.id === heirId,
              },
            }
          })()}
          leaderName={leader?.name}
          onMakeLeader={makeLeader}
          heirName={heirId !== selected.id ? heirName : undefined}
          onNameHeir={() => void nameHeir()}
          onClearHeir={() => void clearHeir()}
          relocate={relocateFor(selected)}
          onRelocate={relocate}
          rename={
            selected.owner === world.home.realmId
              ? {
                  needsRealmName:
                    selected.id === world.home.leaderId && world.home.realmName === null,
                }
              : undefined
          }
          onRename={rename}
          sections={cardSections}
          onSections={onCardSections}
          scriptParams={
            selected.script && (
              <ScriptParamFields
                params={scripts.find((s) => s.id === selected.script!.scriptId)?.params ?? []}
                // As seen: the values picked for the script they run come with it.
                values={world.residents.find((r) => r.id === selected.id)?.script?.params ?? {}}
                // Working by a workplace's settings, what they don't override reads its values.
                workplace={(() => {
                  const from = world.residents.find((r) => r.id === selected.id)?.script
                    ?.settingsFrom
                  return from === undefined ? undefined : (world.workSettings[from]?.params ?? {})
                })()}
                label={(id) => paramValueLabel(paramWorld(world), id)}
                target={targetParam(scripts.find((s) => s.id === selected.script!.scriptId) ?? {})}
                onTile={targetOnTile(
                  world,
                  scripts.find((s) => s.id === selected.script!.scriptId),
                  selected,
                )}
                waypoints={world.waypoints}
                picking={picker.param.name}
                onPick={picker.param.toggle}
                onNumber={(name, value) => void setScriptParam(name, { value })}
                onChoose={(p, value) =>
                  void setScriptParam(p.name, p.type === 'choice' ? { value } : { targetId: value })
                }
                onClear={(name) => void setScriptParam(name, { targetId: null })}
              />
            )
          }
          scriptRun={selected.script && scriptRunInfo(selected.id, selected.script.scriptId)}
          scriptMemory={selected.script && scriptMemoryTree(selected.id)}
          scriptLog={
            <ScriptLog id={selected.id} lines={scriptLogs.get(selected.id)} watch={watchScript} />
          }
          onStore={async () =>
            setOrderError(
              await giveOrder({ ...storeAll(selected, world.tick), residentId: selected.id }),
            )
          }
          {...queueOf(selected)}
          addStep={addStep(world)}
          onClose={() => {
            setSelectedIds([])
            picker.cardClosed()
          }}
          collapsed={pick !== undefined && pick.kind !== 'army' && !picksCity}
        />
      </InsertPointContext.Provider>
    </CardSheet>
  )
}
