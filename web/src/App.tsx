import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, formatUnits, parseUnits } from "ethers";
import {
  connectWallet,
  loadVenue,
  shortAddress,
  ORACLE_ABI,
  Phase,
  type VenueHandles,
  type Wallet,
} from "./lib/venue";
import { sealOrder } from "./lib/sealing";
import { VenuePanel } from "./components/VenuePanel";
import { BalancesPanel } from "./components/BalancesPanel";
import { OrderTicket } from "./components/OrderTicket";
import { SettlementsTable } from "./components/SettlementsTable";

export interface VenueStatus {
  batchId: number;
  phase: number;
  endsAt: bigint;
  orders: number;
  referencePrice: bigint | null;
  maxDeviationBps: bigint;
  enclaveKey: string;
  teeSigner: string;
  attestationDigest: string;
}

export interface Balances {
  walletBase: bigint;
  walletQuote: bigint;
  venueBase: bigint;
  venueQuote: bigint;
}

export interface Settlement {
  batchId: number;
  clearingPrice: bigint;
  matchedBase: bigint;
  fillCount: number;
}

export interface LocalOrder {
  batchId: number;
  side: "buy" | "sell";
  amount: string;
  limit: string;
  ciphertext: string;
  at: number;
}

const POOL_KEY = "stillwater.pool";
const ORDERS_KEY = "stillwater.orders";

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [poolAddress, setPoolAddress] = useState(localStorage.getItem(POOL_KEY) ?? "");
  const [venue, setVenue] = useState<VenueHandles | null>(null);
  const [status, setStatus] = useState<VenueStatus | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [orders, setOrders] = useState<LocalOrder[]>(
    JSON.parse(localStorage.getItem(ORDERS_KEY) ?? "[]")
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const connect = useCallback(async () => {
    try {
      setError(null);
      setWallet(await connectWallet());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Attach to the venue whenever wallet + address are available.
  useEffect(() => {
    if (!wallet || !poolAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
      setVenue(null);
      return;
    }
    localStorage.setItem(POOL_KEY, poolAddress);
    loadVenue(wallet, poolAddress)
      .then(setVenue)
      .catch((err) => setError(`venue: ${err.message ?? err}`));
  }, [wallet, poolAddress]);

  const refresh = useCallback(async () => {
    if (!wallet || !venue) return;
    try {
      const { pool } = venue;
      const [info, enclaveKey, teeSigner, digest, deviation] = await Promise.all([
        pool.batchInfo(),
        pool.enclaveEncryptionKey(),
        pool.teeSigner(),
        pool.teeAttestationDigest(),
        pool.maxDeviationBps(),
      ]);
      let referencePrice: bigint | null = null;
      try {
        const oracle = new Contract(await pool.oracle(), ORACLE_ABI, wallet.provider);
        const [price] = await oracle.latestPrice.staticCallResult();
        referencePrice = price;
      } catch {
        referencePrice = null;
      }
      setStatus({
        batchId: Number(info.id),
        phase: Number(info.phase),
        endsAt: info.endsAt,
        orders: Number(info.orders),
        referencePrice,
        maxDeviationBps: deviation,
        enclaveKey,
        teeSigner,
        attestationDigest: digest,
      });
      const [walletBase, walletQuote, venueBase, venueQuote] = await Promise.all([
        venue.base.balanceOf(wallet.address),
        venue.quote.balanceOf(wallet.address),
        pool.baseBalanceOf(wallet.address),
        pool.quoteBalanceOf(wallet.address),
      ]);
      setBalances({ walletBase, walletQuote, venueBase, venueQuote });

      const events = await pool.queryFilter(pool.filters.BatchSettled(), 0, "latest");
      setSettlements(
        events
          .map((log) => {
            const args = (log as unknown as { args: [bigint, bigint, bigint, bigint] }).args;
            return {
              batchId: Number(args[0]),
              clearingPrice: args[1],
              matchedBase: args[2],
              fillCount: Number(args[3]),
            };
          })
          .filter((s) => s.fillCount > 0 || s.matchedBase > 0n)
          .reverse()
          .slice(0, 24)
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [wallet, venue]);

  useEffect(() => {
    if (!venue) return;
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [venue, refresh]);

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      try {
        await action();
        await refresh();
      } catch (err) {
        const e = err as { shortMessage?: string; message?: string };
        setError(e.shortMessage ?? e.message ?? String(err));
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const deposit = (isBase: boolean, human: string) =>
    run(isBase ? "deposit-base" : "deposit-quote", async () => {
      if (!venue || !wallet) return;
      const token = isBase ? venue.base : venue.quote;
      const amount = parseUnits(human, isBase ? venue.baseDecimals : venue.quoteDecimals);
      const allowance: bigint = await token.allowance(wallet.address, venue.pool);
      if (allowance < amount) {
        await (await token.approve(venue.pool, amount)).wait();
      }
      await (await venue.pool.deposit(isBase, amount)).wait();
    });

  const withdraw = (isBase: boolean, human: string) =>
    run(isBase ? "withdraw-base" : "withdraw-quote", async () => {
      if (!venue) return;
      const amount = parseUnits(human, isBase ? venue.baseDecimals : venue.quoteDecimals);
      await (await venue.pool.withdraw(isBase, amount)).wait();
    });

  const mintTestFunds = () =>
    run("mint", async () => {
      if (!venue || !wallet) return;
      await (
        await venue.base.mint(wallet.address, parseUnits("10000", venue.baseDecimals))
      ).wait();
      await (
        await venue.quote.mint(wallet.address, parseUnits("25000", venue.quoteDecimals))
      ).wait();
    });

  const closeBatch = () =>
    run("close", async () => {
      if (!venue) return;
      await (await venue.pool.closeBatch()).wait();
    });

  const submit = (side: "buy" | "sell", amount: string, limit: string) =>
    run("submit", async () => {
      if (!venue || !wallet || !status) return;
      const amountBase = parseUnits(amount, venue.baseDecimals);
      const limitPrice = parseUnits(limit, 18);
      const ciphertext = await sealOrder(
        {
          trader: wallet.address,
          batchId: status.batchId,
          side,
          amountBase: amountBase.toString(),
          limitPrice: limitPrice.toString(),
        },
        status.enclaveKey
      );
      await (await venue.pool.submitOrder(ciphertext)).wait();
      const record: LocalOrder = {
        batchId: status.batchId,
        side,
        amount,
        limit,
        ciphertext,
        at: Date.now(),
      };
      setOrders((prev) => {
        const next = [record, ...prev].slice(0, 20);
        localStorage.setItem(ORDERS_KEY, JSON.stringify(next));
        return next;
      });
    });

  const priceFmt = useMemo(
    () => (p: bigint) => Number(formatUnits(p, 18)).toFixed(4),
    []
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          STILLWATER
          <span className="tagline">sealed-order venue on flare</span>
        </div>
        <div className="topbar-right">
          {status?.referencePrice != null && venue && (
            <div className="ref-price">
              <span className="label">FTSO {venue.baseSymbol}/{venue.quoteSymbol}</span>
              <span className="mono">{priceFmt(status.referencePrice)}</span>
            </div>
          )}
          {wallet ? (
            <div className="wallet mono" title={wallet.address}>
              <span className="dot" />
              {shortAddress(wallet.address)} · chain {wallet.chainId.toString()}
            </div>
          ) : (
            <button className="btn primary" onClick={connect}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      {!wallet ? (
        <main className="empty-state">
          <h1>Trade size without making ripples.</h1>
          <p>
            Stillwater is a sealed-order batch venue for FXRP. Orders are encrypted to a
            key that exists only inside a trusted execution environment, cleared in
            uniform-price auctions, and settled onchain under FTSO price bounds.
          </p>
          <button className="btn primary large" onClick={connect}>
            Connect wallet to begin
          </button>
        </main>
      ) : (
        <main className="grid">
          <div className="col">
            <VenuePanel
              status={status}
              venue={venue}
              poolAddress={poolAddress}
              onPoolAddress={setPoolAddress}
              onCloseBatch={closeBatch}
              busy={busy}
            />
            <BalancesPanel
              venue={venue}
              balances={balances}
              busy={busy}
              onDeposit={deposit}
              onWithdraw={withdraw}
              onMint={mintTestFunds}
            />
          </div>
          <div className="col">
            <OrderTicket
              venue={venue}
              status={status}
              orders={orders}
              busy={busy}
              onSubmit={submit}
            />
          </div>
          <div className="col">
            <SettlementsTable settlements={settlements} venue={venue} />
          </div>
        </main>
      )}

      {error && <div className="toast error">{error}</div>}
    </div>
  );
}
