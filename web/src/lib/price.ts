import { formatUnits, parseUnits } from "viem";
import type { PoolTokens } from "../types";

export function priceDecimals(tokens: PoolTokens): number {
  return 18 + tokens.quoteDecimals - tokens.baseDecimals;
}

export function parsePrice(human: string, tokens: PoolTokens): bigint {
  return parseUnits(human, priceDecimals(tokens));
}

export function formatPrice(price: bigint, tokens: PoolTokens): string {
  return formatUnits(price, priceDecimals(tokens));
}

export function priceToNumber(price: bigint, tokens: PoolTokens): number {
  return Number(formatPrice(price, tokens));
}
