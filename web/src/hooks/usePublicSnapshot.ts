import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";
import { usePublicClient } from "wagmi";
import { oracleAbi } from "../abi/oracle";
import { poolAbi } from "../abi/pool";
import { defaultPoolAddress } from "../lib/network";
import { queryBatchSettled } from "../lib/logs";
import type { Settlement } from "../types";
import { flareTestnet } from "../wagmi";
import { venueKeys } from "./queryKeys";

export interface PublicSnapshot {
  batchesCleared: number;
  referencePrice: bigint | null;
  maxDeviationBps: bigint;
  settlements: Settlement[];
}

function fallbackClient() {
  return createPublicClient({
    chain: flareTestnet,
    transport: http(flareTestnet.rpcUrls.default.http[0]),
  });
}

export function usePublicSnapshot() {
  const pool = defaultPoolAddress() || undefined;
  const wagmiClient = usePublicClient({ chainId: flareTestnet.id });

  return useQuery({
    queryKey: venueKeys.publicSnapshot(pool),
    enabled: Boolean(pool),
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<PublicSnapshot> => {
      const client = wagmiClient ?? fallbackClient();
      const [info, maxDeviationBps, oracleAddr] = await Promise.all([
        client.readContract({
          address: pool!,
          abi: poolAbi,
          functionName: "batchInfo",
        }),
        client.readContract({
          address: pool!,
          abi: poolAbi,
          functionName: "maxDeviationBps",
        }),
        client.readContract({
          address: pool!,
          abi: poolAbi,
          functionName: "oracle",
        }),
      ]);

      let referencePrice: bigint | null = null;
      try {
        const latest = await client.readContract({
          address: oracleAddr,
          abi: oracleAbi,
          functionName: "latestPrice",
        });
        referencePrice = latest[0];
      } catch {
        referencePrice = null;
      }

      let settlements: Settlement[] = [];
      try {
        const events = await queryBatchSettled(client, { address: pool! });
        settlements = events
          .map((args) => ({
            batchId: Number(args.batchId),
            clearingPrice: args.clearingPrice,
            matchedBase: args.matchedBase,
            fillCount: args.fillCount,
          }))
          .filter((s) => s.fillCount > 0 || s.matchedBase > 0n)
          .reverse()
          .slice(0, 7);
      } catch {
        settlements = [];
      }

      return {
        batchesCleared: Math.max(0, Number(info[0]) - 1),
        referencePrice,
        maxDeviationBps,
        settlements,
      };
    },
  });
}
