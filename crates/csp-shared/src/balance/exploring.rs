//! Waypoints and exploring.

use super::*;

balance! {
/// The most waypoints a Player holds (`CONTEXT.md`: Waypoint): enough to mark passes, nodes and
/// meeting points across a wide realm, few enough that the drawer and the map stay readable.
pub const WAYPOINTS_MAX: f64 = 50.0;

/// The Food an explorer keeps beyond what the way back needs (`CONTEXT.md`: Explore), in units:
/// they turn back once the Food on them, a rider's horse's included, covers no more than the way
/// back plus this. Their own food (`OWN_FOOD`) and a unit more: a horse eats only what its rider
/// carries beyond their own food, so it eats all the way home, and an estimate a little short of
/// the real way still gets them there.
pub const EXPLORE_FOOD_MARGIN: f64 = OWN_FOOD + 1.0;

/// How far around a place the edge of a Player's explored terrain is looked for (`exploredEdge`),
/// in tiles along each direction. Sight reaches `SIGHT_RANGE`, so an explorer finds the edge well
/// inside it; this only bounds the search where none is near.
pub const EXPLORED_EDGE_RANGE: f64 = 4.0 * SIGHT_RANGE;

/// How near a tile the Explore default found no way to it may lie and still be left out of the
/// edge it looks for next (`exploredEdge`'s `skip`), in tiles: the far shore of a lake goes along
/// with the tile it tried.
pub const EXPLORE_SKIP_RANGE: f64 = 8.0;
}
