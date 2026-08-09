import { useMemo } from "react";
import { createPublicClient, http, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { chains, venueChainId } from "../lib/network";

export function useVenueClient(): { client: PublicClient; chainId: number } {
  const { chainId: walletChainId } = useAccount();
  const chainId = venueChainId(walletChainId);
  const wagmiClient = usePublicClient({ chainId });

  const fallback = useMemo(() => {
    const chain = chains.find((c) => c.id === chainId) ?? chains[0];
    return createPublicClient({
      chain,
      transport: http(chain.rpcUrls.default.http[0], { batch: true }),
    });
  }, [chainId]);

  return { client: (wagmiClient as PublicClient | undefined) ?? fallback, chainId };
}
