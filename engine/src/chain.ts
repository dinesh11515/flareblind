import { Contract, JsonRpcProvider, Wallet } from "ethers";
import type { ClearingResult } from "./auction.js";

export const POOL_ABI = [
  "event OrderSubmitted(uint64 indexed batchId, address indexed trader, uint32 orderIndex, bytes sealedOrder)",
  "event BatchClosed(uint64 indexed batchId, uint32 orderCount)",
  "event BatchSettled(uint64 indexed batchId, uint256 clearingPrice, uint256 matchedBase, uint32 fillCount)",
  "function batchInfo() view returns (uint64 id, uint8 phase, uint256 endsAt, uint32 orders)",
  "function closeBatch()",
  "function settleBatch(uint64 batchId, uint256 clearingPrice, (address trader, bool isBuy, uint128 baseAmount)[] fills)",
  "function baseBalanceOf(address) view returns (uint256)",
  "function quoteBalanceOf(address) view returns (uint256)",
  "function maxDeviationBps() view returns (uint256)",
  "function oracle() view returns (address)",
  "function teeSigner() view returns (address)",
  "function enclaveEncryptionKey() view returns (bytes32)",
];

const ORACLE_ABI = [
  "function latestPrice() returns (uint256 price, uint256 timestamp)",
];

export const Phase = { Open: 0, Sealing: 1 } as const;

const LOG_CHUNK = 30;

const MAX_LOOKBACK = 50_000;

export interface SealedOrderEvent {
  batchId: number;
  trader: string;
  orderIndex: number;
  sealedOrder: string;
}

interface OrderSubmittedLog {
  args: [bigint, string, bigint, string];
}

export class PoolClient {
  readonly provider: JsonRpcProvider;
  readonly signer: Wallet;
  readonly pool: Contract;

  constructor(rpcUrl: string, poolAddress: string, teeSignerKey: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.signer = new Wallet(teeSignerKey, this.provider);
    this.pool = new Contract(poolAddress, POOL_ABI, this.signer);
  }

  async batchInfo(): Promise<{ id: number; phase: number; endsAt: bigint; orders: number }> {
    const [id, phase, endsAt, orders] = await this.pool.batchInfo();
    return { id: Number(id), phase: Number(phase), endsAt, orders: Number(orders) };
  }

  async chainNow(): Promise<bigint> {
    const block = await this.provider.getBlock("latest");
    return BigInt(block!.timestamp);
  }

  async closeBatch(): Promise<void> {
    const tx = await this.pool.closeBatch();
    await tx.wait();
  }

  async fetchSealedOrders(batchId: number, expectedCount?: number): Promise<SealedOrderEvent[]> {
    const filter = this.pool.filters.OrderSubmitted(batchId);
    const latest = await this.provider.getBlockNumber();
    const configured = process.env.POOL_FROM_BLOCK
      ? Number(process.env.POOL_FROM_BLOCK)
      : undefined;
    const floor =
      configured !== undefined && configured <= latest
        ? configured
        : Math.max(0, latest - MAX_LOOKBACK);
    const target = expectedCount ?? Infinity;

    const logs: OrderSubmittedLog[] = [];
    let end = latest;
    while (end >= floor && logs.length < target) {
      const start = Math.max(floor, end - LOG_CHUNK + 1);
      const chunk = await this.pool.queryFilter(filter, start, end);
      logs.push(...(chunk as unknown as OrderSubmittedLog[]));
      if (start === floor) break;
      end = start - 1;
    }

    return logs
      .map(({ args }) => ({
        batchId: Number(args[0]),
        trader: args[1],
        orderIndex: Number(args[2]),
        sealedOrder: args[3],
      }))
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }

  async venueBalances(traders: string[]): Promise<Map<string, { base: bigint; quote: bigint }>> {
    const unique = [...new Set(traders.map((t) => t.toLowerCase()))];
    const pairs = await Promise.all(
      unique.map(async (trader) => {
        const [base, quote] = await Promise.all([
          this.pool.baseBalanceOf(trader) as Promise<bigint>,
          this.pool.quoteBalanceOf(trader) as Promise<bigint>,
        ]);
        return [trader, { base, quote }] as const;
      })
    );
    return new Map(pairs);
  }

  async referencePrice(): Promise<bigint> {
    const oracleAddress: string = await this.pool.oracle();
    const oracle = new Contract(oracleAddress, ORACLE_ABI, this.provider);
    const [price] = await oracle.latestPrice.staticCallResult();
    return price;
  }

  async maxDeviationBps(): Promise<bigint> {
    return await this.pool.maxDeviationBps();
  }

  async settle(batchId: number, result: ClearingResult): Promise<string> {
    const fills = result.fills.map((f) => ({
      trader: f.trader,
      isBuy: f.isBuy,
      baseAmount: f.baseAmount,
    }));
    const tx = await this.pool.settleBatch(batchId, result.clearingPrice, fills);
    const receipt = await tx.wait();
    return receipt.hash;
  }
}
