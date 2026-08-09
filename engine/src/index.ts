import http from "node:http";
import {
  ready,
  generateEnclaveKeypair,
  keypairFromSecret,
  toHex,
  type EnclaveKeypair,
} from "./crypto.js";
import { collectAttestation } from "./attestation.js";
import { PoolClient, Phase } from "./chain.js";
import { settleFromEvents } from "./settle.js";

function listenHealth(): void {
  const port = process.env.PORT;
  if (!port) return;
  http
    .createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      res.writeHead(404).end();
    })
    .listen(Number(port), () => console.log(`health on :${port}`));
}

function isLocalRpc(rpcUrl: string): boolean {
  return /localhost|127\.0\.0\.1/.test(rpcUrl);
}

async function main(): Promise<void> {
  listenHealth();
  await ready();

  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const poolAddress = process.env.POOL_ADDRESS;
  const teeSignerKey = process.env.TEE_SIGNER_KEY;
  if (!poolAddress || !teeSignerKey) {
    console.error("POOL_ADDRESS and TEE_SIGNER_KEY are required");
    process.exit(1);
  }
  if (!isLocalRpc(rpcUrl) && !process.env.ENCLAVE_SECRET_KEY) {
    console.error("ENCLAVE_SECRET_KEY is required off localhost");
    process.exit(1);
  }

  const keypair: EnclaveKeypair = process.env.ENCLAVE_SECRET_KEY
    ? keypairFromSecret(process.env.ENCLAVE_SECRET_KEY)
    : generateEnclaveKeypair();

  const client = new PoolClient(rpcUrl, poolAddress, teeSignerKey);
  const attestation = await collectAttestation(
    await client.signer.getAddress(),
    toHex(keypair.publicKey)
  );
  console.log(`flareblind engine | mode=${attestation.mode}`);
  console.log(`  signer     ${await client.signer.getAddress()}`);
  console.log(`  enc pubkey ${toHex(keypair.publicKey)}`);
  console.log(`  att digest ${attestation.digest}`);

  const registeredKey: string = await client.pool.enclaveEncryptionKey();
  if (registeredKey.toLowerCase() !== toHex(keypair.publicKey).toLowerCase()) {
    console.warn(
      "  warning: onchain enclaveEncryptionKey differs from this key — " +
        "orders sealed to the onchain key will not decrypt here"
    );
  }

  const pollMs = Number(process.env.POLL_MS ?? 5000);

  for (;;) {
    try {
      await withRetry(() => tick(client, keypair));
    } catch (err) {
      console.error("tick failed:", err instanceof Error ? err.message : err);
    }
    await sleep(pollMs);
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await sleep(1000 * (i + 1));
    }
  }
  throw last;
}

async function tick(client: PoolClient, keypair: EnclaveKeypair): Promise<void> {
  const info = await client.batchInfo();

  if (info.phase === Phase.Open) {
    const now = await client.chainNow();
    if (now >= info.endsAt) {
      console.log(`batch ${info.id}: window elapsed (${info.orders} orders), closing`);
      await client.closeBatch();
    }
    return;
  }

  const events = await client.fetchSealedOrders(info.id, info.orders);
  if (events.length < info.orders) {
    console.warn(
      `batch ${info.id}: found ${events.length} of ${info.orders} sealed orders in scan range`
    );
  }
  const balances = await client.venueBalances(events.map((e) => e.trader));
  const referencePrice = await client.referencePrice();
  const maxDeviationBps = await client.maxDeviationBps();

  const { result, accepted, dropped } = settleFromEvents(
    events,
    keypair,
    balances,
    referencePrice,
    maxDeviationBps
  );
  console.log(
    `batch ${info.id}: ${events.length} sealed orders, ${accepted} accepted, ${dropped} dropped`
  );
  const hash = await client.settle(info.id, result);
  if (result.fills.length === 0) {
    console.log(`batch ${info.id}: no cross, rolled over (${hash})`);
  } else {
    console.log(
      `batch ${info.id}: cleared ${result.matchedBase} base at ${result.clearingPrice} ` +
        `across ${result.fills.length} fills (${hash})`
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
