import { useEffect, useState } from "react";
import { Phase } from "../abi/pool";
import { useCountdown } from "../hooks/useCountdown";
import { priceToNumber } from "../lib/price";
import type { PoolTokens, VenueStatus } from "../types";

export function BatchStatusBar(props: {
  status: VenueStatus | null;
  tokens: PoolTokens | undefined;
  unreachable: boolean;
  busy: string | null;
  onCloseBatch: () => void;
}) {
  const { status, tokens, unreachable, busy, onCloseBatch } = props;
  const [confirmClose, setConfirmClose] = useState(false);
  const remaining = useCountdown(status);

  useEffect(() => {
    setConfirmClose(false);
  }, [status?.batchId, status?.phase]);

  if (!status || !tokens) {
    return (
      <section className="batch-bar skeleton" aria-busy={!unreachable}>
        <p className="note">
          {unreachable
            ? "No venue at that address on this network. Check the pool contract in Market."
            : "Loading batch…"}
        </p>
      </section>
    );
  }

  const open = status.phase === Phase.Open;
  const elapsed = remaining <= 0;
  const closable = open && elapsed;
  const duration = Number(status.batchDuration) || 1;
  const progress = open
    ? Math.min(100, Math.max(0, ((duration - remaining) / duration) * 100))
    : 100;

  const phaseLabel = open
    ? elapsed
      ? "Window ended — ready to close"
      : "Accepting sealed orders"
    : "Matching in the enclave";
  const phaseHint = open
    ? "Your size and limit stay encrypted until this window closes."
    : "The TEE is decrypting funded orders and computing one clearing price.";

  return (
    <section
      className={`batch-bar ${open ? "is-open" : "is-sealing"}`}
      aria-live="polite"
    >
      <div className="batch-bar-main">
        <div className="batch-bar-id">
          <span className="batch-label">Current batch</span>
          <span className="batch-id mono">#{status.batchId}</span>
          <span className={`badge ${open ? "open" : "sealing"}`}>
            {open ? "OPEN" : "CLEARING"}
          </span>
        </div>

        <div className="batch-bar-phase">
          <strong>{phaseLabel}</strong>
          <p>{phaseHint}</p>
        </div>

        <div className="batch-bar-timer">
          <span className="batch-label">
            {!open ? "Status" : elapsed ? "Window" : "Closes in"}
          </span>
          <span className={`countdown mono ${open && remaining <= 15 ? "urgent" : ""}`}>
            {!open ? "Matching…" : elapsed ? "Elapsed" : formatCountdown(remaining)}
          </span>
        </div>
      </div>

      <div className="batch-bar-stats">
        <div className="stat">
          <span className="batch-label">Sealed orders</span>
          <span className="mono">{status.orders}</span>
        </div>
        <div className="stat">
          <span className="batch-label">FTSO band</span>
          <span className="mono">
            ±{(Number(status.maxDeviationBps) / 100).toFixed(2)}%
          </span>
        </div>
        {status.referencePrice != null && (
          <div className="stat">
            <span className="batch-label">Oracle</span>
            <span className="mono">
              {priceToNumber(status.referencePrice, tokens).toFixed(4)}{" "}
              {tokens.quoteSymbol}
            </span>
          </div>
        )}
        {closable && (
          <button
            className={`btn sm ${confirmClose ? "primary" : "ghost"}`}
            onClick={() => (confirmClose ? onCloseBatch() : setConfirmClose(true))}
            disabled={busy !== null}
          >
            {busy === "close"
              ? "Closing…"
              : confirmClose
                ? "Confirm close"
                : "Close batch"}
          </button>
        )}
      </div>

      {closable && confirmClose && (
        <p className="note batch-warning">
          Closing freezes withdrawals until the enclave settles this batch. Only
          do this if the matching engine is running.
        </p>
      )}

      <div
        className={`batch-progress ${open ? "is-open" : "is-sealing"}`}
        aria-hidden="true"
      >
        <div className="batch-progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </section>
  );
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
