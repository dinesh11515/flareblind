import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  defaultPoolAddress,
  isAddress,
  isSupersededPool,
  resolvePoolAddress,
} from "./network";

const POOL_KEY = "flareblind.pool";

export function readInitialPool(): string {
  const stored =
    localStorage.getItem(POOL_KEY) ?? localStorage.getItem("stillwater.pool");
  const resolved = resolvePoolAddress(stored);
  if (resolved && resolved !== stored) {
    localStorage.setItem(POOL_KEY, resolved);
    localStorage.removeItem("stillwater.pool");
  }
  return resolved;
}

export function usePoolAddress() {
  const [poolAddress, setPoolAddressState] = useState(readInitialPool);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSupersededPool(poolAddress)) {
      const def = defaultPoolAddress();
      setPoolAddressState(def);
      setError("That pool was retired. Using the current Coston2 venue.");
      return;
    }
    if (isAddress(poolAddress)) {
      localStorage.setItem(POOL_KEY, poolAddress);
    }
  }, [poolAddress]);

  const setPoolAddress = useCallback((next: string) => {
    if (isSupersededPool(next)) {
      setError("That pool was retired. Using the current Coston2 venue.");
      setPoolAddressState(defaultPoolAddress());
      return;
    }
    setError(null);
    setPoolAddressState(next);
  }, []);

  const pool = isAddress(poolAddress) ? (poolAddress as Address) : undefined;

  return { poolAddress, pool, setPoolAddress, poolError: error, clearPoolError: () => setError(null) };
}
