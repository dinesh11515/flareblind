import sodium from "libsodium-wrappers";

export interface EnclaveKeypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface OrderPayload {
  trader: string;
  batchId: number;
  side: "buy" | "sell";
  amountBase: string;
  limitPrice: string;
}

export async function ready(): Promise<void> {
  await sodium.ready;
}

export function generateEnclaveKeypair(): EnclaveKeypair {
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export function keypairFromSecret(secretHex: string): EnclaveKeypair {
  const privateKey = fromHex(secretHex);
  return { publicKey: sodium.crypto_scalarmult_base(privateKey), privateKey };
}

export function sealOrder(order: OrderPayload, enclavePublicKey: Uint8Array): Uint8Array {
  const plaintext = new TextEncoder().encode(JSON.stringify(order));
  return sodium.crypto_box_seal(plaintext, enclavePublicKey);
}

export function openOrder(sealed: Uint8Array, keypair: EnclaveKeypair): OrderPayload | null {
  let plaintext: Uint8Array;
  try {
    plaintext = sodium.crypto_box_seal_open(sealed, keypair.publicKey, keypair.privateKey);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.trader !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(o.trader)) return null;
  if (typeof o.batchId !== "number" || !Number.isInteger(o.batchId) || o.batchId < 1) return null;
  if (o.side !== "buy" && o.side !== "sell") return null;
  if (!isPositiveDecimal(o.amountBase) || !isPositiveDecimal(o.limitPrice)) return null;
  return {
    trader: o.trader,
    batchId: o.batchId,
    side: o.side,
    amountBase: o.amountBase as string,
    limitPrice: o.limitPrice as string,
  };
}

function isPositiveDecimal(v: unknown): boolean {
  return typeof v === "string" && /^[0-9]+$/.test(v) && BigInt(v) > 0n;
}

export function toHex(bytes: Uint8Array): string {
  return "0x" + Buffer.from(bytes).toString("hex");
}

export function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex.replace(/^0x/, ""), "hex"));
}
