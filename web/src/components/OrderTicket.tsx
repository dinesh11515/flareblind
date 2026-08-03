import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Phase } from "../abi/pool";
import { shortHex } from "../lib/format";
import { sealOrder } from "../lib/sealing";
import type { LocalOrder, PoolTokens, VenueStatus } from "../types";

export function OrderTicket(props: {
  tokens: PoolTokens | undefined;
  status: VenueStatus | null;
  orders: LocalOrder[];
  busy: string | null;
  trader: string;
  onSubmit: (side: "buy" | "sell", amount: string, limit: string) => void;
}) {
  const { tokens, status, orders, busy, trader, onSubmit } = props;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const [cipher, setCipher] = useState<string | null>(null);

  const notional = useMemo(() => {
    const a = Number(amount);
    const l = Number(limit);
    if (!Number.isFinite(a) || !Number.isFinite(l) || a <= 0 || l <= 0) return null;
    return a * l;
  }, [amount, limit]);

  const baseDecimals = tokens?.baseDecimals;
  const batchId = status?.batchId;
  const enclaveKey = status?.enclaveKey;

  useEffect(() => {
    if (notional === null || baseDecimals === undefined || batchId === undefined || !enclaveKey) {
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
            amountBase: parseUnits(amount, baseDecimals).toString(),
            limitPrice: parseUnits(limit, 18).toString(),
          },
          enclaveKey
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
  }, [amount, limit, side, notional, trader, batchId, enclaveKey, baseDecimals]);

  if (!tokens || !status) {
    return (
      <section className="panel ticket">
        <h2>Trade</h2>
        <p className="note">Connect a wallet and pool to seal an order.</p>
      </section>
    );
  }

  const open = status.phase === Phase.Open;
  const canSubmit = open && notional !== null && busy === null;
  const oracle =
    status.referencePrice != null
      ? Number(formatUnits(status.referencePrice, 18))
      : null;

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

      <div className="summary rows">
        <div className="row">
          <span className="label">{side === "buy" ? "Max cost" : "Min proceeds"}</span>
          <span className="mono">
            {notional === null
              ? "—"
              : `${notional.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokens.quoteSymbol}`}
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
              <span className="label">What the chain will see</span>
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
          : open
            ? `Seal ${side} into batch #${status.batchId}`
            : "Batch is clearing — wait for next window"}
      </button>

      {orders.length > 0 && (
        <>
          <h3>Your sealed orders</h3>
          <div className="orders">
            {orders.slice(0, 6).map((o) => (
              <div className={`order ${o.side}`} key={o.at}>
                <div className="order-line">
                  <span className={`pill ${o.side}`}>{o.side.toUpperCase()}</span>
                  <span className="mono">
                    {o.amount} {tokens.baseSymbol} @ {o.limit}
                  </span>
                  <span className="mono dim">batch #{o.batchId}</span>
                </div>
                <div className="order-cipher mono" title={o.ciphertext}>
                  {shortHex(o.ciphertext, 24)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
