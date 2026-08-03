import { formatUnits } from "viem";
import { usePublicSnapshot } from "../hooks/usePublicSnapshot";

const STEPS = [
  {
    n: "01",
    title: "Fund",
    body: "Deposit FTestXRP or USD₮0 into the venue. Only funded balances can be filled, so nobody can bluff size.",
    tag: "onchain deposit",
  },
  {
    n: "02",
    title: "Seal",
    body: "Side, size and limit are encrypted in your browser to a key that only exists inside the enclave. The chain stores ciphertext.",
    tag: "client-side encryption",
  },
  {
    n: "03",
    title: "Clear",
    body: "When the window shuts, the TEE runs a uniform-price auction and signs the result. The contract checks it against FTSO.",
    tag: "TEE + FTSO bound",
  },
];

export function Landing(props: { onEnter: () => void }) {
  const { onEnter } = props;
  const { data: snapshot } = usePublicSnapshot();

  const oracle =
    snapshot?.referencePrice != null
      ? Number(formatUnits(snapshot.referencePrice, 18))
      : null;
  const bandPct = snapshot ? Number(snapshot.maxDeviationBps) / 100 : null;
  const ledger =
    snapshot && snapshot.settlements.length >= 3 && oracle !== null
      ? snapshot.settlements
      : [];

  return (
    <main className="landing">
      <section className={`landing-hero ${oracle === null ? "solo" : ""}`}>
        <div className="landing-hero-copy">
          <p className="eyebrow">Uniform-price batch auctions · Flare FTSO</p>
          <h1 className="landing-brand">Trade size without showing it.</h1>
          <p className="landing-lead">
            Large FXRP orders leak into the mempool the moment you sign.
            Flareblind seals them client-side, matches them inside a TEE, and
            clears the whole batch at <strong>one price</strong> — bounded by
            Flare's FTSO feed and verified onchain.
          </p>
          <div className="landing-cta">
            <button className="btn primary large" onClick={onEnter}>
              Enter the venue
            </button>
            <a className="btn large" href="#how">
              How it works
            </a>
          </div>

          {snapshot && (
            <dl className="landing-stats">
              <div className="stat">
                <dt>batches cleared</dt>
                <dd className="mono">
                  {snapshot.batchesCleared.toLocaleString()}
                </dd>
              </div>
              {bandPct !== null && (
                <div className="stat">
                  <dt>FTSO band</dt>
                  <dd className="mono">±{bandPct.toFixed(2)}%</dd>
                </div>
              )}
              <div className="stat">
                <dt>orders seen pre-trade</dt>
                <dd className="mono">0</dd>
              </div>
            </dl>
          )}
        </div>

        {oracle !== null && (
          <div className="landing-dial" aria-hidden="true">
            <span className="dial-plate" />
            <span className="dial-ring" />
            <span className="dial-ring" />
            <span className="dial-ring sage" />
            <div className="dial-face">
              <span className="dial-label">FTSO reference price</span>
              <span className="dial-value mono">{oracle.toFixed(4)}</span>
              <span className="dial-note">
                every batch clears within ±{bandPct?.toFixed(2)}% of it
              </span>
            </div>
          </div>
        )}
      </section>

      <section id="how" className="landing-how">
        <h2>Three moves, one price.</h2>
        <p className="landing-sub">
          Nothing about your order is public until after it is filled — and even
          then, only the aggregate.
        </p>
        <div className="landing-steps">
          {STEPS.map((step) => (
            <article key={step.n}>
              <span className="mono step-num">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <span className="step-tag">{step.tag}</span>
            </article>
          ))}
        </div>
      </section>

      {ledger.length > 0 && oracle !== null && bandPct !== null && (
        <section className="receipt">
          <div className="receipt-copy">
            <span className="eyebrow">The receipt</span>
            <h2>Every cleared batch lands inside the band.</h2>
            <p>
              The settlement contract rejects any clearing price more than ±
              {bandPct.toFixed(2)}% from Flare's FTSO XRP/USD feed. Here are the
              last {ledger.length} batches, plotted against that band.
            </p>
            <button className="btn primary" onClick={onEnter}>
              See the live venue
            </button>
          </div>
          <div className="receipt-chart">
            <div className="receipt-scale">
              <span>−{bandPct.toFixed(2)}%</span>
              <span>FTSO {oracle.toFixed(4)}</span>
              <span>+{bandPct.toFixed(2)}%</span>
            </div>
            {ledger.map((s) => {
              const price = Number(formatUnits(s.clearingPrice, 18));
              const half = oracle * (bandPct / 100);
              const rel = half === 0 ? 0 : (price - oracle) / half;
              const pos = Math.min(94, Math.max(6, 50 + rel * 50));
              const max = ledger.reduce(
                (m, x) => (x.matchedBase > m ? x.matchedBase : m),
                1n,
              );
              const dot =
                10 +
                Math.round((Number((s.matchedBase * 100n) / max) / 100) * 12);
              return (
                <div className="receipt-row" key={s.batchId}>
                  <span className="receipt-batch">#{s.batchId}</span>
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
                </div>
              );
            })}
            <p className="receipt-note">
              Dot size = matched volume. Not one batch outside the band.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
