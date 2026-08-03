import http from "node:http";
import { createHash } from "node:crypto";

const LAUNCHER_SOCKET = "/run/container_launcher/teeserver.sock";
const TOKEN_AUDIENCE = "https://flareblind.exchange";

export type AttestationMode = "confidential-space" | "dev";

export interface AttestationInfo {
  mode: AttestationMode;

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
