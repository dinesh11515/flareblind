import { formatUnits } from "viem";
import { Phase } from "../abi/pool";
import type { PoolTokens, VenueStatus } from "../types";

export function BatchStatusBar(props: {
  status: VenueStatus | null;
  tokens: PoolTokens | undefined;
  busy: string | null;
  onCloseBatch: () => void;
}) {
  const { status, tokens, busy, onCloseBatch } = props;

  if (!status || !tokens) {
    return (
      <section className="batch-bar skeleton" aria-busy="true">
        <p className="note">Loading batch…</p>
      </section>
    );
  }

  const remaining = Number(status.endsAt - status.chainNow);
  const open = status.phase === Phase.Open;
  const closable = open && remaining <= 0;
  const phaseLabel = open
    ? remaining <= 0
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
          <span className="batch-label">{open ? "Closes in" : "Status"}</span>
          <span
            className={`countdown mono ${open && remaining <= 15 ? "urgent" : ""}`}
          >
            {open ? formatCountdown(remaining) : "Matching…"}
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
              {Number(formatUnits(status.referencePrice, 18)).toFixed(4)}{" "}
              {tokens.quoteSymbol}
            </span>
          </div>
        )}
        {closable && (
          <button
            className="btn primary sm"
            onClick={onCloseBatch}
            disabled={busy !== null}
          >
            {busy === "close" ? "Closing…" : "Close batch"}
          </button>
        )}
      </div>

      <div
        className={`batch-progress ${open ? "is-open" : "is-sealing"}`}
        aria-hidden="true"
      >
        <div className="batch-progress-fill" />
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
