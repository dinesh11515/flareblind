import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { oracleAbi } from "../abi/oracle";
import { poolAbi } from "../abi/pool";
import type { VenueStatus } from "../types";
import { useVenueClient } from "./useVenueClient";
import { venueKeys } from "./queryKeys";

type PoolView = Extract<
  (typeof poolAbi)[number],
  { type: "function"; stateMutability: "view" }
>["name"];

export function useVenueStatus(pool?: Address) {
  const { client, chainId } = useVenueClient();

  return useQuery({
    queryKey: venueKeys.status(chainId, pool),
    enabled: Boolean(pool),
    refetchInterval: 4_000,
    queryFn: async (): Promise<VenueStatus> => {
      const read = <T,>(functionName: PoolView) =>
        client.readContract({
          address: pool!,
          abi: poolAbi,
          functionName,
        }) as Promise<T>;

      const [
        info,
        enclaveKey,
        teeSigner,
        digest,
        deviation,
        duration,
        oracleAddr,
        block,
      ] = await Promise.all([
        read<readonly [bigint, number, bigint, number]>("batchInfo"),
        read<`0x${string}`>("enclaveEncryptionKey"),
        read<Address>("teeSigner"),
        read<`0x${string}`>("teeAttestationDigest"),
        read<bigint>("maxDeviationBps"),
        read<bigint>("batchDuration"),
        read<Address>("oracle"),
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
        batchDuration: duration,
        enclaveKey,
        teeSigner,
        attestationDigest: digest,
      };
    },
  });
}
