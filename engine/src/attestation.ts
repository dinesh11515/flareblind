import http from "node:http";
import { createHash } from "node:crypto";

/**
 * Workload attestation.
 *
 * In production the engine runs in GCP Confidential Space (Intel TDX). The
 * container launcher exposes a local socket that mints OIDC attestation
 * tokens signed by Google, with our custom nonces binding the enclave's
 * signing address and encryption key to the measured container image. The
 * token is published alongside the venue and its keccak digest is registered
 * onchain with the signer, so anyone can verify which code holds the keys.
 *
 * Outside Confidential Space the engine runs in dev mode and says so: the
 * digest commits to the same key material but attests nothing.
 */

const LAUNCHER_SOCKET = "/run/container_launcher/teeserver.sock";
const TOKEN_AUDIENCE = "https://stillwater.exchange";

export type AttestationMode = "confidential-space" | "dev";

export interface AttestationInfo {
  mode: AttestationMode;
  /** keccak-free stand-in: sha256 digest of the token (or dev preimage). */
  digest: string;
  token?: string;
}

export async function collectAttestation(
  signerAddress: string,
  encryptionPublicKeyHex: string
): Promise<AttestationInfo> {
  const token = await requestLauncherToken([signerAddress, encryptionPublicKeyHex]);
  if (token !== null) {
    return { mode: "confidential-space", digest: sha256Hex(token), token };
  }
  return {
    mode: "dev",
    digest: sha256Hex(`dev|${signerAddress}|${encryptionPublicKeyHex}`),
  };
}

function requestLauncherToken(nonces: string[]): Promise<string | null> {
  const body = JSON.stringify({ audience: TOKEN_AUDIENCE, nonces });
  return new Promise((resolve) => {
    const req = http.request(
      {
        socketPath: LAUNCHER_SOCKET,
        path: "/v1/token",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeout: 2000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(res.statusCode === 200 ? data : null));
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end(body);
  });
}

function sha256Hex(input: string): string {
  return "0x" + createHash("sha256").update(input).digest("hex");
}
