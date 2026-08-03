import type { Address, Hex } from "viem";

export interface PoolTokens {
  base: Address;
  quote: Address;
  baseSymbol: string;
  quoteSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
}

export interface VenueStatus {
  batchId: number;
  phase: number;
  endsAt: bigint;
  chainNow: bigint;
  orders: number;
  referencePrice: bigint | null;
  maxDeviationBps: bigint;
  enclaveKey: Hex;
  teeSigner: Address;
  attestationDigest: Hex;
}

export interface Balances {
  walletBase: bigint;
  walletQuote: bigint;
  venueBase: bigint;
  venueQuote: bigint;
}

export interface Settlement {
  batchId: number;
  clearingPrice: bigint;
  matchedBase: bigint;
  fillCount: number;
}

export interface LocalOrder {
  batchId: number;
  side: "buy" | "sell";
  amount: string;
  limit: string;
  ciphertext: string;
  at: number;
}
