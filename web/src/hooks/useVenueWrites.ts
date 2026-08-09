import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type Address, type Hex, parseUnits } from "viem";
import { waitForTransactionReceipt } from "@wagmi/core";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { erc20Abi } from "../abi/erc20";
import { poolAbi } from "../abi/pool";
import { formatAppError } from "../lib/errors";
import { parsePrice } from "../lib/price";
import { sealOrder } from "../lib/sealing";
import type { LocalOrder, PoolTokens, VenueStatus } from "../types";
import { useVenueClient } from "./useVenueClient";
import { venueKeys } from "./queryKeys";

const ordersKey = (pool: Address) => `flareblind.orders.${pool.toLowerCase()}`;

export function readLocalOrders(pool?: Address): LocalOrder[] {
  if (!pool) return [];
  try {
    const raw = localStorage.getItem(ordersKey(pool));
    return raw ? (JSON.parse(raw) as LocalOrder[]) : [];
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
  const { client, chainId } = useVenueClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<LocalOrder[]>(() => readLocalOrders(pool));

  useEffect(() => {
    setOrders(readLocalOrders(pool));
  }, [pool]);

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: venueKeys.status(chainId, pool) }),
      queryClient.invalidateQueries({
        queryKey: venueKeys.balances(chainId, pool, address),
      }),
      queryClient.invalidateQueries({
        queryKey: venueKeys.settlements(chainId, pool),
      }),
    ]);
  }, [address, chainId, pool, queryClient]);

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
        const allowance = await client.readContract({
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
    [address, client, pool, run, tokens, waitTx, writeContractAsync],
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
        const limitPrice = parsePrice(limit, tokens);
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
          tx: hash,
          at: Date.now(),
        };
        setOrders((prev) => {
          const next = [record, ...prev].slice(0, 20);
          localStorage.setItem(ordersKey(pool), JSON.stringify(next));
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
