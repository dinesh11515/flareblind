import { ethers, network } from "hardhat";

/**
 * Deploys the venue.
 *
 * Local/dev networks get mock tokens and a mock oracle. Coston2 and Flare
 * expect real addresses via environment:
 *
 *   BASE_TOKEN       FXRP (or FTestXRP on Coston2)
 *   QUOTE_TOKEN      USD stable used as quote
 *   FEED_ID          FTSOv2 feed id, default XRP/USD
 *   TEE_SIGNER       enclave settlement address (rotatable later)
 *   ENCLAVE_PUBKEY   enclave x25519 key, 0x + 64 hex
 */
const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const XRP_USD_FEED_ID = "0x015852502f55534400000000000000000000000000";

const BATCH_DURATION = 300; // 5 minute batches
const MAX_DEVIATION_BPS = 200;
const MAX_ORACLE_AGE = 600;

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const live = network.name === "coston2" || network.name === "flare";
  console.log(`network ${network.name}, deployer ${deployer.address}`);

  let baseAddress: string;
  let quoteAddress: string;
  let oracleAddress: string;

  if (live) {
    baseAddress = required("BASE_TOKEN");
    quoteAddress = required("QUOTE_TOKEN");
    const adapter = await ethers.deployContract("FtsoV2Adapter", [
      FLARE_CONTRACT_REGISTRY,
      process.env.FEED_ID ?? XRP_USD_FEED_ID,
      await decimalsOf(baseAddress),
      await decimalsOf(quoteAddress),
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

  const pool = await ethers.deployContract("StillwaterPool", [
    baseAddress,
    quoteAddress,
    oracleAddress,
    BATCH_DURATION,
    MAX_DEVIATION_BPS,
    MAX_ORACLE_AGE,
    deployer.address,
  ]);
  await pool.waitForDeployment();
  console.log(`StillwaterPool  ${await pool.getAddress()}`);

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
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required on ${network.name}`);
  return value;
}

async function decimalsOf(token: string): Promise<number> {
  const erc20 = await ethers.getContractAt("MockERC20", token);
  return Number(await erc20.decimals());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
