import { useQuery } from "@tanstack/react-query";
import { type Address, createPublicClient, http } from "viem";
import { usePublicClient } from "wagmi";
import { queryBatchSettled } from "../lib/logs";
import type { Settlement } from "../types";
import { flareTestnet } from "../wagmi";
import { venueKeys } from "./queryKeys";

function fallbackClient() {
  return createPublicClient({
    chain: flareTestnet,
    transport: http(flareTestnet.rpcUrls.default.http[0]),
  });
}

export function useSettlements(pool?: Address, limit = 24) {
  const wagmiClient = usePublicClient({ chainId: flareTestnet.id });

  return useQuery({
    queryKey: [...venueKeys.settlements(pool), limit],
    enabled: Boolean(pool),
    refetchInterval: 45_000,
    queryFn: async (): Promise<Settlement[]> => {
      const client = wagmiClient ?? fallbackClient();
      const fromBlock = import.meta.env.VITE_POOL_FROM_BLOCK
        ? BigInt(import.meta.env.VITE_POOL_FROM_BLOCK)
        : undefined;
      const events = await queryBatchSettled(client, {
        address: pool!,
        fromBlock,
      });

      return events
        .map((args) => ({
          batchId: Number(args.batchId),
          clearingPrice: args.clearingPrice,
          matchedBase: args.matchedBase,
          fillCount: args.fillCount,
        }))
        .filter((s) => s.fillCount > 0 || s.matchedBase > 0n)
        .reverse()
        .slice(0, limit);
    },
  });
}
