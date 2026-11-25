import {
  CREW_FOOD,
  STARVE_DAYS,
  DOWN_DAYS,
  FEED_UNITS,
  NPC_REVIVE_REACH,
  WAKE_HEALTH,
  FOOD_SPOIL_PER_DAY,
  FOOD_SURPLUS_DAYS,
  GET_FOOD_AT,
  GET_FOOD_TAKE,
  HEAL_DAYS,
  HORSE_FOOD_PER_DAY,
  HUNGER_DAYS,
  HUNGER_ENDURANCE_EFFECT,
  HUNGER_ENDURANCE_LIMIT,
  MAX_HEALTH,
  NPC_NODE_REACH,
  OWN_FOOD,
  OUTPOST_REFILL_REACH,
  SET_OUT_WORK_DAYS,
} from '@csp/balance'
import {
  days,
  foodEatenPerDay,
  foodHalfLifeDays,
  num,
  outputPerDay,
  pct,
  residentsPerFarmer,
} from './wiki-view.js'

export function FoodSection() {
  return (
    <>
      <p>
        Residents eat only food they carry. An average resident eats {num(foodEatenPerDay())} Food a
        game day on plains; each point of Endurance above average needs{' '}
        {pct(HUNGER_ENDURANCE_EFFECT)} less (more below), at most {pct(HUNGER_ENDURANCE_LIMIT)}.
        They keep {num(OWN_FOOD)} Food of their own on them, and at home take a meal from the
        storage when they run low. A child at home doesn't wait to run low: whenever they have less
        than their own food, they take meals until they have it again, so a child leaving the city
        has {days(OWN_FOOD / foodEatenPerDay())} of food on them. Within {num(OUTPOST_REFILL_REACH)}{' '}
        tiles of an outpost storage of their realm they take it from there the same way, so a
        stocked outpost storage next to a far workplace keeps its workers fed.
      </p>
      <p>
        Far from home, a resident working, building or tearing down goes and gets food on their own.
        Below <code>foodAt</code> units of Food on them ({num(GET_FOOD_AT)} unless you set it on
        their card), they walk to their <code>food</code> storage, else their main storage (
        <code>storage</code> for Work, <code>source</code> for Build, Build line and Tear down),
        else the nearest one of your realm with Food, take Food up to <code>foodTake</code> (
        {num(GET_FOOD_TAKE)} unless set) and go back. Whenever they are at a storage anyway, their
        own food is topped up to <code>foodTake</code> instead of {num(OWN_FOOD)}. With{' '}
        <code>foodAt</code> set to 0 they don't go on their own and rely on refilling.
      </p>
      <p>
        A crew at a far workplace is fed by its carrier: the worker who carries a load to the
        storage brings back the Food the workplace's pile lacks of <code>crewFood</code> (
        {num(CREW_FOOD)} unless set), from their <code>food</code> storage, else their{' '}
        <code>storage</code>, else the nearest one with Food, and puts it on the pile, where the
        crew takes its meals, so nobody else leaves for Food while the pile holds some. A farm's
        pile keeps its own Food instead. <code>crewFood</code> 0 brings none. A resident an NPC city
        sends to a workplace sets out with Food for the walk there and back plus{' '}
        {days(SET_OUT_WORK_DAYS)} of work, not a fixed amount, so they last until the carrier's
        first round trip. Its builders of a site more than {num(NPC_NODE_REACH)} tiles from its
        storage take the same, and go back for more while they still have what the walk home eats;
        so do its workers at a workplace that far out.
      </p>
      <p>
        A full hunger meter lasts {days(HUNGER_DAYS)} without eating; an empty one costs all health
        in {days(STARVE_DAYS)}, so a resident without food goes <b>Down</b>{' '}
        {days(HUNGER_DAYS + STARVE_DAYS)} after their last meal. Fed again before that, they heal
        from nothing to full in {days(HEAL_DAYS)}.
      </p>
      <p>
        Down, a resident lies unconscious on their tile for {days(DOWN_DAYS)}: their order, script
        and queue end, they get off any horse or carriage and leave their army, take no orders,
        don't eat and lose no more health. Anyone in sight sees that they are Down: their token lies
        on its side, and their own Player's card says how long is left. Down is not safe: anyone on
        their tile can pick up what they carry, as from a pile (from another realm's resident that
        is theft), and a blow kills them, as they can't dodge. When the time is up they die of
        hunger. Only hunger puts a resident Down: wounds kill as before, and a Leader who is Down
        still leads. The realm log says when one goes Down, wakes or dies.
      </p>
      <p>
        <b>Reviving:</b> any grown resident of any realm on or next to a Down resident's tile can{' '}
        <b>Feed</b> them: the Feed row on their card (or on the Down resident's tile card), a queue
        step, or <code>feed(targetId, units)</code> in a script. It puts up to that many units of
        the Food in their own hands into the Down resident's ({num(FEED_UNITS)} unless set). One
        unit is eaten at once, and they wake idle with {num(WAKE_HEALTH)} of {num(MAX_HEALTH)}{' '}
        health, which comes back while their hunger meter isn't empty; the rest stays in their hands
        to eat later.
      </p>
      <p>
        NPC cities and the Trade Organization's cities revive their own: while one of their
        residents lies Down in their area or within {num(NPC_REVIVE_REACH)} tiles of it and their
        storage holds Food, one grown resident, never a soldier and a spare hand first, takes Food
        there and Feeds them, one for each resident Down. It comes ahead of building, road crews,
        scouts, work for surplus and what is short, but their farmers stay while Food is short.
      </p>
      <p>
        Food spoils: {pct(FOOD_SPOIL_PER_DAY)} of every stock goes bad each game day, half of it in{' '}
        {days(foodHalfLifeDays)}. A city has a food surplus when its storages hold more Food than
        its residents eat in {days(FOOD_SURPLUS_DAYS)}.
      </p>
      <p>
        <b>One average farmer feeds {num(residentsPerFarmer())} residents</b>, themselves included:
        a farmer makes {num(outputPerDay('food', 'farming'))} Food a game day. A horse eats{' '}
        {num(HORSE_FOOD_PER_DAY)} Food a game day.
      </p>
    </>
  )
}
