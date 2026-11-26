import { CREW_FOOD, GET_FOOD_AT, GET_FOOD_TAKE } from '@csp/balance'
import { PARAM_DESCRIPTIONS } from '@csp/lang-wasm'
import { WORKPLACE_PARAM, SCRIPT_PARAM_TYPES } from '@csp/shared-types'
import { ScriptCode, Table } from './parts.js'
import { foodEatenPerDay, num } from './wiki-view.js'
import {
  PARAM_CHOICE_EXAMPLE,
  PARAM_COMMENT_EXAMPLE,
  PARAM_DEFAULT_EXAMPLE,
} from './wiki-scripting.js'

export function ParamsSection() {
  return (
    <>
      <p>
        A script can ask for values you pick for whoever runs it, such as which storage the output
        goes to. Each is a <code>param</code> line at the very top of the script, read further down
        as <code>params.name</code>. A <code>param</code> line anywhere else is a syntax error.
      </p>
      <ScriptCode
        source={`param storage: storage
if (params.storage != null) { store(["wood"], params.storage) }`}
      />
      <Table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Holds</th>
          </tr>
        </thead>
        <tbody>
          {SCRIPT_PARAM_TYPES.map((t) => (
            <tr key={t}>
              <td>
                <code>{t}</code>
              </td>
              <td>{PARAM_DESCRIPTIONS[t]}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ul>
        <li>
          Starting at once: giving a task or Run script starts it in one tap, with the values the
          resident keeps or the defaults; in a group each one goes on with their own.
        </li>
        <li>
          Before it starts: a Customise button beside the order, on the resident card, the group
          card and in Add step, shows its params, filled with those values. Change what you like and
          press Start; Cancel gives nothing. Each param's <code>?</code> says what it is for. On a
          phone the form rises from the bottom of the screen, with Start and Cancel always in view.
          For a group the form shows once, and each of them gets the same values. With Shift held
          the step added to the queue keeps the values. An order whose script has no params to show
          has no Customise.
        </li>
        <li>
          The form opens by itself only when a param has no default and no <code>none:</code> in its
          comment, since the script has nothing to go on without it. Give each param one or the
          other to start your script in one tap.
        </li>
        <li>A defence script starts nothing, so its params are still shown when you pick it.</li>
        <li>
          A resident's card shows one field for each param of the script they run: pick it on the
          map, or clear it. A <code>number</code> param has a number field instead: type a whole
          number of zero or more and press Enter. A <code>choice</code> param has a list of its
          words, and a <code>waypoint</code> param a list of your waypoints (or pick its marker on
          the map); the first entry in either list leaves it unset. None of them stops the script.
        </li>
        <li>
          The comment at the end of a <code>param</code> line is what the card shows: what the param
          is for, and after <code>none:</code> what the script uses while none is picked. Each field
          says the value the script uses: the one picked, else a <code>number</code> param's
          default, a default script's target the one on their tile, or what the comment says after{' '}
          <code>none:</code>.
          <ScriptCode source={PARAM_COMMENT_EXAMPLE} />
        </li>
        <li>
          A group's card sets a <code>number</code> param for each of them running a script with it.
        </li>
        <li>
          The values are kept for each resident and each script. Giving the task again keeps them; a
          param removed from the script is dropped, and a new one starts unset.
        </li>
        <li>
          A <code>building</code> param can name a workplace or construction site of anyone's you
          know, in sight or last seen; out of sight the card names it with "(last seen)" and the
          script reads it as you last saw it. A param reads <code>null</code> while none is picked,
          and once the one picked is gone or no longer one it may name. A <code>number</code> param
          reads the number typed, or <code>null</code> while unset. A <code>choice</code> param
          reads the word picked as a string; a word the script no longer lists is dropped. A{' '}
          <code>waypoint</code> param reads the waypoint, with its <code>id</code>,{' '}
          <code>name</code>, <code>x</code> and <code>y</code>; once you remove the waypoint it
          reads as unset.
        </li>
        <li>
          A <code>number</code> param may have a default: <code>= n</code> after its type, a whole
          number of zero or more. Unset, it reads the default; the number typed wins over it, and
          clearing the field goes back to it. Its field shows the default while unset. A{' '}
          <code>choice</code> param may have one too, one of its words: <code>= north</code> after
          its list. A <code>building</code>, <code>storage</code> or <code>waypoint</code> param
          can't have one.
          <ScriptCode source={PARAM_DEFAULT_EXAMPLE} />
        </li>
        <li>
          A <code>choice</code> param lists the words it can be in brackets after its type, each
          once; a default that is not one of them is a syntax error. A <code>waypoint</code> param
          is one of your waypoints.
          <ScriptCode source={PARAM_CHOICE_EXAMPLE} />
        </li>
        <li>
          The Work default has <code>workplace</code>: the workplace to work, the one they stand on
          while none is picked; it is never kept between starts, so Customise on Run script shows it
          empty, and giving Work on a workplace fills it without asking. It also has{' '}
          <code>storage</code>: the main storage, for the output, inputs and Food; and{' '}
          <code>output</code>, <code>input</code> and <code>food</code>, each taking its place for
          that one use when picked. The Build default has <code>site</code>: the construction site
          to join; and <code>source</code>: where materials come from, a carriage too. Unset, each
          uses the nearest storage; a source picked that holds none of what the site lacks is left
          alone, and they just build. The Haul default has <code>carriage</code>: the carriage to
          drive. The Tear down default has <code>building</code>, the Breed horses and Feed the
          stable defaults <code>stable</code>. Like Work's <code>workplace</code>, each of these is
          the one they stand on while none is picked, never kept between starts, and filled by
          giving the task. Feed the stable also has <code>source</code>: where the Food comes from.
          The Tear down default has <code>source</code>: where Food comes from. The Build, Build
          line and Tear down defaults also have <code>food</code>: where Food comes from, their{' '}
          <code>source</code> while none is picked. The Work, Build and Tear down defaults also have
          the <code>number</code> params <code>foodAt</code> (default {num(GET_FOOD_AT)}; 0 turns it
          off) and <code>foodTake</code> (default {num(GET_FOOD_TAKE)}) for getting food, in units
          of Food (a resident eats about {num(foodEatenPerDay())} a game day). Work also has{' '}
          <code>crewFood</code> (default {num(CREW_FOOD)}; 0 brings none): the Food the workplace's
          pile keeps for the crew, which the carrier tops up on the way back from the storage.
        </li>
      </ul>
      <h3>Workplace settings</h3>
      <p>
        How a workplace is worked belongs to the workplace, not to each worker. On the card of a
        workplace, or of a construction site of one, open Work settings: pick its work script and
        set that script's params there, once for the whole crew.
      </p>
      <ul>
        <li>
          The work script is your Work default, or any script of yours that declares{' '}
          <code>param {WORKPLACE_PARAM}: building</code>. Switching to another one starts its values
          over, and everyone working there by the settings switches to it, as if given Work again.
        </li>
        <li>
          Each of its params but <code>{WORKPLACE_PARAM}</code>, which is the workplace itself, has
          a field as on a resident's card: pick it on the map or type a number, and clear it. Each
          shows its comment and the value it uses.
        </li>
        <li>
          You can set them for any workplace your realm knows: your own, or anyone's in sight or
          last seen. Two realms working the same farm each keep their own, and neither sees the
          other's. NPC cities keep none.
        </li>
        <li>
          Your scripts read them on a building as <code>workSettings</code>: the work script's id (
          <code>null</code> for the Work default) and the values set by name.
        </li>
        <li>Settings of a workplace that is gone go with it.</li>
      </ul>
      <h4>Working by the settings</h4>
      <ul>
        <li>
          Giving a resident Work at a workplace, from their card, a group card or a queue step, runs
          its work script, at once. Customise shows its params filled with the workplace's values.
        </li>
        <li>
          A value you change in that form becomes that resident's own, an override. What they kept
          for that script before doesn't carry over, with Customise or without.
        </li>
        <li>
          While they work there, each param reads their override, else the workplace's value, else
          the script's default. Their card says which: a value "from the workplace", or "their own"
          with a button back to the workplace's.
        </li>
        <li>
          Changing a value on the workplace's card reaches everyone working there without an
          override at once, from their next use of it.
        </li>
        <li>
          A script you give by hand with Run script stays the resident's own choice and reads only
          their own values.
        </li>
      </ul>
    </>
  )
}
