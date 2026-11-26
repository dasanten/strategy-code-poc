//! Trial order (T121.9, not merged): strolling to a tile, like walking.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{OrderRequest, Resident, ResidentOrder, StrollOrder, Tile, WorldState};

use crate::order_meta::{OrderMeta, StepGroup};
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::{int_field, str_field, OrderKind};
use crate::running::{same_when_equal, Arrival, By, Going, GoingMut, RunningOrder, Ties, TiesMut, To};
use crate::script_actions::{arg, ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;

pub struct Stroll;

impl OrderKind for Stroll {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        if ordered_resident(world, sender, str_field(order, "residentId")).is_none() {
            return Some("not one of your residents".into());
        }
        if int_field(order, "x").is_none() || int_field(order, "y").is_none() {
            return Some("the target must be a tile".into());
        }
        None
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let id = str_field(order, "residentId");
        let (Some(x), Some(y)) = (int_field(order, "x"), int_field(order, "y")) else { return };
        if let Some(r) = world.residents.iter_mut().find(|r| Some(r.id.as_str()) == id) {
            r.order = Some(ResidentOrder::Stroll(StrollOrder {
                target: Tile { x: x as f64, y: y as f64 },
                path: None,
                progress: 0.0,
            }));
        }
    }
}

pub(crate) static STROLL_META: OrderMeta = OrderMeta::request("stroll", &Stroll)
    .queue_step(StepGroup::Move)
    .gets_off_first()
    .script(&[STROLL_ACTION]);

const STROLL_ACTION: ScriptAction = ScriptAction {
    name: "stroll",
    group: ActionGroup::Movement,
    request: Request::Fields(&[arg("x"), arg("y")]),
    cost: 10.0,
    description: "Stroll to a tile.",
    returns: ScriptType::String,
};

impl RunningOrder for StrollOrder {
    fn going(&self) -> Option<Going<'_>> {
        Some(Going {
            path: &self.path,
            progress: self.progress,
            now: true,
            by: By::Foot,
            to: To::tile(&self.target),
            near: false,
            after: None,
            estimated: true,
        })
    }
    fn going_mut(&mut self) -> Option<GoingMut<'_>> {
        Some(GoingMut::new(&mut self.path, &mut self.progress))
    }
    fn arrive(&mut self) -> Arrival {
        Arrival::Done
    }
    fn resume(&mut self, _: &WorldState, _: &Resident) -> bool {
        GoingMut::new(&mut self.path, &mut self.progress).reset_found();
        true
    }
    same_when_equal!();
    fn ties(&self) -> Ties<'_> {
        Ties::NONE
    }
    fn ties_mut(&mut self) -> TiesMut<'_> {
        TiesMut::none()
    }
}
