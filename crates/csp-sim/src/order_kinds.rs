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

/// A string field as the order requests' borrowed views take it.
fn text_ref<'o>(order: &'o OrderRequest, key: &str) -> Option<&'o str> {
    order.fields.get(key).and_then(Value::as_str)
}

/// A name field as the renaming checks take it (`Given`): missing, text, or something else.
fn given<'o>(order: &'o OrderRequest, key: &str) -> crate::queries::people::Given<'o> {
    use crate::queries::people::Given;
    match order.fields.get(key) {
        None => Given::Missing,
        Some(Value::String(s)) => Given::Text(s),
        Some(_) => Given::NotText,
    }
}

fn ids(order: &OrderRequest, key: &str) -> Option<Vec<String>> {
    order.fields.get(key).and_then(Value::as_array).map(|a| {
        a.iter().map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string)).collect()
    })
}

fn breed_request(o: &OrderRequest) -> crate::breeding::BreedRequest {
    crate::breeding::BreedRequest {
        resident_id: text(o, "residentId"),
        stable_id: text(o, "stableId"),
        horse_ids: ids(o, "horseIds"),
    }
}

fn relocate_request(o: &OrderRequest) -> crate::relocating::RelocateRequest {
    let group =
        o.fields.get("group").map(|g| g.as_array().map(|_| ids(o, "group").unwrap_or_default()));
    crate::relocating::RelocateRequest {
        resident_id: text(o, "residentId"),
        city_id: text(o, "cityId"),
        group,
    }
}

fn rename_request(o: &OrderRequest) -> crate::renaming::RenameRequest<'_> {
    crate::renaming::RenameRequest {
        resident_id: text_ref(o, "residentId"),
        target_id: text_ref(o, "targetId"),
        city_id: text_ref(o, "cityId"),
        horse_id: text_ref(o, "horseId"),
        name: given(o, "name"),
        realm_name: given(o, "realmName"),
    }
}

fn pair_request(o: &OrderRequest) -> crate::pairing::PairRequest<'_> {
    crate::pairing::PairRequest {
        resident_id: text_ref(o, "residentId"),
        partner_id: text_ref(o, "partnerId"),
    }
}

fn hand_over_request(o: &OrderRequest) -> crate::leader::HandOverRequest<'_> {
    crate::leader::HandOverRequest {
        resident_id: text_ref(o, "residentId"),
        new_leader_id: text_ref(o, "newLeaderId"),
    }
}

fn map_size(t: Option<&TerrainMap>) -> i32 {
    t.map_or(csp_shared::balance::MAP_SIZE, |t| t.size)
}

/// Adds the order kinds of T86.5 (goods), T86.8 (people) and T86.11 (realms), which landed after
/// the first registrations.
pub fn add_later_rule_orders(kinds: &mut OrderKinds) {
    use csp_shared::world::TradeSide;

    // T86.5: goods.
    kinds.insert(
        "pickUp",
        fn_kind(
            Box::new(|w, s, o, _| crate::carrying::validate_pick_up(w, s, o)),
            Box::new(|w, s, o, _| crate::carrying::apply_pick_up(w, s, o)),
        ),
    );
    kinds.insert(
        "drop",
        fn_kind(
            Box::new(|w, s, o, _| crate::carrying::validate_drop(w, s, o)),
            Box::new(|w, s, o, _| crate::carrying::apply_drop(w, s, o)),
        ),
    );
    kinds.insert(
        "store",
        fn_kind(
            Box::new(|w, s, o, t| crate::storing::validate_store(w, s, o, map_size(t))),
            Box::new(|w, s, o, t| crate::storing::apply_store(w, s, o, map_size(t))),
        ),
    );
    kinds.insert(
        "fetch",
        fn_kind(
            Box::new(|w, s, o, t| crate::storing::validate_fetch(w, s, o, map_size(t))),
            Box::new(|w, s, o, t| crate::storing::apply_fetch(w, s, o, map_size(t))),
        ),
    );
    kinds.insert(
        "haul",
        fn_kind(
            Box::new(crate::hauling::validate_haul),
            Box::new(|w, s, o, _| crate::hauling::apply_haul(w, s, o)),
        ),
    );
    kinds.insert(
        "stop",
        fn_kind(
            Box::new(|w, s, o, _| crate::hauling::validate_stop(w, s, o)),
            Box::new(|w, s, o, _| crate::hauling::apply_stop(w, s, o)),
        ),
    );
    kinds.insert(
        "buyCity",
        fn_kind(
            Box::new(|w, s, o, _| crate::buying::validate_buy_city(w, s, o)),
            Box::new(|w, s, o, _| crate::buying::apply_buy_city(w, s, o)),
        ),
    );
    for (name, side) in [("buy", TradeSide::Buy), ("sell", TradeSide::Sell)] {
        kinds.insert(
            name,
            fn_kind(
                Box::new(move |w, s, o, _| crate::trading::validate_trade(w, s, o, side)),
                Box::new(move |w, s, o, _| crate::trading::apply_trade(w, s, o, side)),
            ),
        );
    }
    kinds.insert(
        "swap",
        fn_kind(
            Box::new(|w, s, o, _| crate::trading::validate_swap(w, s, o)),
            Box::new(|w, s, o, _| crate::trading::apply_swap(w, s, o)),
        ),
    );
    kinds.insert(
        "buyHorse",
        fn_kind(
            Box::new(|w, s, o, _| crate::trading::validate_buy_horse(w, s, o)),
            Box::new(|w, s, o, _| crate::trading::apply_buy_horse(w, s, o)),
        ),
    );
    kinds.insert(
        "sellHorse",
        fn_kind(
            Box::new(|w, s, o, _| crate::trading::validate_sell_horse(w, s, o)),
            Box::new(|w, s, o, _| crate::trading::apply_sell_horse(w, s, o)),
        ),
    );
    kinds.insert(
        "transfer",
        fn_kind(
            Box::new(|w, s, o, _| crate::transfers::validate_transfer(w, s, o)),
            Box::new(|w, s, o, t| crate::transfers::apply_transfer(w, s, o, map_size(t))),
        ),
    );
    kinds.insert(
        "handIn",
        fn_kind(
            Box::new(|w, s, o, _| crate::transfers::validate_hand_in(w, s, o)),
            Box::new(|w, s, o, _| crate::transfers::apply_hand_in(w, s, o)),
        ),
    );

    // T86.8: people.
    kinds.insert(
        "breed",
        fn_kind(
            Box::new(|w, s, o, _| {
                crate::breeding::validate_breed(w, s, &breed_request(o)).map(str::to_string)
            }),
            Box::new(|w, _, o, _| crate::breeding::apply_breed(w, &breed_request(o))),
        ),
    );
    kinds.insert(
        "pair",
        fn_kind(
            Box::new(|w, s, o, _| {
                crate::pairing::validate_pair(w, s, &pair_request(o)).map(str::to_string)
            }),
            Box::new(|w, _, o, _| crate::pairing::apply_pair(w, &pair_request(o))),
        ),
    );
    kinds.insert(
        "relocate",
        fn_kind(
            Box::new(|w, s, o, _| crate::relocating::validate_relocate(w, s, &relocate_request(o))),
            Box::new(|w, _, o, t| crate::relocating::apply_relocate(w, &relocate_request(o), t)),
        ),
    );
    kinds.insert(
        "rename",
        fn_kind(
            Box::new(|w, s, o, _| {
                crate::renaming::validate_rename(w, s.user_id, &rename_request(o))
            }),
            Box::new(|w, s, o, _| crate::renaming::apply_rename(w, s.user_id, &rename_request(o))),
        ),
    );
    kinds.insert(
        "renameCity",
        fn_kind(
            Box::new(|w, s, o, _| {
                crate::renaming::validate_rename_city(w, s.user_id, &rename_request(o))
            }),
            Box::new(|w, s, o, _| {
                crate::renaming::apply_rename_city(w, s.user_id, &rename_request(o))
            }),
        ),
    );
    kinds.insert(
        "renameHorse",
        fn_kind(
            Box::new(|w, s, o, _| {
                crate::renaming::validate_rename_horse(w, s.user_id, &rename_request(o))
            }),
            Box::new(|w, s, o, _| {
                crate::renaming::apply_rename_horse(w, s.user_id, &rename_request(o))
            }),
        ),
    );
    kinds.insert(
        "handOver",
        fn_kind(
            Box::new(|w, s, o, t| {
                crate::leader::validate_hand_over(
                    w,
                    s.user_id,
                    &hand_over_request(o),
                    t.map(|t| t.size),
                )
            }),
            Box::new(|w, s, o, t| {
                crate::leader::apply_hand_over(
                    w,
                    s.user_id,
                    &hand_over_request(o),
                    t.map(|t| t.size),
                )
            }),
        ),
    );

    // reviving.ts (named by no rule ticket; T86.14).
    kinds.insert("feed", crate::reviving::Feed);

    // T86.11: realms.
    for (name, kind) in crate::alliances::alliance_orders() {
        kinds.insert(name, Realmed(kind));
    }
    for (name, kind) in crate::contracts::contract_orders() {
        kinds.insert(name, Realmed(kind));
    }
    kinds.insert("pay", Realmed(crate::contracts::Pay));
    kinds.insert("buyOff", Realmed(crate::directives::BuyOff));
    kinds.insert("payDebt", crate::trade_org_debt::PayDebt);
}

/// A realm order kind (T86.11), written against its own stand-in sender.
// TODO: `realm_pending::{OrderKind, OrderSender}` give way to `orders`' and `order_sender`'s.
struct Realmed<K>(K);

fn realm_sender(s: &OrderSender) -> crate::realm_pending::OrderSender {
    crate::realm_pending::OrderSender { user_id: s.user_id, npc_city_id: s.npc_city_id.clone() }
}

impl<K: crate::realm_pending::OrderKind + Send + Sync> OrderKind for Realmed<K> {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        self.0.validate(world, &realm_sender(sender), order, terrain)
    }
    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        self.0.apply(world, &realm_sender(sender), order, terrain)
    }
}
