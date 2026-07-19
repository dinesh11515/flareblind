import { BrowserProvider, Contract, JsonRpcSigner } from "ethers";

export const POOL_ABI = [
  "function base() view returns (address)",
  "function quote() view returns (address)",
  "function batchInfo() view returns (uint64 id, uint8 phase, uint256 endsAt, uint32 orders)",
  "function baseBalanceOf(address) view returns (uint256)",
  "function quoteBalanceOf(address) view returns (uint256)",
  "function enclaveEncryptionKey() view returns (bytes32)",
  "function teeSigner() view returns (address)",
  "function teeAttestationDigest() view returns (bytes32)",
  "function maxDeviationBps() view returns (uint256)",
  "function oracle() view returns (address)",
  "function deposit(bool isBase, uint256 amount)",
  "function withdraw(bool isBase, uint256 amount)",
  "function submitOrder(bytes sealedOrder)",
  "function closeBatch()",
  "event BatchSettled(uint64 indexed batchId, uint256 clearingPrice, uint256 matchedBase, uint32 fillCount)",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function mint(address to, uint256 amount)",
];

export const ORACLE_ABI = [
  "function latestPrice() returns (uint256 price, uint256 timestamp)",
];

export const Phase = { Open: 0, Sealing: 1 } as const;

export interface Wallet {
  provider: BrowserProvider;
  signer: JsonRpcSigner;
  address: string;
  chainId: bigint;
}

export interface VenueHandles {
  pool: Contract;
  base: Contract;
  quote: Contract;
  baseSymbol: string;
  quoteSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
}

export async function connectWallet(): Promise<Wallet> {
  const ethereum = (window as { ethereum?: unknown }).ethereum;
  if (!ethereum) throw new Error("No wallet extension found");
  const provider = new BrowserProvider(ethereum as never);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();
  return { provider, signer, address: signer.address, chainId: network.chainId };
}

export async function loadVenue(wallet: Wallet, poolAddress: string): Promise<VenueHandles> {
  const pool = new Contract(poolAddress, POOL_ABI, wallet.signer);
  const [baseAddr, quoteAddr] = await Promise.all([pool.base(), pool.quote()]);
  const base = new Contract(baseAddr, ERC20_ABI, wallet.signer);
  const quote = new Contract(quoteAddr, ERC20_ABI, wallet.signer);
  const [baseSymbol, quoteSymbol, baseDecimals, quoteDecimals] = await Promise.all([
    base.symbol(),
    quote.symbol(),
    base.decimals(),
    quote.decimals(),
  ]);
  return {
    pool,
    base,
    quote,
    baseSymbol,
    quoteSymbol,
    baseDecimals: Number(baseDecimals),
    quoteDecimals: Number(quoteDecimals),
  };
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function shortHex(hex: string, chars = 10): string {
  return hex.length <= 2 + chars * 2
    ? hex
    : `${hex.slice(0, 2 + chars)}…${hex.slice(-chars)}`;
}
