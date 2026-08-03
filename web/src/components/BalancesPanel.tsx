import { useState } from "react";
import { formatUnits } from "viem";
import type { Balances, PoolTokens } from "../types";

export function BalancesPanel(props: {
  tokens: PoolTokens | undefined;
  balances: Balances | null;
  busy: string | null;
  liveNetwork: boolean;
  onDeposit: (isBase: boolean, amount: string) => void;
  onWithdraw: (isBase: boolean, amount: string) => void;
  onMint: () => void;
}) {
  const { tokens, balances, busy, liveNetwork, onDeposit, onWithdraw, onMint } =
    props;
  const [baseAmt, setBaseAmt] = useState("");
  const [quoteAmt, setQuoteAmt] = useState("");

  if (!tokens || !balances) return null;

  const fmt = (v: bigint, decimals: number) =>
    Number(formatUnits(v, decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });

  const row = (
    symbol: string,
    decimals: number,
    wallet: bigint,
    venueBal: bigint,
    amount: string,
    setAmount: (v: string) => void,
    isBase: boolean,
  ) => (
    <div className="asset">
      <div className="asset-head">
        <span className="symbol">{symbol}</span>
        <div className="asset-stats mono">
          <span>
            <em>in wallet</em>
            {fmt(wallet, decimals)}
          </span>
          <span className="venue-bal">
            <em>in venue</em>
            {fmt(venueBal, decimals)}
          </span>
        </div>
      </div>
      <div className="asset-actions">
        <input
          className="mono"
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`${symbol} amount`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button
          className="btn"
          disabled={busy !== null || !amount}
          onClick={() => onDeposit(isBase, amount)}
        >
          {busy === (isBase ? "deposit-base" : "deposit-quote")
            ? "…"
            : "Deposit"}
        </button>
        <button
          className="btn ghost"
          disabled={busy !== null || !amount}
          onClick={() => onWithdraw(isBase, amount)}
        >
          Withdraw
        </button>
      </div>
    </div>
  );

  const needsDeposit = balances.venueBase === 0n && balances.venueQuote === 0n;

  return (
    <section className={`panel ${needsDeposit ? "panel-focus" : ""}`}>
      <div className="panel-head">
        <div>
          <h2>Your funds</h2>
          <p className="panel-sub">
            Deposit before sealing — venue balance backs fills.
          </p>
        </div>
      </div>

      {needsDeposit && (
        <div className="callout">
          <strong>Step 1</strong>
          <span>
            Move tokens into the venue. Wallet balance alone cannot be matched.
          </span>
        </div>
      )}

      {row(
        tokens.baseSymbol,
        tokens.baseDecimals,
        balances.walletBase,
        balances.venueBase,
        baseAmt,
        setBaseAmt,
        true,
      )}
      {row(
        tokens.quoteSymbol,
        tokens.quoteDecimals,
        balances.walletQuote,
        balances.venueQuote,
        quoteAmt,
        setQuoteAmt,
        false,
      )}

      {!liveNetwork && (
        <button className="btn ghost" disabled={busy !== null} onClick={onMint}>
          {busy === "mint" ? "Minting…" : "Mint test funds"}
        </button>
      )}
      {liveNetwork && (
        <p className="note">
          Need tokens? Use the{" "}
          <a
            href="https://faucet.flare.network/"
            target="_blank"
            rel="noreferrer"
          >
            Coston2 faucet
          </a>{" "}
          for FTestXRP + USD₮0, then deposit here.
        </p>
      )}
    </section>
  );
}
