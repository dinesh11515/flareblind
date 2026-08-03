import {
  type Address,
  type PublicClient,
  decodeEventLog,
  parseAbiItem,
} from "viem";

export const HISTORY_BLOCKS = 900;

const LOG_CHUNK = 30;
const LOG_CONCURRENCY = 8;

export const batchSettledEvent = parseAbiItem(
  "event BatchSettled(uint64 indexed batchId, uint256 clearingPrice, uint256 matchedBase, uint32 fillCount)",
);

export interface BatchSettledArgs {
  batchId: bigint;
  clearingPrice: bigint;
  matchedBase: bigint;
  fillCount: number;
}

export async function queryBatchSettled(
  client: PublicClient,
  params: {
    address: Address;
    fromBlock?: bigint;
  },
): Promise<BatchSettledArgs[]> {
  const latest = await client.getBlockNumber();
  const floor = latest > BigInt(HISTORY_BLOCKS) ? latest - BigInt(HISTORY_BLOCKS) : 0n;
  const start =
    params.fromBlock !== undefined && params.fromBlock > floor
      ? params.fromBlock
      : floor;

  const ranges: [bigint, bigint][] = [];
  for (let block = start; block <= latest; block += BigInt(LOG_CHUNK)) {
    const to =
      block + BigInt(LOG_CHUNK) - 1n > latest
        ? latest
        : block + BigInt(LOG_CHUNK) - 1n;
    ranges.push([block, to]);
  }

  const out: BatchSettledArgs[] = [];
  for (let i = 0; i < ranges.length; i += LOG_CONCURRENCY) {
    const wave = await Promise.all(
      ranges.slice(i, i + LOG_CONCURRENCY).map(([fromBlock, toBlock]) =>
        client.getLogs({
          address: params.address,
          event: batchSettledEvent,
          fromBlock,
          toBlock,
        }),
      ),
    );
    for (const chunk of wave) {
      for (const log of chunk) {
        const decoded = decodeEventLog({
          abi: [batchSettledEvent],
          data: log.data,
          topics: log.topics,
        });
        const args = decoded.args as {
          batchId: bigint;
          clearingPrice: bigint;
          matchedBase: bigint;
          fillCount: number;
        };
        out.push({
          batchId: args.batchId,
          clearingPrice: args.clearingPrice,
          matchedBase: args.matchedBase,
          fillCount: Number(args.fillCount),
        });
      }
    }
  }
  return out;
}
