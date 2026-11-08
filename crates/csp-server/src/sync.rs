//! What each connection was sent, so each tick sends only the difference (ADR 0006;
//! `apps/server/src/sync.ts`): entities in sight that changed, and ids that left sight.
//!
//! The TypeScript keys its caches by object identity (`Map<readonly T[], Sent>`). Here a list is
//! an `Arc<[T]>` and what a view was sent an `Arc` too, keyed by address while the round holds a
//! clone (so no address is reused within the round): views that diff against one list end up
//! holding one `Sent`, and from then on they share one diff, worked out once.

use std::collections::HashMap;
use std::sync::Arc;

use indexmap::IndexMap;
use serde::Serialize;

/// An entity a view can be sent: anything with a string id.
pub trait HasId {
    fn id(&self) -> &str;
}

/// What changed for a view since it was last sent, and the ids that left sight.
#[derive(Debug, Clone, PartialEq)]
pub struct Diff<T> {
    pub changed: Vec<T>,
    pub gone: Vec<String>,
}

/// What one connection was last sent, as JSON by id. Never changed once made, so views share it.
pub type Sent = Arc<IndexMap<String, Arc<str>>>;

/// How an entity is turned into JSON for the tick message.
pub type ToJson<T> = Box<dyn Fn(&T) -> String + Send>;

fn key<T: ?Sized>(a: &Arc<T>) -> usize {
    Arc::as_ptr(a) as *const () as usize
}

struct Known<T> {
    /// The list the diff was worked out against, kept so its address stays its own.
    list: Arc<[T]>,
    /// What views were sent before, kept for the same reason.
    _before: Sent,
    diff: Arc<Diff<T>>,
    after: Sent,
    fragment: Option<Arc<str>>,
}

/// One tick's sync for every connection (Epic 49): each entity in a list is turned into JSON once
/// however many views diff against that list, and views that were sent the same get the same
/// diff, worked out once. A realm's sockets get the same list from the sight cache, so all of a
/// realm's in-step sockets share the work. Made for one broadcast and dropped after it.
pub struct SyncRound<T> {
    json: ToJson<T>,
    /// Each list as JSON by id: what a view that diffed against it was sent afterwards.
    lists: HashMap<usize, (Arc<[T]>, Sent)>,
    /// The diff worked out from what views were sent before, by the address of that `Sent`.
    diffs: HashMap<usize, Known<T>>,
    /// Which `diffs` entry made each diff, by the diff's address.
    made: HashMap<usize, usize>,
}

impl<T: Serialize> Default for SyncRound<T> {
    fn default() -> Self {
        Self::new(Box::new(|e: &T| serde_json::to_string(e).expect("serialisable")))
    }
}

impl<T> SyncRound<T> {
    pub fn new(json: ToJson<T>) -> Self {
        Self { json, lists: HashMap::new(), diffs: HashMap::new(), made: HashMap::new() }
    }
}

impl<T: HasId + Clone> SyncRound<T> {
    /// The list as JSON by id, made once.
    pub fn sent(&mut self, list: &Arc<[T]>) -> Sent {
        if let Some((_, sent)) = self.lists.get(&key(list)) {
            return Arc::clone(sent);
        }
        let sent: Sent =
            Arc::new(list.iter().map(|e| (e.id().to_owned(), Arc::from((self.json)(e)))).collect());
        self.lists.insert(key(list), (Arc::clone(list), Arc::clone(&sent)));
        sent
    }

    /// The diff of `before` against the list, worked out once per `before` and list.
    pub fn diff(&mut self, before: &Sent, list: &Arc<[T]>) -> Arc<Diff<T>> {
        if let Some(known) = self.diffs.get(&key(before)) {
            if Arc::ptr_eq(&known.list, list) {
                return Arc::clone(&known.diff);
            }
        }
        let after = self.sent(list);
        // The pointer first, as `!==` on strings checks the reference before the characters:
        // views in step share one diff, so this runs once per group of them, not once per socket.
        let changed = list
            .iter()
            .filter(|e| match (before.get(e.id()), after.get(e.id())) {
                (Some(b), Some(a)) => !(Arc::ptr_eq(b, a) || b == a),
                _ => true,
            })
            .cloned()
            .collect();
        let gone = before.keys().filter(|id| !after.contains_key(*id)).cloned().collect();
        let diff = Arc::new(Diff { changed, gone });
        self.made.insert(key(&diff), key(before));
        self.diffs.insert(
            key(before),
            Known {
                list: Arc::clone(list),
                _before: Arc::clone(before),
                diff: Arc::clone(&diff),
                after,
                fragment: None,
            },
        );
        diff
    }

    /// `"changed":[…],"gone":[…]` for a diff this round made, from the JSON it already has, so
    /// the tick message of every socket that shares the diff splices in the same string. Panics
    /// for a diff of another round.
    pub fn fragment(&mut self, diff: &Arc<Diff<T>>) -> Arc<str> {
        let at = *self.made.get(&key(diff)).expect("not a diff of this round");
        let known = self.diffs.get_mut(&at).expect("not a diff of this round");
        if let Some(out) = &known.fragment {
            return Arc::clone(out);
        }
        let json: Vec<&str> = diff.changed.iter().map(|e| &*known.after[e.id()]).collect();
        let gone = serde_json::to_string(&diff.gone).expect("strings");
        let out: Arc<str> = Arc::from(format!("\"changed\":[{}],\"gone\":{gone}", json.join(",")));
        known.fragment = Some(Arc::clone(&out));
        out
    }
}

/// What one connection has been sent so far, so each tick only sends the difference (ADR 0006).
/// The same keeps a Player's Last seen out of sight in step. Within a [`SyncRound`] the views
/// that diff against one list end up sharing what they were sent, so from then on they share the
/// work.
pub struct ClientView {
    sent: Sent,
}

impl Default for ClientView {
    fn default() -> Self {
        ClientView { sent: Arc::new(IndexMap::new()) }
    }
}

impl ClientView {
    pub fn new() -> Self {
        Self::default()
    }

    /// Everything in sight, for the welcome message; remembers it as sent.
    pub fn initial<T: HasId + Clone + Serialize>(&mut self, entities: &[T]) -> Vec<T> {
        self.sent = Arc::new(
            entities
                .iter()
                .map(|e| {
                    let json = serde_json::to_string(e).expect("serialisable");
                    (e.id().to_owned(), Arc::from(json))
                })
                .collect(),
        );
        entities.to_vec()
    }

    /// What changed since the view was last sent, worked out in `round`.
    pub fn diff<T: HasId + Clone>(
        &mut self,
        entities: &Arc<[T]>,
        round: &mut SyncRound<T>,
    ) -> Arc<Diff<T>> {
        let diff = round.diff(&self.sent, entities);
        self.sent = round.sent(entities);
        diff
    }

    /// [`ClientView::diff`] in a round of its own.
    pub fn diff_alone<T: HasId + Clone + Serialize>(&mut self, entities: &Arc<[T]>) -> Diff<T> {
        let mut round = SyncRound::default();
        (*self.diff(entities, &mut round)).clone()
    }
}

#[cfg(test)]
mod tests {
    //! `sync.test.ts`'s `ClientView` cases (its `OrderQueue` cases are T86.2's), on a small
    //! entity of id and place: what is tested is the bookkeeping, not the entity.
    use std::sync::Mutex;

    use super::*;

    #[derive(Debug, Clone, PartialEq, Serialize)]
    struct Unit {
        id: String,
        owner: &'static str,
        x: i32,
        y: i32,
    }

    impl HasId for Unit {
        fn id(&self) -> &str {
            &self.id
        }
    }

    fn unit(id: &str, x: i32) -> Unit {
        Unit { id: id.into(), owner: "red", x, y: 0 }
    }

    fn list(units: Vec<Unit>) -> Arc<[Unit]> {
        units.into()
    }

    fn diff(changed: Vec<Unit>, gone: &[&str]) -> Diff<Unit> {
        Diff { changed, gone: gone.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn sends_only_what_changed_and_what_left_sight() {
        let mut view = ClientView::new();
        view.initial(&[unit("a", 0), unit("b", 0)]);
        assert_eq!(view.diff_alone(&list(vec![unit("a", 0), unit("b", 0)])), diff(vec![], &[]));
        assert_eq!(
            view.diff_alone(&list(vec![unit("a", 1), unit("c", 0)])),
            diff(vec![unit("a", 1), unit("c", 0)], &["b"])
        );
        assert_eq!(view.diff_alone(&list(vec![unit("a", 1), unit("c", 0)])), diff(vec![], &[]));
    }

    #[test]
    fn turns_each_entity_into_json_once_per_round_and_shares_the_diff_of_views_sent_the_same() {
        let made = Arc::new(Mutex::new(Vec::<String>::new()));
        let json = || -> ToJson<Unit> {
            let made = Arc::clone(&made);
            Box::new(move |e: &Unit| {
                made.lock().unwrap().push(e.id.clone());
                serde_json::to_string(e).unwrap()
            })
        };
        let mut views: Vec<ClientView> = (0..3).map(|_| ClientView::new()).collect();
        for v in &mut views {
            v.initial(&[unit("a", 0), unit("b", 0)]);
        }
        let l = list(vec![unit("a", 1), unit("c", 0)]);
        let mut round = SyncRound::new(json());
        let diffs: Vec<_> = views.iter_mut().map(|v| v.diff(&l, &mut round)).collect();
        let mut seen = made.lock().unwrap().clone();
        seen.sort();
        assert_eq!(seen, ["a", "c"]);
        assert_eq!(*diffs[0], diff(vec![unit("a", 1), unit("c", 0)], &["b"]));
        // Welcomed apart, they were sent equal strings but not the same: each diffs on its own,
        // then they share what they were sent.
        let mut next = SyncRound::new(json());
        let moved = list(vec![unit("a", 2), unit("c", 0)]);
        let diffs: Vec<_> = views.iter_mut().map(|v| v.diff(&moved, &mut next)).collect();
        for d in &diffs[1..] {
            assert!(Arc::ptr_eq(d, &diffs[0]));
        }
        assert_eq!(*diffs[0], diff(vec![unit("a", 2)], &[]));
        let expected =
            format!("\"changed\":[{}],\"gone\":[]", serde_json::to_string(&unit("a", 2)).unwrap());
        assert_eq!(&*next.fragment(&diffs[0]), expected);
    }

    #[test]
    fn gives_a_view_that_joined_this_round_its_own_diff_and_keeps_it_in_step_after() {
        let l = list(vec![unit("a", 0), unit("b", 0)]);
        let mut old = ClientView::new();
        old.initial(&[unit("a", 0)]);
        let mut round = SyncRound::default();
        let mut fresh = ClientView::new();
        fresh.initial(&[unit("a", 0), unit("b", 0)]);
        assert_eq!(*old.diff(&l, &mut round), diff(vec![unit("b", 0)], &[]));
        assert_eq!(*fresh.diff(&l, &mut round), diff(vec![], &[]));
        let mut next = SyncRound::default();
        let after = list(vec![unit("a", 1)]);
        let d = fresh.diff(&after, &mut next);
        assert!(Arc::ptr_eq(&old.diff(&after, &mut next), &d));
        assert_eq!(*d, diff(vec![unit("a", 1)], &["b"]));
    }
}
