import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  parseUnits,
  formatUnits,
} from "ethers";
import { ready, generateEnclaveKeypair, sealOrder, toHex } from "../src/crypto.js";
import { collectAttestation } from "../src/attestation.js";
import { PoolClient } from "../src/chain.js";
import { settleFromEvents } from "../src/settle.js";

/**
 * Full venue walkthrough against a local hardhat node:
 * deploy, register enclave keys, seal and submit orders from three traders,
 * close the batch, run the engine's settlement pipeline, and verify balances.
 *
 *   cd contracts && npx hardhat node          (terminal 1)
 *   cd engine && npm run demo                 (terminal 2)
 */

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const DECIMALS = 6;
const PRICE = (p: string) => parseUnits(p, 18);
const XRP = (a: string) => parseUnits(a, DECIMALS);
const USD = (a: string) => parseUnits(a, DECIMALS);

const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = (rel: string) => {
  const file = path.join(here, "../../contracts/artifacts/contracts", rel);
  return JSON.parse(readFileSync(file, "utf-8"));
};

async function main(): Promise<void> {
  await ready();
  const provider = new JsonRpcProvider(RPC);
  const owner = await provider.getSigner(0);
  const [alice, bob, carol] = await Promise.all(
    [2, 3, 4].map((i) => provider.getSigner(i))
  );

  // The TEE signer is a fresh key so the demo does not lean on well-known
  // node accounts; in production it is generated inside the enclave.
  const tee = Wallet.createRandom().connect(provider);
  await (await owner.sendTransaction({ to: tee.address, value: 10n ** 18n })).wait();

  step("deploy venue");
  const deploy = async (rel: string, args: unknown[]) => {
    const a = artifact(rel);
    const factory = new ContractFactory(a.abi, a.bytecode, owner);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract as Contract;
  };
  const base = await deploy("mocks/MockERC20.sol/MockERC20.json", ["Test FXRP", "FXRP", DECIMALS]);
  const quote = await deploy("mocks/MockERC20.sol/MockERC20.json", ["Test USD", "USDX", DECIMALS]);
  const oracle = await deploy("mocks/MockOracle.sol/MockOracle.json", []);
  const now = (await provider.getBlock("latest"))!.timestamp;
  await (await oracle.set(PRICE("2.10"), now)).wait();
  const pool = await deploy("StillwaterPool.sol/StillwaterPool.json", [
    await base.getAddress(),
    await quote.getAddress(),
    await oracle.getAddress(),
    120, // batch window, seconds
    200, // max clearing deviation from FTSO, bps
    600, // max oracle age, seconds
    await owner.getAddress(),
  ]);
  console.log(`  pool   ${await pool.getAddress()}`);
  console.log(`  FTSO reference price 2.10 USDX/FXRP, band ±2%`);

  step("generate enclave keys and register with attestation digest");
  const keypair = generateEnclaveKeypair();
  const attestation = await collectAttestation(tee.address, toHex(keypair.publicKey));
  await (await pool.setTeeSigner(tee.address, attestation.digest)).wait();
  await (await pool.setEnclaveEncryptionKey(toHex(keypair.publicKey))).wait();
  console.log(`  mode   ${attestation.mode}`);
  console.log(`  signer ${tee.address}`);
  console.log(`  digest ${attestation.digest}`);

  step("traders fund venue balances");
  const fund = async (
    signer: typeof alice,
    name: string,
    baseAmt: bigint,
    quoteAmt: bigint
  ) => {
    const addr = await signer.getAddress();
    if (baseAmt > 0n) {
      await (await base.mint(addr, baseAmt)).wait();
      await (await (base.connect(signer) as Contract).approve(pool, baseAmt)).wait();
      await (await (pool.connect(signer) as Contract).deposit(true, baseAmt)).wait();
    }
    if (quoteAmt > 0n) {
      await (await quote.mint(addr, quoteAmt)).wait();
      await (await (quote.connect(signer) as Contract).approve(pool, quoteAmt)).wait();
      await (await (pool.connect(signer) as Contract).deposit(false, quoteAmt)).wait();
    }
    console.log(
      `  ${name.padEnd(6)} ${formatUnits(baseAmt, DECIMALS).padStart(8)} FXRP | ` +
        `${formatUnits(quoteAmt, DECIMALS).padStart(9)} USDX`
    );
  };
  await fund(alice, "alice", 0n, USD("3000"));
  await fund(bob, "bob", XRP("800"), 0n);
  await fund(carol, "carol", XRP("700"), 0n);

  step("traders seal orders to the enclave key and submit");
  const submit = async (
    signer: typeof alice,
    name: string,
    side: "buy" | "sell",
    amount: bigint,
    limit: bigint
  ) => {
    const sealed = sealOrder(
      {
        trader: (await signer.getAddress()).toLowerCase(),
        batchId: 1,
        side,
        amountBase: amount.toString(),
        limitPrice: limit.toString(),
      },
      keypair.publicKey
    );
    await (await (pool.connect(signer) as Contract).submitOrder(toHex(sealed))).wait();
    console.log(
      `  ${name.padEnd(6)} ${side.padEnd(4)} ${formatUnits(amount, DECIMALS).padStart(7)} ` +
        `@ ${formatUnits(limit, 18)}  -> ${sealed.length}-byte ciphertext onchain`
    );
  };
  await submit(alice, "alice", "buy", XRP("1200"), PRICE("2.12"));
  await submit(bob, "bob", "sell", XRP("800"), PRICE("2.05"));
  await submit(carol, "carol", "sell", XRP("700"), PRICE("2.11"));

  step("batch window elapses; anyone closes the batch");
  await provider.send("evm_increaseTime", [121]);
  await provider.send("evm_mine", []);
  await (await pool.closeBatch()).wait();
  console.log("  batch 1 sealed; balances frozen for settlement");

  step("engine decrypts, clears, and settles");
  const client = new PoolClient(RPC, await pool.getAddress(), tee.privateKey);
  const events = await client.fetchSealedOrders(1);
  const balances = await client.venueBalances(events.map((e) => e.trader));
  const referencePrice = await client.referencePrice();
  const { result, accepted, dropped } = settleFromEvents(
    events,
    keypair,
    balances,
    referencePrice,
    await client.maxDeviationBps()
  );
  console.log(`  ${events.length} sealed orders, ${accepted} accepted, ${dropped} dropped`);
  const hash = await client.settle(1, result);
  console.log(
    `  cleared ${formatUnits(result.matchedBase, DECIMALS)} FXRP at ` +
      `${formatUnits(result.clearingPrice, 18)} USDX (tx ${hash.slice(0, 10)}…)`
  );

  step("venue balances after settlement");
  const show = async (signer: typeof alice, name: string) => {
    const addr = await signer.getAddress();
    const b: bigint = await pool.baseBalanceOf(addr);
    const q: bigint = await pool.quoteBalanceOf(addr);
    console.log(
      `  ${name.padEnd(6)} ${formatUnits(b, DECIMALS).padStart(8)} FXRP | ` +
        `${formatUnits(q, DECIMALS).padStart(9)} USDX`
    );
  };
  await show(alice, "alice");
  await show(bob, "bob");
  await show(carol, "carol");
  console.log(`  dust   ${formatUnits(await pool.quoteDust(), DECIMALS)} USDX`);

  step("verify");
  assertEq(result.clearingPrice, PRICE("2.11"), "clearing price 2.11");
  assertEq(await pool.baseBalanceOf(await alice.getAddress()), XRP("1200"), "alice bought 1200");
  assertEq(await pool.baseBalanceOf(await bob.getAddress()), XRP("160"), "bob pro-rated to 640");
  assertEq(await pool.baseBalanceOf(await carol.getAddress()), XRP("140"), "carol pro-rated to 560");
  console.log("\n  all checks passed — sealed intake to onchain settlement, end to end\n");
}

function step(title: string): void {
  console.log(`\n== ${title}`);
}

function assertEq(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) {
    throw new Error(`check failed: ${label} (expected ${expected}, got ${actual})`);
  }
  console.log(`  ok: ${label}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
