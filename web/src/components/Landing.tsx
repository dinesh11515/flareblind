import type { Address } from "viem";
import { useSettlements } from "../hooks/useSettlements";
import { priceToNumber } from "../lib/price";
import type { PoolTokens, VenueStatus } from "../types";
import { SettlementsLedger } from "./SettlementsLedger";

const STEPS = [
  {
    n: "01",
    title: "Fund",
    body: "Deposit the base or quote token into the venue. Only funded balances can be filled, so nobody can bluff size.",
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

export function Landing(props: {
  onEnter: () => void;
  pool: Address | undefined;
  tokens: PoolTokens | undefined;
  status: VenueStatus | null;
}) {
  const { onEnter, pool, tokens, status } = props;
  const { data: settlements = [] } = useSettlements(pool);

  const oracle =
    status?.referencePrice != null && tokens
      ? priceToNumber(status.referencePrice, tokens)
      : null;
  const bandPct = status ? Number(status.maxDeviationBps) / 100 : null;
  const windowMins = status ? Math.round(Number(status.batchDuration) / 60) : null;
  const ledger = settlements.slice(0, 6);

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

          {status && (
            <dl className="landing-stats">
              {bandPct !== null && (
                <div className="stat">
                  <dt>FTSO band</dt>
                  <dd className="mono">±{bandPct.toFixed(2)}%</dd>
                </div>
              )}
              {windowMins !== null && (
                <div className="stat">
                  <dt>batch window</dt>
                  <dd className="mono">{windowMins}m</dd>
                </div>
              )}
              {tokens && (
                <div className="stat">
                  <dt>pair</dt>
                  <dd className="mono">
                    {tokens.baseSymbol}/{tokens.quoteSymbol}
                  </dd>
                </div>
              )}
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

      {ledger.length > 0 && status && bandPct !== null && (
        <section className="receipt">
          <div className="receipt-copy">
            <span className="eyebrow">The receipt</span>
            <h2>Every cleared batch landed inside the band.</h2>
            <p>
              The settlement contract rejects any clearing price more than ±
              {bandPct.toFixed(2)}% from Flare's FTSO XRP/USD feed. Here are the
              last {ledger.length} batches to cross, plotted against that band.
            </p>
            <button className="btn primary" onClick={onEnter}>
              See the live venue
            </button>
          </div>
          <div className="receipt-chart">
            <SettlementsLedger
              settlements={ledger}
              tokens={tokens}
              referencePrice={status.referencePrice}
              maxDeviationBps={status.maxDeviationBps}
              compact
            />
          </div>
        </section>
      )}
    </main>
  );
}
