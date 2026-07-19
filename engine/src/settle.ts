import { openOrder, fromHex, type EnclaveKeypair } from "./crypto.js";
import {
  clearBatch,
  filterFunded,
  type ClearingResult,
  type DecryptedOrder,
} from "./auction.js";
import type { SealedOrderEvent } from "./chain.js";

/**
 * Turn a batch's sealed order events into a settlement.
 *
 * An order is dropped (never reverted on) unless it:
 *   - decrypts to a well-formed payload under the enclave key,
 *   - names the same trader that submitted it onchain (no ciphertext replay
 *     by another account),
 *   - names the batch it was actually submitted to (no cross-batch replay),
 *   - is fully funded by the trader's frozen venue balance.
 *
 * Addresses are lowercased throughout; `balances` must be keyed lowercase.
 */
export function settleFromEvents(
  events: SealedOrderEvent[],
  keypair: EnclaveKeypair,
  balances: Map<string, { base: bigint; quote: bigint }>,
  referencePrice: bigint,
  maxDeviationBps: bigint
): { result: ClearingResult; accepted: number; dropped: number } {
  const orders: DecryptedOrder[] = [];
  for (const event of events) {
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
  const result = clearBatch(funded, referencePrice, maxDeviationBps);
  return { result, accepted: funded.length, dropped: events.length - funded.length };
}
