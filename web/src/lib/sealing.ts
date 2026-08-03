import sodium from "libsodium-wrappers";

export interface OrderDraft {
  trader: string;
  batchId: number;
  side: "buy" | "sell";
  amountBase: string;
  limitPrice: string;
}

export async function sealOrder(draft: OrderDraft, enclaveKeyHex: string): Promise<string> {
  await sodium.ready;
  const key = hexToBytes(enclaveKeyHex);
  if (key.length !== 32) throw new Error("venue has no enclave encryption key registered");
  if (key.every((b) => b === 0)) throw new Error("venue has no enclave encryption key registered");
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ ...draft, trader: draft.trader.toLowerCase() })
  );
  const sealed = sodium.crypto_box_seal(plaintext, key);
  return bytesToHex(sealed);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
