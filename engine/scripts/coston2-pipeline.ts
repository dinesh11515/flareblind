import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, NonceManager, Wallet, formatUnits, parseUnits } from "ethers";
import { ready, sealOrder, toHex, fromHex } from "../src/crypto.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../contracts/.env") });

const RPC = process.env.RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
const POOL = process.env.POOL_ADDRESS ?? "0x69369e567BC87e463d2acc90abf9cA0E15cB8795";

async function main(): Promise<void> {
  const key = process.env.DEPLOYER_KEY;
  if (!key) throw new Error("DEPLOYER_KEY missing");

  await ready();
  const provider = new JsonRpcProvider(RPC);
  const trader = new NonceManager(new Wallet(key, provider));
  const addr = await trader.getAddress();

  const pool = new Contract(
    POOL,
    [
      "function batchInfo() view returns (uint64 id, uint8 phase, uint256 endsAt, uint32 orders)",
      "function enclaveEncryptionKey() view returns (bytes32)",
      "function deposit(bool isBase, uint256 amount)",
      "function submitOrder(bytes sealedOrder)",
      "function closeBatch()",
      "function base() view returns (address)",
      "function baseBalanceOf(address) view returns (uint256)",
      "event BatchSettled(uint64 indexed batchId, uint256 clearingPrice, uint256 matchedBase, uint32 fillCount)",
    ],
    provider
  );

  const baseAddr: string = await pool.base();
  const base = new Contract(
    baseAddr,
    [
      "function balanceOf(address) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function symbol() view returns (string)",
    ],
    provider
  );

  const walletBal: bigint = await base.balanceOf(addr);
  console.log(`${await base.symbol()} wallet balance: ${formatUnits(walletBal, 6)}`);
  if (walletBal < parseUnits("1", 6)) {
    throw new Error("Need FTestXRP in wallet — request from faucet");
  }

  const depositAmt = parseUnits("2", 6);
  const allowance: bigint = await base.allowance(addr, POOL);
  if (allowance < depositAmt) await (await base.connect(trader).approve(POOL, depositAmt)).wait();
  await (await pool.connect(trader).deposit(true, depositAmt)).wait();
  console.log(`deposited ${formatUnits(depositAmt, 6)} base to venue`);

  const [batchId, , endsAt] = await pool.batchInfo();
  const encKey: string = await pool.enclaveEncryptionKey();
  const sellAmt = parseUnits("1", 6);
  const limit = parseUnits("0.50", 18);
  const sealed = sealOrder(
    {
      trader: addr.toLowerCase(),
      batchId: Number(batchId),
      side: "sell",
      amountBase: sellAmt.toString(),
      limitPrice: limit.toString(),
    },
    fromHex(encKey)
  );
  await (await pool.connect(trader).submitOrder(toHex(sealed))).wait();
  console.log(`submitted sealed sell on batch #${batchId}`);

  for (;;) {
    const block = await provider.getBlock("latest");
    const remaining = Number(endsAt - BigInt(block!.timestamp));
    if (remaining <= 0) break;
    console.log(`  waiting ${remaining}s for batch window…`);
    await sleep(Math.min(remaining, 15) * 1000);
  }

  await (await pool.connect(trader).closeBatch()).wait();
  console.log("batch closed — waiting for engine…");

  const id = Number(batchId);
  for (let i = 0; i < 36; i++) {
    const logs = await pool.queryFilter(pool.filters.BatchSettled(id), 0, "latest");
    if (logs.length > 0) {
      console.log(`batch #${id} settled onchain (no-cross rollover ok)`);
      const venueBal: bigint = await pool.baseBalanceOf(addr);
      console.log(`venue base balance: ${formatUnits(venueBal, 6)}`);
      console.log("\npipeline test passed\n");
      return;
    }
    await sleep(5000);
  }
  throw new Error("settlement timed out — is the engine running?");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
