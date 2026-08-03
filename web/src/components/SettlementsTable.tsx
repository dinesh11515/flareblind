import type { PoolTokens, Settlement } from "../types";
import { SettlementsLedger } from "./SettlementsLedger";

export function SettlementsTable(props: {
  settlements: Settlement[];
  tokens: PoolTokens | undefined;
  referencePrice: bigint | null;
  maxDeviationBps: bigint;
}) {
  const { settlements, tokens, referencePrice, maxDeviationBps } = props;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Cleared batches</h2>
          <p className="panel-sub">
            Every settlement, plotted against the FTSO band it had to land in.
          </p>
        </div>
        {settlements.length > 0 && (
          <span className="badge open">
            {settlements.length} in band · 0 rejected
          </span>
        )}
      </div>

      <SettlementsLedger
        settlements={settlements}
        tokens={tokens}
        referencePrice={referencePrice}
        maxDeviationBps={maxDeviationBps}
      />

      {tokens && settlements.length > 0 && referencePrice !== null && (
        <p className="note">
          Dot size scales with matched volume. A settlement outside the band
          cannot be written — the contract reverts.
        </p>
      )}
    </section>
  );
}
