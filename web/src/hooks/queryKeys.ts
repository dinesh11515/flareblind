import type { Address } from "viem";

export const venueKeys = {
  all: ["venue"] as const,
  tokens: (chainId: number, pool?: Address) =>
    [...venueKeys.all, chainId, "tokens", pool] as const,
  status: (chainId: number, pool?: Address) =>
    [...venueKeys.all, chainId, "status", pool] as const,
  balances: (chainId: number, pool?: Address, address?: Address) =>
    [...venueKeys.all, chainId, "balances", pool, address] as const,
  settlements: (chainId: number, pool?: Address) =>
    [...venueKeys.all, chainId, "settlements", pool] as const,
};
