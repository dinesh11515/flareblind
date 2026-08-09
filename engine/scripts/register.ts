import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, NonceManager, Wallet, parseEther } from "ethers";
import { ready, generateEnclaveKeypair, toHex } from "../src/crypto.js";
import { collectAttestation } from "../src/attestation.js";
import { POOL_ABI } from "../src/chain.js";

const HARDHAT_ACCOUNT_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const OWNER_SETTERS = [
  "function owner() view returns (address)",
  "function setTeeSigner(address signer, bytes32 attestationDigest)",
  "function setEnclaveEncryptionKey(bytes32 publicKey)",
];

const Phase = { Open: 0, Sealing: 1 } as const;

function ownerKey(): string {
  const key = process.env.OWNER_KEY ?? process.env.DEPLOYER_KEY ?? HARDHAT_ACCOUNT_0;
  return key;
}

function deploymentsPath(): string | null {
  const candidate = join(dirname(fileURLToPath(import.meta.url)), "../../deployments/coston2.json");
  try {
    readFileSync(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function updateDeployments(
  path: string,
  signer: string,
  encryptionKey: string,
  digest: string,
  mode: string
): void {
  const doc = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  doc.enclave = {
    signer,
    encryptionKey,
    attestationDigest: digest,
    mode,
    rotatedAt: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
}

async function main(): Promise<void> {
  await ready();
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const poolAddress = process.env.POOL_ADDRESS;
  if (!poolAddress) throw new Error("POOL_ADDRESS is required");

  const provider = new JsonRpcProvider(rpcUrl);
  const chainId = (await provider.getNetwork()).chainId;
  const key = ownerKey();
  if (chainId !== 31337n && !process.env.OWNER_KEY && !process.env.DEPLOYER_KEY) {
    throw new Error("OWNER_KEY or DEPLOYER_KEY is required on live networks");
  }

  const owner = new NonceManager(new Wallet(key, provider));
  const pool = new Contract(poolAddress, [...POOL_ABI, ...OWNER_SETTERS], owner);

  const poolOwner: string = await pool.owner();
  const ownerAddress = await owner.getAddress();
  if (poolOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error(`wallet ${ownerAddress} is not pool owner (${poolOwner})`);
  }

  const [batchId, phase, , orders] = await pool.batchInfo();
  const id = Number(batchId);
  const count = Number(orders);
  if (phase === Phase.Sealing && count > 0) {
    console.warn(
      `batch ${id} is Sealing with ${count} order(s) — old ciphertext cannot be decrypted after rotation;` +
        " the new engine should settle with empty fills to reopen the venue"
    );
  } else if (phase === Phase.Open && count > 0) {
    console.warn(
      `batch ${id} is Open with ${count} order(s) sealed to the current onchain key —` +
        " wait for this batch to clear before traders submit new orders"
    );
  }

  const tee = Wallet.createRandom().connect(provider);
  const keypair = generateEnclaveKeypair();
  const attestation = await collectAttestation(tee.address, toHex(keypair.publicKey));

  if ((await provider.getBalance(tee.address)) === 0n) {
    await (await owner.sendTransaction({ to: tee.address, value: parseEther("1") })).wait();
  }
  await (await pool.setTeeSigner(tee.address, attestation.digest)).wait();
  await (await pool.setEnclaveEncryptionKey(toHex(keypair.publicKey))).wait();

  const encPub = toHex(keypair.publicKey);
  const deployments = deploymentsPath();
  if (deployments) {
    updateDeployments(deployments, tee.address, encPub, attestation.digest, attestation.mode);
    console.log(`updated ${deployments}`);
  }

  console.log(`registered on ${poolAddress} (${attestation.mode})`);
  console.log(`  signer     ${tee.address}`);
  console.log(`  enc pubkey ${encPub}`);
  console.log(`  digest     ${attestation.digest}`);
  console.log(`\nengine / Railway variables:\n`);
  console.log(`RPC_URL=${rpcUrl}`);
  console.log(`POOL_ADDRESS=${poolAddress}`);
  console.log(`POOL_FROM_BLOCK=33567293`);
  console.log(`TEE_SIGNER_KEY=${tee.privateKey}`);
  console.log(`ENCLAVE_SECRET_KEY=${toHex(keypair.privateKey)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
