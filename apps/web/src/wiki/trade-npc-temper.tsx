import {
  CITY_PRICE_BY_BUILDING,
  CITY_PRICE_PER_RESIDENT,
  CITY_PRICE_STANDING_SWING,
  CONTRACT_MAX_DAYS,
  NPC_PATROLS_MAX,
  NPC_PATROL_ROAD_STOPS,
  NPC_PATROL_WALL_STOPS,
  NPC_POST_AROUND_HALL,
  NPC_SOLDIERS_AT_GATE,
  NPC_SOLDIERS_ON_HALL,
  NPC_SOLDIERS_PER_PATROL,
  NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT,
  NPC_STANCE,
  NPC_ACTING_FIRST,
  NPC_RETALIATE,
  NPC_GATE_WATCH_RANGE,
  NPC_SOLDIER_SHARE,
  NPC_TRADE,
  STANDING_NPC_TRADE_COINS_PER_POINT,
  STANDING_TRADE_COINS_PER_POINT,
  TRADE_ORG_ARMY,
  NPC_NODE_GUARD_RANGE,
  NPC_TAKE_OUTWEIGH_TIMES,
  NPC_TAKE_PARTY_MIN,
  NPC_SITE_ESCORTS,
} from '@csp/balance'
import type { BuildingKind } from '@csp/shared-types'
import { kindName } from './names.js'
import { days, num, pct, signed } from './wiki-view.js'

/** The trade topic, continued: what an NPC city does and why (apart for its length). */
export function TradeNpcTemperPart() {
  return (
    <>
      <h3>What drives an NPC city</h3>
      <p>
        An NPC city is more than its needs. It has a <b>temperament</b>, fixed for good, which leans
        it one way; it feels <b>threat</b> from those it sees armed nearby and from those who killed
        or robbed its people, and remembers where it lost them; and each game day it takes a{' '}
        <b>stance</b> from both: growing, arming, trading, settling further out, or turning on
        whoever hurt it. The stance decides what it builds and how many soldiers it keeps, its
        threat how far it sends its traders and where its workers go, and its temperament which
        stance it reaches for first. Below, each in turn; Threat is under Standing & reactions.
      </p>
      <h3>Temperament</h3>
      <p>
        Every NPC city has a temperament, fixed when it comes to be: merchant, militarist or
        settler. A self-managed city gets one when its Leader dies, unless it had one before. A
        daughter takes its mother's {pct(NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT)} of the time and
        otherwise draws one of its own, which may still be the same. Whoever sees a city reads its
        temperament on its card, and keeps it in Last seen; whoever has traded with it reads it in
        the Standing list while they hold a standing with each other. Scripts see the same. Trading
        posts and the HQ have none. On its own a temperament changes nothing: it tilts the city's
        stance.
      </p>
      <h3>Stance</h3>
      <p>
        What an NPC city is after for now. It picks again at its first planning pass of each game
        day, from what it needs: <b>Fortify</b> by the threat it feels from the one it fears most,
        fully at {num(NPC_STANCE.fortifyThreat)}; <b>Trade</b> with a Food surplus and a Trade
        Organization warehouse within its traders' reach; <b>Expand</b> with a Food surplus and
        nothing short. Trade and Expand alone are worth {pct(NPC_STANCE.tradeNeed)} and{' '}
        {pct(NPC_STANCE.expandNeed)} of what it takes. Its temperament's own stance (merchant Trade,
        militarist Fortify, settler Expand) counts {num(NPC_STANCE.temperamentTilt)} times; the
        greatest need that is full wins, and it grows (<b>Grow</b>) when none is.
      </p>
      <ul>
        <li>
          <b>Fortify</b> keeps {num(NPC_STANCE.fortifySoldiers)} times the soldiers it keeps by its
          size, sends {num(NPC_STANCE.fortifyEscorts)} more with each escort, shuts its gates to
          armed outsiders {num(NPC_STANCE.fortifyGateWatch)} times as far off, and weighs the danger
          places by the way to a workplace {num(NPC_STANCE.fortifyDanger)} times as much.
        </li>
        <li>
          <b>Trade</b> works for surplus only up to {pct(NPC_STANCE.tradeSurplusCap)} of its caps,
          so more goes to market, and has {num(NPC_STANCE.tradeTraders)} more trader out.
        </li>
        <li>
          <b>Expand</b> waits {pct(NPC_STANCE.expandFullDays)} of the days full before it founds and
          sends {num(NPC_STANCE.expandScouts)} times the scouts.
        </li>
      </ul>
      <p>
        <b>Taking a node.</b> An NPC city short of a good it has no workplace for builds on the
        nearest free node of it that it knows. In Expand, when that node lies out of its City area,{' '}
        {num(NPC_SITE_ESCORTS)} of its soldiers beyond its hall and gate posts go along and stand at
        the site until the workplace is built. A militarist city in Expand that knows no free node
        of the good goes for the nearest workplace on one that a realm holds, in no city: the
        realm's residents within {num(NPC_NODE_GUARD_RANGE)} tiles of it hold it. It goes only when
        the soldiers it can spare are at least {num(NPC_TAKE_OUTWEIGH_TIMES)} times as strong as the
        armed ones there, and never fewer than {num(NPC_TAKE_PARTY_MIN)}. They strike everyone of
        that realm there, an attack like any other and a crime against it, until none is left up;
        then the workplace is the city's and its own workers move in (Holding a workplace). It never
        goes for the node of a realm in its shelter (Demands).
      </p>
      <p>
        Whoever sees an NPC city reads its stance on its card as a mood line: growing, arming, busy
        trading, looking to expand, or retaliating against whom. Scripts see it as the city's
        stance.
      </p>
      <h3>Retaliating</h3>
      <p>
        An NPC city turns on a realm (<b>Retaliate</b>) once it feels a threat of{' '}
        {num(NPC_RETALIATE.threat)} from it and knows of a recent crime of theirs against it, such
        as its traders killed. It arms as under Fortify and sends that realm demands for Coins.
        Rarely it marches: with a threat of {num(NPC_RETALIATE.marchThreat)}, its standing toward
        them at {signed(NPC_RETALIATE.marchStanding)} or below, and its soldiers beyond its hall and
        gate posts {num(NPC_RETALIATE.marchOutweigh)} times as strong as the defenders of their
        nearest city, those soldiers walk to that city's town hall and occupy it. Held to the end,
        the city leaves the realm and goes on as an NPC city of its own. Never against a realm in
        its shelter.
      </p>
      <p>
        It ends when its threat from them fades below {num(NPC_RETALIATE.endsBelow)} (a paid demand
        clears it at once) or its losses leave it weaker than them. Then it turns to Fortify, and a
        march under way is called off: its soldiers walk home.
      </p>
      <p>
        An NPC city sells only what it holds above this reserve and buys only what it is short of.
        It lends residents at {num(NPC_TRADE.pricePerResidentWeek)} coins each a game week, but only
        its spare hands: those its plan has idle, on a road crew, scouting or working for surplus.
        Its farmers, those working for a good short of its reserve and its builders stay, and so do{' '}
        {pct(NPC_TRADE.defenceShare)} of its adults at home, its soldiers among them. They take
        weapons and armour along only from what its storages hold above its reserve; with none spare
        they come unarmed. It lends nobody while it weighs a demand, while its town hall is
        occupied, or while your armed residents stand in its City area or in sight of it. Those it
        lends never act against it: they refuse an order to attack its residents, walls or gates, to
        climb, ram or throw at its walls or to tear down its buildings, whether you give it by hand, in a queue, to a
        group or an army or from a script, and they can't occupy its town hall nor count as your
        fighters toward it. Struck by one of its own, they still defend themselves. The Trade
        Organization hires out soldiers at {num(TRADE_ORG_ARMY.pricePerSoldierWeek)} coins each a
        game week. A contract runs at most {days(CONTRACT_MAX_DAYS)}. An NPC city hires too, on its
        own: once it feels a threat of {num(NPC_ACTING_FIRST.hireThreat)} from one Organization, it
        asks the Trade Organization for up to {num(NPC_ACTING_FIRST.hireSoldiers)} soldiers for{' '}
        {days(NPC_ACTING_FIRST.hireDays)}, if its storages hold the whole price, and pays each week
        from them. They stand at its town hall and fight attackers in its City area. They set out
        with the Food for the walk there and back from a storage of their own city, and in its City
        area they eat from its storage as at home.
      </p>
      <p>
        An NPC city shuts its gates while anyone armed who isn't of the city or its alliance stands
        within {num(NPC_GATE_WATCH_RANGE)} tiles of one, and opens them once nobody does. The Trade
        Organization's army doesn't count, so its soldiers can walk in and buy, unless the city
        refuses the Trade Organization or the army has come for that city. Any other armed outsider
        near still shuts the gates, on the soldiers too.
      </p>
      <p>
        The soldiers of an NPC village, town or self-managed city run the same Alarm default as your
        armed residents do (see Alarms): they go after a thief they saw, an attacker and whoever
        occupies the town hall, as no crime, and walk to the town hall to hold it while an armed
        outsider is in the area, then go back to their posts. An unarmed visitor they leave alone,
        and striking anyone else there is a crime for them too. One who gets armed or comes home
        while the hall is occupied joins in. Trading posts and the HQ keep their own rules: their
        soldiers go straight at attackers and occupiers in the area, a post's at thieves it knows of
        as well.
      </p>
      <p>
        Between fights those soldiers stand spread out, each on the post their id gives them among
        those the city has: first {num(NPC_SOLDIERS_ON_HALL)} on the town hall, where one is enough
        to stop anyone occupying it, then {num(NPC_SOLDIERS_AT_GATE)} at each gate, and the rest up
        on the walk of its wall, on the tiles they can get up to; they stay up between fights, and
        coming down for another post takes the time again. A city with too little wall for them, or
        none, has them stand on the free ground within {num(NPC_POST_AROUND_HALL)} tiles of its hall
        as well. They eat where they stand. If those on the hall or at a gate are called away or
        die, the next soldiers take over at the city's next planning pass, and they come back once
        the alarm is over. In a big city with a training ground some train in turns (
        <a href="#training">Training</a>). Trading posts and the HQ don't do this.
      </p>
      <p>
        The soldiers it keeps by its size ({pct(NPC_SOLDIER_SHARE)} of its adults) are all it keeps
        in peace. Anyone else armed, such as a smith carrying the smithy’s spears to the storage,
        stands down: they put their weapons, armour and Arrows into its storage and go back to work,
        those on a round, escorting, training or on alarm last. Soldiers just standing on a post
        count as standing idle; those on a round, escorting or training don’t.
      </p>
      <p>
        Of the soldiers on its wall {pct(1 / NPC_SOLDIERS_PER_PATROL)} walk a round, and never more
        than {num(NPC_PATROLS_MAX)} in a city however big: {num(NPC_PATROL_WALL_STOPS)} stops along
        its wall, {num(NPC_PATROL_ROAD_STOPS)} along its roads inside it, and back to where they set
        out. When a round ends the next by id goes, so those on the wall take turns; those on the
        hall and at the gates stay put. They refill as they walk, and one low on Food with none to
        take goes back to their post. A stop they can't get to they skip. An alarm breaks a round
        off, and they go on with it once the alarm is over.
      </p>
      <p>
        Bought outright, an NPC city asks {num(CITY_PRICE_PER_RESIDENT)} coins a resident plus, for
        its buildings:{' '}
        {(Object.entries(CITY_PRICE_BY_BUILDING) as [BuildingKind, number][])
          .map(([k, c]) => `${kindName(k).toLowerCase()} ${num(c)}`)
          .join(', ')}
        . Standing moves that price by up to {pct(CITY_PRICE_STANDING_SWING)} either way: cheaper
        the better it holds you.
      </p>
      <p>
        Trade raises standing by a point, both ways, for every{' '}
        {num(STANDING_NPC_TRADE_COINS_PER_POINT)} coins with an NPC city and every{' '}
        {num(STANDING_TRADE_COINS_PER_POINT)} with the Trade Organization or another realm. A swap
        counts both its sale and its purchase, and so does an accepted offer of goods for goods. The
        trade section shows your standing there and how far your last trade moved it, and the realm
        log says so for each trade.
      </p>
    </>
  )
}
