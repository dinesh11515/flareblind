import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { erc20Abi } from "../abi/erc20";
import { poolAbi } from "../abi/pool";
import type { Balances, PoolTokens } from "../types";
import { useVenueClient } from "./useVenueClient";
import { venueKeys } from "./queryKeys";

export function useBalances(
  pool: Address | undefined,
  tokens: PoolTokens | undefined,
  address: Address | undefined,
) {
  const { client, chainId } = useVenueClient();

  return useQuery({
    queryKey: venueKeys.balances(chainId, pool, address),
    enabled: Boolean(pool && tokens && address),
    refetchInterval: 4_000,
    queryFn: async (): Promise<Balances> => {
      const [walletBase, walletQuote, venueBase, venueQuote] = await Promise.all([
        client.readContract({
          address: tokens!.base,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address!],
        }),
        client.readContract({
          address: tokens!.quote,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address!],
        }),
        client.readContract({
          address: pool!,
          abi: poolAbi,
          functionName: "baseBalanceOf",
          args: [address!],
        }),
        client.readContract({
          address: pool!,
          abi: poolAbi,
          functionName: "quoteBalanceOf",
          args: [address!],
        }),
      ]);
      return { walletBase, walletQuote, venueBase, venueQuote };
    },
  });
}
