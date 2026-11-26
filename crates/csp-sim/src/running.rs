//! What a running order answers for itself (T121.6): where it goes and by what, what happens when
//! it gets there, whether it goes on after an interruption, and what it ties its resident to. Each
//! order struct implements [`RunningOrder`] in the module of its kind; [`ResidentOrder`] hands every
//! question on in one place, below.
//!
//! A new order: implement the trait on its struct (the compiler asks for each method) and name its
//! variant in `running_orders!`. An order done where the resident stands says so with `in_place!`,
//! one that ties them to nothing with `no_ties!`.

use csp_shared::world::{
    Good, GoodsPlace, GoodsWanted, Resident, ResidentOrder, Stock, Tile, TilePath, WorldState,
};

use crate::queries::carriages::{driven_carriage_id, horse_for};
use crate::queries::residents::is_down;

/// The order behind a kind that shares its struct with no other, or with one that answers the same.
pub enum Own {}

/// An order a resident holds. `As` tells apart two kinds that share a struct and answer differently
/// (a row and a sail order).
pub trait RunningOrder<As = Own> {
    /// How it goes along a path. None: it is done where the resident stands.
    fn going(&self) -> Option<Going<'_>>;
    /// What walking changes on it. Some for every order that goes along a path.
    fn going_mut(&mut self) -> Option<GoingMut<'_>>;
    /// It got to the end of its path (`arrive`).
    fn arrive(&mut self) -> Arrival;
    /// It was kept aside under a defence or Alarm script that is over: gets it ready to go on from
    /// where `r` stands now, and whether it does (`orderGoingOn`).
    fn resume(&mut self, world: &WorldState, r: &Resident) -> bool;
    /// Whether it is the order `kept` was, however far it has come since (`same_order`).
    fn same(&self, kept: &Self) -> bool;
    /// What it ties its resident to.
    fn ties(&self) -> Ties<'_>;
    /// The ties that change with the world.
    fn ties_mut(&mut self) -> TiesMut<'_>;
}

/// How an order goes along a path.
pub struct Going<'a> {
    pub path: &'a Option<TilePath>,
    pub progress: f64,
    /// Whether it goes along it now: not a haul route loading, a line building, a store putting.
    pub now: bool,
    pub by: By<'a>,
    pub to: To<'a>,
    /// Coming into contact with where it goes is enough.
    pub near: bool,
    /// The army or punishment its carriage goes after now (`armyDrivenTo`).
    pub after: Option<&'a str>,
    /// Whether the arrival estimate covers it (`CONTEXT.md`: Estimates).
    pub estimated: bool,
}

/// What an order goes by: it sets the pace and the ground it may take.
#[derive(Clone, Copy)]
pub enum By<'a> {
    /// Walking, or riding a horse.
    Foot,
    /// Driving a carriage, with the Food it keeps on board.
    Carriage { id: &'a str, keeps_food: f64 },
    /// Rowing a boat, or a ship on a haul route by water.
    Oars(&'a str),
    /// Sailing a ship.
    Sails(&'a str),
    /// Pushing a siege machine.
    Machine(&'a str),
}

/// Where an order goes.
#[derive(Clone, Copy)]
pub enum To<'a> {
    At((f64, f64)),
    /// A resident, building or siege machine to attack.
    Foe(&'a str),
    /// A store or fetch order's place, which can move on.
    Place(&'a GoodsPlace),
    /// A siege machine, which can be pushed on.
    Machine(&'a str),
    Nowhere,
}

impl To<'_> {
    /// The tile `t`.
    pub fn tile(t: &Tile) -> Self {
        To::At((t.x, t.y))
    }
}

/// What walking changes on an order that goes along a path.
pub struct GoingMut<'a> {
    pub path: &'a mut Option<TilePath>,
    pub progress: &'a mut f64,
    /// The tile that follows the army it goes after, of an order that can.
    pub after: Option<&'a mut Tile>,
}

impl<'a> GoingMut<'a> {
    pub fn new(path: &'a mut Option<TilePath>, progress: &'a mut f64) -> Self {
        GoingMut { path, progress, after: None }
    }

    /// The way is found again from scratch (`o.path = null; o.progress = 0`).
    pub fn reset(self) {
        *self.path = None;
        *self.progress = 0.0;
    }

    /// The way is found again, if one was found (`if ('path' in o && o.path) ...`): an order still
    /// searching keeps its progress.
    pub fn reset_found(self) {
        if self.path.is_some() {
            self.reset();
        }
    }
}

/// What happens to an order that got there.
pub enum Arrival {
    /// It is done.
    Done,
    /// It goes on there.
    GoesOn,
    /// The resident joins the siege machine's crew on its tile, or goes on after the machine.
    JoinsCrew,
}

/// The building an order works on.
pub enum On<'a> {
    Nothing,
    Site(&'a str),
    Repairs(&'a str),
    /// A building or a siege machine.
    TearsDown(&'a str),
}

/// The goods an order handles.
pub enum Handles<'a> {
    Nothing,
    Stock(&'a Stock),
    Wanted(&'a GoodsWanted),
}

impl Handles<'_> {
    pub fn goods(&self) -> Vec<Good> {
        match self {
            Handles::Nothing => Vec::new(),
            Handles::Stock(s) => s.keys().copied().collect(),
            Handles::Wanted(s) => s.keys().copied().collect(),
        }
    }
}

/// What an order ties its resident to; each order names its own over [`Ties::NONE`].
pub struct Ties<'a> {
    /// The army that gave it.
    pub army: Option<&'a str>,
    /// The army it supplies (`suppliedArmy`).
    pub supplies: Option<&'a str>,
    /// Whom or what it strikes at of its own accord: not fighting back.
    pub strikes: Option<&'a str>,
    /// The wall, gate or other target it ends with when that falls.
    pub falls_with: Option<&'a str>,
    /// Struck, the resident goes on with it: no defence script, no blow back.
    pub kept_when_struck: bool,
    pub on: On<'a>,
    /// The building whose crew it counts them to.
    pub crew_of: Option<&'a str>,
    /// The building they refill at, and where they must stand for it, if anywhere in particular.
    pub refills_at: Option<(&'a str, Option<&'a Tile>)>,
    pub handles: Handles<'a>,
}

impl Ties<'_> {
    pub const NONE: Ties<'static> = Ties {
        army: None,
        supplies: None,
        strikes: None,
        falls_with: None,
        kept_when_struck: false,
        on: On::Nothing,
        crew_of: None,
        refills_at: None,
        handles: Handles::Nothing,
    };
}

/// The ties that change with the world.
pub struct TiesMut<'a> {
    /// The army that gave it, of an order an army can give.
    pub army: Option<&'a mut Option<String>>,
    /// The site or workplace it works on, which can be folded into another building.
    pub place: Option<&'a mut String>,
}

impl TiesMut<'_> {
    pub fn none() -> Self {
        TiesMut { army: None, place: None }
    }
}

/// An order done where the resident stands: it goes nowhere, and kept aside it goes on as it was.
macro_rules! in_place {
    () => {
        fn going(&self) -> Option<crate::running::Going<'_>> {
            None
        }
        fn going_mut(&mut self) -> Option<crate::running::GoingMut<'_>> {
            None
        }
        fn arrive(&mut self) -> crate::running::Arrival {
            crate::running::Arrival::Done
        }
        fn resume(
            &mut self,
            _: &csp_shared::world::WorldState,
            _: &csp_shared::world::Resident,
        ) -> bool {
            true
        }
        crate::running::same_when_equal!();
    };
}
pub(crate) use in_place;

/// An order is the one kept aside when they are equal.
macro_rules! same_when_equal {
    () => {
        fn same(&self, kept: &Self) -> bool {
            self == kept
        }
    };
}
pub(crate) use same_when_equal;

/// An order that ties its resident to nothing.
macro_rules! no_ties {
    () => {
        fn ties(&self) -> crate::running::Ties<'_> {
            crate::running::Ties::NONE
        }
        crate::running::no_ties_mut!();
    };
}
pub(crate) use no_ties;

/// An order none of whose ties change.
macro_rules! no_ties_mut {
    () => {
        fn ties_mut(&mut self) -> crate::running::TiesMut<'_> {
            crate::running::TiesMut::none()
        }
    };
}
pub(crate) use no_ties_mut;

/// Whether an order driving the carriage `id` goes on: its driver is with it, nobody else drives it
/// and its horse is there and not Down.
pub fn driver_goes_on(world: &WorldState, r: &Resident, id: &str) -> bool {
    let Some(carriage) = world.carriages.iter().find(|k| k.id == id) else { return false };
    if carriage.x != r.x || carriage.y != r.y {
        return false;
    }
    if world.residents.iter().any(|x| x.id != r.id && driven_carriage_id(x) == Some(id)) {
        return false;
    }
    horse_for(world, carriage).is_some_and(|h| !is_down(h.down_until))
}

/// The carriage an order drives, by a drive order or on a haul route.
pub fn driven_carriage(o: &ResidentOrder) -> Option<&str> {
    match o.going()?.by {
        By::Carriage { id, .. } => Some(id),
        By::Foot | By::Oars(_) | By::Sails(_) | By::Machine(_) => None,
    }
}

/// How an order goes along a path now (`moveOrder`); None while it doesn't.
pub fn moving(o: Option<&ResidentOrder>) -> Option<Going<'_>> {
    o?.going().filter(|g| g.now)
}

macro_rules! kind {
    () => {
        Own
    };
    ($kind:ty) => {
        $kind
    };
}

/// [`ResidentOrder`] hands each question on to the order it holds.
macro_rules! running_orders {
    ($($variant:ident $(as $kind:ty)?,)*) => {
        impl RunningOrder for ResidentOrder {
            fn going(&self) -> Option<Going<'_>> {
                match self {
                    $(Self::$variant(o) => RunningOrder::<kind!($($kind)?)>::going(o),)*
                }
            }
            fn going_mut(&mut self) -> Option<GoingMut<'_>> {
                match self {
                    $(Self::$variant(o) => RunningOrder::<kind!($($kind)?)>::going_mut(o),)*
                }
            }
            fn arrive(&mut self) -> Arrival {
                match self {
                    $(Self::$variant(o) => RunningOrder::<kind!($($kind)?)>::arrive(o),)*
                }
            }
            fn resume(&mut self, world: &WorldState, r: &Resident) -> bool {
                match self {
                    $(Self::$variant(o) => RunningOrder::<kind!($($kind)?)>::resume(o, world, r),)*
                }
            }
            fn same(&self, kept: &Self) -> bool {
                match self {
                    $(Self::$variant(o) => {
                        matches!(kept, Self::$variant(k)
                            if RunningOrder::<kind!($($kind)?)>::same(o, k))
                    })*
                }
            }
            fn ties(&self) -> Ties<'_> {
                match self {
                    $(Self::$variant(o) => RunningOrder::<kind!($($kind)?)>::ties(o),)*
                }
            }
            fn ties_mut(&mut self) -> TiesMut<'_> {
                match self {
                    $(Self::$variant(o) => RunningOrder::<kind!($($kind)?)>::ties_mut(o),)*
                }
            }
        }
    };
}

running_orders! {
    WalkTo,
    Stroll,
    Drive,
    Haul,
    PickUp,
    Drop,
    Store,
    Fetch,
    Build,
    TearDown,
    Repair,
    WorkAt,
    Breed,
    Attack,
    Climb,
    Teach,
    Train,
    RoadLine,
    WallLine,
    Pay,
    BuyCity,
    Trade,
    Swap,
    BuyHorse,
    SellHorse,
    HandIn,
    BuyOff,
    PayDebt,
    AcceptOffer,
    Relocate,
    Feed,
    Row as crate::rowing::Row,
    HaulByWater,
    Sail as crate::sailing::Sail,
    Equip,
    Crew,
    Push,
    Ram,
    Throw,
    Gather,
    Rally,
}
