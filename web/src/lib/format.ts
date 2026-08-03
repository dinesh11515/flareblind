export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function shortHex(hex: string, chars = 10): string {
  return hex.length <= 2 + chars * 2
    ? hex
    : `${hex.slice(0, 2 + chars)}…${hex.slice(-chars)}`;
}
