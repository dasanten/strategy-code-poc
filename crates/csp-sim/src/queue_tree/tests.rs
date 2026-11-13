use super::*;
use csp_shared::world::{Forever, Repeat, RepeatUntil};
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
    begin(&mut q, &mut |_| true);
    q
}

/// The steps the queue runs, every one starting, until it ends or `most` are done.
fn run(q: &mut Queue, most: usize) -> Vec<u32> {
    let mut out = vec![];
    loop {
        out.push(q.current);
        mark_started(q);
        assert_eq!(rounds_problem(q), None);
        if out.len() == most || advance(q, &mut |_| true) == Advance::Ended {
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
    assert_eq!(advance(&mut q, &mut |_| true), Advance::Moved { crossed: true });
    assert_eq!(q.current, 3);
}

#[test]
fn a_looping_queue_ends_after_a_pass_that_started_nothing() {
    let mut q = queue(vec![step(1), step(2)], true);
    assert_eq!(advance(&mut q, &mut |_| true), Advance::Moved { crossed: false });
    assert_eq!(advance(&mut q, &mut |_| true), Advance::Ended);
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
    let QueueItem::Repeat(b) = &mut q.items[0] else { panic!("a block") };
    b.round = 3;
    assert!(rounds_problem(&q).unwrap().contains("round 3 of block 1 around"));
    q.current = 3;
    assert!(rounds_problem(&q).unwrap().contains("away from its step"));
}

fn iff(id: u32, items: Vec<QueueItem>, r#else: Option<Vec<QueueItem>>) -> QueueItem {
    let r#if = serde_json::from_value(json!({ "kind": "mounted", "is": true })).unwrap();
    QueueItem::If(IfBlock { id, r#if, items, r#else, branch: None })
}

/// The steps the queue runs with every If answered by `answers` in turn, until it ends or `most`
/// are done, and how many times it asked.
fn run_asking(items: Vec<QueueItem>, r#loop: bool, answers: &[bool], most: usize) -> Vec<u32> {
    let mut asked = answers.iter().copied();
    let mut ask = |_: &Condition| asked.next().expect("asked more often than answered");
    let mut q = Queue {
        realm_id: "r".into(),
        next_step_id: ids_of(&items).into_iter().max().unwrap_or(0) + 1,
        items,
        current: 0,
        started_at: None,
        r#loop,
        started: false,
    };
    let mut out = vec![];
    if begin(&mut q, &mut ask) == Advance::Ended {
        return out;
    }
    loop {
        out.push(q.current);
        mark_started(&mut q);
        assert_eq!(rounds_problem(&q), None);
        if out.len() == most || advance(&mut q, &mut ask) == Advance::Ended {
            assert_eq!(asked.next(), None, "answers left over");
            return out;
        }
    }
}

#[test]
fn an_if_runs_its_items_when_true_and_its_else_when_false() {
    let tree = || vec![step(1), iff(2, vec![step(3), step(4)], Some(vec![step(5)])), step(6)];
    assert_eq!(run_asking(tree(), false, &[true], 100), vec![1, 3, 4, 6]);
    assert_eq!(run_asking(tree(), false, &[false], 100), vec![1, 5, 6]);
}

#[test]
fn an_if_without_else_is_passed_over_when_false() {
    let tree = || vec![step(1), iff(2, vec![step(3)], None), step(4)];
    assert_eq!(run_asking(tree(), false, &[false], 100), vec![1, 4]);
    // As the first item, and as the whole queue: then there is nothing to run.
    assert_eq!(
        run_asking(vec![iff(2, vec![step(3)], None), step(4)], false, &[false], 100),
        vec![4]
    );
    assert_eq!(
        run_asking(vec![iff(2, vec![step(3)], None)], false, &[false], 100),
        Vec::<u32>::new()
    );
}

#[test]
fn an_if_is_asked_once_each_time_its_turn_comes_not_while_its_steps_run() {
    // Inside a repeat block it is asked once a round.
    let tree =
        vec![block(1, Repeat::Times(3), vec![iff(2, vec![step(3), step(4)], Some(vec![step(5)]))])];
    assert_eq!(run_asking(tree, false, &[true, false, true], 100), vec![3, 4, 5, 3, 4]);
    // A repeat block inside an If runs all its rounds in the part taken.
    let tree = vec![iff(1, vec![block(2, Repeat::Times(2), vec![step(3)])], Some(vec![step(4)]))];
    assert_eq!(run_asking(tree, false, &[true], 100), vec![3, 3]);
}

#[test]
fn a_looping_queue_of_an_if_that_is_false_ends_rather_than_spins() {
    let tree = vec![iff(1, vec![step(2)], None)];
    assert_eq!(run_asking(tree, true, &[true, true, false], 100), vec![2, 2]);
}

#[test]
fn an_edit_puts_the_branch_where_the_current_step_is() {
    let mut q = Queue {
        realm_id: "r".into(),
        next_step_id: 6,
        items: vec![iff(1, vec![step(2), step(3)], Some(vec![step(4), step(5)]))],
        current: 0,
        started_at: None,
        r#loop: false,
        started: false,
    };
    begin(&mut q, &mut |_| true);
    assert_eq!(q.current, 2);
    // The step it is on moved into the Else part: the block is on Else, and goes on from there.
    let reqs: Vec<QueueItemRequest> = serde_json::from_value(json!([
        { "id": 1, "if": { "kind": "mounted", "is": true },
          "items": [{ "id": 3, "order": { "kind": "walkTo" } }],
          "else": [{ "id": 2, "order": { "kind": "walkTo" } }, { "id": 5, "order": { "kind": "walkTo" } }] },
    ]))
    .unwrap();
    let mut next = q.next_step_id;
    q.items = kept_items(&reqs, &mut next, &rounds_of(&q.items));
    settle_rounds(&mut q);
    assert_eq!(rounds_problem(&q), None);
    let QueueItem::If(b) = &q.items[0] else { panic!("an If") };
    assert_eq!(b.branch, Some(Branch::Else));
    assert_eq!(
        advance(&mut q, &mut |_| panic!("not asked again")),
        Advance::Moved { crossed: false }
    );
    assert_eq!(q.current, 5);
    assert_eq!(advance(&mut q, &mut |_| panic!("not asked again")), Advance::Ended);
}

#[test]
fn rounds_problem_finds_an_if_on_the_wrong_branch() {
    let mut q = Queue {
        realm_id: "r".into(),
        next_step_id: 4,
        items: vec![iff(1, vec![step(2)], Some(vec![step(3)])), step(4)],
        current: 0,
        started_at: None,
        r#loop: false,
        started: false,
    };
    begin(&mut q, &mut |_| false);
    assert_eq!((q.current, rounds_problem(&q)), (3, None));
    let QueueItem::If(b) = &mut q.items[0] else { panic!("an If") };
    b.branch = Some(Branch::Then);
    assert!(rounds_problem(&q).unwrap().contains("If block 1"));
    q.current = 4;
    assert!(rounds_problem(&q).unwrap().contains("If block 1"));
    assert_eq!(depth_of(&q.items), 1);
    assert_eq!(ids_of(&q.items), vec![1, 2, 3, 4]);
    assert_eq!(block_ids(&q.items), vec![1]);
}

fn until(id: u32, items: Vec<QueueItem>) -> QueueItem {
    let until = serde_json::from_value(json!({ "kind": "mounted", "is": true })).unwrap();
    block(id, Repeat::Until(RepeatUntil { until }), items)
}

#[test]
fn a_repeat_until_ends_before_a_round_once_its_condition_holds() {
    // Asked when its turn comes and after each round: no, no, yes.
    let tree = vec![until(1, vec![step(2), step(3)]), step(4)];
    assert_eq!(run_asking(tree, false, &[false, false, true], 100), vec![2, 3, 2, 3, 4]);
    // It has no count: it goes on as long as the condition doesn't hold.
    let tree = vec![until(1, vec![step(2)])];
    let answers = [vec![false; 1500], vec![true]].concat();
    assert_eq!(run_asking(tree, false, &answers, 2000).len(), 1500);
}

#[test]
fn a_repeat_until_never_runs_when_its_condition_holds_at_the_start() {
    let tree = || vec![step(1), until(2, vec![step(3)]), step(4)];
    assert_eq!(run_asking(tree(), false, &[true], 100), vec![1, 4]);
    // As the first item, and as the whole queue: then there is nothing to run.
    assert_eq!(run_asking(vec![until(2, vec![step(3)]), step(4)], false, &[true], 100), vec![4]);
    assert_eq!(run_asking(vec![until(2, vec![step(3)])], false, &[true], 100), Vec::<u32>::new());
    // A looping queue of it ends rather than spins once it holds.
    assert_eq!(run_asking(vec![until(2, vec![step(3)])], true, &[false, true, true], 100), vec![3]);
}

#[test]
fn a_repeat_until_still_ends_after_a_round_that_started_nothing_without_asking() {
    let mut q = Queue {
        realm_id: "r".into(),
        next_step_id: 4,
        items: vec![until(1, vec![step(2)]), step(3)],
        current: 0,
        started_at: None,
        r#loop: false,
        started: false,
    };
    begin(&mut q, &mut |_| false);
    assert_eq!(q.current, 2);
    // Step 2 never started: the round ends the block, and its condition isn't asked.
    assert_eq!(
        advance(&mut q, &mut |_| panic!("a round that started nothing doesn't ask")),
        Advance::Moved { crossed: true }
    );
    assert_eq!((q.current, rounds_problem(&q)), (3, None));
}

#[test]
fn a_repeat_until_keeps_any_round_through_an_edit() {
    let mut q = queue(vec![step(3)], false);
    q.items = vec![until(1, vec![step(2)])];
    begin(&mut q, &mut |_| false);
    assert_eq!(q.current, 2);
    let QueueItem::Repeat(b) = &mut q.items[0] else { panic!("a repeat block") };
    b.round = 5000;
    assert_eq!(rounds_problem(&q), None);
    settle_rounds(&mut q);
    assert_eq!(rounds_of(&q.items)[&1].0, 5000);
}
