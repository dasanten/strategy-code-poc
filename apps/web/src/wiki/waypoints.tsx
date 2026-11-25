import { WAYPOINTS_MAX, WAYPOINT_NAME_MAX_LENGTH } from '@csp/balance'
import { num } from './wiki-view.js'

export function WaypointsSection() {
  return (
    <>
      <p>
        A waypoint is a named marker you put on a tile: a mountain pass, a node you mean to come
        back to, where your residents meet. Right-click a tile on the map, or long-press it on a
        touch screen, while no resident is picked and choose Add waypoint here; the card of any tile
        you click has Add waypoint too. Only you see your waypoints: on the map at every zoom, on
        the minimap, and in the Waypoints tab of the sidebar, where you can rename one, centre the
        map on it or remove it. All of that is free and at once.
      </p>
      <p>
        You hold at most {num(WAYPOINTS_MAX)} waypoints, each with a name of up to{' '}
        {num(WAYPOINT_NAME_MAX_LENGTH)} characters that need not be unique. They are kept with you,
        not your realm, so they are still there if your Leader dies and you found a new realm.
      </p>
      <p>
        A waypoint is a place like a tile. While an order waits for where to go or act (Walk to on a
        resident or group card, a place for a step in the queue planner), click a waypoint’s pin on
        the map, or open the Waypoints tab from the banner and press Pick beside it: the order gets
        the waypoint’s tile. A queue step keeps that tile, so it still goes there if you remove the
        waypoint later, and the queue names the waypoint while it is there.
      </p>
      <p>
        Scripts see your waypoints with <code>waypoints()</code> and can put one down with{' '}
        <code>addWaypoint(x, y, name)</code> or take one away with{' '}
        <code>removeWaypoint(waypoint)</code>, free and at once, without stopping the script. The
        same cap counts there too.
      </p>
    </>
  )
}
