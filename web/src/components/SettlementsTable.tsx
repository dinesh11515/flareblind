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
            Each settlement plotted against the FTSO band, measured from the
            reference price right now.
          </p>
        </div>
        {settlements.length > 0 && (
          <span className="badge open">
            {settlements.length} cleared
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
          Dot size scales with matched volume. Each batch was inside the band
          when it settled — the contract reverts otherwise — so a dot sitting
          wide of centre is the FTSO price having moved since.
        </p>
      )}
    </section>
  );
}
