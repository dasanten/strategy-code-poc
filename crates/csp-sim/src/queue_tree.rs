//! Walking a queue's tree (`CONTEXT.md`: Queue, Repeat block, If block; ADR 0032): which step
//! comes after the current one, how rounds are counted, which part of an If block runs, and how an
//! edited tree keeps its rounds. Plain data in, plain data out: the runner in [`crate::queues`]
//! applies what a step requests and answers the conditions an If block asks ([`Ask`]).
//!
//! A repeat block's `round` is set (from 1) exactly while the current step is inside it; every
//! other block has round 0. `started` notes that a step started in the round (or, on the queue,
//! since it last began from its top); a round that ends without one ends its block, so a block
//! never spins. An If block's `branch` is set exactly while the current step is inside it, to the
//! part it is in.

use std::collections::HashMap;

use csp_shared::world::{
    Branch, Condition, IfBlock, OrderRequest, Queue, QueueItem, QueueStep, Repeat, RepeatBlock,
};

use crate::queue::{QueueItemRequest, QueueStepRequest};

/// The step's order as kept: plain data, without whom it is for (`keptOrder`).
pub fn kept_order(order: &OrderRequest) -> OrderRequest {
    let mut kept = order.clone();
    kept.fields.shift_remove("residentId");
    kept
}

/// Answers whether a condition holds for the resident now (`CONTEXT.md`: Condition).
pub type Ask<'a> = &'a mut dyn FnMut(&Condition) -> bool;

/// A repeat block's round and whether a step started in it, by block id.
pub type Rounds = HashMap<u32, (u32, bool)>;

/// The rounds of every repeat block in `items`.
pub fn rounds_of(items: &[QueueItem]) -> Rounds {
    let mut out = Rounds::new();
    fn walk(items: &[QueueItem], out: &mut Rounds) {
        for item in items {
            if let QueueItem::Repeat(b) = item {
                out.insert(b.id, (b.round, b.started));
            }
            for part in item.parts() {
                walk(part, out);
            }
        }
    }
    walk(items, &mut out);
    out
}

/// The items a request gives, kept: each without an id gets `next_id++`, in the order listed (a
/// block before its items, an If block's items before its Else part); a repeat block keeps the
/// round it had under its id in `rounds`. An If block's branch is set by [`settle_rounds`].
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
                QueueItemRequest::If(b) => {
                    let id = id();
                    let items = kept_items(&b.items, next_id, rounds);
                    let r#else = b.r#else.as_ref().map(|e| kept_items(e, next_id, rounds));
                    QueueItem::If(IfBlock { id, r#if: b.r#if.clone(), items, r#else, branch: None })
                }
            }
        })
        .collect()
}

fn kept_step(id: u32, s: &QueueStepRequest) -> QueueStep {
    QueueStep { id, order: kept_order(&s.order), minutes: s.minutes }
}

/// One step of a path down the tree: the item's place in its list, and which of its parts
/// (`QueueItem::parts`) the path goes on into: 0 for a block's items, 1 for an If block's Else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seg {
    pub at: usize,
    pub part: usize,
}

const TOP: Seg = Seg { at: 0, part: 0 };

/// The path to step `id`, from the top list down.
pub fn path_to(items: &[QueueItem], id: u32) -> Option<Vec<Seg>> {
    for (at, item) in items.iter().enumerate() {
        if let QueueItem::Step(s) = item {
            if s.id == id {
                return Some(vec![Seg { at, part: 0 }]);
            }
            continue;
        }
        for (part, list) in item.parts().into_iter().enumerate() {
            if let Some(mut rest) = path_to(list, id) {
                rest.insert(0, Seg { at, part });
                return Some(rest);
            }
        }
    }
    None
}

/// The list the last segment of a path points into, given the segments before it.
fn list_at<'a>(items: &'a [QueueItem], parent: &[Seg]) -> &'a [QueueItem] {
    let mut list = items;
    for s in parent {
        list = list[s.at].parts()[s.part];
    }
    list
}

/// A block's part to change: its items, or an If block's Else part.
fn part_mut(item: &mut QueueItem, part: usize) -> &mut Vec<QueueItem> {
    match item {
        QueueItem::Repeat(b) => &mut b.items,
        QueueItem::If(b) => {
            if part == 0 {
                &mut b.items
            } else {
                b.r#else.as_mut().expect("the path goes into the Else part")
            }
        }
        QueueItem::Step(_) => unreachable!("a path goes through blocks"),
    }
}

fn item_at_mut<'a>(items: &'a mut [QueueItem], path: &[Seg]) -> &'a mut QueueItem {
    let (last, parent) = path.split_last().expect("a path has an item");
    let mut list = items;
    for s in parent {
        list = part_mut(&mut list[s.at], s.part);
    }
    &mut list[last.at]
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

/// Goes from the item at `path` (which may be just past the end of its list) to the step that
/// runs next, which becomes current (`CONTEXT.md`: Repeat block, If block): a step is it; a repeat
/// block is entered (round 1); an If block asks its condition once and enters its items when it
/// holds, its Else part when it doesn't, or is passed over without one. Past the end of a block's
/// list it goes on as the block says (`advance`); past the end of the queue, back to its top when
/// it loops and a step started in this pass.
fn settle(q: &mut Queue, mut path: Vec<Seg>, ask: Ask<'_>) -> Advance {
    let mut crossed = false;
    loop {
        let (last, parent) = path.split_last().expect("a path has an item");
        if last.at >= list_at(&q.items, parent).len() {
            path.pop();
            if path.is_empty() {
                if !q.r#loop || !q.started {
                    return Advance::Ended;
                }
                q.started = false;
                path.push(TOP);
                continue;
            }
            crossed = true;
            match item_at_mut(&mut q.items, &path) {
                QueueItem::Repeat(b) if b.started && b.repeat.more_after(b.round) => {
                    b.round += 1;
                    b.started = false;
                    path.push(TOP);
                    continue;
                }
                QueueItem::Repeat(b) => {
                    b.round = 0;
                    b.started = false;
                }
                QueueItem::If(b) => b.branch = None,
                QueueItem::Step(_) => unreachable!("a path goes through blocks"),
            }
            path.last_mut().expect("a block").at += 1;
            continue;
        }
        match item_at_mut(&mut q.items, &path) {
            QueueItem::Step(s) => {
                q.current = s.id;
                return Advance::Moved { crossed };
            }
            QueueItem::Repeat(b) => {
                b.round = 1;
                b.started = false;
                crossed = true;
                path.last_mut().expect("an item").part = 0;
                path.push(TOP);
            }
            QueueItem::If(b) => {
                crossed = true;
                let branch = if ask(&b.r#if) {
                    Some(Branch::Then)
                } else if b.r#else.is_some() {
                    Some(Branch::Else)
                } else {
                    None
                };
                b.branch = branch;
                let here = path.last_mut().expect("an item");
                match branch {
                    Some(branch) => {
                        here.part = usize::from(branch == Branch::Else);
                        path.push(TOP);
                    }
                    None => here.at += 1,
                }
            }
        }
    }
}

/// Makes the queue's first step current, entering the blocks around it and asking the If blocks
/// on the way. `Ended` when there is no step to run: every If on the way passed over.
pub fn begin(q: &mut Queue, ask: Ask<'_>) -> Advance {
    settle(q, vec![TOP], ask)
}

/// Moves the queue on from its current step (`CONTEXT.md`: Repeat block, If block): to the next
/// item in its list; at the end of a block's round, to the block's next round when a step started
/// in this one and the count allows, else past the block; at the end of an If block's part, past
/// the block; at the end of the queue, back to its top when it loops and a step started in this
/// pass. An If block reached on the way asks its condition once.
pub fn advance(q: &mut Queue, ask: Ask<'_>) -> Advance {
    let Some(mut path) = path_to(&q.items, q.current) else { return Advance::Ended };
    q.started_at = None;
    path.last_mut().expect("a path has an item").at += 1;
    settle(q, path, ask)
}

/// Notes that the current step started: in the queue's pass and in each repeat block's round
/// around it.
pub fn mark_started(q: &mut Queue) {
    q.started = true;
    let Some(path) = path_to(&q.items, q.current) else { return };
    for depth in 1..path.len() {
        if let QueueItem::Repeat(b) = item_at_mut(&mut q.items, &path[..depth]) {
            b.started = true;
        }
    }
}

/// The part of a block a path is in: what an If block's `branch` is while the path is inside it.
fn branch_of(part: usize) -> Branch {
    if part == 0 {
        Branch::Then
    } else {
        Branch::Else
    }
}

/// Puts the rounds and branches right after an edit: each repeat block around the current step
/// is in a round, at least the first and at most its count, and each If block around it in the
/// part it is in; every other block is in none.
pub fn settle_rounds(q: &mut Queue) {
    let path = path_to(&q.items, q.current).unwrap_or_default();
    fn walk(items: &mut [QueueItem], on_path: Option<&[Seg]>) {
        for (i, item) in items.iter_mut().enumerate() {
            let here = on_path.filter(|p| p.len() > 1 && p[0].at == i);
            let inner = |part: usize| here.filter(|p| p[0].part == part).map(|p| &p[1..]);
            match item {
                QueueItem::Step(_) => {}
                QueueItem::Repeat(b) => {
                    if here.is_some() {
                        let most = match b.repeat {
                            Repeat::Times(n) => n,
                            Repeat::Forever(_) => u32::MAX,
                        };
                        b.round = b.round.clamp(1, most.max(1));
                    } else {
                        b.round = 0;
                        b.started = false;
                    }
                    walk(&mut b.items, inner(0));
                }
                QueueItem::If(b) => {
                    b.branch = here.map(|p| branch_of(p[0].part));
                    walk(&mut b.items, inner(0));
                    if let Some(e) = &mut b.r#else {
                        walk(e, inner(1));
                    }
                }
            }
        }
    }
    walk(&mut q.items, Some(&path));
}

/// The ids of every step and block, in the order listed (a block before its items, an If
/// block's items before its Else part).
pub fn ids_of(items: &[QueueItem]) -> Vec<u32> {
    let mut out = Vec::new();
    fn walk(items: &[QueueItem], out: &mut Vec<u32>) {
        for item in items {
            out.push(item.id());
            for part in item.parts() {
                walk(part, out);
            }
        }
    }
    walk(items, &mut out);
    out
}

/// The ids of the blocks among `items`.
pub fn block_ids(items: &[QueueItem]) -> Vec<u32> {
    let mut out = Vec::new();
    fn walk(items: &[QueueItem], out: &mut Vec<u32>) {
        for item in items {
            if !matches!(item, QueueItem::Step(_)) {
                out.push(item.id());
            }
            for part in item.parts() {
                walk(part, out);
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
            block => 1 + block.parts().into_iter().map(depth_of).max().unwrap_or(0),
        })
        .max()
        .unwrap_or(0)
}

/// What is wrong with the blocks' rounds and branches, if anything (the invariant's half on
/// them): a repeat block around the current step runs a round within its count, every other none;
/// an If block around it is in the part holding it, every other in none; and no block's items
/// (nor an Else part) are empty.
pub fn rounds_problem(q: &Queue) -> Option<String> {
    let path = path_to(&q.items, q.current)?;
    fn walk(items: &[QueueItem], on_path: Option<&[Seg]>) -> Option<String> {
        for (i, item) in items.iter().enumerate() {
            if let QueueItem::Step(_) = item {
                continue;
            }
            if item.parts().iter().any(|p| p.is_empty()) {
                return Some(format!("has an empty block {}", item.id()));
            }
            let here = on_path.filter(|p| p.len() > 1 && p[0].at == i);
            match item {
                QueueItem::Repeat(b) => {
                    let within = match b.repeat {
                        Repeat::Times(n) => b.round <= n,
                        Repeat::Forever(_) => true,
                    };
                    if here.is_some() && (b.round == 0 || !within) {
                        return Some(format!(
                            "runs round {} of block {} around its step",
                            b.round, b.id
                        ));
                    }
                    if here.is_none() && (b.round != 0 || b.started) {
                        return Some(format!(
                            "runs round {} of block {} away from its step",
                            b.round, b.id
                        ));
                    }
                }
                QueueItem::If(b) => {
                    let should = here.map(|p| branch_of(p[0].part));
                    if b.branch != should {
                        return Some(format!(
                            "has If block {} on {:?} where its step is in {:?}",
                            b.id, b.branch, should
                        ));
                    }
                }
                QueueItem::Step(_) => {}
            }
            for (part, list) in item.parts().into_iter().enumerate() {
                let inner = here.filter(|p| p[0].part == part).map(|p| &p[1..]);
                if let Some(p) = walk(list, inner) {
                    return Some(p);
                }
            }
        }
        None
    }
    walk(&q.items, Some(&path))
}

#[cfg(test)]
mod tests;
