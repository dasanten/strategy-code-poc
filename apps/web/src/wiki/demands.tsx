import {
  DIRECT_OFFER_DAYS,
  DEMANDS_PER_GAME_DAY,
  DEMAND_DECLINED_STANDING_LOSS,
  DEMAND_MAX_DAYS,
  DEMAND_NOTE_MAX_LENGTH,
  DEMAND_TRADE_ORG_STANDING_LOSS,
  DEMAND_YIELD_RESPECT_MIN,
  DEMAND_YIELD_RESPECT_TIMES,
  OUTWEIGH_HOLD_DAYS,
  NPC_DEMAND_OUTWEIGH_TIMES,
  NPC_DEMAND_MIN_STRENGTH,
  NPC_DEMAND_COINS,
  NPC_DEMAND_DAYS,
  NPC_DEMAND_AGAIN_DAYS,
  NPC_DEMAND_REFUSED_STANDING,
  NEW_REALM_SHELTER_DAYS,
} from '@csp/balance'
import { days, num } from './wiki-view.js'

export function DemandsSection() {
  return (
    <>
      <p>
        A demand tells another realm what you want and by when: <strong>a named city</strong> of
        theirs, or <strong>goods or Coins</strong>, with a note of at most{' '}
        {num(DEMAND_NOTE_MAX_LENGTH)} characters and a deadline of up to {days(DEMAND_MAX_DAYS)}.
        Open <strong>Demands</strong> in the Diplomacy tab to send one or to answer one. Scripts can
        too (<code>sendDemand</code>, <code>acceptDemand</code>, <code>declineDemand</code>,{' '}
        <code>demands</code>).
      </p>
      <ul>
        <li>
          You can send one to any realm you know of: one whose residents you see, an ally, one whose
          city you have seen, one with a standing toward you or you toward it, or your side in a
          contract, demand or Direct offer.
        </li>
        <li>
          It arrives at once, wherever they are, on their Demands tab and as a notice. A realm sends
          at most {num(DEMANDS_PER_GAME_DAY)} a game day, scripts included.
        </li>
        <li>
          They accept or decline it, or let it lapse at the deadline; it also lapses when either
          side's Leader dies. Both realm logs say what happened.
        </li>
        <li>
          <strong>Accepting a demand for a city hands it over at once.</strong> It joins the
          sender's realm as a captured city does: the residents who live there, its horses and
          carriages as <a href="#combat">capturing</a> takes them. A Leader who lived there stays in
          their realm, homeless. You can do this with your last city too. It is your own choice, so
          it is no crime and costs no standing. A city no longer yours can't be handed over: the
          demand stays until you decline it or it lapses.
        </li>
        <li>
          <strong>Accepting a demand for goods or Coins hands them over the way you pick.</strong>{' '}
          Set aside at a storage of yours, they wait for the sender alone to fetch in person,
          wanting nothing back, under their Direct offers, for up to {days(DIRECT_OFFER_DAYS)};
          fetching them is no trade and raises no standing. Sent by a Transfer, a caravan brings
          them from a city of yours to a city of theirs whose storage you see, one load at a time,
          and you pay the fee. If the storage is short it says so before you accept, and what it
          holds is what goes. With none of it there you can't accept that way.
        </li>
        <li>
          <strong>An NPC city weighs it at its planning passes</strong>, one each game hour. You can
          send one to any NPC city you have seen or have a standing with. It gives in once the
          strength of your fighters near it (Respect, under Standing) has come to at least{' '}
          {num(DEMAND_YIELD_RESPECT_TIMES)} times its own side, and at least{' '}
          {num(DEMAND_YIELD_RESPECT_MIN)}, for {days(OUTWEIGH_HOLD_DAYS)} without a break: a real
          army that stays at the gate wins a city without a fight, a crowd with spears or an army
          walking through doesn't. Until then it <strong>wavers</strong>, and the Demands tab shows
          how long is left; a planning pass on which your force doesn't outweigh it that far starts
          the time again from nothing. Your walls and fighters out of its sight don't count. It
          joins your realm as a persuaded city does, or sets what it holds of the goods aside at its
          storage for you alone to fetch. With none of your fighters near it declines at its next
          pass; it declines too when the deadline comes first, or with none of the goods there.
          Declining drops its standing toward you by {num(DEMAND_DECLINED_STANDING_LOSS)}.
        </li>
        <li>
          <strong>The Trade Organization always declines</strong>, within a game hour, and being
          asked costs you {num(DEMAND_TRADE_ORG_STANDING_LOSS)} of its standing. Everyone knows of
          it.
        </li>
        <li>
          <strong>A militarist NPC city sends demands too.</strong> Once a game day it sends one to
          each realm it knows of (one it feels threatened by, or one with a standing either way)
          whose armed residents, wherever they are, its own side outweighs at least{' '}
          {num(NPC_DEMAND_OUTWEIGH_TIMES)} times over, and by at least{' '}
          {num(NPC_DEMAND_MIN_STRENGTH)}: {num(NPC_DEMAND_COINS)} Coins within{' '}
          {days(NPC_DEMAND_DAYS)}, and the next no sooner than {days(NPC_DEMAND_AGAIN_DAYS)} later.
          It fetches nothing set aside: you pay by a Transfer from a city of yours to it, in sight
          or not. Paid, it no longer feels threatened by you and its standing toward you is back to
          neutral at least. Declined or let lapse, its standing toward you falls to{' '}
          {num(NPC_DEMAND_REFUSED_STANDING)}: it turns hostile. It never sends one to the Trade
          Organization.
        </li>
        <li>
          <strong>A new realm is sheltered</strong> for its first {days(NEW_REALM_SHELTER_DAYS)}: no
          NPC city sends it a demand or marches on it then. Players can.
        </li>
        <li>
          <strong>The threat is only words.</strong> Ignoring a demand does nothing by itself:
          whatever was threatened is the sender's to carry out, or not. The Trade Organization
          carries out what it threatens over a debt (see Standing & reactions).
        </li>
      </ul>
    </>
  )
}
