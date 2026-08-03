import { useQuery } from "@tanstack/react-query";
import { type Address, createPublicClient, http } from "viem";
import { usePublicClient } from "wagmi";
import { erc20Abi } from "../abi/erc20";
import { poolAbi } from "../abi/pool";
import type { PoolTokens } from "../types";
import { flareTestnet } from "../wagmi";
import { venueKeys } from "./queryKeys";

function fallbackClient() {
  return createPublicClient({
    chain: flareTestnet,
    transport: http(flareTestnet.rpcUrls.default.http[0]),
  });
}

export function usePoolTokens(pool?: Address) {
  const wagmiClient = usePublicClient({ chainId: flareTestnet.id });

  return useQuery({
    queryKey: venueKeys.tokens(pool),
    enabled: Boolean(pool),
    staleTime: 60_000,
    queryFn: async (): Promise<PoolTokens> => {
      const client = wagmiClient ?? fallbackClient();
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
