import { useQuery } from "@tanstack/react-query";
import { type Address, createPublicClient, http } from "viem";
import { usePublicClient } from "wagmi";
import { oracleAbi } from "../abi/oracle";
import { poolAbi } from "../abi/pool";
import type { VenueStatus } from "../types";
import { flareTestnet } from "../wagmi";
import { venueKeys } from "./queryKeys";

function fallbackClient() {
  return createPublicClient({
    chain: flareTestnet,
    transport: http(flareTestnet.rpcUrls.default.http[0]),
  });
}

export function useVenueStatus(pool?: Address) {
  const wagmiClient = usePublicClient({ chainId: flareTestnet.id });

  return useQuery({
    queryKey: venueKeys.status(pool),
    enabled: Boolean(pool),
    refetchInterval: 4_000,
    queryFn: async (): Promise<VenueStatus> => {
      const client = wagmiClient ?? fallbackClient();
      const [info, enclaveKey, teeSigner, digest, deviation, oracleAddr, block] =
        await Promise.all([
          client.readContract({
            address: pool!,
            abi: poolAbi,
            functionName: "batchInfo",
          }),
          client.readContract({
            address: pool!,
            abi: poolAbi,
            functionName: "enclaveEncryptionKey",
          }),
          client.readContract({
            address: pool!,
            abi: poolAbi,
            functionName: "teeSigner",
          }),
          client.readContract({
            address: pool!,
            abi: poolAbi,
            functionName: "teeAttestationDigest",
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
          client.getBlock({ blockTag: "latest" }),
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

      return {
        batchId: Number(info[0]),
        phase: Number(info[1]),
        endsAt: info[2],
        chainNow: block.timestamp,
        orders: Number(info[3]),
        referencePrice,
        maxDeviationBps: deviation,
        enclaveKey,
        teeSigner,
        attestationDigest: digest,
      };
    },
  });
}
