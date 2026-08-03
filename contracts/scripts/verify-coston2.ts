import { ethers, network } from "hardhat";

const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const FTESTXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const FEED_ID = "0x015852502f55534400000000000000000000000000";

async function main(): Promise<void> {
  if (network.name !== "coston2") {
    throw new Error("run with --network coston2");
  }
  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log(`chain id ${chainId}`);

  for (const [label, addr, sym] of [
    ["base", FTESTXRP, "FTestXRP"],
    ["quote", USDT0, "USD₮0"],
  ] as const) {
    const t = await ethers.getContractAt("MockERC20", addr);
    const symbol = await t.symbol();
    const decimals = Number(await t.decimals());
    if (symbol !== sym || decimals !== 6) {
      throw new Error(`${label} ${addr}: ${symbol} ${decimals}dp`);
    }
    console.log(`${sym.padEnd(8)} ${addr}`);
  }

  const registry = await ethers.getContractAt(
    ["function getContractAddressByName(string) view returns (address)"],
    REGISTRY
  );
  const ftsoAddr: string = await registry.getContractAddressByName("FtsoV2");
  console.log(`FtsoV2    ${ftsoAddr}`);

  const ftso = await ethers.getContractAt(
    [
      "function getFeedById(bytes21 feedId) payable returns (uint256 value, int8 decimals, uint64 timestamp)",
    ],
    ftsoAddr
  );
  const [value, dec, ts] = await ftso.getFeedById.staticCall(FEED_ID);
  const human = Number(value) / 10 ** Number(dec);
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  console.log(`XRP/USD   ${human.toFixed(6)} USD (feed age ${age}s)`);
  if (age > 600) console.warn("warning: feed older than default maxOracleAge (600s)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
