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

/**
 * Engine daemon. Watches the venue, closes batches whose window has elapsed,
 * and settles Sealing batches. Configuration via environment:
 *
 *   RPC_URL            chain endpoint (default local hardhat node)
 *   POOL_ADDRESS       StillwaterPool address (required)
 *   TEE_SIGNER_KEY     settlement key; in Confidential Space this is
 *                      generated inside the enclave instead
 *   ENCLAVE_SECRET_KEY optional fixed x25519 secret (hex) for dev restarts
 *   POLL_MS            loop interval, default 5000
 */
async function main(): Promise<void> {
  await ready();

  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const poolAddress = process.env.POOL_ADDRESS;
  const teeSignerKey = process.env.TEE_SIGNER_KEY;
  if (!poolAddress || !teeSignerKey) {
    console.error("POOL_ADDRESS and TEE_SIGNER_KEY are required");
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
  console.log(`stillwater engine | mode=${attestation.mode}`);
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
  const maxDeviationBps = await client.maxDeviationBps();

  for (;;) {
    try {
      await tick(client, keypair, maxDeviationBps);
    } catch (err) {
      console.error("tick failed:", err instanceof Error ? err.message : err);
    }
    await sleep(pollMs);
  }
}

async function tick(
  client: PoolClient,
  keypair: EnclaveKeypair,
  maxDeviationBps: bigint
): Promise<void> {
  const info = await client.batchInfo();

  if (info.phase === Phase.Open) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= info.endsAt) {
      console.log(`batch ${info.id}: window elapsed (${info.orders} orders), closing`);
      await client.closeBatch();
    }
    return;
  }

  // Sealing: compute and submit the settlement.
  const events = await client.fetchSealedOrders(info.id);
  const balances = await client.venueBalances(events.map((e) => e.trader));
  const referencePrice = await client.referencePrice();

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
