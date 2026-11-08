//! The rule tickets' order kinds in the registry (`orderKinds`): those written as an
//! [`OrderKind`] go in as they are; those written as a `validate_*`/`apply_*` pair of functions
//! go in through [`FnKind`]. A rule ticket still to land adds its own lines here.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{OrderRequest, WorldState};
use serde_json::Value;

use crate::armies::{apply_army_order, validate_army_order, ArmyOrderKind, ArmyRequest};
use crate::combat::{apply_attack, validate_attack, AttackRequest};
use crate::order_sender::OrderSender;
use crate::orders::{OrderKind, OrderKinds};
use crate::road_line::{apply_line, validate_line, LineKind};

type Validate = Box<
    dyn Fn(&WorldState, &OrderSender, &OrderRequest, Option<&TerrainMap>) -> Option<String>
        + Send
        + Sync,
>;
type Apply =
    Box<dyn Fn(&mut WorldState, &OrderSender, &OrderRequest, Option<&TerrainMap>) + Send + Sync>;

/// An order kind from a pair of functions.
struct FnKind {
    validate: Validate,
    apply: Apply,
}

impl OrderKind for FnKind {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        (self.validate)(world, sender, order, terrain)
    }
    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        (self.apply)(world, sender, order, terrain)
    }
}

fn fn_kind(validate: Validate, apply: Apply) -> FnKind {
    FnKind { validate, apply }
}

/// A movement order kind (T86.4), written against its own stand-in sender.
// TODO(T86.4): `movement_pending::{OrderKind, OrderSender}` give way to `orders`' and `order_sender`'s.
struct Moved<K>(K);

fn moved_sender(s: &OrderSender) -> crate::movement_pending::OrderSender {
    crate::movement_pending::OrderSender { user_id: s.user_id, npc_city_id: s.npc_city_id.clone() }
}

impl<K: crate::movement_pending::OrderKind + Send + Sync> OrderKind for Moved<K> {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        self.0.validate(world, &moved_sender(sender), order, terrain)
    }
    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        self.0.apply(world, &moved_sender(sender), order, terrain)
    }
}

fn text(order: &OrderRequest, key: &str) -> Option<String> {
    order.fields.get(key).and_then(Value::as_str).map(str::to_string)
}

fn attack_request(order: &OrderRequest) -> AttackRequest {
    AttackRequest { resident_id: text(order, "residentId"), target_id: text(order, "targetId") }
}

fn army_request(order: &OrderRequest) -> ArmyRequest {
    let f = &order.fields;
    ArmyRequest {
        army_id: text(order, "armyId"),
        name: text(order, "name"),
        resident_ids: f.get("residentIds").and_then(Value::as_array).map(|ids| {
            ids.iter().map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string)).collect()
        }),
        target_id: text(order, "targetId"),
        x: f.get("x").and_then(Value::as_f64),
        y: f.get("y").and_then(Value::as_f64),
    }
}

/// Adds the order kinds of the rule tickets merged so far.
pub fn add_rule_orders(kinds: &mut OrderKinds) {
    // T86.4: movement.
    kinds.insert("walkTo", Moved(crate::walking::WalkTo));
    kinds.insert("drive", Moved(crate::driving::Drive));
    kinds.insert("unhitch", Moved(crate::driving::Unhitch));
    kinds.insert("hitch", Moved(crate::driving::Hitch));
    kinds.insert("mount", Moved(crate::riding::Mount));
    kinds.insert("dismount", Moved(crate::riding::Dismount));
    kinds.insert("board", Moved(crate::passengers::Board));
    kinds.insert("getOff", Moved(crate::passengers::GetOff));
    kinds.insert("climb", Moved(crate::climbing::Climb));
    kinds.insert("setGate", Moved(crate::gates::SetGate));
    kinds.insert("claimHorses", Moved(crate::horse_grant::ClaimHorses));

    // T86.6: building and work.
    kinds.insert(
        "build",
        fn_kind(
            Box::new(crate::building::validate_build),
            Box::new(|w, _, o, _| crate::building::apply_build(w, o)),
        ),
    );
    kinds.insert(
        "tearDown",
        fn_kind(
            Box::new(crate::teardown::validate_tear_down),
            Box::new(|w, _, o, _| crate::teardown::apply_tear_down(w, o)),
        ),
    );
    kinds.insert(
        "workAt",
        fn_kind(
            Box::new(|w, s, o, _| crate::work::validate_work_at(w, s, o)),
            Box::new(|w, _, o, _| crate::work::apply_work_at(w, o)),
        ),
    );
    kinds.insert(
        "teach",
        fn_kind(
            Box::new(|w, s, o, _| crate::teaching::validate_teach(w, s, o)),
            Box::new(|w, _, o, _| crate::teaching::apply_teach(w, o)),
        ),
    );
    kinds.insert(
        "train",
        fn_kind(
            Box::new(|w, s, o, _| crate::training::validate_train(w, s, o)),
            Box::new(|w, _, o, _| crate::training::apply_train(w, o)),
        ),
    );
    for (name, kind) in [("roadLine", LineKind::RoadLine), ("wallLine", LineKind::WallLine)] {
        kinds.insert(
            name,
            fn_kind(
                Box::new(move |w, s, o, t| validate_line(kind, w, s, o, t)),
                Box::new(move |w, _, o, t| apply_line(kind, w, o, t)),
            ),
        );
    }

    // T86.7: conflict.
    kinds.insert(
        "attack",
        fn_kind(
            Box::new(|w, s, o, t| {
                validate_attack(w, s, &attack_request(o), t.map(|t| t.size)).map(str::to_string)
            }),
            Box::new(|w, _, o, t| apply_attack(w, &attack_request(o), t.map(|t| t.size))),
        ),
    );
    for name in [
        "formArmy",
        "disbandArmy",
        "armyWalkTo",
        "armyGuard",
        "armyAttack",
        "armyFollow",
        "armyStop",
    ] {
        let kind = ArmyOrderKind::of(name).expect("an army order");
        kinds.insert(
            name,
            fn_kind(
                Box::new(move |w, s, o, t| {
                    validate_army_order(w, kind, s.user_id, &army_request(o), t.map(|t| t.size))
                }),
                Box::new(move |w, s, o, _| apply_army_order(w, kind, s.user_id, &army_request(o))),
            ),
        );
    }
    kinds.insert(
        "acceptJoin",
        fn_kind(
            Box::new(|w, s, o, _| {
                crate::persuasion::validate_accept_join(w, s.user_id, text(o, "cityId").as_deref())
                    .map(str::to_string)
            }),
            Box::new(|w, s, o, t| {
                crate::persuasion::apply_accept_join(
                    w,
                    s.user_id,
                    text(o, "cityId").as_deref(),
                    t.map(|t| t.size),
                )
            }),
        ),
    );
    kinds.insert(
        "declineJoin",
        fn_kind(
            Box::new(|w, s, o, _| {
                crate::persuasion::validate_decline_join(w, s.user_id, text(o, "cityId").as_deref())
                    .map(str::to_string)
            }),
            Box::new(|w, s, o, _| {
                crate::persuasion::apply_decline_join(w, s.user_id, text(o, "cityId").as_deref())
            }),
        ),
    );
}
