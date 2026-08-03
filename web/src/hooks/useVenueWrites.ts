import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type Address, type Hex, parseUnits } from "viem";
import { getPublicClient, waitForTransactionReceipt } from "@wagmi/core";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { COSTON2_ID } from "../lib/network";
import { erc20Abi } from "../abi/erc20";
import { poolAbi } from "../abi/pool";
import { formatAppError } from "../lib/errors";
import { sealOrder } from "../lib/sealing";
import type { LocalOrder, PoolTokens, VenueStatus } from "../types";
import { venueKeys } from "./queryKeys";

const ORDERS_KEY = "flareblind.orders";

export function readLocalOrders(): LocalOrder[] {
  try {
    return JSON.parse(
      localStorage.getItem(ORDERS_KEY) ??
        localStorage.getItem("stillwater.orders") ??
        "[]",
    ) as LocalOrder[];
  } catch {
    return [];
  }
}

export function useVenueWrites(opts: {
  pool?: Address;
  tokens?: PoolTokens;
  status?: VenueStatus | null;
}) {
  const { pool, tokens, status } = opts;
  const { address } = useAccount();
  const config = useConfig();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<LocalOrder[]>(readLocalOrders);

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: venueKeys.status(pool) }),
      queryClient.invalidateQueries({
        queryKey: venueKeys.balances(pool, address),
      }),
      queryClient.invalidateQueries({ queryKey: venueKeys.settlements(pool) }),
      queryClient.invalidateQueries({
        queryKey: venueKeys.publicSnapshot(pool),
      }),
    ]);
  }, [address, pool, queryClient]);

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      try {
        await action();
        await invalidate();
      } catch (err) {
        setError(formatAppError(err));
      } finally {
        setBusy(null);
      }
    },
    [invalidate],
  );

  const waitTx = useCallback(
    async (hash: Hex) => {
      await waitForTransactionReceipt(config, { hash });
    },
    [config],
  );

  const deposit = useCallback(
    (isBase: boolean, human: string) =>
      run(isBase ? "deposit-base" : "deposit-quote", async () => {
        if (!pool || !tokens || !address) return;
        const token = isBase ? tokens.base : tokens.quote;
        const decimals = isBase ? tokens.baseDecimals : tokens.quoteDecimals;
        const amount = parseUnits(human, decimals);
        const publicClient = getPublicClient(config, { chainId: COSTON2_ID });
        if (!publicClient) throw new Error("RPC unreachable. Retry in a moment.");
        const allowance = await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, pool],
        });
        if (allowance < amount) {
          const approveHash = await writeContractAsync({
            address: token,
            abi: erc20Abi,
            functionName: "approve",
            args: [pool, amount],
          });
          await waitTx(approveHash);
        }
        const hash = await writeContractAsync({
          address: pool,
          abi: poolAbi,
          functionName: "deposit",
          args: [isBase, amount],
        });
        await waitTx(hash);
      }),
    [address, config, pool, run, tokens, waitTx, writeContractAsync],
  );

  const withdraw = useCallback(
    (isBase: boolean, human: string) =>
      run(isBase ? "withdraw-base" : "withdraw-quote", async () => {
        if (!pool || !tokens) return;
        const amount = parseUnits(
          human,
          isBase ? tokens.baseDecimals : tokens.quoteDecimals,
        );
        const hash = await writeContractAsync({
          address: pool,
          abi: poolAbi,
          functionName: "withdraw",
          args: [isBase, amount],
        });
        await waitTx(hash);
      }),
    [pool, run, tokens, waitTx, writeContractAsync],
  );

  const mintTestFunds = useCallback(
    () =>
      run("mint", async () => {
        if (!tokens || !address) return;
        const baseHash = await writeContractAsync({
          address: tokens.base,
          abi: erc20Abi,
          functionName: "mint",
          args: [address, parseUnits("10000", tokens.baseDecimals)],
        });
        await waitTx(baseHash);
        const quoteHash = await writeContractAsync({
          address: tokens.quote,
          abi: erc20Abi,
          functionName: "mint",
          args: [address, parseUnits("25000", tokens.quoteDecimals)],
        });
        await waitTx(quoteHash);
      }),
    [address, run, tokens, waitTx, writeContractAsync],
  );

  const closeBatch = useCallback(
    () =>
      run("close", async () => {
        if (!pool) return;
        const hash = await writeContractAsync({
          address: pool,
          abi: poolAbi,
          functionName: "closeBatch",
        });
        await waitTx(hash);
      }),
    [pool, run, waitTx, writeContractAsync],
  );

  const submit = useCallback(
    (side: "buy" | "sell", amount: string, limit: string) =>
      run("submit", async () => {
        if (!pool || !tokens || !address || !status) return;
        const amountBase = parseUnits(amount, tokens.baseDecimals);
        const limitPrice = parseUnits(limit, 18);
        const ciphertext = await sealOrder(
          {
            trader: address,
            batchId: status.batchId,
            side,
            amountBase: amountBase.toString(),
            limitPrice: limitPrice.toString(),
          },
          status.enclaveKey,
        );
        const hash = await writeContractAsync({
          address: pool,
          abi: poolAbi,
          functionName: "submitOrder",
          args: [ciphertext as Hex],
        });
        await waitTx(hash);
        const record: LocalOrder = {
          batchId: status.batchId,
          side,
          amount,
          limit,
          ciphertext,
          at: Date.now(),
        };
        setOrders((prev) => {
          const next = [record, ...prev].slice(0, 20);
          localStorage.setItem(ORDERS_KEY, JSON.stringify(next));
          return next;
        });
      }),
    [address, pool, run, status, tokens, waitTx, writeContractAsync],
  );

  return {
    busy,
    error,
    setError,
    orders,
    deposit,
    withdraw,
    mintTestFunds,
    closeBatch,
    submit,
  };
}
