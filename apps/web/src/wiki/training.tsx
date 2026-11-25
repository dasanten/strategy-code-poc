import {
  NPC_TRAIN_TURN_TICKS,
  TICKS_PER_GAME_DAY,
  TRAINED_CAP_SHARE,
  TRAINING_GROUND_MAX_TRAINEES,
  TRAIN_SKILL_FACTOR,
  FOOTPRINT,
  trainedCap,
  WORK_SKILL_MAX,
} from '@csp/balance'
import { goods } from './names.js'
import { AVERAGE_STATS, buildCosts, days, trainingDays, duration, num, pct } from './wiki-view.js'

export function TrainingSection() {
  const groundCost = buildCosts().find((b) => b.kind === 'trainingGround')!
  return (
    <>
      <p>
        Residents train their stats and skills at a <b>training ground</b>, a{' '}
        {num(FOOTPRINT.trainingGround)} × {num(FOOTPRINT.trainingGround)} building that goes
        anywhere off Mountain and off resource nodes and belongs to nobody. It is built from{' '}
        {goods(groundCost.materials)} and {duration(groundCost.buildTicks)} of one average
        resident's work. A ground teaches one subject at a time: a stat (Strength, Endurance,
        Agility, Intellect) or a skill (Combat, Mining, …), the one its teacher set.
      </p>
      <p>
        <b>Teach:</b> a grown resident standing on a finished ground teaches there, naming the
        subject: <i>Teach…</i> on their card, a Teach step in a queue, or a script's{' '}
        <code>teach("strength")</code>. A ground has one teacher at a time; walking off or taking
        another order ends the teaching. The teacher gains nothing.
      </p>
      <p>
        <b>Train:</b> a grown resident standing on the ground trains there with the Train task:{' '}
        <i>Train</i> on their card, a Train step in a queue, or a script's <code>train()</code>. Up
        to {num(TRAINING_GROUND_MAX_TRAINEES)} train at a ground at once. They learn only while a
        teacher is there, and only up to a <b>ceiling</b>: never past the teacher's own value, and
        never past their own cap, a stat's trained bonus at most {pct(TRAINED_CAP_SHARE)} of its
        base, a work skill at most {num(WORK_SKILL_MAX)} points. At their ceiling they wait. The
        ground's card lists the teacher and subject, then each trainee with their value and their
        ceiling.
      </p>
      <p>
        The trainee's Intellect sets the pace (twice the Intellect, twice as fast); the teacher's
        level is only the ceiling. An average learner under a better teacher takes a stat's trained
        bonus from nothing to its cap (+{num(trainedCap(AVERAGE_STATS.strength))} on an average base
        of {num(AVERAGE_STATS.strength)}) in {days(trainingDays('strength'))}, a work skill to{' '}
        {num(WORK_SKILL_MAX)} in {days(trainingDays('mining'))}, {num(TRAIN_SKILL_FACTOR)} times as
        fast as by working (Construction and Driving train that much faster too), and Combat to its
        most in {days(trainingDays('combat'))}. Training costs time and the food trainees eat;
        nothing trained decays, though old age shrinks a trained stat with its base.
      </p>
      <p>
        Players' residents train, by order, queue step or script, and so do the soldiers of a big
        NPC city with a training ground of its own: the one of them with the most Combat teaches, or
        among equals the strongest, and up to {num(TRAINING_GROUND_MAX_TRAINEES)} others train in
        turns of {days(NPC_TRAIN_TURN_TICKS / TICKS_PER_GAME_DAY)}, by the same rules: Combat while
        any of them is below the teacher in it, else Strength. The soldiers its hall and gates need
        stay on their posts, so with too few left the ground stands empty. So it does once nobody
        can learn anything more from the teacher. An alarm takes them from it and they come back
        after. The Trade Organization trains nobody.
      </p>
    </>
  )
}
