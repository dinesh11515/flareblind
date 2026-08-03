import { describe, expect, it } from "vitest";
import {
  clearBatch,
  filterFunded,
  ceilMul,
  PRICE_SCALE,
  type DecryptedOrder,
} from "../src/auction.js";

const P = (h: string) => {

  const [whole, frac = ""] = h.split(".");
  return BigInt(whole + frac.padEnd(18, "0").slice(0, 18));
};
const REF = P("2.10");
const BPS = 200n;

let seq = 0;
const order = (
  side: "buy" | "sell",
  amount: bigint,
  limit: bigint,
  trader = `0x${(++seq).toString(16).padStart(40, "0")}`
): DecryptedOrder => ({ trader, side, amountBase: amount, limitPrice: limit, index: seq });

describe("clearBatch", () => {
  it("clears a simple cross at the volume-maximizing price", () => {
    const orders = [
      order("buy", 1200n, P("2.12")),
      order("sell", 800n, P("2.05")),
      order("sell", 700n, P("2.11")),
    ];
    const result = clearBatch(orders, REF, BPS);

    expect(result.clearingPrice).toBe(P("2.11"));
    expect(result.matchedBase).toBe(1200n);
  });

  it("returns empty when nothing crosses", () => {
    const orders = [
      order("buy", 1000n, P("2.06")),
      order("sell", 1000n, P("2.14")),
    ];
    const result = clearBatch(orders, REF, BPS);
    expect(result.clearingPrice).toBe(0n);
    expect(result.fills).toHaveLength(0);
  });

  it("never fills an order beyond its limit, even when both sides are willing", () => {

    const orders = [
      order("buy", 500n, P("3.10")),
      order("sell", 500n, P("2.90")),
    ];
    const result = clearBatch(orders, REF, BPS);
    expect(result.clearingPrice).toBe(0n);
    expect(result.fills).toHaveLength(0);
  });

  it("clamps aggressive limits into the band to maximize volume", () => {
    const hi = (REF * 10200n) / 10000n;
    const orders = [
      order("buy", 1000n, P("2.30")),
      order("sell", 600n, P("2.14")),
      order("sell", 400n, hi),
    ];
    const result = clearBatch(orders, REF, BPS);

    expect(result.clearingPrice).toBe(hi);
    expect(result.matchedBase).toBe(1000n);
  });

  it("prefers the price closest to reference among equal-volume candidates", () => {
    const orders = [
      order("buy", 1000n, P("2.14")),
      order("sell", 1000n, P("2.06")),
    ];
    const result = clearBatch(orders, REF, BPS);

    expect(result.clearingPrice).toBe(REF);
  });

  it("pro-rates the oversubscribed side to exact conservation", () => {
    const orders = [
      order("buy", 1000n, P("2.10")),
      order("sell", 700n, P("2.10")),
      order("sell", 600n, P("2.10")),
      order("sell", 400n, P("2.10")),
    ];
    const result = clearBatch(orders, REF, BPS);
    expect(result.matchedBase).toBe(1000n);
    const buys = result.fills.filter((f) => f.isBuy);
    const sells = result.fills.filter((f) => !f.isBuy);
    const sum = (fs: typeof sells) => fs.reduce((a, f) => a + f.baseAmount, 0n);
    expect(sum(buys)).toBe(1000n);
    expect(sum(sells)).toBe(1000n);

    expect(sells.every((f) => f.baseAmount <= 700n)).toBe(true);
  });

  it("holds conservation across randomized batches", () => {
    let rng = 42n;
    const next = () => {
      rng = (rng * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
      return rng;
    };
    for (let trial = 0; trial < 200; trial++) {
      const orders: DecryptedOrder[] = [];
      const n = Number(next() % 12n) + 1;
      for (let i = 0; i < n; i++) {
        const side = next() % 2n === 0n ? "buy" : "sell";
        const amount = (next() % 10_000n) + 1n;

        const limit = REF + ((next() % (10n ** 17n)) - 5n * 10n ** 16n);
        orders.push(order(side, amount, limit));
      }
      const result = clearBatch(orders, REF, BPS);
      const buys = result.fills.filter((f) => f.isBuy);
      const sells = result.fills.filter((f) => !f.isBuy);
      const sum = (fs: typeof sells) => fs.reduce((a, f) => a + f.baseAmount, 0n);
      expect(sum(buys)).toBe(sum(sells));
      expect(sum(buys)).toBe(result.matchedBase);
      if (result.matchedBase > 0n) {
        const lo = (REF * (10000n - BPS)) / 10000n;
        const hi = (REF * (10000n + BPS)) / 10000n;
        expect(result.clearingPrice >= lo && result.clearingPrice <= hi).toBe(true);
      }
    }
  });
});

describe("filterFunded", () => {
  const alice = "0x" + "a".repeat(40);
  const bob = "0x" + "b".repeat(40);

  it("keeps orders covered by venue balances and drops the rest", () => {
    const orders = [
      order("buy", 1000n, P("2.10"), alice),
      order("buy", 1000n, P("2.10"), alice),
      order("sell", 500n, P("2.10"), bob),
    ];
    const balances = new Map([
      [alice, { base: 0n, quote: ceilMul(1000n, P("2.10")) }],
      [bob, { base: 400n, quote: 0n }],
    ]);
    const kept = filterFunded(orders, balances);
    expect(kept).toHaveLength(1);
    expect(kept[0].trader).toBe(alice);
  });

  it("reserves buy funding at the order limit (worst clearing case)", () => {
    const orders = [order("buy", 3n, P("2.10"), alice)];

    const balances = new Map([[alice, { base: 0n, quote: 6n }]]);
    expect(filterFunded(orders, balances)).toHaveLength(0);
    balances.set(alice, { base: 0n, quote: 7n });
    expect(filterFunded(orders, balances)).toHaveLength(1);
  });
});

describe("ceilMul", () => {
  it("rounds quote costs up", () => {
    expect(ceilMul(1n, P("2.10"))).toBe(3n);
    expect(ceilMul(10n, P("2.10"))).toBe(21n);
    expect(ceilMul(0n, P("2.10"))).toBe(0n);
    expect(ceilMul(1n, PRICE_SCALE)).toBe(1n);
  });
});
