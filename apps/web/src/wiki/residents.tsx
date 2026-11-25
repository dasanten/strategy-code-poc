import {
  ADULT_AGE,
  CARRYING_DAYS,
  PAIRING_WAIT_DAYS,
  DRIFTER_REALM_CAP,
  DRIFTER_WAIT_DAYS,
  DRIFTER_DISTANCE_MIN,
  DRIFTER_DISTANCE_MAX,
  DRIFTER_FOOD,
  CHILD_STAT_SPREAD,
  CHILD_YEAR_DAYS,
  DECLINE_AGE,
  DECLINE_FLOOR,
  DECLINE_PER_YEAR,
  FORMER_PLAYER_STANDING,
  HOUSING_ROOM,
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  MAX_HEALTH,
  OWN_FOOD,
  STAT_BASE_MAX,
  STAT_BASE_MIN,
  TRAINED_CAP_SHARE,
  WORK_SKILL_EFFECT,
  WORK_SKILL_MAX,
} from '@csp/balance'
import { days, daysToWorkSkillMax, num, pct, signed } from './wiki-view.js'

export function ResidentsSection() {
  return (
    <>
      <p>
        Every resident has four stats: Strength (carrying, work output, building, blows), Endurance
        (food needed, hard terrain), Agility (walking, dodging) and Intellect (how fast they learn).
        A stat is its base value, from {num(STAT_BASE_MIN)} to {num(STAT_BASE_MAX)} for residents
        nobody passed theirs on to, plus a trained bonus of at most {pct(TRAINED_CAP_SHARE)} of the
        base. A child's base stats are the parents' average, give or take up to{' '}
        {num(CHILD_STAT_SPREAD)}.
      </p>
      <p>
        Skills are learned by doing and never inherited. Work skills and Construction run up to{' '}
        {num(WORK_SKILL_MAX)} points; each point adds {pct(WORK_SKILL_EFFECT)} to output, so a
        master does twice what a beginner does. An average learner gets there after{' '}
        {days(daysToWorkSkillMax)} of work; Intellect speeds learning in proportion (twice the
        Intellect, twice as fast).
      </p>
      <p>
        A pair has one child: once {days(PAIRING_WAIT_DAYS)} have passed since they paired, and
        their city has free housing and a food surplus, one partner carries the child for{' '}
        {days(CARRYING_DAYS)} and doesn't work meanwhile; for another child, pair them again.
        Children age faster: each year up to {num(ADULT_AGE)} takes {days(CHILD_YEAR_DAYS)}, so a
        child is grown after {days(ADULT_AGE * CHILD_YEAR_DAYS)}. From then on a year of age is a
        game year. Until grown, a child walks but doesn't work, build, tear down, drive or pair, and
        of all goods handles only Food: they pick it up, put it down, fetch and store it like
        anyone, so they can carry their meals. At home a child tops up to their own {num(OWN_FOOD)}{' '}
        Food from the storage, so they leave the city with food on them. Stats decline from age{' '}
        {num(DECLINE_AGE)} by {pct(DECLINE_PER_YEAR)} a year, never below {pct(DECLINE_FLOOR)};
        residents die of old age between {num(LIFESPAN_MIN)} and {num(LIFESPAN_MAX)}. A house holds{' '}
        {num(HOUSING_ROOM.house ?? 0)} residents (a site holds nobody yet), and a city's free
        housing is the room of its houses minus its residents. Health runs up to {num(MAX_HEALTH)}.
      </p>
      <p>
        <b>Drifters.</b> A small realm draws newcomers on its own. While your realm has fewer than{' '}
        {num(DRIFTER_REALM_CAP)} residents, your Leader lives, and the city your Leader lives in has
        free housing and a food surplus, a grown drifter sets out for that city every{' '}
        {days(DRIFTER_WAIT_DAYS)}, one at a time; the wait counts only while all of that holds.
        Founding more cities brings no more drifters, and NPC cities, trading posts and the HQ draw
        none. A drifter comes into being out of every Player’s sight, {num(DRIFTER_DISTANCE_MIN)} to{' '}
        {num(DRIFTER_DISTANCE_MAX)} tiles from the town hall, with stats and an age like a starting
        city’s residents and {num(DRIFTER_FOOD)} Food for the walk, and walks in. On the way they
        belong to nobody: they take no orders, and whatever is done to them is no crime. Stepping
        into the city’s area they join it and your realm, standing idle, and your realm log names
        them. If by then the city has no free housing, is no longer yours, or your realm has reached
        the cap, they turn round and are gone once nobody sees them. Residents on their way (a
        drifter, those relocating, children being carried) count toward the free housing and the
        cap. The town hall of your Leader’s city says when the next drifter comes, or why none does.
      </p>
      <p>
        <b>Names.</b> A name the game gives a resident, in a starting city, at birth or when they
        join your realm, is one no living resident of that realm has (an NPC city counts as a realm
        of its own); a name it gives a city is one no city in the world has. Once its list of names
        runs dry it adds a numeral, as in “Edda II”. Renaming is free: you can rename any resident
        or city of your realm, and your names may repeat. Names from before this rule stay as they
        were, so where a list holds two residents of one name it adds their age, and their city when
        they live in different ones.
      </p>
      <p>
        A resident lives in one city, wherever they stand. One who lives in none is <b>homeless</b>:
        their town hall was torn down, or they were away when their city changed hands. A homeless
        resident has no home to refill at and can't pair.
      </p>
      <p>
        Your <b>heir</b> is the one resident you name to carry your realm on. Name them from their
        card (<strong>Leader and heir…</strong>, then <strong>Name heir</strong>) or from a script
        with <code>nameHeir(residentId)</code>; it is free, at once and from anywhere. Who
        qualifies: an adult of your realm who lives in one of its cities, isn't your Leader and
        serves no one else (no mercenary contract or offer naming them, not in the alliance army),
        the same residents a Leader handover allows, but they need not stand by your Leader. You
        have one heir: naming another replaces the first, and <strong>Clear heir</strong> or{' '}
        <code>clearHeir()</code> leaves you with none. The top bar shows your heir, or “No heir” to
        pick one; their card and the Residents list mark them. Only you and your allies see who it
        is. The heir lapses, with a line in your realm log, when they die, leave your realm (their
        city changes hands, or they are handed over), become homeless, are lent out or handed to the
        alliance army, or become your Leader by a handover; then name another.
      </p>
      <p>
        <b>When your Leader dies</b> and you have a living heir (one who is Down counts), the heir
        is your Leader at once and you play on: your realm keeps its name, standing, contracts,
        alliance, scripts and realm log. But it keeps only the city your heir lives in, with its
        residents wherever they stand (those away keep their orders) and everything in it, and the
        horses, carriages and boats nearer it than any other of your cities; outpost storages stay
        yours. Every other city becomes a <b>self-managed city</b> with its residents and the horses
        and carriages nearest it, holding you in good standing at {signed(FORMER_PLAYER_STANDING)};
        its soldiers lent out or in the alliance army walk home. Your realm then has no heir until
        you name one. Your realm log and a notice say who took over and what became of each city.
      </p>
      <p>
        Without a living heir, or when your heir dies in the same tick as your Leader, your realm
        ends: every city becomes self-managed, your contracts end, you leave your alliance, and you
        start afresh with a new Leader and starting city on your next login. So naming an heir, and
        keeping them safe in a city other than your Leader's, is what keeps a lost Leader from
        costing you everything.
      </p>
      <p>
        <b>Relocate</b> moves any resident of your realm, your Leader, children and homeless ones
        too, to another of your cities: pick it on their card. They walk there and become its
        resident on stepping into its area, at once if they are already in it. You can give the
        order only while the city has free housing for them, counting residents already relocating
        there, so the picker shows each city's free housing and greys out a full one. When they
        arrive the city must still have free housing and still be yours; if not, they stop, keep
        their old city and your realm log says why. Moving ends a pair, as a pair needs one city. A
        partner carrying a child can't relocate until it is born; the other partner can, and the
        child is still born. NPC cities don't relocate anyone. A group relocates from the group
        card, all of them or none: the city needs free housing for the whole group, and on arrival
        each moves in while room lasts, anyone left over keeping their old city.
      </p>
      <p>
        Relocate is a queue step too: <strong>Add step</strong> offers it, and you tap one of your
        cities on the map or pick it from the list. Adding it only checks that the city is yours;
        free housing is checked when its turn comes, and a step that can't start then is skipped and
        noted in your realm log. Once they move in, the next step starts. A script relocates with{' '}
        <code>relocate(cityId)</code>, refused for the same reasons as the order; it can{' '}
        <code>wait()</code> on it and then read <code>me.orderEnded</code>: its <code>reason</code>{' '}
        is null once they moved in, else why not. While on their way, their <code>order</code> is{' '}
        <code>"relocate"</code> with the <code>cityId</code> they go to.
      </p>
    </>
  )
}
