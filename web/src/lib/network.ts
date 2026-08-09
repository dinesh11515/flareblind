import { flareTestnet, hardhat } from "viem/chains";
import type { Address } from "viem";

export const COSTON2_ID = flareTestnet.id;
export const LOCAL_ID = hardhat.id;

export const LOCAL_ENABLED = import.meta.env.DEV;

export const chains = LOCAL_ENABLED
  ? ([flareTestnet, hardhat] as const)
  : ([flareTestnet] as const);

export function isSupportedChain(id: number | undefined): boolean {
  return id === COSTON2_ID || (LOCAL_ENABLED && id === LOCAL_ID);
}

export function venueChainId(id: number | undefined): number {
  return isSupportedChain(id) ? id! : COSTON2_ID;
}

export function defaultPoolAddress(): Address | "" {
  const raw = (import.meta.env.VITE_POOL_ADDRESS as string | undefined)?.trim() ?? "";
  return isAddress(raw) ? (raw as Address) : "";
}

const SUPERSEDED_POOLS = new Set([
  "0x69369e567bc87e463d2acc90abf9ca0e15cb8795",
  "0xcfb131e94b6485c851c8f06c3a7dad922ca51b6c",
]);

export function isSupersededPool(address: string): boolean {
  return SUPERSEDED_POOLS.has(address.trim().toLowerCase());
}

export function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function resolvePoolAddress(stored: string | null): string {
  const def = defaultPoolAddress();
  if (!stored || !isAddress(stored) || isSupersededPool(stored)) {
    return def;
  }
  return stored;
}

export function chainLabel(id: number | undefined): string {
  if (id === COSTON2_ID) return "Coston2";
  if (id === LOCAL_ID) return "Local";
  if (id == null) return "disconnected";
  return `chain ${id}`;
}

export function isCoston2(id: number | undefined): boolean {
  return id === COSTON2_ID;
}

export function explorerTxUrl(id: number | undefined, tx: string): string | null {
  return id === COSTON2_ID
    ? `https://coston2-explorer.flare.network/tx/${tx}`
    : null;
}
