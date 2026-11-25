import {
  CARRIAGE_CAPACITY,
  DIRECT_OFFERS_TO_ONE_REALM,
  DIRECT_OFFER_DAYS,
  DELIVERY_LOAD,
  NPC_CITY_REFUSES_STANDING,
  HORSE_PRICE_AGE_FLOOR,
  HORSE_PRICE_AGE_PER_YEAR,
  HORSE_PRICE_BASE,
  HORSE_PRICE_GLUT,
  HORSE_PRICE_PAID_SHARE,
  HORSE_PRICE_PER_STAT,
  HORSE_PRICE_SCARCITY,
  NPC_HORSES_KEPT,
  TRANSFER_FEE_FACTOR,
} from '@csp/balance'
import { num, pct, signed } from './wiki-view.js'

export function HowToTradeSection() {
  return (
    <>
      <p>
        Trade happens in person: one of your residents, or a carriage of yours, stands on the tile
        of a Trade Org warehouse (at its HQ or a trading post) or of an NPC city's storage. Click
        the warehouse or storage on the map and press <strong>Trade here</strong>, or open its city
        under Cities in sight. Its trade section lists what you <strong>can buy</strong> there and
        what you <strong>can sell</strong>, with the units and the price of each. Anyone with a
        resident in sight of it sees its prices.
      </p>
      <h3>Offers at a Player's storage</h3>
      <p>
        A storage of your realm can stand an <strong>offer</strong>: "gives 10 Wood, wants 5 Stone",
        either side may be Coins, as many times over as you name and the goods are there. Post it
        under the city's trade section, wherever your residents are. The goods stay in the storage
        but are <strong>set aside</strong>: your workers, builders, Fetch, haul routes, pick-ups and
        refills leave them alone, while a thief or raider can take them like any others, cutting the
        offer down. Anyone in sight sees it and its rate. Someone of another realm, a resident or
        carriage on the storage's tile, accepts it as many times as they can pay and carry. It
        happens at once, whether you are online or not, and raises standing both ways like a trade:
        by the coins, or goods for goods by both goods at warehouse base prices, as a swap counts
        both its sale and its purchase. What they pay goes into the storage as ordinary goods. It
        ends when it is used up, when you take it down, or when the storage is torn down or no
        longer yours; what was set aside is ordinary goods of that storage again.
      </p>
      <h3>Direct offers</h3>
      <p>
        Under <strong>Direct offers</strong> in the Diplomacy tab you can send an offer to one realm
        you know of: one you see residents of, an ally, one whose city you have seen, one with a
        standing either way, or your side in a contract, demand or direct offer. Name a storage of
        yours, and the goods are set aside there as for any offer. They hear at once wherever they
        are, with a notice and the place, and only they can accept it: someone of theirs goes to the
        storage and takes it in person, as with any offer, or they decline it from anywhere. Anyone
        else in sight of the storage sees it, and that it is for another realm. It lapses after{' '}
        {num(DIRECT_OFFER_DAYS)} game days. Declined, lapsed or taken down, the goods are ordinary
        again and both of you are told. At most {num(DIRECT_OFFERS_TO_ONE_REALM)} can stand to one
        realm.
      </p>
      <p>
        Or have the Trade Organization carry it, while the HQ stands. Name a city of yours and a
        city of theirs whose storage you see, and whether you pay the fee or split it; the form
        shows the fee before you send. Nothing is set aside. They accept it whole from anywhere,
        each side’s goods within one carriage load, and it becomes two Transfers: a caravan takes
        what is there at each city, up to what was agreed, with a fee for what it takes. Each
        caravan takes the share of the side it picks up from as it collects, and the other side’s
        from their storage as it unloads there. If that storage is short of coins then, the goods
        stay delivered and the Trade Organization bears the loss. It changes no standing, and it is
        cancelled if the HQ falls.
      </p>
      <h3>Sending a trader</h3>
      <p>
        With nobody of yours there, the trade section offers to send someone: your residents nearest
        first, with what each carries, or a carriage of yours. Send walks them (or drives the
        carriage) to the tile, and the section shows them on the way. A trade moves only what the
        trader holds, so send coins to buy and goods to sell.
      </p>
      <h3>Buying and selling</h3>
      <p>
        Once one is there, pick the trader, their hands or a carriage of yours on the tile, the good
        and how many. The form says what they carry and the room left (a carriage holds{' '}
        {num(CARRIAGE_CAPACITY)} kg; what a resident carries is under{' '}
        <a href="#transport">Carrying &amp; transport</a>). Buying takes coins from the trader and
        puts the goods in their hands or carriage; selling is the other way round. It happens at
        once, cut down to what the trader holds, what the warehouse or storage holds and what fits.
        A trade that won't go says why: no coins in hand, no room, none in stock, or not wanted.
        Each unit is priced as it moves, so a big trade moves the price as it goes (see{' '}
        <a href="#trade">Trade &amp; prices</a>).
      </p>
      <h3>Swapping</h3>
      <p>
        A trader there can also swap goods for goods, with no coins in hand: under Swap, pick the
        good you want, how many, and the good you give. It is a sale and a purchase at once, each
        unit priced as those are, so the rate comes from the place's prices and moves as its stock
        moves. You hand over enough to pay for what you want, rounded up, and what is over comes
        back in coins as far as the place holds them. It is cut down like any trade, and the button
        says what it would move or why it won't go. Like a trade it raises standing, by both the
        sale and the purchase.
      </p>
      <h3>Trading with a wandering trader</h3>
      <p>
        While a wandering trader stands at a city, anyone with a resident or carriage on its tile
        can trade with it the same way. Press <strong>Trade here</strong> on its tile, or open the
        city it stands at. It trades with its load, but never the Food its crew keep on board, its
        coins come from and go onto the carriage, and it takes goods only as far as the carriage
        holds. It orders no delivery and makes no swap. Those the Trade Organization refuses can't
        trade with it.
      </p>
      <h3>What an NPC city buys and sells</h3>
      <p>
        An NPC city sells only its surplus, what its storages hold above its reserve, and buys only
        goods it is short of, up to its reserve and with the coins in its storage. It takes nothing
        else. Its prices come from its stock like a warehouse's, and its standing toward you moves
        them: the better, the cheaper it sells and the more it pays. It swaps only its surplus for
        what it is short of, and its Rates in the Trade section list each good it is short of
        against each it has spare, at today's prices. Pick one to fill in the swap, or to send
        someone there if nobody of yours is. Below {signed(NPC_CITY_REFUSES_STANDING)} it won't
        trade with you at all. Every trade raises standing both ways (see{' '}
        <a href="#standing">Standing &amp; reactions</a>).
      </p>
      <h3>Buying a horse</h3>
      <p>
        An NPC city sells any horse beyond the {num(NPC_HORSES_KEPT)} it keeps to breed. Only in
        person: a grown resident of yours goes to its finished stable with the Coins in their hands,
        not on a carriage. Press <strong>Trade here</strong> on the stable's tile, or open the city:
        the Trade section lists the horses standing there with name, stats, age and price, and says
        why one won't go. A horse that is hitched, ridden or Down isn't for sale. The Coins go into
        its storage, and the horse is yours where it stands, ready to ride home. Buying one raises
        standing both ways like any trade, and any breeding it was part of ends.
      </p>
      <p>
        An average new horse costs about {num(HORSE_PRICE_BASE)} coins while the city has all it
        wants. Each point of its mean stat above or below average moves that by{' '}
        {pct(HORSE_PRICE_PER_STAT)}, and each game year of age takes off{' '}
        {pct(HORSE_PRICE_AGE_PER_YEAR)}, leaving at least {pct(HORSE_PRICE_AGE_FLOOR)}. As the city
        nears the pair it keeps it asks more, up to {pct(HORSE_PRICE_SCARCITY)} more for the last it
        would sell; with more than it wants, up to {pct(HORSE_PRICE_GLUT)} less. Its standing toward
        you moves the price like its trade prices. Below {signed(NPC_CITY_REFUSES_STANDING)} it
        won't sell you one.
      </p>
      <h3>Selling a horse</h3>
      <p>
        An NPC city buys a horse while it has fewer than it wants, which grows with its size. Ride
        one of yours into its finished stable and get off, with the rider or another grown resident
        of yours there. <strong>Trade here</strong> on the stable's tile, or the city's Trade
        section, lists your horses standing there with what it pays, and says why one won't go. A
        horse that is hitched, ridden or Down can't be sold. A stolen horse sells like any other.
      </p>
      <p>
        It pays about {pct(HORSE_PRICE_PAID_SHARE)} of what it would ask for that horse once it is
        among its own, so a good horse fetches more, and a city with few pays more. Good standing
        brings what it pays and what it asks closer, and it always asks more than it pays. The Coins
        come out of its storages, so it must hold them, and go into your resident's hands; if they
        can't carry all of them the sale doesn't go, so come with room. The horse is the city's
        where it stands, which feeds and breeds it from then on, and any breeding it was part of
        ends. Selling one raises standing both ways like any trade. Below{' '}
        {signed(NPC_CITY_REFUSES_STANDING)} it won't buy from you.
      </p>
      <h3>Delivery</h3>
      <p>
        At a Trade Org warehouse, instead of carrying, a caravan brings what you buy to your city's
        storage, or fetches what you sell from it, for a fee. Pick the city under Delivery in the
        trade form; the buttons show the fee before you order. It goes to or from a city of your
        realm, at most {num(DELIVERY_LOAD)} kg at a time. A delivery is paid at once, goods and fee,
        and the warehouse keeps the goods for you until a caravan brings them. A pick-up is paid
        when the caravan collects, at the warehouse's prices of that moment, less the fee. Carrying
        it yourself costs nothing but is at your own risk. The fees are under{' '}
        <a href="#transport">Carrying &amp; transport</a>.
      </p>
      <h3>Transfer</h3>
      <p>
        To send goods or coins to another realm, open one of its cities under Cities in sight: under
        Transfer, a caravan fetches them from one of your cities and brings them to that city's
        storage, for a fee the button shows before you send. Nobody of yours needs to be at a
        warehouse. The fee is {num(TRANSFER_FEE_FACTOR)} times a delivery's over the caravan's whole
        way, taken from your city's storage with the goods; at most {num(DELIVERY_LOAD)} kg go at a
        time, coins counting by their weight. The other realm doesn't have to agree.
      </p>
    </>
  )
}
