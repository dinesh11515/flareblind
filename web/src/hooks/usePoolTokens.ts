import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { erc20Abi } from "../abi/erc20";
import { poolAbi } from "../abi/pool";
import type { PoolTokens } from "../types";
import { useVenueClient } from "./useVenueClient";
import { venueKeys } from "./queryKeys";

export function usePoolTokens(pool?: Address) {
  const { client, chainId } = useVenueClient();

  return useQuery({
    queryKey: venueKeys.tokens(chainId, pool),
    enabled: Boolean(pool),
    staleTime: 60_000,
    queryFn: async (): Promise<PoolTokens> => {
      const [base, quote] = await Promise.all([
        client.readContract({ address: pool!, abi: poolAbi, functionName: "base" }),
        client.readContract({ address: pool!, abi: poolAbi, functionName: "quote" }),
      ]);
      const [baseSymbol, quoteSymbol, baseDecimals, quoteDecimals] =
        await Promise.all([
          client.readContract({ address: base, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: quote, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: base, abi: erc20Abi, functionName: "decimals" }),
          client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }),
        ]);
      return {
        base,
        quote,
        baseSymbol,
        quoteSymbol,
        baseDecimals: Number(baseDecimals),
        quoteDecimals: Number(quoteDecimals),
      };
    },
  });
}
