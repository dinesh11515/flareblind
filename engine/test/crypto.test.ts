import { beforeAll, describe, expect, it } from "vitest";
import {
  ready,
  generateEnclaveKeypair,
  keypairFromSecret,
  sealOrder,
  openOrder,
  toHex,
  fromHex,
  type OrderPayload,
} from "../src/crypto.js";

const payload: OrderPayload = {
  trader: "0x" + "a".repeat(40),
  batchId: 7,
  side: "buy",
  amountBase: "1000000000",
  limitPrice: "2100000000000000000",
};

beforeAll(async () => {
  await ready();
});

describe("sealed orders", () => {
  it("round-trips seal and open", () => {
    const kp = generateEnclaveKeypair();
    const sealed = sealOrder(payload, kp.publicKey);
    expect(openOrder(sealed, kp)).toEqual(payload);
  });

  it("stays within the onchain ciphertext size cap", () => {
    const kp = generateEnclaveKeypair();
    const big: OrderPayload = {
      ...payload,
      amountBase: "9".repeat(30),
      limitPrice: "9".repeat(30),
      batchId: 2 ** 31,
    };
    expect(sealOrder(big, kp.publicKey).length).toBeLessThanOrEqual(512);
  });

  it("rejects tampered ciphertexts", () => {
    const kp = generateEnclaveKeypair();
    const sealed = sealOrder(payload, kp.publicKey);
    sealed[sealed.length - 1] ^= 0x01;
    expect(openOrder(sealed, kp)).toBeNull();
  });

  it("rejects ciphertexts sealed to a different enclave", () => {
    const kp = generateEnclaveKeypair();
    const other = generateEnclaveKeypair();
    const sealed = sealOrder(payload, other.publicKey);
    expect(openOrder(sealed, kp)).toBeNull();
  });

  it("rejects well-encrypted junk payloads", () => {
    const kp = generateEnclaveKeypair();
    for (const junk of [
      { ...payload, side: "hodl" },
      { ...payload, amountBase: "-5" },
      { ...payload, amountBase: "0" },
      { ...payload, trader: "not an address" },
      { ...payload, batchId: 0 },
      "just a string",
    ]) {
      const sealed = sealOrder(junk as OrderPayload, kp.publicKey);
      expect(openOrder(sealed, kp)).toBeNull();
    }
  });

  it("derives a stable keypair from a fixed secret", () => {
    const kp = generateEnclaveKeypair();
    const restored = keypairFromSecret(toHex(kp.privateKey));
    expect(toHex(restored.publicKey)).toBe(toHex(kp.publicKey));
    const sealed = sealOrder(payload, kp.publicKey);
    expect(openOrder(sealed, restored)).toEqual(payload);
  });

  it("hex helpers round-trip", () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
  });
});
