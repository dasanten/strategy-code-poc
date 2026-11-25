import {
  ALLIANCE_LEAVE_DELAY,
  ALLIANCE_RECALL_DELAY,
  COMBAT_SKILL_LIMIT,
  CRIME_MEMORY_DAYS,
  FORMER_PLAYER_STANDING,
  CARRIAGE_STOLEN_WORTH,
  HORSE_STOLEN_WORTH,
  OCCUPATION_GAME_DAYS,
  NPC_ALLIANCE_JOIN_STANDING,
  NPC_ALLIANCE_LEAVE_STANDING,
  NPC_CITY_REFUSES_STANDING,
  NPC_CITY_WONT_SELL_STANDING,
  NPC_ACTING_FIRST,
  PERSUADE_ASK_AGAIN_DAYS,
  PERSUADE_STANDING,
  STANDING_CONTRACT_BROKEN_LOSS,
  STANDING_DRIFT_PER_DAY,
  STANDING_PER_PAID_WEEK,
  TRADE_ORG_DEBT_DEMAND_DAYS,
  TRADE_ORG_DEBT_TRIPS,
  WORKPLACE_WRECK_WORTH,
  RESPECT_PER_WALL,
  THREAT_SEEN_PER_DAY,
  THREAT_PER_KILLING,
  THREAT_PER_ROBBERY,
  THREAT_HALF_LIFE_DAYS,
  THREAT_FORGOTTEN,
  DANGER_PLACE_MERGE_RANGE,
  DANGER_PLACE_HALF_LIFE_DAYS,
  DANGER_PLACE_WAY_REACH,
  DANGER_ESCORTS_MAX,
  OUTWEIGH_HOLD_DAYS,
  STANDING_RANGE,
  STANDING_NPC_TRADE_COINS_PER_POINT,
  STANDING_TRADE_COINS_PER_POINT,
  TRADE_ORG_LOSS,
  TRADE_ORG_PUNISH,
  TRADE_ORG_PUNISHES_BELOW,
  TRADE_ORG_REFUSES_TRADE_BELOW,
  NPC_HUNT_REACH,
  NPC_HUNTERS_PER_THIEF,
} from '@csp/balance'
import type { BuildingKind, CrimeKind } from '@csp/shared-types'
import { fighterStrength } from '../shared/persuasion.js'
import { BUILDING_NAMES } from '../map/palette.js'
import { Table } from './parts.js'
import { COMBAT_SKILL_MAX, crimeForgotten, days, num, realSeconds, signed } from './wiki-view.js'

/** An untrained fighter with a spear and a fully trained, armoured one, as respect weighs them. */
const UNTRAINED_SPEAR = { carried: { spear: 1 }, skills: {} }

const TRAINED_AND_ARMOURED = {
  carried: { sword: 1, shield: 1, armour: 1 },
  skills: { combat: COMBAT_SKILL_MAX },
}

const CRIME_NAMES: Record<CrimeKind, string> = {
  theft: 'Theft',
  attack: 'Attack',
  tearDown: 'Tearing down a building',
  killing: 'Killing',
  capture: 'Capturing a trading post',
}

export function StandingSection() {
  return (
    <>
      <p>
        Standing runs from {signed(-STANDING_RANGE)} to {signed(STANDING_RANGE)}. A known crime
        lowers the victim's standing toward the culprit; standing drifts back toward neutral by{' '}
        {num(STANDING_DRIFT_PER_DAY)} a game day. A crime is remembered for{' '}
        {days(CRIME_MEMORY_DAYS)} after the news stops spreading. Taking from or tearing down
        another realm's outpost storage counts the same as its city storage, and taking what another
        realm's Down resident carries is theft too. So is driving off in another's carriage (see
        Transport): one theft, worth {num(CARRIAGE_STOLEN_WORTH)} coins for the carriage,{' '}
        {num(HORSE_STOLEN_WORTH)} for its horse, and the load. So is mounting another's horse or
        hitching it (see Riding): one theft, worth {num(HORSE_STOLEN_WORTH)} coins. A carriage
        driven off with a horse of a different owner is a theft from each. Taking back what was
        stolen from you is theft like any other. In your own city's area, force against someone
        occupying its town hall or a thief you know of is no crime (see Under attack).
      </p>
      <p>
        An NPC city goes after those who steal from it. Once one of its residents saw the theft, or
        the news reached it, it sends up to {num(NPC_HUNTERS_PER_THIEF)} soldiers after the thief
        while they are within {num(NPC_HUNT_REACH)} tiles of its home: only soldiers beyond those
        holding its town hall and its gates go. They strike the thief down, which is no crime, take
        what was stolen from where the thief fell and carry it into the city's storage. A thief who
        gets further off is let go, and the soldiers go back to their posts.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Crime</th>
            <th>Standing lost</th>
            <th>Forgotten after</th>
          </tr>
        </thead>
        <tbody>
          {crimeForgotten().map((c) => (
            <tr key={c.crime}>
              <td>{CRIME_NAMES[c.crime]}</td>
              <td>{signed(-c.loss)}</td>
              <td>{days(c.days)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        Trade raises it too: a point for every {num(STANDING_NPC_TRADE_COINS_PER_POINT)} coins with
        an NPC city, every {num(STANDING_TRADE_COINS_PER_POINT)} with the Trade Organization or
        another realm. To stay level against the drift takes{' '}
        {num(STANDING_DRIFT_PER_DAY * STANDING_NPC_TRADE_COINS_PER_POINT)} coins of trade a game day
        with an NPC city.
      </p>
      <p>
        Each paid week of a mercenary contract raises standing by {num(STANDING_PER_PAID_WEEK)} both
        ways; an unpaid week breaks it and costs {num(STANDING_CONTRACT_BROKEN_LOSS)}.
      </p>
      <h3>Thresholds</h3>
      <ul>
        <li>
          Below {signed(NPC_CITY_REFUSES_STANDING)} an NPC city won't trade or hire out to you and
          keeps its gates shut to you; below {signed(NPC_CITY_WONT_SELL_STANDING)} it won't sell
          itself to you.
        </li>
        <li>
          At {signed(PERSUADE_STANDING)}, and once your fighters near it have outweighed its own
          side for {days(OUTWEIGH_HOLD_DAYS)} without a break (Respect, below), an NPC city asks to
          join you; declined, it asks again after {days(PERSUADE_ASK_AGAIN_DAYS)}.
        </li>
        <li>
          An NPC city joins an alliance when it holds every member at{' '}
          {signed(NPC_ALLIANCE_JOIN_STANDING)} or better, and leaves when any falls below{' '}
          {signed(NPC_ALLIANCE_LEAVE_STANDING)}.
        </li>
        <li>
          An NPC city also seeks allies on its own: once it feels a threat of{' '}
          {num(NPC_ACTING_FIRST.allyThreat)} from one Organization, it invites into an alliance it
          leads, founding one if it has none, the realms in no alliance it holds at{' '}
          {signed(NPC_ALLIANCE_JOIN_STANDING)} or better (never the one it fears), and the NPC
          cities that feel threatened by the same Organization and hold it that well too.
        </li>
        <li>
          Below {signed(TRADE_ORG_REFUSES_TRADE_BELOW)} the Trade Organization won't trade with you;
          below {signed(TRADE_ORG_PUNISHES_BELOW)} its army (up to {num(TRADE_ORG_PUNISH.soldiers)}{' '}
          soldiers) comes to take {num(TRADE_ORG_PUNISH.times)} times what it lost. It walks to your
          city however far that is and gives up {days(TRADE_ORG_PUNISH.giveUpDays)} after it
          arrives; it looks in your storages when it arrives, so emptying them in time works, though
          you still see it come. It turns back on the road if the city stops being yours. Its
          soldiers pack Food at the HQ for the way there and back, keeping{' '}
          {num(TRADE_ORG_PUNISH.packRoom)} kg free for what they carry home; they refill at trading
          posts they pass and may take Food from your storage for the way back, apart from what they
          came to take. On the road they keep together. A supply wagon follows them, when the HQ has
          someone free to drive it: a Trade Org carriage with Food for the trip, always with{' '}
          {num(TRADE_ORG_PUNISH.wagonRoom)} kg free for what they take, which they put on it and it
          brings home to the warehouses. Taking from it or stealing it is a crime, its soldiers go
          after whoever does, and without it they go on with what they carry. Each soldier also
          packs {num(TRADE_ORG_PUNISH.purse)} Coins: short of Food on the road, with the wagon's
          share counted, they buy some within {num(TRADE_ORG_PUNISH.postReach)} tiles of them, by
          the same trade as anyone, from a trading post, an NPC city that doesn't refuse the Trade
          Organization, or a Player's Food offer of at most {num(TRADE_ORG_PUNISH.offerFoodPrice)}{' '}
          Coins a unit. They don't buy from you if you are the one they are after, and none of this
          counts as what they came to take. Your realm log says when it is coming, when it arrives,
          what it left with, why it turned back, or that it was lost. Besides stolen goods,
          carriages and horses it counts{' '}
          {(Object.entries(TRADE_ORG_LOSS) as [CrimeKind, number][])
            .map(([c, n]) => `${CRIME_NAMES[c].toLowerCase()} as ${num(n)} coins`)
            .join(', ')}
          .
        </li>
        <li>
          What its army came for and couldn't take stays your debt, from when it heads home or is
          lost, whatever the reason; an army sent by admin directive leaves none. While you owe, a
          crime it learns of adds what it cost to the debt instead of sending another army. Your
          realm log says what you owe, and "Cities in sight" shows it. A resident on any Trade Org
          warehouse's tile can pay it in coins, from their hands or a carriage there, in part or in
          full, even if it refuses to trade with you. The debt ends with the fall of its HQ.
        </li>
        <li>
          Once you owe, it sends you a <strong>demand</strong> for the debt, once for each debt,
          with a deadline {days(TRADE_ORG_DEBT_DEMAND_DAYS)} away. The demand always asks for what
          you owe now, and paying in full at a warehouse ends it. Accept and its caravan comes for
          what you set aside at a storage in a city, for no fee, or you send it by a Transfer to its
          nearest warehouse and pay the fee; what they bring in comes off the debt. Decline it or
          let it lapse and its next step starts at once: its next army comes for your workplaces.
          What accepting leaves owed starts that at the deadline.
        </li>
        <li>
          Its next army then goes to that city and tears down its workplaces, one after the other,
          the same way anyone can. Each comes off the debt for its worth (
          {(Object.entries(WORKPLACE_WRECK_WORTH) as [BuildingKind, number][])
            .sort((a, b) => a[1] - b[1])
            .map(([k, n]) => `${BUILDING_NAMES[k].toLowerCase()} ${num(n)} coins`)
            .join(', ')}
          ) until it is covered or none are left, and your realm log reports each one. The
          workplaces of a city are the farms laid out for it and those its residents work, not one
          nobody of it works or one someone else works. Its soldiers fight those who attack them,
          and it goes home after, with the debt still owed if that didn't cover it, and comes again.
          Pay in full at a warehouse while it is there and it stops and goes home.
        </li>
        <li>
          After {num(TRADE_ORG_DEBT_TRIPS)} such armies have reached a city, with the debt still
          owed, its next army comes to <strong>take the city</strong>. It holds the town hall as
          anyone would, for {days(OCCUPATION_GAME_DAYS)} without a break, and fights whoever is
          armed on the hall or attacks it. When the time is up the city joins the Trade Organization
          as a new trading post and all you owe is settled. Its storages become warehouses with what
          is in them, with prices and a stock floor, but its Food goes into a new storage near the
          town hall. Its people stay as the post's, your Leader staying in your realm, homeless, and
          it gets a caravan and joins the wandering traders' loops. Pay in full at a warehouse
          before that and the army goes home. Capturing that post later goes like any post's
          capture.
        </li>
        <li>
          A trading post you took is a debt too, once it has heard who took it: it adds the post's
          worth, {num(TRADE_ORG_LOSS.capture)} coins, to what you owe, sends no army of its own for
          it, and <strong>demands the city back</strong>, with a deadline{' '}
          {days(TRADE_ORG_DEBT_DEMAND_DAYS)} away. Accept and the city is a trading post again at
          once, with those who live there, its horses and carriages, its warehouse with all it holds
          and a caravan of its own, and the post's worth comes off your debt; anything else you owe
          stays owed. Decline it or let it lapse and your debt goes up its steps like any other.
          Paying all you owe at a warehouse ends this demand too, and you keep the city.
        </li>
        <li>
          A city whose Leader died starts out holding its former Player at{' '}
          {signed(FORMER_PLAYER_STANDING)}, and so does one that left a realm whose heir took over,
          toward that realm.
        </li>
      </ul>
      <p>
        Leaving an alliance takes {realSeconds(ALLIANCE_LEAVE_DELAY)}; soldiers recalled from its
        army are back under their owner's command after {realSeconds(ALLIANCE_RECALL_DELAY)}.
      </p>
      <h3>Respect</h3>
      <p>
        What an NPC city weighs when you demand it or it thinks of joining you. On your side only
        your armed residents count, and only while they stand in its City area or in sight of one of
        its people who is at home there: what its scouts and traders see far away doesn't count, nor
        do your walls, nor residents it lent you. Each counts by strength, as combat weighs them:
        their best weapon's blow, harder with Combat skill (up to {num(1 + COMBAT_SKILL_LIMIT)}{' '}
        times), plus what their shield and armour take off a blow. An untrained resident with a
        spear counts {num(fighterStrength(UNTRAINED_SPEAR))}; one with a sword, shield and armour
        and full Combat skill counts {num(fighterStrength(TRAINED_AND_ARMOURED))}. On its side count
        its soldiers, weighed the same way, and {num(RESPECT_PER_WALL)} for each of its own finished
        wall and gate tiles. It weighs this at its planning pass, once a game hour, and remembers
        since when each realm has outweighed it; the first pass one doesn't, that time starts again
        from nothing.
      </p>
      <h3>Threat</h3>
      <p>
        Apart from how it regards you, an NPC city keeps in mind how dangerous you are: its{' '}
        <strong>threat</strong> from each Organization, a strong friendly neighbour too. At its
        planning pass it adds what your armed residents weigh, by strength as respect weighs them,
        wherever it sees them: in its City area or in sight of any of its people, also its traders
        and scouts far from home. Standing a game day in sight adds {num(THREAT_SEEN_PER_DAY)} for
        each point of strength. Learning that you killed one of its people adds{' '}
        {num(THREAT_PER_KILLING)}, that you robbed it {num(THREAT_PER_ROBBERY)}. Threat fades to
        half every {days(THREAT_HALF_LIFE_DAYS)} and is forgotten below {num(THREAT_FORGOTTEN)}. You
        don't see it.
      </p>
      <p>
        It also remembers <strong>danger places</strong>: where one of its people was killed outside
        its City area, by anyone, bandits too. Another loss within {num(DANGER_PLACE_MERGE_RANGE)}{' '}
        tiles adds to the same place. A danger place fades to half every{' '}
        {days(DANGER_PLACE_HALF_LIFE_DAYS)}. While it remembers one within{' '}
        {num(DANGER_PLACE_WAY_REACH)} tiles of a way, the city sends a soldier more along that way
        for each person lost there, up to {num(DANGER_ESCORTS_MAX)} more.
      </p>
    </>
  )
}
