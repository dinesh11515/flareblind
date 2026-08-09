import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { queryBatchSettled } from "../lib/logs";
import { COSTON2_ID } from "../lib/network";
import type { Settlement } from "../types";
import { useVenueClient } from "./useVenueClient";
import { venueKeys } from "./queryKeys";

const CACHE_LIMIT = 48;

interface CachedSettlement {
  batchId: number;
  clearingPrice: string;
  matchedBase: string;
  fillCount: number;
}

const cacheKey = (pool: Address) => `flareblind.settlements.${pool.toLowerCase()}`;

function readCache(key: string): Settlement[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return (JSON.parse(raw) as CachedSettlement[]).map((s) => ({
      batchId: s.batchId,
      clearingPrice: BigInt(s.clearingPrice),
      matchedBase: BigInt(s.matchedBase),
      fillCount: s.fillCount,
    }));
  } catch {
    return [];
  }
}

function writeCache(key: string, settlements: Settlement[]): void {
  const rows: CachedSettlement[] = settlements.map((s) => ({
    batchId: s.batchId,
    clearingPrice: s.clearingPrice.toString(),
    matchedBase: s.matchedBase.toString(),
    fillCount: s.fillCount,
  }));
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    return;
  }
}

export function useSettlements(pool?: Address, limit = 24) {
  const { client, chainId } = useVenueClient();

  return useQuery({
    queryKey: [...venueKeys.settlements(chainId, pool), limit],
    enabled: Boolean(pool),
    refetchInterval: 45_000,
    queryFn: async (): Promise<Settlement[]> => {
      const fromBlock = import.meta.env.VITE_POOL_FROM_BLOCK
        ? BigInt(import.meta.env.VITE_POOL_FROM_BLOCK)
        : undefined;
      const events = await queryBatchSettled(client, {
        address: pool!,
        fromBlock,
      });

      const scanned = events
        .map((args) => ({
          batchId: Number(args.batchId),
          clearingPrice: args.clearingPrice,
          matchedBase: args.matchedBase,
          fillCount: args.fillCount,
        }))
        .filter((s) => s.fillCount > 0 && s.matchedBase > 0n);

      if (chainId !== COSTON2_ID) {
        return scanned.sort((a, b) => b.batchId - a.batchId).slice(0, limit);
      }

      const key = cacheKey(pool!);
      const byBatch = new Map<number, Settlement>();
      for (const s of readCache(key)) byBatch.set(s.batchId, s);
      for (const s of scanned) byBatch.set(s.batchId, s);
      const merged = [...byBatch.values()]
        .sort((a, b) => b.batchId - a.batchId)
        .slice(0, CACHE_LIMIT);
      writeCache(key, merged);
      return merged.slice(0, limit);
    },
  });
}
