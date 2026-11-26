import { WALK_TICKS_PER_TILE, aboutTime } from '@csp/balance'
import { WHO_PAGE, WHO_SUGGESTS } from '../realm/who-list-view.js'
import { GROUP_SLOTS } from '../residents/saved-groups.js'
import { Table } from './parts.js'
import { num } from './wiki-view.js'

export function ControlsSection() {
  return (
    <>
      <h3>The screen</h3>
      <p>
        The map fills the screen, with four places over it. The <b>top bar</b> along the top shows
        the control mode, your realm, the clock, your goods, your Leader, Zeal and your heir. The{' '}
        <b>sidebar</b> on the left has a tab for each of your lists, in three groups: People
        (Residents, Horses, Armies), Diplomacy, and Realm (Cities, Waypoints, Scripts, Realm log);
        one is open at a time, and the sidebar folds to its strip of tabs. The <b>command bar</b>{' '}
        along the bottom holds the card of whatever you picked (a resident, a group, an army): its
        header on the left, its tabs and orders beside it. The <b>map dock</b> bottom right, at the
        command bar’s right end, holds the minimap and the map’s buttons. The <b>dock</b> on the
        right holds a tile’s card, the who-list and the realm order cards, so a tile and a resident
        can be open together. A panel an order opens (Goods, Build, Haul route, …) opens above the
        command bar.
      </p>
      <p>
        Scripts on the sidebar opens the <b>script workshop</b>, a screen of its own over the map,
        with your script library and its editor.
      </p>
      <h3>Picking and orders</h3>
      <p>
        Click one of your residents on the map to pick them and open their card in the command bar.
        Each action on the card shows its letter key; press it to run the action. The card opens
        with the orders they can take. While it stays open, each row stays where it is: an order
        that stops being possible (they walk off the farm they worked) stays in its place, greyed
        out, saying why, and one that becomes possible is added at the end of its group. The rows
        are sorted afresh once you pick something else. A group’s card has the same rows and keys.
      </p>
      <p>
        Escape leaves the top-most thing first: picking a target on the map, then a panel open on
        the card (Build, Goods, Run script, …), then a tile’s card in the dock, then the resident’s
        or group’s card, then the open tab of the sidebar.
      </p>
      <p>
        In unit control mode, what a click picks on a tile goes in this order, at every zoom: one of
        your residents there, then a building, then the bare tile, each showing its card. A carriage
        of yours, or a horse of yours nobody rides, counts like a building. A click on a stack of
        your residents (a token with a count, or the +N badge up close) picks them all as a group;
        its card’s Members tab picks one of them. A stack with someone else’s residents in it opens
        the tile card instead, which lists them all. With a mouse, what a click would pick is
        outlined while you hover over it, in its owner’s colour; on a touch screen a tap picks by
        the same order.
      </p>
      <h3>Control modes</h3>
      <p>
        The Unit | Realm switch at the start of the top bar, or the Tab key, picks how you give
        orders. This browser remembers it; you start in unit control mode.
      </p>
      <p>
        In <b>unit control mode</b> you pick residents, a group or an army, then say what they do,
        as the rest of this section tells. In <b>realm control mode</b> you say what is to be done
        and where, then who does it. There a click or tap on the map picks a building (a carriage,
        or a horse nobody rides, counts as one), else the bare tile: your residents are drawn but
        never picked, so a crowded tile is still easy to click, and a drag or the Select button
        picks no group. The realm bar, in the command bar’s place along the bottom (above the map
        buttons on a phone), is where those orders start.
      </p>
      <p>
        <b>Build</b> on the realm bar opens the Build menu. Pick a kind (and Customise, if you
        like), then tap where it goes: the footprint shows under the pointer, marked where it
        doesn’t fit, and a tile it can’t go on says why and sends nobody. Then the <b>who-list</b>{' '}
        opens in the dock: your residents nearest the place first, each with what they are doing and
        how long their way there is. The nearest {num(WHO_SUGGESTS.build)} idle ones are already
        ticked; change the ticks or just Confirm. With nobody idle, nobody is ticked and the list
        says so. Those who can’t build (children, a partner carrying a child, or with no way there)
        come last, greyed out, saying why. Those ticked walk there and build as a group sent with
        Build would; hold Shift while confirming to pick the next place for another of the same
        kind.
        <b>Road</b> and <b>Wall</b> beside it lay out a line the same way (see{' '}
        <a href="#building">Building</a>).
      </p>
      <p>
        A busy resident you tick gets a <b>Now / After</b> switch on their row. <b>Now</b> drops
        what they are doing and sends them at once. <b>After</b> adds the order to the end of their
        queue, as Shift does on their card: they finish the steps they have first. Someone walking
        with no queue yet gets one, the walk first. After is offered only to those two: someone
        running a script or a task (Work, a haul route, …) or another order without a queue has
        nothing to add to, as a new queue would end what they do, so their row offers Now only and
        says “no queue to add to”. The switch starts on After for someone running a queue and on Now
        for anyone else busy; an idle resident has no switch. The line at the top sums it up: “3
        ticked: 2 now, 1 after”.
      </p>
      <p>
        A long who-list can be searched by name and filtered as the Residents list can (idle, by
        city, has weapons, …); this browser remembers the filters. Ticks stay on those a search or
        filter hides, and the list says how many are ticked but not shown. Only the nearest{' '}
        {num(WHO_PAGE)} are drawn at first; Show more draws more.
      </p>
      <p>
        A building’s card starts the orders about it, each ending in the same who-list:{' '}
        <b>Work here</b> at a workplace (or a site of one), <b>Build this site</b> at a site of
        yours, <b>Feed the stable</b> and <b>Breed horses</b> (pick the two first) at a stable,{' '}
        <b>Teach</b> (pick the subject) and <b>Train</b> at a training ground, and <b>Tear down</b>{' '}
        at any building of yours or a workplace. Only those that fit the building show, greyed with
        why while they can’t be given. Customise, or a workplace’s Work settings, come before the
        who-list, as on a resident’s card. The who-list ticks the nearest {num(WHO_SUGGESTS.work)}{' '}
        idle resident for Work, Feed the stable, Breed, Teach and Train, and{' '}
        {num(WHO_SUGGESTS.tearDown)} for Tear down. A resident you tick who stands elsewhere walks
        there first and then does it, with no second order from you; one already there just starts.
      </p>
      <p>
        The realm bar also has <b>Walk to</b> (tap where; those ticked spread over the free tiles
        around it, as a group does; Shift picks the next place), <b>Explore</b> (its form first:
        what to look for, which way, a waypoint, how much food), <b>Run script</b> (pick the script,
        with Customise for its params; a building, storage or waypoint for a param is picked on the
        map) and <b>Relocate</b> (pick the city). Each ends in the who-list, the nearest{' '}
        {num(WHO_SUGGESTS.walkTo)} idle one ticked. Explore and a script with no place picked have
        no target tile, so the list sorts by the distance to your town hall and says so; Relocate
        sorts by the town hall of the city they move to, and lists those living there already last.
      </p>
      <p>
        A tile’s card in realm control mode offers <b>Walk here</b>, and on a tile with no building{' '}
        <b>Build here</b>: the Build menu for that tile, then the who-list. The card of a storage,
        stable, haven, or a carriage or boat of yours offers <b>Store here</b> (those carrying
        something listed first, the nearest {num(WHO_SUGGESTS.store)} idle ones ticked) and{' '}
        <b>Fetch from here</b>, the good picked from what it holds (those with room for it listed
        first).
      </p>
      <p>
        The card of a carriage of yours starts <b>Haul with this carriage</b> (pick the goods each
        way and the Food kept on board, then tap the route’s other stop), <b>Drive this to</b> (tap
        where) and <b>Board</b>; a boat’s card <b>Row this to</b> and <b>Board</b>; a ship docked at
        a haven <b>Board</b> as a passenger and <b>Board as crew</b>. Driving, hauling and rowing
        take one resident: the who-list ticks the nearest idle one, and Confirm is off while more
        than one is ticked. Board ticks as many as there are seats left, the list counting them (“2
        of 3 seats”), and Confirm is off past the seats; crew take no seat. A resident you tick who
        is elsewhere walks to the carriage, beside the boat or onto the ship’s haven first, then
        takes the order. A carriage someone already drives says so on its Haul and Drive rows: one
        you send Now takes it over, its driver stopping; one you send After waits in their queue,
        and their step fails if it is still driven when its turn comes.
      </p>
      <p>
        Switching to realm control mode lets go of the resident, group or army you had picked.
        Picking one some other way (a row or Pick these in the Residents list, a saved group’s
        number key, the Armies tab, a notice that opens a resident) switches back to unit control
        mode.
      </p>
      <h3>The sidebar</h3>
      <p>
        The sidebar on the left has a strip of tabs in three groups: People (Residents, Horses,
        Armies), Diplomacy, and Realm (Cities, Waypoints, Scripts, Realm log). One tab is open at a
        time, beside the strip; its button again, Escape or the « button at the foot of the strip
        folds the sidebar to its strip, and » opens it again on the tab you had open. Drag its right
        edge to make it wider; the width, and whether it was folded, stay for your next visit. The
        Diplomacy tab has a tab each for Contracts, Demands, Direct offers, Alliance and Standing;
        it reopens on the tab you left it on, and a notice’s Open takes you to its tab. A small dot
        on a tab says it holds something you haven’t seen yet: a demand, Direct offer or contract
        offer sent to you, or Realm log lines newer than the last time you had the log open. Opening
        it there clears the dot. On a phone the strip is in the menu, a tab fills the screen, and
        the menu button shows the dot too.
      </p>
      <p>
        The Residents tab’s Open full list button opens the list across the screen, with everyone’s
        age, city, stats, skills, gear, what they carry, hunger, health and what they are doing. On
        a phone each resident is a small card. Tap one to open that resident’s card, which closes
        the full list. Stats there are what they count for now, old age included.
      </p>
      <p>
        Search the full list by name, filter it by weapons (has any, has none, or fights with a
        certain one), by whether they are idle, by children or the grown up, by city and by a skill
        they have learned, and sort it by any column: tap a heading, and tap it again to turn the
        order round; on a phone the sort has its own menu. Whoever has nothing in the column comes
        last either way. This browser remembers your choice.
      </p>
      <p>
        Pick these makes a group on the map of everyone the full list shows, or of those you ticked
        among them, ready for one order, and closes the full list so the group card shows. Someone
        ticked whom the search or a filter hides isn’t picked. Ticks last only while the full list
        is open.
      </p>
      <p>
        The card and the residents list say what each resident is doing. Walking, riding or driving
        somewhere, they also say about when they arrive, also on the way to crew a siege machine, to
        the next tile of a road or wall line, or after someone to attack. Rowing, sailing, pushing a
        siege machine and hauling by water say only the tiles to go for now. The card’s meters and
        countdowns (building, tearing down, breeding, carrying, pairing, growing up) say about how
        long is left, real time first and game time in brackets: “Walking to 12, 40 ·{' '}
        {aboutTime(24 * WALK_TICKS_PER_TILE)}”. Each is an estimate from the current pace, so it
        changes as that does: a way from the ground still to go (terrain, roads, Agility, the
        horse’s Speed and hunger, Driving skill; unexplored ground counts as Plains), a construction
        site from who works on it now, so it says nobody is building while nobody does.
      </p>
      <p>
        To pick several at once, drag a box around them with Shift held (or after the Select button
        on the map), or Shift-click residents to add them or take them out.
      </p>
      <p>
        While residents are picked, the map draws the way each of them is going, as a line ending in
        a dot: walking, driving or hauling somewhere, storing or fetching, walking to the next tile
        of a road or wall line, or going after someone. So a script that fetches food shows its way
        to the storage too. A passenger’s way is the carriage’s. Ways show at every zoom; far out as
        a thin line with a ringed dot at its end.
      </p>
      <p>
        In the same colour the map outlines the places they are set on: the buildings and carriages
        their script’s params name, and where their order heads for (the workplace they work, the
        site they build, the storage or carriage they store at or fetch from, both stops of a haul).
        Only places you can see or remember are outlined.
      </p>
      <p>
        An order that needs a place (walk to, drive to, a road or wall line, where to build, the
        storage to store at) shrinks the card to its header and a banner says what to pick. Where
        the card was stays dead until you pick, so a click there gives no order by accident. Before
        you click, the map shows under the pointer what the pick would do: the way there, with about
        when they arrive; the line of a road or wall and how many tiles it has, red when it is too
        long; a workplace’s footprint on a resource node, red where it doesn’t fit, or the site they
        would join; or the building a Store, Fetch or Work would use. The banner names what is under
        the pointer. Escape or Cancel gives no order.
      </p>
      <p>
        On a touch screen one finger pans the map, two fingers pinch to zoom, and a tap picks. A
        long-press does what right-click does. Turn on Select to make a one-finger drag box a group
        instead of panning. While picking a place, the first tap shows the preview there and the
        banner gains Confirm: press it, or tap the same tile again, to give the order; a tap
        elsewhere moves the preview.
      </p>
      <p>
        The map has three zoom tiers: far shows terrain, territory, the finished roads you see or
        last saw as thin lines, and one emblem per city; middle adds buildings, nodes and residents;
        close shows each figure. Far out territory is filled in its owner’s colour, nearer in only
        its borders are drawn; the Region map button fills it at every zoom. The map dock bottom
        right holds the minimap, the zoom and Centre buttons, Select, Region map and Legend; its
        last line names the terrain, the tile and the tier under the pointer. The minimap shows the
        terrain you explored, your cities, your residents and carriages away from them, and the
        cities you know, with the part on screen as a rectangle; click it to look there. The minimap
        folds to a button, the legend opens over the dock, and your browser remembers how you left
        them.
      </p>
      <p>
        The top bar shows the Food, Wood, Stone, Coal, Steel and Coins held in your storages, for
        what you pick beside them: Entire realm, outpost storages included, or one of your cities by
        name. Stables, carriages and piles don’t count. A storage in sight counts as it is now, one
        out of sight with what you last saw in it; then ≈ beside the goods says that part of the
        total is that old, and how old. Your browser remembers the pick; a city no longer yours goes
        back to Entire realm.
      </p>
      <p>
        On a phone the command bar is a sheet at the bottom of the screen. Drag its handle to show
        just its header, half the screen or all of it; a tap on the handle goes one step up. While
        an order waits for a target the card drops to its header. The menu button at the top left
        opens the sidebar’s tabs, your goods, your Leader, heir and Zeal, the wiki and Log out. The
        map’s buttons (Centre, Select, Region map, Legend and Minimap) sit in one row just above the
        card; zoom by pinching. The Residents and Horses tabs show each one in two lines: name and
        age, then what they are doing (or where the horse is) with their meters.
      </p>
      <p>
        Terrain you have explored loads as you look at it. Until it is here it shows grey, and the
        line in place of the readout says “Loading the map…”; dark is terrain you haven’t explored.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Keys</th>
            <th>What they do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <kbd>Ctrl</kbd>+<kbd>{GROUP_SLOTS[0]}</kbd>–<kbd>{GROUP_SLOTS.at(-1)}</kbd>
            </td>
            <td>
              Save the picked residents as that number's group (with nobody picked, forget it)
            </td>
          </tr>
          <tr>
            <td>
              <kbd>{GROUP_SLOTS[0]}</kbd>–<kbd>{GROUP_SLOTS.at(-1)}</kbd>
            </td>
            <td>Pick that group again; dead residents and ones no longer yours drop out of it</td>
          </tr>
          <tr>
            <td>
              <kbd>{GROUP_SLOTS[0]}</kbd>–<kbd>{GROUP_SLOTS.at(-1)}</kbd> twice
            </td>
            <td>Pick the group and centre the map on it</td>
          </tr>
        </tbody>
      </Table>
      <p>Groups are kept in this browser, for each realm; another browser starts without them.</p>
      <p>
        With several picked, the group card gives each of them the same order, just as their own
        cards would. Every order a resident's card has is on it, but pairing, making Leader and
        renaming, which are about one resident. Nothing ties them together afterwards; each goes on
        alone. The card shows the orders some of them can take where they stand, as rows with the
        same keys as on a resident's card; while it stays open, an order none of them can take any
        more stays greyed out, saying why (“nobody stands on a carriage or beside a boat of your
        realm”).
      </p>
      <ul>
        <li>
          <strong>Walk to</strong> (or right-click the map): they spread over free tiles around the
          one picked, the nearest of them to the nearest tile.
        </li>
        <li>
          <strong>Work</strong>: pick a workplace; those standing at it work it. Walk them there
          first.
        </li>
        <li>
          <strong>Build</strong>: pick a tile and what to build there, or a construction site. Each
          walks there; the first to arrive lays out the site and the others join it.
        </li>
        <li>
          <strong>Store</strong> puts what each carries in the nearest storage (their own food stays
          with them), <strong>Store at</strong> in the storage, stable or carriage picked;{' '}
          <strong>Fetch</strong> takes a good from the nearest storage or carriage holding it, or
          from the one picked. <strong>Drop all</strong> puts down everything each carries.
        </li>
        <li>
          <strong>Mount horses</strong>: each takes a different free horse of yours on their tile.{' '}
          <strong>Drive carriages</strong> and <strong>Haul route</strong> go to each standing on a
          carriage, one driver for each carriage.
        </li>
        <li>
          <strong>Feed the stable</strong>: each standing in a stable feeds it.{' '}
          <strong>Breed horses</strong>: pick two horses in a stable where some of them stand; one
          of them there who isn't breeding yet tends the pair. Pick two more for the next.
        </li>
        <li>
          <strong>Build line: road</strong> and <strong>Build line: wall</strong>: pick where the
          line starts and ends; each gets Build line with that line, and they share it (see
          Building). <strong>Tear down</strong>: pick a building; those standing at it tear it down.
        </li>
        <li>
          <strong>Attack</strong>: pick a resident of another realm, or a wall or gate, for them all
          to attack. <strong>Climb a wall</strong>: those next to the one picked climb over.
        </li>
        <li>
          <strong>Board carriage</strong> (with several carriages of your realm where some of them
          stand, pick one) puts those on its tile aboard, in the group's order, until it is full;{' '}
          <strong>Get off</strong> gets every passenger among them off. See Passengers. A boat of
          your realm beside some of them is boarded the same way (Board boat), and{' '}
          <strong>Row boats to</strong> has one of them row each boat there; see Water.
        </li>
      </ul>
      <p>
        Those who can't take an order are skipped, and a notice under the top bar says who and why:
        children don't work, build or drive, and store, fetch or put down only Food; a partner
        carrying a child doesn't work, build, tear down, breed or haul; orders bound to a place go
        only to those standing there; Board skips those not on the carriage's tile, the driver,
        riders and, once it is full, the rest.
      </p>
      <p>
        Hold <kbd>Shift</kbd> while giving a group order to add it to the end of each one's queue
        instead (see Queues). Work, Tear down and Breed horses then also go to those away from the
        place, who walk there first, and Store to those who carry nothing yet. Stop still stops them
        all and ends their queues.
      </p>
      <p>
        The group card's Queue tab has the same planner as a resident's card.{' '}
        <strong>Add step</strong> adds the step to the end of each one's own queue.{' '}
        <strong>Plan a queue for all</strong> opens a plan kept in this browser: add steps, reorder
        them, give them durations and loop it, as on a resident's card, then{' '}
        <strong>Give to all</strong> makes each one's queue a copy of it, ending what they do.
        Everyone gets every step, even one they can't do; they skip it when its turn comes.
        Afterwards each one's queue is their own, edited on their card.
      </p>
    </>
  )
}
