import {
  QUEUE_DEFAULT_STEP_MINUTES,
  QUEUE_MAX_STEPS,
  QUEUE_MAX_DEPTH,
  QUEUE_MAX_REPEAT,
} from '@csp/balance'
import { realMinutes } from '../queue/queue-view.js'
import { DEFAULT_REPEAT } from '../queue/plan-blocks.js'
import { num } from './wiki-view.js'

export function QueuesSection() {
  return (
    <>
      <p>
        A queue gives a resident a list of steps to do one after another, some of them wrapped in
        repeat blocks, up to {num(QUEUE_MAX_STEPS)} steps and blocks in all. A step is any order you
        could give them on its own: walk to, pick up, drop, store, fetch, drive, hitch or unhitch a
        horse, mount or dismount, board or get off a carriage, work, build, haul, feed the stable,
        breed horses, tear down, Build line (road or wall), relocate to another of your cities, or
        run one of your scripts with its params.
      </p>
      <p>
        To plan ahead, use <strong>Add step</strong> beside the queue's steps on the resident's card
        (the command bar grows upward while the Queue tab is open; its button takes it back to bar
        height): a palette of every kind of step, each with its icon, grouped as the Orders tab is
        (Move, Work &amp; build, Goods, Scripts), plus Flow with <strong>Repeat</strong> and{' '}
        <strong>If</strong> for the picked steps, and <strong>Wait until</strong>. Customise is the
        small ⚙ beside a step. New steps go at the end; tap the <strong>+</strong> between two steps
        to add the next ones there instead, and tap it again to go back to the end. One that acts on
        a place (work a workplace, build, store at or fetch from a storage, pick up, feed the
        stable, breed, …) has you pick that place on the map, anywhere, not only where the resident
        stands now; one that needs more (which goods, what to build, what a smithy makes, which
        script) asks for it on the card after. What to build is the same Build menu as on the card;
        a kind dimmed because the tile lacks something today, such as a city's area, can still be
        added, for a step before it may bring that. A step that has to be done on its tile goes
        after a walk there, unless the step before already walks there; one that acts on no place
        (Explore, Dismount, Get off, Run script) gets no walk. Adding a step only checks that it
        could make sense (the place is there as you last knew it, and a carriage or horse is yours).
        A workplace or construction site can be anyone's, in sight or as last seen, since a
        workplace has no owner: queue Work at a far mine and they walk there and work it. Whether a
        step can start is checked when its turn comes.
      </p>
      <p>
        For a resident with no queue, the steps you add, paste or load collect as a{' '}
        <strong>draft</strong>, marked “Draft, not started”: nothing runs until you press{' '}
        <strong>Start queue</strong>, which gives it. <strong>Discard draft</strong> throws it away.
        A running queue is edited live; <strong>Edit as draft</strong> copies it into a draft while
        the queue runs on untouched, and Start queue replaces it (the step they are on keeps going
        if it is still in it). A draft is kept in this browser and lost on reloading the page.{' '}
        <strong>Clear</strong> empties a draft or a group's plan. On a running queue it asks first,
        then removes every step but the one the resident is on and turns loop off, so they finish
        that step and the queue ends; <strong>Stop</strong> still halts them at once.
      </p>
      <p>
        Hold <kbd>Shift</kbd> while you give an order (a button, its key, or a tile picked on the
        map, right-click included) to add it to the end of the resident's queue instead of replacing
        what they do; on a resident without a queue it starts one, after the walk they are on, if
        any. An order done on the resident's tile (work, build, pick up, drop, drive, board, haul,
        tear down) is queued after a walk back to that tile, so it still finds them there when its
        turn comes, every round of a loop. Work or haul followed by another step gets a duration of{' '}
        {num(QUEUE_DEFAULT_STEP_MINUTES)} game minutes ({realMinutes(QUEUE_DEFAULT_STEP_MINUTES)}),
        which you can change.
      </p>
      <p>
        The resident's card lists the queue with the current step marked and what they are doing in
        it, each step on one line with an icon for its kind of order and its place by name: a
        building with its city (“Walk to Farm, Quarrytown IV”), a waypoint or a city, or the tile's
        coordinates when nothing is there. A step's duration shows as a chip when it has one, or
        when it needs one; tap it to type the duration in game minutes (the real time shows beside
        it), empty it to clear it. The steps sit in a bracket, <strong>Loop</strong>, with its
        switch in its head: on, the first step follows the last. Drag a step to reorder it, also
        into or out of a repeat block's bracket, or focus it and press <kbd>Alt</kbd>+<kbd>↑</kbd>{' '}
        or <kbd>Alt</kbd>+<kbd>↓</kbd>. On a phone, tap the steps to move to pick them, then tap{' '}
        <strong>Move here</strong> where they go. A step kind dragged from Add step and dropped
        between two steps is planned there. Remove a step with ✕. The planner's <strong>?</strong>{' '}
        shows how it works.
      </p>
      <p>
        To reuse steps, tap one in the planner to pick it (<kbd>Shift</kbd>+tap picks a range;
        tapping the picked one again unpicks it), then <strong>Copy</strong>. <strong>Paste</strong>{' '}
        puts copies after the picked step, or at the end with none picked, in the same planner,
        another resident's or a group's; the pasted steps are picked, so a second Paste goes after
        them. <kbd>Ctrl</kbd>+<kbd>C</kbd> and <kbd>Ctrl</kbd>+<kbd>V</kbd> do the same while the
        planner has focus. The clipboard is this browser's: it survives switching cards, not
        reloading the page, and the server never sees it. A pasted step keeps its places and the
        walk before it, and is checked again when its turn comes.
      </p>
      <p>
        To keep a plan, open the planner's <strong>Saved…</strong> and save it under a name, such as
        “Mine run”; saving under a name already taken asks before it overwrites. Saved… also lists
        the saved queues with their step count and date, to load one or delete it (a resident with
        nothing queued has <strong>Load…</strong> for the same list); loading adds its steps after
        the planned ones, in any resident's planner or a group's. Saved queues are kept in this
        browser, as saved groups are: the server never sees them, and another browser has its own. A
        saved step keeps its places, so one whose building is gone from the map (torn down, say) is
        flagged in the planner; it is still given, and skipped when its turn comes.
      </p>
      <p>
        To do some steps several times in a row, pick them (in a row) and press{' '}
        <strong>Repeat</strong>: they are wrapped in a repeat block, done {num(DEFAULT_REPEAT)}{' '}
        times until you type another count (up to {num(QUEUE_MAX_REPEAT)}), or pick{' '}
        <strong>forever</strong> or <strong>until…</strong> in its head. The block is a bracket
        inside Loop's, its count in its head and its steps inside; it is picked, moved (into another
        block too), copied, pasted, saved and removed as one,
        <strong> Unwrap</strong> puts its steps back as they were, and a block can hold another, up
        to {num(QUEUE_MAX_DEPTH)} deep. The block is part of the queue itself: wrapping steps of a
        running queue edits it live, and the resident does the block's steps round after round. The
        running queue shows the round the block is on (“round 2 of 3”), and an edit keeps it. A
        round in which none of its steps could start ends the block, so a block whose steps all fail
        never spins: the queue goes on after it. A queue holds at most {num(QUEUE_MAX_STEPS)} steps
        and blocks as written: “repeat 100 times” of two steps is three. The planner counts them and
        won't give a plan over that, saying by how much. Loop still loops the whole queue; a looping
        queue that got through all its steps without starting one ends. Your scripts see a queue as
        before: the step the resident is on and its number among the steps counted top to bottom,
        not the blocks or their rounds.
      </p>
      <p>
        <strong>Repeat until</strong> repeats the block until a condition holds (the same conditions
        as Wait until, below), set on the card when you pick <strong>until…</strong>;{' '}
        <strong>Change</strong> in the head sets another. The condition is checked before each
        round: when the block's turn comes, and again after each round. Once it holds, the block
        runs no more rounds and the queue goes on after it; a round already begun runs to its end.
        If it holds when the block's turn comes, the block runs no round at all. It has no count, so
        the running queue shows just the round it is on (“round 4”), and a round in which none of
        its steps could start still ends it. For example, “repeat until the storage holds 100 Wood:
        fetch, haul” keeps hauling until the storage is full enough. A condition on a place gone, or
        no longer your realm's, counts as false and is noted in your realm log.
      </p>
      <p>
        To do some steps only sometimes, pick them (in a row) and press <strong>If</strong> in Add
        step's Flow, then set its condition (the same conditions as Wait until, below): they are
        wrapped in an If block, a bracket with the condition in its head. When its turn comes the
        condition is checked once: if it holds, the block's steps run; if not, they are passed over.
        To do something else instead, pick other steps and press the block's <strong>Else</strong>:
        they move into its Else part, a second part of the bracket, run when the condition doesn't
        hold. The condition is not checked again while the block's steps run, whatever changes
        meanwhile. <strong>Change</strong> sets another condition, <strong>Unwrap</strong> puts its
        steps (then its Else steps) back where it was. An If block nests with repeat blocks and
        counts as a block towards the queue's size and depth; inside a repeat block it is checked
        again each round. A running queue marks the part it is running. A condition on a place gone,
        or no longer your realm's, counts as false (so the Else part runs) and is noted in your
        realm log. Your scripts see the steps counted top to bottom, the Else part's after the
        block's own.
      </p>
      <p>
        <strong>Wait until</strong>, in Add step's Flow, is a step that ends once its condition
        holds; meanwhile the resident stands idle where they are. With a duration it also ends when
        that is up, whether the condition holds or not. Its condition is set on the card: pick the
        kind, then its fields. A condition is about the resident themself or one place of your own
        realm, never anything you couldn't know:
      </p>
      <ul>
        <li>
          <strong>Carrying</strong>: they, or the carriage or boat they drive, carry at least or
          less than so many of a good. The carriage or boat is the one they drive or are aboard,
          else a carriage of yours on their tile; with none, the condition is false.
        </li>
        <li>
          <strong>Full or empty</strong>: they, or that carriage or boat, are full (not room left
          for one more unit of what they hold) or empty.
        </li>
        <li>
          <strong>Stock at a place</strong>: a storage, workplace pile or construction site of your
          realm, picked on the map, holds at least or less than so many of a good.
        </li>
        <li>
          <strong>Hunger or health</strong>: their hunger meter or health is above or below a share
          of full.
        </li>
        <li>
          <strong>Mounted</strong> or <strong>Aboard</strong>: they are, or are not.
        </li>
        <li>
          <strong>Game hour</strong>: it is before an hour, or that hour or later.
        </li>
      </ul>
      <p>
        The condition is checked from the tick after the wait started, so a wait whose condition
        already holds lasts a tick. A condition on a place that is gone, or no longer your realm's,
        counts as false and is noted once in your realm log. In a group's plan each member checks
        the condition for themself.
      </p>
      <p>
        A step ends when it is done (the walk arrives, the goods are stored, the script calls{' '}
        <code>end()</code>), or once its duration in game minutes is up, if you gave it one. Working
        a workplace, hauling and feeding a stable never end on their own, so such a step needs a
        duration unless it is the last. With loop on, the first step follows the last; without, the
        queue ends after it.
      </p>
      <p>
        You can add, remove and reorder steps while the queue runs; the current step keeps going
        unless you remove it, and then the step in its place starts. A step that can't start, or
        ends in a failure (a store whose storage is gone), is skipped and noted in your realm log.
        Any other order you give the resident ends the queue.
      </p>
      <p>
        Your scripts see a resident's queue as <code>queue</code>: which step they are on and what
        it is. Their <code>order</code> and <code>script</code> stay the current step's own. Scripts
        can't start or change queues.
      </p>
    </>
  )
}
