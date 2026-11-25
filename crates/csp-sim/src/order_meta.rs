//! What an order kind says about itself (T121.5): each kind's [`OrderMeta`] stands in the module
//! that implements the kind, and everything that asks about a kind reads it: the registry
//! (`orders::order_kinds`), what a queue step can be, who gets off first, what an NPC city may
//! give, the invariants.
//!
//! A new kind: declare its `OrderMeta` in its module, and name it in [`ORDER_METAS`]; one a
//! resident holds (a [`ResidentOrder`]) is also named in `running_orders!` here and in `running.rs`.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{OrderRequest, ResidentOrder, WorldState};

use crate::order_sender::OrderSender;
use crate::orders::OrderKind;
use crate::script_actions::ScriptAction;

pub type Validate =
    fn(&WorldState, &OrderSender, &OrderRequest, Option<&TerrainMap>) -> Option<String>;
pub type Apply = fn(&mut WorldState, &OrderSender, &OrderRequest, Option<&TerrainMap>);

/// An order kind from a pair of functions.
#[derive(Clone, Copy)]
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

/// What carries out the requests of a kind.
enum Requests {
    Kind(&'static dyn OrderKind),
    Fns(FnKind),
    /// An order kind built on the script library, which its host puts into the registry.
    ByHost,
    /// None: the kind is only held by a resident, or only a step the queue runner keeps.
    Never,
}

/// The Orders tab heading a queue step is shown under (`CONTEXT.md`: Planner blocks).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StepGroup {
    Move,
    Work,
    Goods,
    Scripts,
    /// What shapes the queue rather than being an order (Wait until).
    Flow,
}

/// The facts about one order kind. The flags about a request are read by the kind of an
/// `OrderRequest`, those about a running order by that of a [`ResidentOrder`]; where a resident
/// holds an order under the kind it was requested by, both are here.
pub struct OrderMeta {
    /// The kind's name, in a request and in a resident's order.
    pub kind: &'static str,
    requests: Requests,
    /// Request: it can be a step of a queue (`CONTEXT.md`: Queue): a one-off action or task the UI
    /// gives a resident, or running one of the Player's scripts. Never a queue.
    pub queue_step: bool,
    /// Request: the Orders tab heading a queue step is shown under, in the planner's palette and
    /// its rows; every queue step has one.
    pub step_group: Option<StepGroup>,
    /// Request: as a queue step it never ends on its own.
    pub never_ends: bool,
    /// Request: it acts on a tile, and so gets a passenger off their carriage first
    /// (`CONTEXT.md`: Passenger).
    pub gets_off_first: bool,
    /// Request: it leaves a resident's script running: it changes nobody's order (pairing, the
    /// Leader handover, renaming, offers, ...), or sees to the script itself.
    pub keeps_script: bool,
    /// Request: it is given to an army, whose members stay in it.
    pub to_army: bool,
    /// Running: only a grown resident can hold it.
    pub adults_only: bool,
    /// Running: an NPC city gives it to its residents (ADR 0002: only kinds a Player can give).
    pub npc_city: bool,
    /// Running: a resident carrying a child can't hold it (`CONTEXT.md`: Carrying).
    pub blocked_carrying_child: bool,
    /// Running: it goes on until stopped, so given under attack it holds until calm.
    pub goes_on_until_stopped: bool,
    /// The actions a resident's script asks for it with; none for an order a script can't give.
    pub script: &'static [ScriptAction],
}

impl OrderMeta {
    const fn new(kind: &'static str, requests: Requests) -> Self {
        OrderMeta {
            kind,
            requests,
            queue_step: false,
            step_group: None,
            never_ends: false,
            gets_off_first: false,
            keeps_script: false,
            to_army: false,
            adults_only: false,
            npc_city: false,
            blocked_carrying_child: false,
            goes_on_until_stopped: false,
            script: &[],
        }
    }

    /// A kind whose requests `order` carries out.
    pub const fn request(kind: &'static str, order: &'static dyn OrderKind) -> Self {
        Self::new(kind, Requests::Kind(order))
    }

    /// A kind whose requests a pair of functions carries out.
    pub const fn fns(kind: &'static str, validate: Validate, apply: Apply) -> Self {
        Self::new(kind, Requests::Fns(FnKind { validate, apply }))
    }

    /// A kind whose host puts it into the registry, built on the script library.
    pub const fn by_host(kind: &'static str) -> Self {
        Self::new(kind, Requests::ByHost)
    }

    /// A kind nobody requests.
    pub const fn not_requested(kind: &'static str) -> Self {
        Self::new(kind, Requests::Never)
    }

    /// It can be a step of a queue, shown under `group`.
    pub const fn queue_step(self, group: StepGroup) -> Self {
        OrderMeta { queue_step: true, step_group: Some(group), ..self }
    }
    pub const fn never_ends(self) -> Self {
        OrderMeta { never_ends: true, ..self }
    }
    pub const fn gets_off_first(self) -> Self {
        OrderMeta { gets_off_first: true, ..self }
    }
    pub const fn keeps_script(self) -> Self {
        OrderMeta { keeps_script: true, ..self }
    }
    pub const fn to_army(self) -> Self {
        OrderMeta { to_army: true, ..self }
    }
    pub const fn adults_only(self) -> Self {
        OrderMeta { adults_only: true, ..self }
    }
    pub const fn npc_city(self) -> Self {
        OrderMeta { npc_city: true, ..self }
    }
    pub const fn blocked_carrying_child(self) -> Self {
        OrderMeta { blocked_carrying_child: true, ..self }
    }
    pub const fn goes_on_until_stopped(self) -> Self {
        OrderMeta { goes_on_until_stopped: true, ..self }
    }

    pub const fn script(self, script: &'static [ScriptAction]) -> Self {
        OrderMeta { script, ..self }
    }

    /// The order kind for the registry, if this one is in it without a host.
    pub(crate) fn order_kind(&self) -> Option<Arc<dyn OrderKind>> {
        match &self.requests {
            Requests::Kind(k) => Some(Arc::new(*k)),
            Requests::Fns(f) => Some(Arc::new(*f)),
            Requests::ByHost | Requests::Never => None,
        }
    }
}

/// The facts about a kind, by its name.
pub fn meta_of(kind: &str) -> Option<&'static OrderMeta> {
    static BY_KIND: LazyLock<HashMap<&'static str, &'static OrderMeta>> =
        LazyLock::new(|| ORDER_METAS.iter().map(|m| (m.kind, *m)).collect());
    BY_KIND.get(kind).copied()
}

/// Which meta each running order has: the match behind [`running_meta`], and for the test the
/// variants by name.
macro_rules! running_orders {
    ($($variant:ident => $meta:path,)*) => {
        /// The facts about a resident's order: its kind string comes from here.
        pub fn running_meta(o: &ResidentOrder) -> &'static OrderMeta {
            match o {
                $(ResidentOrder::$variant(_) => &$meta,)*
            }
        }

        #[cfg(test)]
        pub(crate) const RUNNING: &[(&str, &OrderMeta)] =
            &[$((stringify!($variant), &$meta),)*];
    };
}

running_orders! {
    WalkTo => crate::walking::WALK_TO_META,
    Drive => crate::driving::DRIVE_META,
    Haul => crate::hauling::HAUL_META,
    PickUp => crate::carrying::PICK_UP_META,
    Drop => crate::carrying::DROP_META,
    Store => crate::storing::STORE_META,
    Fetch => crate::storing::FETCH_META,
    Build => crate::building::BUILD_META,
    TearDown => crate::teardown::TEAR_DOWN_META,
    Repair => crate::repair::REPAIR_META,
    WorkAt => crate::work::WORK_AT_META,
    Breed => crate::breeding::BREED_META,
    Attack => crate::combat::ATTACK_META,
    Climb => crate::climbing::CLIMB_META,
    Teach => crate::teaching::TEACH_META,
    Train => crate::training::TRAIN_META,
    RoadLine => crate::road_line::ROAD_LINE_META,
    WallLine => crate::road_line::WALL_LINE_META,
    Pay => crate::contracts::PAY_META,
    BuyCity => crate::buying::BUY_CITY_META,
    Trade => crate::trading::TRADE_META,
    Swap => crate::trading::SWAP_META,
    BuyHorse => crate::trading::BUY_HORSE_META,
    SellHorse => crate::trading::SELL_HORSE_META,
    HandIn => crate::transfers::HAND_IN_META,
    BuyOff => crate::directives::BUY_OFF_META,
    PayDebt => crate::trade_org_debt::PAY_DEBT_META,
    AcceptOffer => crate::offers::ACCEPT_OFFER_META,
    Relocate => crate::relocating::RELOCATE_META,
    Feed => crate::reviving::FEED_META,
    Row => crate::rowing::ROW_META,
    HaulByWater => crate::water_hauling::HAUL_BY_WATER_META,
    Sail => crate::sailing::SAIL_META,
    Equip => crate::equipping::EQUIP_META,
    Crew => crate::siege::CREW_META,
    Push => crate::siege::PUSH_META,
    Ram => crate::siege::RAM_META,
    Throw => crate::siege::THROW_META,
    Gather => crate::gathering::GATHER_META,
    Rally => crate::rally::RALLY_META,
}

/// Every order kind's facts. Their order is also that of their script actions in the game API.
pub static ORDER_METAS: &[&OrderMeta] = &[
    &crate::walking::WALK_TO_META,
    &crate::driving::DRIVE_META,
    &crate::riding::MOUNT_META,
    &crate::riding::DISMOUNT_META,
    &crate::driving::UNHITCH_META,
    &crate::driving::HITCH_META,
    &crate::passengers::BOARD_META,
    &crate::loading::LOAD_META,
    &crate::rowing::ROW_META,
    &crate::sailing::SAIL_META,
    &crate::siege::CREW_META,
    &crate::siege::RAM_META,
    &crate::siege::THROW_META,
    &crate::siege::PUSH_META,
    &crate::passengers::GET_OFF_META,
    &crate::hauling::HAUL_META,
    &crate::hauling::STOP_META,
    &crate::carrying::PICK_UP_META,
    &crate::carrying::DROP_META,
    &crate::storing::STORE_META,
    &crate::storing::FETCH_META,
    &crate::building::BUILD_META,
    &crate::teardown::TEAR_DOWN_META,
    &crate::repair::REPAIR_META,
    &crate::work::WORK_AT_META,
    &crate::gathering::GATHER_META,
    &crate::teaching::TEACH_META,
    &crate::training::TRAIN_META,
    &crate::breeding::BREED_META,
    &crate::pairing::PAIR_META,
    &crate::combat::ATTACK_META,
    &crate::reviving::FEED_META,
    &crate::equipping::EQUIP_META,
    &crate::equipping::TAKE_OFF_META,
    &crate::climbing::CLIMB_META,
    &crate::contracts::PAY_META,
    &crate::buying::BUY_CITY_META,
    &crate::trading::BUY_META,
    &crate::trading::SELL_META,
    &crate::trading::SWAP_META,
    &crate::trading::BUY_HORSE_META,
    &crate::trading::SELL_HORSE_META,
    &crate::transfers::HAND_IN_META,
    &crate::offers::POST_OFFER_META,
    &crate::offers::TAKE_DOWN_OFFER_META,
    &crate::offers::ACCEPT_OFFER_META,
    &crate::offers::SEND_DIRECT_OFFER_META,
    &crate::offers::SEND_CARRIED_OFFER_META,
    &crate::offers::ACCEPT_CARRIED_OFFER_META,
    &crate::offers::DECLINE_OFFER_META,
    &crate::directives::BUY_OFF_META,
    &crate::trade_org_debt::PAY_DEBT_META,
    &crate::leader::HAND_OVER_META,
    &crate::heir::NAME_HEIR_META,
    &crate::heir::CLEAR_HEIR_META,
    &crate::renaming::RENAME_META,
    &crate::renaming::RENAME_CITY_META,
    &crate::relocating::RELOCATE_META,
    &crate::renaming::RENAME_HORSE_META,
    &crate::horse_grant::CLAIM_HORSES_META,
    &crate::demands::SEND_DEMAND_META,
    &crate::demands::ACCEPT_DEMAND_META,
    &crate::demands::DECLINE_DEMAND_META,
    &crate::road_line::ROAD_LINE_META,
    &crate::road_line::WALL_LINE_META,
    &crate::waypoints::ADD_WAYPOINT_META,
    &crate::waypoints::REMOVE_WAYPOINT_META,
    &crate::gates::SET_GATE_META,
    &crate::queues::QUEUE_META,
    &crate::queues::EDIT_QUEUE_META,
    &crate::waypoints::RENAME_WAYPOINT_META,
    &crate::alliances::FOUND_ALLIANCE_META,
    &crate::alliances::INVITE_TO_ALLIANCE_META,
    &crate::alliances::WITHDRAW_INVITE_META,
    &crate::alliances::ACCEPT_INVITE_META,
    &crate::alliances::DECLINE_INVITE_META,
    &crate::alliances::LEAVE_ALLIANCE_META,
    &crate::alliances::REMOVE_FROM_ALLIANCE_META,
    &crate::alliances::HAND_OVER_TO_ALLIANCE_META,
    &crate::alliances::RECALL_FROM_ALLIANCE_META,
    &crate::contracts::OFFER_CONTRACT_META,
    &crate::contracts::ACCEPT_CONTRACT_META,
    &crate::contracts::CANCEL_CONTRACT_META,
    &crate::rally::RALLY_META,
    &crate::armies::FORM_ARMY_META,
    &crate::armies::DISBAND_ARMY_META,
    &crate::armies::ARMY_WALK_TO_META,
    &crate::armies::ARMY_GUARD_META,
    &crate::armies::ARMY_ATTACK_META,
    &crate::armies::ARMY_FOLLOW_META,
    &crate::armies::ARMY_STOP_META,
    &crate::persuasion::ACCEPT_JOIN_META,
    &crate::persuasion::DECLINE_JOIN_META,
    &crate::transfers::TRANSFER_META,
    &crate::script_runner::RUN_SCRIPT_META,
    &crate::script_runner::SET_DEFENCE_SCRIPT_META,
    &crate::script_runner::SET_ALARM_SCRIPT_META,
    &crate::script_runner::TASK_META,
    &crate::script_runner::ARMY_RUN_SCRIPT_META,
    &crate::script_params::SET_SCRIPT_PARAM_META,
    &crate::workplace_settings::SET_WORK_SETTINGS_META,
    &crate::queue::WAIT_UNTIL_META,
    &crate::water_hauling::HAUL_BY_WATER_META,
    &crate::trading::TRADE_META,
];

#[cfg(test)]
mod tests;
