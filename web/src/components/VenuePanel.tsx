import { useEffect, useState } from "react";
import { shortHex, Phase, type VenueHandles } from "../lib/venue";
import type { VenueStatus } from "../App";

export function VenuePanel(props: {
  status: VenueStatus | null;
  venue: VenueHandles | null;
  poolAddress: string;
  onPoolAddress: (a: string) => void;
  onCloseBatch: () => void;
  busy: string | null;
}) {
  const { status, venue, poolAddress, onPoolAddress, onCloseBatch, busy } = props;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = status ? Number(status.endsAt) - now : 0;
  const closable = status?.phase === Phase.Open && remaining <= 0;

  return (
    <section className="panel">
      <h2>Venue</h2>
      <label className="field">
        <span>Pool address</span>
        <input
          className="mono"
          value={poolAddress}
          spellCheck={false}
          placeholder="0x…"
          onChange={(e) => onPoolAddress(e.target.value.trim())}
        />
      </label>

      {status && venue && (
        <>
          <div className="rows">
            <div className="row">
              <span className="label">Batch</span>
              <span className="mono">#{status.batchId}</span>
            </div>
            <div className="row">
              <span className="label">Phase</span>
              <span className={`badge ${status.phase === Phase.Open ? "open" : "sealing"}`}>
                {status.phase === Phase.Open ? "OPEN" : "SEALING"}
              </span>
            </div>
            <div className="row">
              <span className="label">{status.phase === Phase.Open ? "Closes in" : "Awaiting enclave"}</span>
              <span className="mono">
                {status.phase === Phase.Open ? formatCountdown(remaining) : "…"}
              </span>
            </div>
            <div className="row">
              <span className="label">Sealed orders</span>
              <span className="mono">{status.orders}</span>
            </div>
            <div className="row">
              <span className="label">Price band</span>
              <span className="mono">±{(Number(status.maxDeviationBps) / 100).toFixed(2)}%</span>
            </div>
          </div>

          {closable && (
            <button className="btn" onClick={onCloseBatch} disabled={busy !== null}>
              {busy === "close" ? "Closing…" : "Close batch"}
            </button>
          )}

          <h3>Enclave</h3>
          <div className="rows">
            <div className="row">
              <span className="label">Sealing key</span>
              <span className="mono" title={status.enclaveKey}>
                {shortHex(status.enclaveKey, 8)}
              </span>
            </div>
            <div className="row">
              <span className="label">Settlement signer</span>
              <span className="mono" title={status.teeSigner}>
                {shortHex(status.teeSigner, 8)}
              </span>
            </div>
            <div className="row">
              <span className="label">Attestation</span>
              <span className="mono" title={status.attestationDigest}>
                {shortHex(status.attestationDigest, 8)}
              </span>
            </div>
          </div>
          <p className="note">
            Orders are sealed to the enclave key in your browser. The venue contract only
            accepts settlements signed by the attested enclave, conserved to the wei and
            priced within the FTSO band.
          </p>
        </>
      )}
    </section>
  );
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
