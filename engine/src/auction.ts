/**
 * Uniform-price batch auction.
 *
 * All orders in a batch clear at one price, chosen to maximize executed
 * volume. Every filled buy pays the same price every filled sell receives,
 * so ordering within a batch carries no advantage and there is nothing to
 * front-run. The clearing price is constrained to the FTSO reference band
 * up front, so the enclave never proposes a settlement the contract would
 * reject.
 */

const BPS = 10_000n;
export const PRICE_SCALE = 10n ** 18n;

export interface DecryptedOrder {
  trader: string;
  side: "buy" | "sell";
  amountBase: bigint; // base-wei
  limitPrice: bigint; // 1e18-scaled quote per base-wei
  index: number; // submission order, used for deterministic tie-breaks
}

export interface Fill {
  trader: string;
  isBuy: boolean;
  baseAmount: bigint;
}

export interface ClearingResult {
  clearingPrice: bigint; // 0n when nothing crosses
  matchedBase: bigint;
  fills: Fill[];
}

/**
 * Drop orders a trader cannot fund from their frozen venue balance.
 * Orders are considered in submission sequence; each buy reserves
 * ceil(amount * limit) quote (limit is the worst price a buy can clear at),
 * each sell reserves its base amount.
 */
export function filterFunded(
  orders: DecryptedOrder[],
  balances: Map<string, { base: bigint; quote: bigint }>
): DecryptedOrder[] {
  const remaining = new Map<string, { base: bigint; quote: bigint }>();
  for (const [trader, b] of balances) remaining.set(trader, { ...b });

  const kept: DecryptedOrder[] = [];
  for (const order of [...orders].sort((a, b) => a.index - b.index)) {
    const rem = remaining.get(order.trader);
    if (!rem) continue;
    if (order.side === "buy") {
      const reserve = ceilMul(order.amountBase, order.limitPrice);
      if (rem.quote < reserve) continue;
      rem.quote -= reserve;
    } else {
      if (rem.base < order.amountBase) continue;
      rem.base -= order.amountBase;
    }
    kept.push(order);
  }
  return kept;
}

export function clearBatch(
  orders: DecryptedOrder[],
  referencePrice: bigint,
  maxDeviationBps: bigint
): ClearingResult {
  const empty: ClearingResult = { clearingPrice: 0n, matchedBase: 0n, fills: [] };
  if (orders.length === 0 || referencePrice <= 0n) return empty;

  const lo = (referencePrice * (BPS - maxDeviationBps)) / BPS;
  const hi = (referencePrice * (BPS + maxDeviationBps)) / BPS;

  // Candidate prices: every order limit clamped into the reference band,
  // plus the reference itself. Clamping keeps volume from orders whose
  // limits sit outside the band while never proposing an out-of-band price.
  const candidates = new Set<bigint>([referencePrice]);
  for (const o of orders) {
    candidates.add(o.limitPrice < lo ? lo : o.limitPrice > hi ? hi : o.limitPrice);
  }

  let best: { price: bigint; executable: bigint } | null = null;
  for (const price of candidates) {
    const buyVol = sum(orders, (o) => o.side === "buy" && o.limitPrice >= price);
    const sellVol = sum(orders, (o) => o.side === "sell" && o.limitPrice <= price);
    const executable = buyVol < sellVol ? buyVol : sellVol;
    if (
      best === null ||
      executable > best.executable ||
      (executable === best.executable && closer(price, best.price, referencePrice))
    ) {
      best = { price, executable };
    }
  }

  if (best === null || best.executable === 0n) return empty;
  const { price, executable } = best;

  const buys = orders.filter((o) => o.side === "buy" && o.limitPrice >= price);
  const sells = orders.filter((o) => o.side === "sell" && o.limitPrice <= price);
  const buyVol = sum(buys, () => true);
  const sellVol = sum(sells, () => true);

  const buyFills =
    buyVol === executable ? fullFills(buys) : prorate(buys, executable, buyVol);
  const sellFills =
    sellVol === executable ? fullFills(sells) : prorate(sells, executable, sellVol);

  return {
    clearingPrice: price,
    matchedBase: executable,
    fills: [
      ...buyFills.map((f) => ({ ...f, isBuy: true })),
      ...sellFills.map((f) => ({ ...f, isBuy: false })),
    ],
  };
}

function fullFills(orders: DecryptedOrder[]): { trader: string; baseAmount: bigint }[] {
  return orders.map((o) => ({ trader: o.trader, baseAmount: o.amountBase }));
}

/**
 * Pro-rata allocation for the oversubscribed side. Floor allocations are
 * topped up one wei at a time by largest fractional remainder (submission
 * index breaks remaining ties), so the side sums to exactly `executable`
 * and settlement conservation holds to the wei.
 */
function prorate(
  orders: DecryptedOrder[],
  executable: bigint,
  totalVol: bigint
): { trader: string; baseAmount: bigint }[] {
  const entries = orders.map((o) => {
    const exact = o.amountBase * executable;
    return {
      order: o,
      alloc: exact / totalVol,
      remainder: exact % totalVol,
    };
  });

  let shortfall = executable - entries.reduce((acc, e) => acc + e.alloc, 0n);
  const byRemainder = [...entries].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.order.index - b.order.index;
  });
  for (const entry of byRemainder) {
    if (shortfall === 0n) break;
    // never allocate above the order's own size
    if (entry.alloc < entry.order.amountBase) {
      entry.alloc += 1n;
      shortfall -= 1n;
    }
  }

  return entries
    .filter((e) => e.alloc > 0n)
    .map((e) => ({ trader: e.order.trader, baseAmount: e.alloc }));
}

function sum(orders: DecryptedOrder[], keep: (o: DecryptedOrder) => boolean): bigint {
  return orders.reduce((acc, o) => (keep(o) ? acc + o.amountBase : acc), 0n);
}

function closer(a: bigint, b: bigint, ref: bigint): boolean {
  const da = a > ref ? a - ref : ref - a;
  const db = b > ref ? b - ref : ref - b;
  if (da !== db) return da < db;
  return a < b; // final tie-break: deterministic, favors the lower price
}

export function ceilMul(amountBase: bigint, price: bigint): bigint {
  return (amountBase * price + PRICE_SCALE - 1n) / PRICE_SCALE;
}
