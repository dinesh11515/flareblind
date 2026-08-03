import { PoolClient } from "../src/chain.js";

async function main(): Promise<void> {
  const client = new PoolClient(
    process.env.RPC_URL!,
    process.env.POOL_ADDRESS!,
    process.env.TEE_SIGNER_KEY!
  );
  const info = await client.batchInfo();
  console.log("batch", info);
  const events = await client.fetchSealedOrders(info.id);
  console.log("sealed orders", events.length, events);
  const ref = await client.referencePrice();
  console.log("ref price", ref.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
