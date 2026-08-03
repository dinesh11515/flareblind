import { formatUnits } from "viem";
import type { PoolTokens, Settlement } from "../types";

export function SettlementsLedger(props: {
  settlements: Settlement[];
  tokens: PoolTokens | undefined;
  referencePrice: bigint | null;
  maxDeviationBps: bigint;
}) {
  const { settlements, tokens, referencePrice, maxDeviationBps } = props;

  if (!tokens || settlements.length === 0 || referencePrice === null) {
    return (
      <div className="empty-settlements">
        <p className="note">
          No crossed batches yet. When buys and sells meet inside the FTSO
          band, the clearing price and matched size show up here.
        </p>
      </div>
    );
  }

  const oracle = Number(formatUnits(referencePrice, 18));
  const bandPct = Number(maxDeviationBps) / 100;
  const half = oracle * (Number(maxDeviationBps) / 10000);
  const maxMatched = settlements.reduce(
    (m, s) => (s.matchedBase > m ? s.matchedBase : m),
    1n,
  );

  return (
    <div className="ledger">
      <div className="ledger-row is-head">
        <span>Batch</span>
        <span className="ledger-scale">
          <span>−{bandPct.toFixed(2)}%</span>
          <span>FTSO {oracle.toFixed(4)}</span>
          <span>+{bandPct.toFixed(2)}%</span>
        </span>
        <span style={{ textAlign: "right" }}>Cleared at</span>
        <span className="hide-sm" style={{ textAlign: "right" }}>
          Matched
        </span>
        <span className="hide-sm" style={{ textAlign: "right" }}>
          Fills
        </span>
      </div>

      {settlements.map((s) => {
        const price = Number(formatUnits(s.clearingPrice, 18));
        const rel = half === 0 ? 0 : (price - oracle) / half;
        const pos = Math.min(94, Math.max(6, 50 + rel * 50));
        const ratio = Number((s.matchedBase * 100n) / maxMatched) / 100;
        const dot = 10 + Math.round(ratio * 12);

        return (
          <div className="ledger-row" key={s.batchId}>
            <span className="ledger-batch">#{s.batchId}</span>
            <span className="ledger-track">
              <span
                className="ledger-dot"
                style={{
                  left: `${pos.toFixed(1)}%`,
                  width: dot,
                  height: dot,
                }}
              />
            </span>
            <span className="ledger-price">{price.toFixed(4)}</span>
            <span className="ledger-num hide-sm">
              {Number(
                formatUnits(s.matchedBase, tokens.baseDecimals),
              ).toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}{" "}
              {tokens.baseSymbol}
            </span>
            <span className="ledger-num dim hide-sm">{s.fillCount}</span>
          </div>
        );
      })}
    </div>
  );
}
