import { openOrder, fromHex, type EnclaveKeypair } from "./crypto.js";
import {
  clearBatch,
  filterFunded,
  type ClearingResult,
  type DecryptedOrder,
} from "./auction.js";
import type { SealedOrderEvent } from "./chain.js";

const BAND_USE_BPS = 90n;

export function settleFromEvents(
  events: SealedOrderEvent[],
  keypair: EnclaveKeypair,
  balances: Map<string, { base: bigint; quote: bigint }>,
  referencePrice: bigint,
  maxDeviationBps: bigint
): { result: ClearingResult; accepted: number; dropped: number } {
  const orders: DecryptedOrder[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const ciphertext = event.sealedOrder.toLowerCase();
    if (seen.has(ciphertext)) continue;
    seen.add(ciphertext);

    const payload = openOrder(fromHex(event.sealedOrder), keypair);
    if (payload === null) continue;
    if (payload.trader.toLowerCase() !== event.trader.toLowerCase()) continue;
    if (payload.batchId !== event.batchId) continue;
    orders.push({
      trader: event.trader.toLowerCase(),
      side: payload.side,
      amountBase: BigInt(payload.amountBase),
      limitPrice: BigInt(payload.limitPrice),
      index: event.orderIndex,
    });
  }

  const funded = filterFunded(orders, balances);
  const result = clearBatch(
    funded,
    referencePrice,
    (maxDeviationBps * BAND_USE_BPS) / 100n
  );
  return { result, accepted: funded.length, dropped: events.length - funded.length };
}
