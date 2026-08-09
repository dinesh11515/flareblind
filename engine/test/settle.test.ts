import { beforeAll, describe, expect, it } from "vitest";
import {
  ready,
  generateEnclaveKeypair,
  sealOrder,
  toHex,
  type EnclaveKeypair,
  type OrderPayload,
} from "../src/crypto.js";
import { settleFromEvents } from "../src/settle.js";
import type { SealedOrderEvent } from "../src/chain.js";

const P = (h: string) => {
  const [whole, frac = ""] = h.split(".");
  return BigInt(whole + frac.padEnd(18, "0").slice(0, 18));
};
const REF = P("2.10");
const BPS = 200n;

const ALICE = "0x" + "a".repeat(40);
const MALLORY = "0x" + "b".repeat(40);

let kp: EnclaveKeypair;
beforeAll(async () => {
  await ready();
  kp = generateEnclaveKeypair();
});

const payload = (over: Partial<OrderPayload> = {}): OrderPayload => ({
  trader: ALICE,
  batchId: 1,
  side: "buy",
  amountBase: "1000",
  limitPrice: P("2.10").toString(),
  ...over,
});

const event = (p: OrderPayload, over: Partial<SealedOrderEvent> = {}): SealedOrderEvent => ({
  batchId: 1,
  trader: p.trader,
  orderIndex: 0,
  sealedOrder: toHex(sealOrder(p, kp.publicKey)),
  ...over,
});

const funded = new Map([
  [ALICE, { base: 10_000n, quote: 100_000n }],
  [MALLORY, { base: 10_000n, quote: 100_000n }],
]);

const run = (events: SealedOrderEvent[]) =>
  settleFromEvents(events, kp, funded, REF, BPS);

describe("settleFromEvents", () => {
  it("clears a matched pair sealed to the enclave key", () => {
    const { result, accepted, dropped } = run([
      event(payload({ side: "buy" })),
      event(payload({ trader: MALLORY, side: "sell" }), {
        trader: MALLORY,
        orderIndex: 1,
      }),
    ]);
    expect(accepted).toBe(2);
    expect(dropped).toBe(0);
    expect(result.matchedBase).toBe(1000n);
  });

  it("drops a ciphertext replayed from another address", () => {
    const alices = event(payload());
    const stolen: SealedOrderEvent = {
      ...alices,
      trader: MALLORY,
      orderIndex: 1,
    };
    const { accepted, dropped } = run([stolen]);
    expect(accepted).toBe(0);
    expect(dropped).toBe(1);
  });

  it("drops a ciphertext replayed into a later batch", () => {
    const stale = event(payload({ batchId: 1 }), { batchId: 2, orderIndex: 0 });
    const { accepted, dropped } = run([stale]);
    expect(accepted).toBe(0);
    expect(dropped).toBe(1);
  });

  it("counts a trader's own resubmitted ciphertext once", () => {
    const once = event(payload({ side: "sell" }));
    const { result, accepted } = run([
      event(payload({ trader: MALLORY, side: "buy" }), { trader: MALLORY }),
      once,
      { ...once, orderIndex: 2 },
    ]);
    expect(accepted).toBe(2);
    expect(result.matchedBase).toBe(1000n);
  });

  it("drops orders sealed to a different enclave", () => {
    const other = generateEnclaveKeypair();
    const wrongKey: SealedOrderEvent = {
      batchId: 1,
      trader: ALICE,
      orderIndex: 0,
      sealedOrder: toHex(sealOrder(payload(), other.publicKey)),
    };
    expect(run([wrongKey]).accepted).toBe(0);
  });

  it("drops orders the trader cannot fund", () => {
    const broke = new Map([[ALICE, { base: 0n, quote: 0n }]]);
    const { accepted, dropped } = settleFromEvents(
      [event(payload())],
      kp,
      broke,
      REF,
      BPS
    );
    expect(accepted).toBe(0);
    expect(dropped).toBe(1);
  });

  it("keeps the clearing price inside the margin the contract will re-check", () => {
    const { result } = run([
      event(payload({ side: "buy", limitPrice: P("3.00").toString() })),
      event(payload({ trader: MALLORY, side: "sell", limitPrice: P("1.00").toString() }), {
        trader: MALLORY,
        orderIndex: 1,
      }),
    ]);
    const hard = (REF * BPS) / 10_000n;
    const drift =
      result.clearingPrice > REF ? result.clearingPrice - REF : REF - result.clearingPrice;
    expect(result.matchedBase).toBe(1000n);
    expect(drift).toBeLessThan(hard);
  });
});
