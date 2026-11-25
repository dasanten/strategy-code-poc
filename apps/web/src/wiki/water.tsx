import {
  BOAT_CAPACITY,
  SHIP_CAPACITY,
  SHIP_MIN_CREW,
  SAIL_SPEED,
  PASSENGER_WEIGHT,
  ROW_SPEED,
  ROW_STRENGTH_AVERAGE,
  ROW_STRENGTH_EFFECT,
  ROW_STRENGTH_LIMIT,
  SEAFARING_SKILL_EFFECT,
  SEAFARING_SKILL_LIMIT,
  SEAFARING_SKILL_PER_DAY,
  HAUL_KEEP_FOOD,
  FOOTPRINT,
} from '@csp/balance'
import { goods } from './names.js'
import { buildCosts, boatCost, shipCost, duration, num, pct } from './wiki-view.js'

export function WaterSection() {
  const havenCost = buildCosts().find((b) => b.kind === 'haven')!
  return (
    <>
      <p>
        Lake and Sea are <b>water</b>. Nobody walks on them, and a walk always goes round on land.
        Boats and ships are what cross them, and they start at a haven.
      </p>
      <p>
        A <b>haven</b> is a {num(FOOTPRINT.haven)} × {num(FOOTPRINT.haven)} building on the shore:
        every tile of it on passable land, off Mountain and off resource nodes, and at least one of
        its tiles touching Lake or Sea, straight or diagonally. The Build menu offers it only where
        it fits. It is built from {goods(havenCost.materials)} and {duration(havenCost.buildTicks)}{' '}
        of one average resident's work.
      </p>
      <p>
        A haven has a <b>storage</b>: anyone standing at it puts goods in or takes them out, by
        hand, with Store and Fetch, or with a script, as at any storage. Like a stable it has no
        owner of its own: it is the city's whose resident laid it out, and taking goods from it is
        judged as taking from any storage of that city. NPC cities don't build havens.
      </p>
      <p>
        <b>Building a boat.</b> A resident standing on a tile of a finished haven that touches the
        water lays out a <b>boat site</b> there with Build (in the Build menu under Transport). It
        is a construction site like any other: it takes {goods(boatCost().materials)} and{' '}
        {duration(boatCost().buildTicks)} of one average resident's work, anyone may bring materials
        or work on it, and torn down it leaves all its materials. Once finished the site is gone,
        and an empty boat of the realm of whoever finished it floats on the nearest free water tile
        next to it.
      </p>
      <p>
        A boat always floats on a water tile, one boat to a tile. It carries a few residents and a
        little cargo: {num(BOAT_CAPACITY)} kg in all, each passenger counting as{' '}
        {num(PASSENGER_WEIGHT)} kg. It shows on the map to whoever sees its tile, like a carriage;
        its card tells whose it is and how heavily it is loaded, and what it holds only to its own
        realm and allies. Scripts see the boats in sight with <code>vessels()</code>. A boat of a
        realm that ends belongs to nobody, as NPC cities don't use the water.
      </p>
      <p>
        <b>Building a ship.</b> A <b>ship</b> is the big vessel of the Sea: it carries far more than
        a carriage, {num(SHIP_CAPACITY)} kg in all, sails with a crew and goes only on Sea, never
        onto a Lake. A resident standing on a tile of a finished haven that touches the Sea lays out
        a <b>ship site</b> there with Build (under Transport); a haven on a Lake alone builds boats
        only. The site takes {goods(shipCost().materials)} and {duration(shipCost().buildTicks)} of
        one average resident's work, so it is a job for many hands, and like a boat site anyone may
        bring materials or work on it. Once finished the site is gone, and an empty ship of the
        realm of whoever finished it floats on the nearest free Sea tile next to it. It shows on the
        map on a token of its own, to whoever sees its tile; its card tells whose it is, its load,
        and who is aboard.
      </p>
      <p>
        <b>Docked.</b> A ship on a water tile touching a haven, straight or diagonally, is docked
        there; one launched at a haven is docked at it. Only docked, and only from that haven, do
        residents board it, get off it or load it: for a ship, beside it means standing anywhere on
        the haven it is docked at, and getting off lands on a free tile of that haven. A ship out at
        sea takes nobody on and lets nobody off. Store and Fetch with a docked ship as the place
        walk onto its haven.
      </p>
      <p>
        <b>Crew.</b> Residents of the ship's realm board it as its <b>crew</b> rather than as
        passengers: Board ship… on their card opens the choice (As crew or As passenger), the group
        card offers Crew the ship and Board the ship, a queue step Board a ship as crew, and a
        script <code>board(ship.id, true)</code>. Only grown residents crew a ship, and crew don't
        count against what it holds, while each passenger counts as {num(PASSENGER_WEIGHT)} kg as on
        a boat. A ship sails only with at least {num(SHIP_MIN_CREW)} crew aboard; its card names its
        crew and says whether it can sail. Getting off, one of the crew is its crew no more.
      </p>
      <p>
        <b>Loading a ship.</b> Those standing on the haven a ship is docked at move goods straight
        between the haven's storage and the ship, as many as there are and fit, at once: Load ship
        and Unload in the Goods panel, or a script's <code>loadShip(ship, goods)</code> and{' '}
        <code>unloadShip(ship, goods)</code>. Taking goods from another city's haven this way is
        judged as taking from its storage. Goods can also go aboard by hand, as onto a boat, from
        the haven.
      </p>
      <p>
        <b>Sailing.</b> One of the crew aboard, its <b>captain</b>, sails the ship: Sail ship to on
        their card, then a tile, a queue step Sail the ship, or a script's{' '}
        <code>sail(ship, x, y)</code>. Given a Sea tile it sails there; given a tile of a haven, it
        docks on the free Sea tile beside that haven nearest it. It goes a Step at a time over Sea
        only, never onto a Lake, so a lake haven builds boats, not ships. It sails only with at
        least {num(SHIP_MIN_CREW)} crew aboard, and stops where it is if fewer are left. An
        unskilled crew sails it {num(SAIL_SPEED)} times as fast as walking on Plains; their average{' '}
        <b>Seafaring</b> makes it faster as a rower's does a boat, and every tick of sailing teaches
        Seafaring to the whole crew. Everyone aboard goes along and sees from the ship's tile. Crew
        and passengers eat their own food and, running low, take a meal from the ship's Food, as on
        a boat.
      </p>
      <p>
        <b>Stealing a ship.</b> Residents of your realm on the haven another realm's ship is docked
        at board it as crew, if nobody of another realm is aboard and no armed resident of its owner
        stands on the haven while none of yours does; with at least {num(SHIP_MIN_CREW)} of them
        aboard, sailing it off steals it with its load, known through a witness like a boat's theft.
      </p>
      <p>
        <b>Fighting at a ship.</b> Those aboard a docked ship can be attacked from anywhere on its
        haven, and fight back at those on it; out at sea, as with a boat, nobody reaches them.
      </p>
      <p>
        <b>Beside a boat</b> means on a land tile touching its water tile, straight or diagonally. A
        resident beside a boat of their realm <b>boards</b> it, children too (Board boat on their
        card, or on the boat's card, or a script's <code>board(id)</code>), and steps onto its water
        tile: on the map they ride inside it, which shows how many are aboard, and their Doing line
        says "Aboard a boat". Each passenger counts as {num(PASSENGER_WEIGHT)} kg of the{' '}
        {num(BOAT_CAPACITY)} kg it holds, so {num(Math.floor(BOAT_CAPACITY / PASSENGER_WEIGHT))}{' '}
        residents fill an empty one. No horse goes aboard: a rider dismounts first, and the driver
        of a carriage can't board.
      </p>
      <p>
        A passenger <b>gets off</b> onto a free land tile beside the boat: one they pick (a script's{' '}
        <code>getOff(x, y)</code>), or the first one there. Giving a passenger a walk or an order
        that acts on a tile gets them off first, onto the shore nearest where they are going. A boat
        away from every shore keeps its passengers aboard: they can't get off, and a walk given to
        them ends. Walking never uses a boat. Down or dead, a passenger stays in the boat, and what
        they carried stays in it.
      </p>
      <p>
        <b>Loading.</b> Residents beside a boat put goods in it and take goods out, up to what it
        holds with its passengers counted in: Store and Fetch with the boat as the place (they walk
        to the shore beside it), or a pick-up or drop at <code>{'{kind: "vessel"}'}</code> from a
        script. Residents and goods only: a boat takes no horse or carriage.
      </p>
      <p>
        <b>Rowing.</b> A grown resident aboard a boat of their realm, or beside it (they board
        first), rows it to a water tile: Row boat to on their card, then a tile on the map, or a
        script's <code>row(boat, x, y)</code>. Given a land tile, the boat goes to the nearest free
        water tile beside it. It goes a Step at a time over water only, Lake and Sea alike, and a
        diagonal Step only where both straight tiles beside it are water too, so it never squeezes
        between two pieces of land. The rower takes its oars and is no passenger: they don't count
        against what it holds, and whoever was at the oars before becomes a passenger. Everyone
        aboard goes along and sees from the boat's tile, so rowing along a coast explores it. On the
        map the boat glides from tile to tile, and the rower's Doing line says where it is heading.
        A boat nobody rows stays where it is; it never drifts. Walking never uses a boat: a walk
        across water still goes round on land.
      </p>
      <p>
        An average rower moves a boat {num(ROW_SPEED)} times as fast as walking on Plains. Each
        point of Strength above {num(ROW_STRENGTH_AVERAGE)} makes it {pct(ROW_STRENGTH_EFFECT)}{' '}
        faster (and each below, slower), at most {pct(ROW_STRENGTH_LIMIT)} either way. Rowing
        teaches <b>Seafaring</b>, {num(SEAFARING_SKILL_PER_DAY)} a game day of rowing at average
        Intellect, and each point of it makes the boat {pct(SEAFARING_SKILL_EFFECT)} faster, at most{' '}
        {pct(SEAFARING_SKILL_LIMIT)}. Rowing costs food as walking on Plains does. The rower and
        passengers eat their own food and, running low, take a meal from the boat's Food.
      </p>
      <p>
        <b>Boats in queues and groups.</b> Boarding, rowing, getting off and loading are queue steps
        like any other, so a queue can take a resident across a lake and back, and a saved queue
        keeps them. With Add step, <b>Board a boat</b> picks the boat, then the shore tile to board
        it from (a walk there goes first): beside the boat now, or beside where an earlier step rows
        it. <b>Row the boat</b> picks the boat, then where to row it; it needs them aboard or beside
        it already, so it usually follows Board a boat. <b>Get off</b> lands them on the shore
        beside the boat, and Store and Fetch take the boat as their place. A step that can't be done
        when its turn comes (the boat isn't beside them) is skipped and noted in the realm log. On
        the group card, <b>Board boat</b> boards those beside a boat of your realm until it is full,{' '}
        <b>Get off</b> gets everyone aboard off together, and <b>Row boats to</b> has one of them
        row each boat (the first already aboard it, else the first beside it) while the others
        aboard go along: board, row, get off, and the whole crew is across.
      </p>
      <p>
        <b>Haul route by boat.</b> A boat runs a haul route as a carriage does, between two stops on
        land: shore tiles or a haven, each with free water beside it. A grown resident standing on
        the shore beside a boat of your realm picks <strong>Haul route…</strong> on their card, the
        goods to take and to bring back and the Food kept on board for them ({num(HAUL_KEEP_FOOD)}{' '}
        unless you pick another amount), then the other stop on the map; the tile they stand on is
        the first stop. With Add step it is <b>Haul route by boat</b>: the boat, the first stop (a
        walk there goes first), then the other one. A script gives it with{' '}
        <code>haul(boat, x, y, goods)</code> from the shore beside the boat. At each stop the rower
        gets off onto it and loads and unloads by hand from beside the boat, like a carriage's
        driver: at a haven from and into its storage, at a shore from and onto the pile on the tile.
        Then they board, take the oars and row to the free water beside the other stop. The boat
        leaves the first stop once it has goods on board and nothing more to load there; with none
        there yet it waits. The route ends when the boat isn't beside the stop any more (rowed off
        by someone else) or the rower can't get off onto it, and goes on until stopped otherwise.
        The rower's Doing line says what they load or where they row.
      </p>
      <p>
        <b>Haul route by ship.</b> A ship runs a haul route between two havens. A grown resident
        standing on the haven a ship of your realm is docked at picks <strong>Haul route…</strong>{' '}
        on their card (or <b>Haul route by boat or ship</b> with Add step, or a script's{' '}
        <code>haul(ship, x, y, goods)</code>), then a tile of the other haven; they are its captain.
        With them aboard it must have at least {num(SHIP_MIN_CREW)} crew, so the others board as
        crew first. At each haven the captain gets off and moves the goods straight between the
        haven's storage and the ship, as many as there are and fit, at once: first the goods for
        that haven off, then the Food kept on board for the crew topped up, then the goods for the
        other haven on. Then they board again as one of the crew and sail to the other haven,
        docking on the free Sea beside it; the rest of the crew stays aboard all the while and eats
        from the ship's Food. Goods go both ways as for a carriage, ore home and Food out, say. The
        ship leaves the first haven once it has goods for the other aboard; with none there yet it
        waits. Sailing on each time teaches Seafaring to the whole crew.
      </p>
      <p>
        <b>Stealing a boat.</b> A grown resident beside another realm's boat can row it off as a
        carriage is driven off: <strong>Row off (theft)</strong> on their card, then a tile, or a
        script's <code>row(boat, x, y)</code> naming that boat. The boat joins your realm at once
        with its load, and they take its oars. It can't be taken while someone rows it or anyone is
        aboard, nor while an armed resident of its owner stands beside it and none of your realm
        does. Boat and load are one theft, known through a witness like a carriage's: its owner's
        realm log says at once that it is gone and where it was last. A boat of nobody is simply
        yours.
      </p>
      <p>
        <b>Fighting at a boat.</b> Those aboard can be attacked by anyone beside it, as if the boat
        were the next land tile, and fight back from aboard; Down or dead, they stay in it. There
        are no fights between boats and none from open water, so a boat away from every shore is out
        of reach: an attack on someone aboard it finds no way and ends. An alarm at home doesn't
        reach whoever is rowing.
      </p>
    </>
  )
}
