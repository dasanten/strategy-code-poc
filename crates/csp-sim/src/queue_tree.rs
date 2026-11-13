//! Walking a queue's tree (`CONTEXT.md`: Queue, Repeat block; ADR 0032): which step comes after
//! the current one, how rounds are counted, and how an edited tree keeps its rounds. Plain data in,
//! plain data out: the runner in [`crate::queues`] applies what a step requests.
//!
//! A block's `round` is set (from 1) exactly while the current step is inside it; every other
//! block has round 0. `started` notes that a step started in the round (or, on the queue, since it
//! last began from its top); a round that ends without one ends its block, so a block never spins.

use std::collections::HashMap;

use csp_shared::world::{OrderRequest, Queue, QueueItem, QueueStep, Repeat, RepeatBlock};

use crate::queue::{QueueItemRequest, QueueStepRequest};

/// The step's order as kept: plain data, without whom it is for (`keptOrder`).
pub fn kept_order(order: &OrderRequest) -> OrderRequest {
    let mut kept = order.clone();
    kept.fields.shift_remove("residentId");
    kept
}

/// A block's round and whether a step started in it, by block id.
pub type Rounds = HashMap<u32, (u32, bool)>;

/// The rounds of every block in `items`.
pub fn rounds_of(items: &[QueueItem]) -> Rounds {
    let mut out = Rounds::new();
    fn walk(items: &[QueueItem], out: &mut Rounds) {
        for item in items {
            if let QueueItem::Repeat(b) = item {
                out.insert(b.id, (b.round, b.started));
                walk(&b.items, out);
            }
        }
    }
    walk(items, &mut out);
    out
}

/// The items a request gives, kept: each without an id gets `next_id++`, in the order listed (a
/// block before its items); a block keeps the round it had under its id in `rounds`.
pub fn kept_items(reqs: &[QueueItemRequest], next_id: &mut u32, rounds: &Rounds) -> Vec<QueueItem> {
    reqs.iter()
        .map(|item| {
            let mut id = || {
                item.id().unwrap_or_else(|| {
                    *next_id += 1;
                    *next_id - 1
                })
            };
            match item {
                QueueItemRequest::Step(s) => QueueItem::Step(kept_step(id(), s)),
                QueueItemRequest::Repeat(b) => {
                    let id = id();
                    let (round, started) = rounds.get(&id).copied().unwrap_or((0, false));
                    QueueItem::Repeat(RepeatBlock {
                        id,
                        repeat: b.repeat,
                        items: kept_items(&b.items, next_id, rounds),
                        round,
                        started,
                    })
                }
            }
        })
        .collect()
}

fn kept_step(id: u32, s: &QueueStepRequest) -> QueueStep {
    QueueStep { id, order: kept_order(&s.order), minutes: s.minutes }
}

/// The path of indices to step `id`, from the top list down.
pub fn path_to(items: &[QueueItem], id: u32) -> Option<Vec<usize>> {
    for (i, item) in items.iter().enumerate() {
        match item {
            QueueItem::Step(s) if s.id == id => return Some(vec![i]),
            QueueItem::Step(_) => {}
            QueueItem::Repeat(b) => {
                if let Some(mut rest) = path_to(&b.items, id) {
                    rest.insert(0, i);
                    return Some(rest);
                }
            }
        }
    }
    None
}

/// The list the last index of `path` points into: the top list, or a block's items.
fn list_at<'a>(items: &'a [QueueItem], parent: &[usize]) -> &'a [QueueItem] {
    let mut list = items;
    for &i in parent {
        match &list[i] {
            QueueItem::Repeat(b) => list = &b.items,
            QueueItem::Step(_) => unreachable!("a path goes through blocks"),
        }
    }
    list
}

fn item_at_mut<'a>(items: &'a mut [QueueItem], path: &[usize]) -> &'a mut QueueItem {
    let (&last, parent) = path.split_last().expect("a path has an item");
    let mut list = items;
    for &i in parent {
        match &mut list[i] {
            QueueItem::Repeat(b) => list = &mut b.items,
            QueueItem::Step(_) => unreachable!("a path goes through blocks"),
        }
    }
    &mut list[last]
}

fn block_at_mut<'a>(items: &'a mut [QueueItem], path: &[usize]) -> &'a mut RepeatBlock {
    match item_at_mut(items, path) {
        QueueItem::Repeat(b) => b,
        QueueItem::Step(_) => unreachable!("the path names a block"),
    }
}

/// Goes down from the item at `path` to its first step, entering each block on the way (round 1);
/// the step becomes current. True when a block was entered.
fn descend(q: &mut Queue, mut path: Vec<usize>) -> bool {
    let mut entered = false;
    loop {
        match item_at_mut(&mut q.items, &path) {
            QueueItem::Step(s) => {
                q.current = s.id;
                return entered;
            }
            QueueItem::Repeat(b) => {
                b.round = 1;
                b.started = false;
                entered = true;
                path.push(0);
            }
        }
    }
}

/// Makes the queue's first step current, entering the blocks around it.
pub fn begin(q: &mut Queue) {
    descend(q, vec![0]);
}

/// Where the queue went from its current step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Advance {
    /// To the next step; `crossed` when it entered or left a block or began a block's next round.
    Moved { crossed: bool },
    /// The queue is over: past its last step without loop, or looping after a pass that started
    /// no step.
    Ended,
}

/// Moves the queue on from its current step (`CONTEXT.md`: Repeat block): to the next item in its
/// list; at the end of a block's round, to the block's next round when a step started in this one
/// and the count allows, else past the block; at the end of the queue, back to its top when it
/// loops and a step started in this pass.
pub fn advance(q: &mut Queue) -> Advance {
    let Some(mut path) = path_to(&q.items, q.current) else { return Advance::Ended };
    q.started_at = None;
    let mut crossed = false;
    loop {
        let last = path.pop().expect("a path has an item");
        if last + 1 < list_at(&q.items, &path).len() {
            path.push(last + 1);
            break;
        }
        if path.is_empty() {
            if !q.r#loop || !q.started {
                return Advance::Ended;
            }
            q.started = false;
            path.push(0);
            break;
        }
        crossed = true;
        let b = block_at_mut(&mut q.items, &path);
        if b.started && b.repeat.more_after(b.round) {
            b.round += 1;
            b.started = false;
            path.push(0);
            break;
        }
        b.round = 0;
        b.started = false;
    }
    let entered = descend(q, path);
    Advance::Moved { crossed: crossed || entered }
}

/// Notes that the current step started: in the queue's pass and in each block's round around it.
pub fn mark_started(q: &mut Queue) {
    q.started = true;
    let Some(path) = path_to(&q.items, q.current) else { return };
    for depth in 1..path.len() {
        block_at_mut(&mut q.items, &path[..depth]).started = true;
    }
}

/// Puts the rounds right after an edit: each block around the current step is in a round, at
/// least the first and at most its count; every other block is in none.
pub fn settle_rounds(q: &mut Queue) {
    let path = path_to(&q.items, q.current).unwrap_or_default();
    fn walk(items: &mut [QueueItem], on_path: Option<&[usize]>) {
        for (i, item) in items.iter_mut().enumerate() {
            let QueueItem::Repeat(b) = item else { continue };
            let inner = on_path.filter(|p| p.len() > 1 && p[0] == i).map(|p| &p[1..]);
            if inner.is_some() {
                let most = match b.repeat {
                    Repeat::Times(n) => n,
                    Repeat::Forever(_) => u32::MAX,
                };
                b.round = b.round.clamp(1, most.max(1));
            } else {
                b.round = 0;
                b.started = false;
            }
            walk(&mut b.items, inner);
        }
    }
    walk(&mut q.items, Some(&path));
}

/// The ids of every step and block, in the order listed (a block before its items).
pub fn ids_of(items: &[QueueItem]) -> Vec<u32> {
    let mut out = Vec::new();
    fn walk(items: &[QueueItem], out: &mut Vec<u32>) {
        for item in items {
            match item {
                QueueItem::Step(s) => out.push(s.id),
                QueueItem::Repeat(b) => {
                    out.push(b.id);
                    walk(&b.items, out);
                }
            }
        }
    }
    walk(items, &mut out);
    out
}

/// The ids of the blocks among `items`.
pub fn block_ids(items: &[QueueItem]) -> Vec<u32> {
    let steps: Vec<u32> = collect_step_ids(items);
    ids_of(items).into_iter().filter(|id| !steps.contains(id)).collect()
}

fn collect_step_ids(items: &[QueueItem]) -> Vec<u32> {
    let mut out = Vec::new();
    fn walk(items: &[QueueItem], out: &mut Vec<u32>) {
        for item in items {
            match item {
                QueueItem::Step(s) => out.push(s.id),
                QueueItem::Repeat(b) => walk(&b.items, out),
            }
        }
    }
    walk(items, &mut out);
    out
}

/// How deep the blocks nest: 0 for a list of steps.
pub fn depth_of(items: &[QueueItem]) -> u32 {
    items
        .iter()
        .map(|item| match item {
            QueueItem::Step(_) => 0,
            QueueItem::Repeat(b) => 1 + depth_of(&b.items),
        })
        .max()
        .unwrap_or(0)
}

/// What is wrong with the blocks' rounds, if anything (the invariant's half on rounds): a block
/// around the current step runs a round within its count, every other block none, and none is
/// empty.
pub fn rounds_problem(q: &Queue) -> Option<String> {
    let path = path_to(&q.items, q.current)?;
    fn walk(items: &[QueueItem], on_path: Option<&[usize]>) -> Option<String> {
        for (i, item) in items.iter().enumerate() {
            let QueueItem::Repeat(b) = item else { continue };
            if b.items.is_empty() {
                return Some(format!("has an empty block {}", b.id));
            }
            let inner = on_path.filter(|p| p.len() > 1 && p[0] == i).map(|p| &p[1..]);
            let within = match b.repeat {
                Repeat::Times(n) => b.round <= n,
                Repeat::Forever(_) => true,
            };
            if inner.is_some() && (b.round == 0 || !within) {
                return Some(format!("runs round {} of block {} around its step", b.round, b.id));
            }
            if inner.is_none() && (b.round != 0 || b.started) {
                return Some(format!(
                    "runs round {} of block {} away from its step",
                    b.round, b.id
                ));
            }
            if let Some(p) = walk(&b.items, inner) {
                return Some(p);
            }
        }
        None
    }
    walk(&q.items, Some(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::world::Forever;
    use serde_json::json;

    fn step(id: u32) -> QueueItem {
        QueueItem::Step(QueueStep {
            id,
            order: serde_json::from_value(json!({ "kind": "walkTo", "x": 1, "y": 1 })).unwrap(),
            minutes: None,
        })
    }

    fn block(id: u32, repeat: Repeat, items: Vec<QueueItem>) -> QueueItem {
        QueueItem::Repeat(RepeatBlock { id, repeat, items, round: 0, started: false })
    }

    fn queue(items: Vec<QueueItem>, r#loop: bool) -> Queue {
        let mut q = Queue {
            realm_id: "r".into(),
            next_step_id: ids_of(&items).into_iter().max().unwrap_or(0) + 1,
            items,
            current: 0,
            started_at: None,
            r#loop,
            started: false,
        };
        begin(&mut q);
        q
    }

    /// The steps the queue runs, every one starting, until it ends or `most` are done.
    fn run(q: &mut Queue, most: usize) -> Vec<u32> {
        let mut out = vec![];
        loop {
            out.push(q.current);
            mark_started(q);
            assert_eq!(rounds_problem(q), None);
            if out.len() == most || advance(q) == Advance::Ended {
                return out;
            }
        }
    }

    #[test]
    fn a_nested_repeat_runs_its_rounds() {
        let inner = block(3, Repeat::Times(2), vec![step(4)]);
        let mut q =
            queue(vec![step(1), block(2, Repeat::Times(2), vec![inner, step(5)]), step(6)], false);
        assert_eq!(run(&mut q, 100), vec![1, 4, 4, 5, 4, 4, 5, 6]);
    }

    #[test]
    fn forever_runs_until_a_round_starts_nothing() {
        let mut q =
            queue(vec![block(1, Repeat::Forever(Forever::Forever), vec![step(2), step(3)])], false);
        assert_eq!(run(&mut q, 7), vec![2, 3, 2, 3, 2, 3, 2]);
        // A round in which no step starts ends the block, and with it this queue.
        let mut q =
            queue(vec![block(1, Repeat::Forever(Forever::Forever), vec![step(2)]), step(3)], false);
        assert_eq!(advance(&mut q), Advance::Moved { crossed: true });
        assert_eq!(q.current, 3);
    }

    #[test]
    fn a_looping_queue_ends_after_a_pass_that_started_nothing() {
        let mut q = queue(vec![step(1), step(2)], true);
        assert_eq!(advance(&mut q), Advance::Moved { crossed: false });
        assert_eq!(advance(&mut q), Advance::Ended);
        let mut q = queue(vec![step(1), step(2)], true);
        assert_eq!(run(&mut q, 5), vec![1, 2, 1, 2, 1]);
    }

    #[test]
    fn an_edit_keeps_the_rounds_by_id_and_settles_them() {
        let mut q = queue(vec![block(1, Repeat::Times(5), vec![step(2), step(3)])], false);
        run(&mut q, 5);
        assert_eq!(rounds_of(&q.items)[&1].0, 3);
        // Lowered below the round it is on, it runs its last round.
        let reqs: Vec<QueueItemRequest> = serde_json::from_value(json!([
            { "id": 1, "repeat": 2, "items": [{ "id": 2, "order": { "kind": "walkTo" } }] },
            { "repeat": 4, "items": [{ "order": { "kind": "walkTo" } }] },
        ]))
        .unwrap();
        let mut next = q.next_step_id;
        q.items = kept_items(&reqs, &mut next, &rounds_of(&q.items));
        q.current = 2;
        settle_rounds(&mut q);
        assert_eq!(rounds_problem(&q), None);
        assert_eq!(rounds_of(&q.items)[&1].0, 2);
        assert_eq!(rounds_of(&q.items)[&4].0, 0);
        assert_eq!(ids_of(&q.items), vec![1, 2, 4, 5]);
    }

    #[test]
    fn rounds_problem_finds_a_round_out_of_its_count_or_away_from_the_step() {
        let mut q = queue(vec![block(1, Repeat::Times(2), vec![step(2)]), step(3)], false);
        assert_eq!(rounds_problem(&q), None);
        block_at_mut(&mut q.items, &[0]).round = 3;
        assert!(rounds_problem(&q).unwrap().contains("round 3 of block 1 around"));
        q.current = 3;
        assert!(rounds_problem(&q).unwrap().contains("away from its step"));
    }
}
