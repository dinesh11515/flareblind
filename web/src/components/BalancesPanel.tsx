import { useState } from "react";
import { formatUnits } from "ethers";
import type { VenueHandles } from "../lib/venue";
import type { Balances } from "../App";

export function BalancesPanel(props: {
  venue: VenueHandles | null;
  balances: Balances | null;
  busy: string | null;
  onDeposit: (isBase: boolean, amount: string) => void;
  onWithdraw: (isBase: boolean, amount: string) => void;
  onMint: () => void;
}) {
  const { venue, balances, busy, onDeposit, onWithdraw, onMint } = props;
  const [baseAmt, setBaseAmt] = useState("");
  const [quoteAmt, setQuoteAmt] = useState("");

  if (!venue || !balances) return null;

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
    isBase: boolean
  ) => (
    <div className="asset">
      <div className="asset-head">
        <span className="symbol">{symbol}</span>
        <span className="mono dim">
          wallet {fmt(wallet, decimals)} · venue {fmt(venueBal, decimals)}
        </span>
      </div>
      <div className="asset-actions">
        <input
          className="mono"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button
          className="btn"
          disabled={busy !== null || !amount}
          onClick={() => onDeposit(isBase, amount)}
        >
          Deposit
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

  return (
    <section className="panel">
      <h2>Balances</h2>
      {row(venue.baseSymbol, venue.baseDecimals, balances.walletBase, balances.venueBase, baseAmt, setBaseAmt, true)}
      {row(venue.quoteSymbol, venue.quoteDecimals, balances.walletQuote, balances.venueQuote, quoteAmt, setQuoteAmt, false)}
      <button className="btn ghost" disabled={busy !== null} onClick={onMint}>
        {busy === "mint" ? "Minting…" : "Mint test funds"}
      </button>
      <p className="note">
        Venue balances back your sealed orders. Withdrawals pause only while a batch is
        settling.
      </p>
    </section>
  );
}
