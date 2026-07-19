import { useMemo, useState } from "react";
import { Phase, shortHex, type VenueHandles } from "../lib/venue";
import type { LocalOrder, VenueStatus } from "../App";

export function OrderTicket(props: {
  venue: VenueHandles | null;
  status: VenueStatus | null;
  orders: LocalOrder[];
  busy: string | null;
  onSubmit: (side: "buy" | "sell", amount: string, limit: string) => void;
}) {
  const { venue, status, orders, busy, onSubmit } = props;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");

  const notional = useMemo(() => {
    const a = Number(amount);
    const l = Number(limit);
    if (!Number.isFinite(a) || !Number.isFinite(l) || a <= 0 || l <= 0) return null;
    return a * l;
  }, [amount, limit]);

  if (!venue || !status) {
    return (
      <section className="panel">
        <h2>Order ticket</h2>
        <p className="note">Connect to a venue to trade.</p>
      </section>
    );
  }

  const open = status.phase === Phase.Open;
  const canSubmit = open && notional !== null && busy === null;

  return (
    <section className="panel ticket">
      <h2>Order ticket</h2>

      <div className="side-toggle" role="tablist" aria-label="Order side">
        <button
          role="tab"
          aria-selected={side === "buy"}
          className={`side buy ${side === "buy" ? "active" : ""}`}
          onClick={() => setSide("buy")}
        >
          Buy {venue.baseSymbol}
        </button>
        <button
          role="tab"
          aria-selected={side === "sell"}
          className={`side sell ${side === "sell" ? "active" : ""}`}
          onClick={() => setSide("sell")}
        >
          Sell {venue.baseSymbol}
        </button>
      </div>

      <label className="field">
        <span>Amount ({venue.baseSymbol})</span>
        <input
          className="mono large"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Limit price ({venue.quoteSymbol} per {venue.baseSymbol})</span>
        <input
          className="mono large"
          inputMode="decimal"
          placeholder="0.0000"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
      </label>

      <div className="rows">
        <div className="row">
          <span className="label">{side === "buy" ? "Max cost" : "Min proceeds"}</span>
          <span className="mono">
            {notional === null
              ? "—"
              : `${notional.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${venue.quoteSymbol}`}
          </span>
        </div>
        <div className="row">
          <span className="label">Executes at</span>
          <span className="mono">uniform clearing price</span>
        </div>
        <div className="row">
          <span className="label">Visible to</span>
          <span className="mono">enclave only</span>
        </div>
      </div>

      <button
        className={`btn primary large ${side}`}
        disabled={!canSubmit}
        onClick={() => onSubmit(side, amount, limit)}
      >
        {busy === "submit"
          ? "Sealing and submitting…"
          : open
            ? `Seal and submit to batch #${status.batchId}`
            : "Batch is sealing — wait for next window"}
      </button>

      {orders.length > 0 && (
        <>
          <h3>Your sealed orders</h3>
          <div className="orders">
            {orders.slice(0, 6).map((o) => (
              <div className="order" key={o.at}>
                <div className="order-line">
                  <span className={`pill ${o.side}`}>{o.side.toUpperCase()}</span>
                  <span className="mono">
                    {o.amount} {venue.baseSymbol} @ {o.limit}
                  </span>
                  <span className="mono dim">batch #{o.batchId}</span>
                </div>
                <div className="order-cipher mono" title={o.ciphertext}>
                  {shortHex(o.ciphertext, 24)}
                </div>
              </div>
            ))}
          </div>
          <p className="note">
            Only these ciphertexts exist onchain. Side, size, and limit stay in your
            browser and inside the enclave.
          </p>
        </>
      )}
    </section>
  );
}
