import { ethers, network } from "hardhat";

const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const XRP_USD_FEED_ID = "0x015852502f55534400000000000000000000000000";

const COSTON2_BASE = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const COSTON2_QUOTE = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";

const BATCH_DURATION = 300;
const MAX_DEVIATION_BPS = 200;
const MAX_ORACLE_AGE = 600;

const EXPLORER: Record<string, string> = {
  coston2: "https://coston2-explorer.flare.network",
  flare: "https://flare-explorer.flare.network",
};

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const live = network.name === "coston2" || network.name === "flare";
  console.log(`network ${network.name}, deployer ${deployer.address}`);

  if (live) {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const expected = network.name === "coston2" ? 114n : 14n;
    if (chainId !== expected) {
      throw new Error(`chain id ${chainId} != ${expected} for ${network.name}`);
    }
  }

  let baseAddress: string;
  let quoteAddress: string;
  let oracleAddress: string;

  if (live) {
    baseAddress = tokenAddress("BASE_TOKEN", network.name === "coston2" ? COSTON2_BASE : undefined);
    quoteAddress = tokenAddress("QUOTE_TOKEN", network.name === "coston2" ? COSTON2_QUOTE : undefined);
    const baseDecimals = await decimalsOf(baseAddress);
    const quoteDecimals = await decimalsOf(quoteAddress);
    await assertToken(baseAddress, network.name === "coston2" ? "FTestXRP" : undefined, 6, baseDecimals);
    await assertToken(quoteAddress, network.name === "coston2" ? "USD₮0" : undefined, 6, quoteDecimals);

    const adapter = await ethers.deployContract("FtsoV2Adapter", [
      FLARE_CONTRACT_REGISTRY,
      process.env.FEED_ID ?? XRP_USD_FEED_ID,
      baseDecimals,
      quoteDecimals,
    ]);
    await adapter.waitForDeployment();
    oracleAddress = await adapter.getAddress();
    console.log(`FtsoV2Adapter   ${oracleAddress}`);
  } else {
    const base = await ethers.deployContract("MockERC20", ["Test FXRP", "FXRP", 6]);
    const quote = await ethers.deployContract("MockERC20", ["Test USD", "USDX", 6]);
    const oracle = await ethers.deployContract("MockOracle");
    await Promise.all([
      base.waitForDeployment(),
      quote.waitForDeployment(),
      oracle.waitForDeployment(),
    ]);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await oracle.set(ethers.parseUnits("2.10", 18), now)).wait();
    baseAddress = await base.getAddress();
    quoteAddress = await quote.getAddress();
    oracleAddress = await oracle.getAddress();
    console.log(`MockERC20 FXRP  ${baseAddress}`);
    console.log(`MockERC20 USDX  ${quoteAddress}`);
    console.log(`MockOracle      ${oracleAddress}`);
  }

  const pool = await ethers.deployContract("FlareblindPool", [
    baseAddress,
    quoteAddress,
    oracleAddress,
    BATCH_DURATION,
    MAX_DEVIATION_BPS,
    MAX_ORACLE_AGE,
    deployer.address,
  ]);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log(`FlareblindPool  ${poolAddress}`);

  if (process.env.TEE_SIGNER) {
    await (
      await pool.setTeeSigner(
        process.env.TEE_SIGNER,
        process.env.ATTESTATION_DIGEST ?? ethers.ZeroHash
      )
    ).wait();
    console.log(`teeSigner       ${process.env.TEE_SIGNER}`);
  }
  if (process.env.ENCLAVE_PUBKEY) {
    await (await pool.setEnclaveEncryptionKey(process.env.ENCLAVE_PUBKEY)).wait();
    console.log(`enclave pubkey  ${process.env.ENCLAVE_PUBKEY}`);
  }

  const explorer = EXPLORER[network.name];
  if (explorer) {
    console.log(`\nexplorer        ${explorer}/address/${poolAddress}`);
    console.log(`\nnext steps:`);
    console.log(`  cd ../engine && POOL_ADDRESS=${poolAddress} OWNER_KEY=<deployer> npx tsx scripts/register.ts`);
    console.log(`  cd ../web && echo "VITE_POOL_ADDRESS=${poolAddress}" >> .env`);
  }
}

function tokenAddress(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required on ${network.name}`);
  return value;
}

async function assertToken(
  address: string,
  expectedSymbol: string | undefined,
  expectedDecimals: number,
  actualDecimals: number
): Promise<void> {
  const erc20 = await ethers.getContractAt("MockERC20", address);
  const symbol = await erc20.symbol();
  if (expectedSymbol && symbol !== expectedSymbol) {
    throw new Error(`${address} symbol ${symbol} != ${expectedSymbol}`);
  }
  if (actualDecimals !== expectedDecimals) {
    throw new Error(`${address} decimals ${actualDecimals} != ${expectedDecimals}`);
  }
  console.log(`token ${symbol.padEnd(8)} ${address} (${actualDecimals} dp)`);
}

async function decimalsOf(token: string): Promise<number> {
  const erc20 = await ethers.getContractAt("MockERC20", token);
  return Number(await erc20.decimals());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
