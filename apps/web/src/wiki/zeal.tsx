import { DEFEND_CALM_TICKS, RALLY_PACE, ZEAL_CAP_HOURS } from '@csp/balance'
import { duration, num, zealFillRealHours, zealFullRealMinutes } from './wiki-view.js'

export function ZealSection() {
  return (
    <>
      <p>
        <strong>Zeal</strong> is yours, not your realm's: a pool that fills in real time, whether
        you are online or not, from empty to full in about {num(zealFillRealHours())} real hours. A
        full pool holds {num(ZEAL_CAP_HOURS)} game hours of rallying, about{' '}
        {num(zealFullRealMinutes())} real minutes. A new Player starts with it full, and a Leader
        handover or your Leader's death keeps it. It doesn't fill while your Leader rallies the
        crew. The meter in the top bar shows how full it is, and while it doesn't fill.
      </p>
      <p>
        <strong>Rally the crew</strong> is an order for your Leader alone. Stand them at a workplace
        or a construction site and pick Rally the crew on their card or the building's: everyone of
        your realm working there, or building, tearing down or repairing there, works at{' '}
        {num(RALLY_PACE)} times their pace, on top of their skill, Strength and Tools. Your Leader
        does no work of their own meanwhile. Zeal drains a game hour of rallying for every game
        hour, only while somebody is being rallied. It doesn't fill while the order runs, even when
        nobody is at work, and fills again once the rally ends; the building's card says about how
        long it lasts. Only work is faster: not walking, carrying, fetching, training or fighting.
      </p>
      <p>
        It ends when you stop it or give your Leader another order, when they leave the building or
        go Down, or when the Zeal is used up. Whatever Zeal is left stays. It goes on until stopped:
        struck, your Leader defends themself and takes the rally up again once no blow has landed
        for {duration(DEFEND_CALM_TICKS)}, if still at the building. Given under attack, it holds
        until then (see Under attack).
      </p>
      <p>
        It is given by hand only. No script can rally the crew and it can't be a queue step: the
        game API has no call for it, as a script would spend the pool the moment it filled.
      </p>
    </>
  )
}
