import { Contract, JsonRpcProvider, NonceManager, Wallet, parseEther } from "ethers";
import { ready, generateEnclaveKeypair, toHex } from "../src/crypto.js";
import { collectAttestation } from "../src/attestation.js";
import { POOL_ABI } from "../src/chain.js";

const HARDHAT_ACCOUNT_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const OWNER_SETTERS = [
  "function setTeeSigner(address signer, bytes32 attestationDigest)",
  "function setEnclaveEncryptionKey(bytes32 publicKey)",
];

async function main(): Promise<void> {
  await ready();
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const poolAddress = process.env.POOL_ADDRESS;
  if (!poolAddress) throw new Error("POOL_ADDRESS is required");

  const provider = new JsonRpcProvider(rpcUrl);
  const chainId = (await provider.getNetwork()).chainId;
  const ownerKey = process.env.OWNER_KEY ?? HARDHAT_ACCOUNT_0;
  if (chainId !== 31337n && !process.env.OWNER_KEY) {
    throw new Error("OWNER_KEY is required on live networks");
  }
  const owner = new NonceManager(new Wallet(ownerKey, provider));
  const pool = new Contract(poolAddress, [...POOL_ABI, ...OWNER_SETTERS], owner);

  const tee = Wallet.createRandom().connect(provider);
  const keypair = generateEnclaveKeypair();
  const attestation = await collectAttestation(tee.address, toHex(keypair.publicKey));

  if ((await provider.getBalance(tee.address)) === 0n) {
    await (await owner.sendTransaction({ to: tee.address, value: parseEther("1") })).wait();
  }
  await (await pool.setTeeSigner(tee.address, attestation.digest)).wait();
  await (await pool.setEnclaveEncryptionKey(toHex(keypair.publicKey))).wait();

  console.log(`registered on ${poolAddress} (${attestation.mode})`);
  console.log(`  signer     ${tee.address}`);
  console.log(`  enc pubkey ${toHex(keypair.publicKey)}`);
  console.log(`  digest     ${attestation.digest}`);
  console.log(`\nrun the engine with:\n`);
  console.log(`export RPC_URL=${rpcUrl}`);
  console.log(`export POOL_ADDRESS=${poolAddress}`);
  console.log(`export TEE_SIGNER_KEY=${tee.privateKey}`);
  console.log(`export ENCLAVE_SECRET_KEY=${toHex(keypair.privateKey)}`);
  console.log(`npm start`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
