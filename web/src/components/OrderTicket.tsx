import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Phase } from "../abi/pool";
import { useCountdown } from "../hooks/useCountdown";
import { useVenueClient } from "../hooks/useVenueClient";
import { shortHex } from "../lib/format";
import { explorerTxUrl } from "../lib/network";
import { parsePrice, priceToNumber } from "../lib/price";
import { sealOrder } from "../lib/sealing";
import type { Balances, LocalOrder, PoolTokens, VenueStatus } from "../types";

const CLOSE_GUARD_SECONDS = 12;

interface Draft {
  amountBase: bigint;
  limitPrice: bigint;
}

const PRICE_SCALE = 10n ** 18n;

function ceilCost(amountBase: bigint, price: bigint): bigint {
  return (amountBase * price + PRICE_SCALE - 1n) / PRICE_SCALE;
}

function readDraft(
  amount: string,
  limit: string,
  side: "buy" | "sell",
  tokens: PoolTokens,
  status: VenueStatus,
  balances: Balances | null,
): { draft: Draft; problem: null } | { draft: null; problem: string | null } {
  if (!amount.trim() || !limit.trim()) return { draft: null, problem: null };

  let amountBase: bigint;
  let limitPrice: bigint;
  try {
    amountBase = parseUnits(amount, tokens.baseDecimals);
    limitPrice = parsePrice(limit, tokens);
  } catch {
    return { draft: null, problem: "Enter a plain decimal number, e.g. 1000.5" };
  }

  if (amountBase <= 0n) {
    return {
      draft: null,
      problem: `Amount rounds to zero — ${tokens.baseSymbol} has ${tokens.baseDecimals} decimals`,
    };
  }
  if (limitPrice <= 0n) return { draft: null, problem: "Limit price must be above zero" };

  if (status.referencePrice != null && status.referencePrice > 0n) {
    const bps = status.maxDeviationBps;
    const lo = (status.referencePrice * (10_000n - bps)) / 10_000n;
    const hi = (status.referencePrice * (10_000n + bps)) / 10_000n;
    const unfillable = side === "buy" ? limitPrice < lo : limitPrice > hi;
    if (unfillable) {
      const band = (Number(bps) / 100).toFixed(2);
      return {
        draft: null,
        problem: `Outside the ±${band}% FTSO band — this order could never clear`,
      };
    }
  }

  if (balances) {
    if (side === "buy") {
      const cost = ceilCost(amountBase, limitPrice);
      if (balances.venueQuote < cost) {
        return {
          draft: null,
          problem: `Needs ${fmt(cost, tokens.quoteDecimals)} ${tokens.quoteSymbol} in the venue — deposit more first`,
        };
      }
    } else if (balances.venueBase < amountBase) {
      return {
        draft: null,
        problem: `Needs ${fmt(amountBase, tokens.baseDecimals)} ${tokens.baseSymbol} in the venue — deposit more first`,
      };
    }
  }

  return { draft: { amountBase, limitPrice }, problem: null };
}

function fmt(v: bigint, decimals: number): string {
  return Number(formatUnits(v, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

export function OrderTicket(props: {
  tokens: PoolTokens | undefined;
  status: VenueStatus | null;
  balances: Balances | null;
  orders: LocalOrder[];
  busy: string | null;
  trader: string;
  onSubmit: (side: "buy" | "sell", amount: string, limit: string) => void;
}) {
  const { tokens, status, balances, orders, busy, trader, onSubmit } = props;
  const { chainId } = useVenueClient();
  const remaining = useCountdown(status);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const [cipher, setCipher] = useState<string | null>(null);

  const { draft, problem } = useMemo(
    () =>
      tokens && status
        ? readDraft(amount, limit, side, tokens, status, balances)
        : { draft: null, problem: null },
    [amount, limit, side, tokens, status, balances],
  );

  const batchId = status?.batchId;
  const enclaveKey = status?.enclaveKey;
  const amountBase = draft?.amountBase;
  const limitPrice = draft?.limitPrice;

  useEffect(() => {
    if (amountBase === undefined || limitPrice === undefined || batchId === undefined || !enclaveKey) {
      setCipher(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const hex = await sealOrder(
          {
            trader,
            batchId,
            side,
            amountBase: amountBase.toString(),
            limitPrice: limitPrice.toString(),
          },
          enclaveKey,
        );
        if (!cancelled) setCipher(hex);
      } catch {
        if (!cancelled) setCipher(null);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amountBase, limitPrice, side, trader, batchId, enclaveKey]);

  if (!tokens || !status) {
    return (
      <section className="panel ticket">
        <h2>Seal order</h2>
        <p className="note">Connect a wallet and venue to seal an order.</p>
      </section>
    );
  }

  const open = status.phase === Phase.Open;
  const closingSoon = open && remaining <= CLOSE_GUARD_SECONDS;
  const canSubmit =
    open && !closingSoon && draft !== null && cipher !== null && busy === null;
  const oracle =
    status.referencePrice != null ? priceToNumber(status.referencePrice, tokens) : null;

  return (
    <section className="panel ticket panel-focus">
      <div className="panel-head">
        <div>
          <h2>Seal order</h2>
          <p className="panel-sub">
            Encrypted in your browser → submitted as ciphertext to batch #{status.batchId}
          </p>
        </div>
        <span className={`badge ${open ? "open" : "sealing"}`}>
          {open ? "OPEN" : "CLEARING"}
        </span>
      </div>

      <div className="side-toggle" role="tablist" aria-label="Order side">
        <button
          role="tab"
          aria-selected={side === "buy"}
          className={`side buy ${side === "buy" ? "active" : ""}`}
          onClick={() => setSide("buy")}
        >
          Buy {tokens.baseSymbol}
        </button>
        <button
          role="tab"
          aria-selected={side === "sell"}
          className={`side sell ${side === "sell" ? "active" : ""}`}
          onClick={() => setSide("sell")}
        >
          Sell {tokens.baseSymbol}
        </button>
      </div>

      <label className="field">
        <span>Amount</span>
        <div className="input-wrap">
          <input
            className="mono large"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className="suffix">{tokens.baseSymbol}</span>
        </div>
      </label>

      <label className="field">
        <span className="field-row">
          Limit price
          {oracle != null && (
            <button
              type="button"
              className="linkish"
              onClick={() => setLimit(oracle.toFixed(4))}
            >
              Use oracle {oracle.toFixed(4)}
            </button>
          )}
        </span>
        <div className="input-wrap">
          <input
            className="mono large"
            inputMode="decimal"
            placeholder="0.0000"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
          <span className="suffix">{tokens.quoteSymbol}</span>
        </div>
        <span className="field-hint">
          {side === "buy"
            ? `Max you’ll pay per ${tokens.baseSymbol}. Fill only if clearing ≤ your limit.`
            : `Min you’ll accept per ${tokens.baseSymbol}. Fill only if clearing ≥ your limit.`}
        </span>
      </label>

      {problem && (
        <p className="field-problem" role="alert">
          {problem}
        </p>
      )}

      <div className="summary rows">
        <div className="row">
          <span className="label">{side === "buy" ? "Max cost" : "Min proceeds"}</span>
          <span className="mono">
            {draft === null
              ? "—"
              : `${fmt(
                  side === "buy"
                    ? ceilCost(draft.amountBase, draft.limitPrice)
                    : (draft.amountBase * draft.limitPrice) / PRICE_SCALE,
                  tokens.quoteDecimals,
                )} ${tokens.quoteSymbol}`}
          </span>
        </div>
        <div className="row">
          <span className="label">Everyone gets</span>
          <span>the same clearing price</span>
        </div>
        <div className="row">
          <span className="label">Who sees your size?</span>
          <span>Enclave only — not the mempool</span>
        </div>
        {cipher && (
          <div className="cipher-preview">
            <div className="cipher-head">
              <span className="label">On chain, your order looks like</span>
              <span className="cipher-live">live</span>
            </div>
            <p className="cipher-body mono">{cipher.slice(0, 96)}…</p>
          </div>
        )}
      </div>

      <button
        className={`btn primary large ${side}`}
        disabled={!canSubmit}
        onClick={() => onSubmit(side, amount, limit)}
      >
        {busy === "submit"
          ? "Sealing…"
          : !open
            ? "Batch is clearing — wait for next window"
            : closingSoon
              ? "Window closing — wait for the next batch"
              : `Seal ${side} into batch #${status.batchId}`}
      </button>

      {orders.length > 0 && (
        <>
          <h3>Your sealed orders</h3>
          <div className="orders">
            {orders.slice(0, 6).map((o) => {
              const txUrl = o.tx ? explorerTxUrl(chainId, o.tx) : null;
              return (
                <div className={`order ${o.side}`} key={o.at}>
                  <div className="order-line">
                    <span className={`pill ${o.side}`}>{o.side.toUpperCase()}</span>
                    <span className="mono">
                      {o.amount} {tokens.baseSymbol} @ {o.limit}
                    </span>
                    <span className="mono dim">
                      batch #{o.batchId}
                      {o.batchId < status.batchId ? " · settled" : ""}
                    </span>
                    {txUrl && (
                      <a
                        className="mono dim"
                        href={txUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        tx
                      </a>
                    )}
                  </div>
                  <div className="order-cipher mono" title={o.ciphertext}>
                    {shortHex(o.ciphertext, 24)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
