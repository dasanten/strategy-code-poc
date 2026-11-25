# Trade Organization: trading

- **Trading with the Trade Organization:** only in person, by a resident (or a carriage) on a
  warehouse's tile, at its HQ or a trading post. Selling hands the goods into the warehouse and
  takes its coins into the resident's hands, as far as they can carry; buying is the other way
  round. It happens at once. A carriage of theirs on the tile can trade its load instead of
  their hands. Each unit goes at the price its stock makes with that unit in it, so a big trade
  moves the price as it goes, and a trade is cut down to what the trader holds, what the
  warehouse holds and what fits. At the HQ the coins come from and go into its coin warehouse.
- **Warehouse prices:** each warehouse prices every good from its own stock, buying lower than it
  sells. Posts don't share prices, so carrying goods between regions can pay off. Anyone with a
  resident in sight of a warehouse sees its prices.
- **Trading with an NPC city:** only in person, by a resident (or a carriage) on the tile of an
  NPC city's storage, exactly like trading at a warehouse: it happens at once, goods and coins
  move between the trader's hands (or carriage) and the storage, and a trade is cut down to what
  the trader holds, what the storage holds and what fits. It sells only its surplus, what its
  storages hold above its reserve (NPC reserve), and buys only goods it is short of, up to the
  reserve and with the coins in its storage; other goods it doesn't take. Its prices come from
  its own stock the way warehouse prices do (buying lower
  than it sells, each unit priced with its stock as it moves), then its standing toward the
  trader moves them like the city price: the better, the cheaper it sells and the more it pays.
  Anyone with a resident in sight of the storage sees its prices. A trade raises its standing
  toward the trader, like trade with the Trade Organization.
- **Swap:** goods for goods, in person at a warehouse or an NPC city's storage, with no Coins
  needed in hand. It is a sale and a purchase at once, each unit priced as those trades do, so the
  place's prices give the rate: the trader names what they want and how much, and hands over enough
  of the good they give to pay for it, rounded up. What is over comes back in Coins as far as
  the place holds them. It is cut down like any trade, and an NPC city swaps only its surplus for
  what it is short of. The Trade section lists an NPC city's **rates** without being asked: each
  good it is short of against each it has spare, worked out from its prices, so nothing new is kept
  and the city plans nothing for them.
- **Offer:** what a Player posts at a storage of their realm: "gives 10 Wood, wants 5 Stone", either
  side may be Coins, as many times over as the goods are there. The goods stay in the storage but
  set aside: workers, builders, Fetch and refills leave them alone, while a thief or raider can
  take them like any others, cutting the offer down. Anyone in sight sees it and its rate. A
  resident or carriage on the storage's tile accepts it, as many times as they can pay and carry;
  it happens at once, whether or not the Player is online, and raises standing like a trade. It
  ends when it is used up, when the Player takes it down, or when the storage is torn down or no
  longer the realm's (the goods are then ordinary goods of that storage). Scripts can post and accept
  offers.
- **NPC cities at an offer:** an NPC city sends its trader to a Player's offer within a set reach
  when the offer gives what it is short of and wants what it has spare (or Coins), at a rate at
  least as good as its own prices. The Trade Organization accepts offers only for its army to buy
  Food on the way (Trade Org debt).
- **Direct offer:** an offer sent to one named realm, who sees it at once wherever they are and
  accepts or declines it within a set time. The sender picks how the goods change hands: **in
  person**, an offer at a storage of the sender's that only that realm can accept; or **carried**,
  where on accepting the Trade Organization carries both sides' goods as two Transfers, its fee
  paid by the sender or split, as the sender picks (offered only while the HQ stands, and each side's
  goods are taken as a pick-up takes them). A storage's goods are set aside only for the in-person
  way. Carried, the sender names both cities when sending, as for a Transfer, and can only name a
  city whose storage they see, so the fee shown is exact; the other side only accepts or declines,
  from anywhere. It is taken whole on accepting, each side's goods within one carriage load, and
  changes no standing. Split, each side pays half of both fees; paid by the sender, the sender pays
  both. Each caravan takes the share of the side it picks up from as it collects, and the other
  side's from their storage as it unloads there. A storage short of coins on unloading gives what it
  has, the goods stay delivered and the Trade Organization bears the loss. A Player can send one to any realm they know of: one they see residents of, an ally, one whose
  city they have seen (Last seen), one with a standing toward them or they toward it, or their side
  in a contract, demand or Direct offer. Both sides see it in their Diplomacy tab's Direct offers until it ends, and a
  notice tells the one it is sent to, with the place. In person, it is otherwise an offer like any
  other: anyone in sight of the storage sees it and that it is for another realm, and the sender can
  take it down. Declined, lapsed or taken down, its goods are ordinary again and both sides are told;
  it lapses too when the realm it was sent to is gone. A realm can have only so many standing to one
  realm.
- **Trade section:** where a city's panel shows trading, for each of its warehouses or storages
  in sight, from the Player's side: what they **can buy** there and what they **can sell**, with
  how many units and the price (an NPC city lists only its surplus and what it is short of, and
  says it takes nothing else). With nobody of theirs there, it offers to **send** one of their
  residents (nearest first, with what they carry) or carriages: a walk order to the tile, then
  shown on the way. Once one is there, it shows what the trader carries and room left, and a
  trade that won't go says why (no coins in hand, no room, none in stock, not wanted). Delivery
  and Transfer each have a heading and a line saying what they do, with the fee before ordering,
  and the section links to the Wiki's "How to trade". The tile card of a warehouse, an NPC
  city's storage or stable with horses to buy or sell (Horse market), or a wandering trader at a stop has **Trade here**, which opens it. It shows their standing with that city, and a trade says how far it moved it. Only
  the UI: the trades are those above.
- **Stock floor:** the Trade Organization gets its stock physically (its own workplaces on every
  kind of resource, plus buying). When a warehouse of the HQ runs low, it tops up to a minimum at
  the end of each game day. This is the one controlled exception to "everything is physical" (ADR
  0003). A trading post's warehouse has no such top-up (ADR 0023): its floor only says what its
  spare hands, caravan and wandering traders go for, and what it holds came by them. A post can
  run dry, and a raid can empty a region's market.
- **Price anchor:** the Trade Organization buys low and sells high, so it is always there as a
  market of last resort. Its prices rise when its stock is low; Players usually get better deals
  trading with each other.
