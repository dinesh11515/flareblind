import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, NonceManager, Wallet, formatUnits, parseUnits } from "ethers";
import { ready, sealOrder, toHex, fromHex } from "../src/crypto.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../contracts/.env") });

const RPC = process.env.RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
const POOL = process.env.POOL_ADDRESS ?? "0xCFb131E94B6485C851C8F06c3a7DaD922Ca51B6C";
const DECIMALS = 6;

const POOL_ABI = [
  "function batchInfo() view returns (uint64 id, uint8 phase, uint256 endsAt, uint32 orders)",
  "function enclaveEncryptionKey() view returns (bytes32)",
  "function deposit(bool isBase, uint256 amount)",
  "function submitOrder(bytes sealedOrder)",
  "function closeBatch()",
  "function withdraw(bool isBase, uint256 amount)",
  "function baseBalanceOf(address) view returns (uint256)",
  "function quoteBalanceOf(address) view returns (uint256)",
  "function base() view returns (address)",
  "function quote() view returns (address)",
  "function oracle() view returns (address)",
  "event BatchSettled(uint64 indexed batchId, uint256 clearingPrice, uint256 matchedBase, uint32 fillCount)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
];

const ORACLE_ABI = ["function latestPrice() returns (uint256 price, uint256 timestamp)"];

async function main(): Promise<void> {
  const deployerKey = process.env.DEPLOYER_KEY;
  if (!deployerKey) throw new Error("DEPLOYER_KEY missing in contracts/.env");

  await ready();
  const provider = new JsonRpcProvider(RPC);
  const sellerKey = process.env.SELLER_KEY;
  const buyer = new NonceManager(new Wallet(deployerKey, provider));
  const seller = sellerKey
    ? new Wallet(sellerKey, provider)
    : Wallet.createRandom().connect(provider);
  const buyerAddr = await buyer.getAddress();
  const sellerAddr = seller.address;

  console.log(`pool   ${POOL}`);
  console.log(`buyer  ${buyerAddr}`);
  console.log(`seller ${sellerAddr}`);
  if (!sellerKey) {
    console.log("generated seller wallet — fund via FTestXRP transfer from deployer");
  }

  const pool = new Contract(POOL, POOL_ABI, provider);
  const baseAddr: string = await pool.base();
  const quoteAddr: string = await pool.quote();
  const base = new Contract(baseAddr, ERC20_ABI, provider);
  const quote = new Contract(quoteAddr, ERC20_ABI, provider);
  console.log(`pair   ${await base.symbol()}/${await quote.symbol()}`);

  const oracle = new Contract(await pool.oracle(), ORACLE_ABI, provider);
  const [refPrice] = await oracle.latestPrice.staticCallResult();
  console.log(`ftso   ${formatUnits(refPrice, 18)} quote/base`);

  await fundGas(buyer, sellerAddr, parseUnits("0.5", 18));
  await ensureTokens(buyer, seller, base, quote);

  const sellAmt = parseUnits("2", DECIMALS);
  const buyAmt = parseUnits("2", DECIMALS);
  const sellLimit = (refPrice * 95n) / 100n;
  const buyLimit = (refPrice * 105n) / 100n;

  await deposit(buyer, pool, base, quote, 0n, parseUnits("6", DECIMALS));
  await deposit(seller, pool, base, quote, sellAmt, 0n);

  const [batchId] = await pool.batchInfo();
  const encKey: string = await pool.enclaveEncryptionKey();
  console.log(`batch  #${batchId}`);

  await submit(buyer, pool, fromHex(encKey), batchId, "buy", buyAmt, buyLimit);
  await submit(seller, pool, fromHex(encKey), batchId, "sell", sellAmt, sellLimit);
  console.log("orders submitted (sealed)");

  await waitUntilClosable(pool);
  const phase = Number((await pool.batchInfo())[1]);
  if (phase === 0) {
    await (await pool.connect(buyer).closeBatch()).wait();
    console.log("batch closed — waiting for engine settlement…");
  } else {
    console.log("batch already closed by engine — waiting for settlement…");
  }

  await waitForSettlement(pool, Number(batchId), 120_000);
  const [bBase, bQuote] = await Promise.all([
    pool.baseBalanceOf(buyerAddr),
    pool.quoteBalanceOf(buyerAddr),
  ]);
  const [sBase, sQuote] = await Promise.all([
    pool.baseBalanceOf(sellerAddr),
    pool.quoteBalanceOf(sellerAddr),
  ]);
  console.log(`buyer  venue ${formatUnits(bBase, DECIMALS)} base | ${formatUnits(bQuote, DECIMALS)} quote`);
  console.log(`seller venue ${formatUnits(sBase, DECIMALS)} base | ${formatUnits(sQuote, DECIMALS)} quote`);
  if (bBase < buyAmt) throw new Error("buyer did not receive base — settlement may have failed");
  console.log("\nsmoke test passed\n");
}

async function fundGas(from: NonceManager, to: string, amount: bigint): Promise<void> {
  const tx = await from.sendTransaction({ to, value: amount });
  await tx.wait();
}

async function ensureTokens(
  buyer: NonceManager,
  seller: Wallet,
  base: Contract,
  quote: Contract
): Promise<void> {
  const sellNeed = parseUnits("2", DECIMALS);
  const buyNeed = parseUnits("6", DECIMALS);
  const buyerAddr = await buyer.getAddress();
  const [bQuote, sWallet] = await Promise.all([
    quote.balanceOf(buyerAddr),
    base.balanceOf(seller.address),
  ]);
  if (bQuote < buyNeed) {
    throw new Error(
      `Buyer needs ${formatUnits(buyNeed, DECIMALS)} USDT0 from https://faucet.flare.network/`
    );
  }
  if (sWallet < sellNeed) {
    await (await base.connect(buyer).transfer(seller.address, sellNeed)).wait();
  }
}

async function deposit(
  signer: NonceManager | Wallet,
  pool: Contract,
  base: Contract,
  quote: Contract,
  baseAmt: bigint,
  quoteAmt: bigint
): Promise<void> {
  const addr = await signer.getAddress();
  const p = pool.connect(signer);
  if (baseAmt > 0n) {
    const allowance: bigint = await base.allowance(addr, POOL);
    if (allowance < baseAmt) await (await base.connect(signer).approve(POOL, baseAmt)).wait();
    await (await p.deposit(true, baseAmt)).wait();
  }
  if (quoteAmt > 0n) {
    const allowance: bigint = await quote.allowance(addr, POOL);
    if (allowance < quoteAmt) await (await quote.connect(signer).approve(POOL, quoteAmt)).wait();
    await (await p.deposit(false, quoteAmt)).wait();
  }
}

async function submit(
  signer: NonceManager | Wallet,
  pool: Contract,
  encKey: Uint8Array,
  batchId: bigint,
  side: "buy" | "sell",
  amount: bigint,
  limit: bigint
): Promise<void> {
  const trader = (await signer.getAddress()).toLowerCase();
  const sealed = sealOrder(
    {
      trader,
      batchId: Number(batchId),
      side,
      amountBase: amount.toString(),
      limitPrice: limit.toString(),
    },
    encKey
  );
  await (await pool.connect(signer).submitOrder(toHex(sealed))).wait();
}

async function waitUntilClosable(pool: Contract): Promise<void> {
  for (;;) {
    const [, , endsAt] = await pool.batchInfo();
    const block = await pool.runner!.provider!.getBlock("latest");
    const now = BigInt(block!.timestamp);
    const remaining = Number(endsAt - now);
    if (remaining <= 0) return;
    console.log(`  batch closes in ${remaining}s…`);
    await sleep(Math.min(remaining, 15) * 1000);
  }
}

async function waitForSettlement(pool: Contract, batchId: number, timeoutMs: number): Promise<void> {
  const fromBlock = process.env.POOL_FROM_BLOCK ? Number(process.env.POOL_FROM_BLOCK) : undefined;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const logs = await querySettled(pool, batchId, fromBlock);
    if (logs.length > 0) {
      const args = (logs[0] as { args: [bigint, bigint, bigint, bigint] }).args;
      console.log(
        `settled batch #${batchId}: ${formatUnits(args[2], DECIMALS)} base @ ${formatUnits(args[1], 18)}`
      );
      return;
    }
    await sleep(5000);
  }
  throw new Error("settlement timed out — is the engine running?");
}

async function querySettled(pool: Contract, batchId: number, fromBlock?: number) {
  const provider = pool.runner!.provider!;
  const latest = await provider.getBlockNumber();
  const start = fromBlock ?? Math.max(0, latest - 500);
  const filter = pool.filters.BatchSettled(batchId);
  const logs = [];
  for (let block = start; block <= latest; block += 30) {
    const end = Math.min(block + 29, latest);
    logs.push(...(await pool.queryFilter(filter, block, end)));
  }
  return logs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
