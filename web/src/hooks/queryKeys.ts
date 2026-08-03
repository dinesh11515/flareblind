import type { Address } from "viem";

export const venueKeys = {
  all: ["venue"] as const,
  tokens: (pool?: Address) => [...venueKeys.all, "tokens", pool] as const,
  status: (pool?: Address) => [...venueKeys.all, "status", pool] as const,
  balances: (pool?: Address, address?: Address) =>
    [...venueKeys.all, "balances", pool, address] as const,
  settlements: (pool?: Address) =>
    [...venueKeys.all, "settlements", pool] as const,
  publicSnapshot: (pool?: Address) =>
    [...venueKeys.all, "publicSnapshot", pool] as const,
};
