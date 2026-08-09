import { useEffect } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { VenuePanel } from "../components/VenuePanel";
import { BalancesPanel } from "../components/BalancesPanel";
import { OrderTicket } from "../components/OrderTicket";
import { SettlementsTable } from "../components/SettlementsTable";
import { BatchStatusBar } from "../components/BatchStatusBar";
import { TradeFlow } from "../components/TradeFlow";
import { useBalances } from "../hooks/useBalances";
import { usePoolTokens } from "../hooks/usePoolTokens";
import { useSettlements } from "../hooks/useSettlements";
import { useVenueStatus } from "../hooks/useVenueStatus";
import { useVenueWrites } from "../hooks/useVenueWrites";
import { isCoston2 } from "../lib/network";

export function Venue(props: {
  address: Address | undefined;
  poolAddress: string;
  pool: Address | undefined;
  onPoolAddress: (a: string) => void;
  onConnect: () => void;
  onError: (msg: string | null) => void;
}) {
  const { address, poolAddress, pool, onPoolAddress, onConnect, onError } = props;
  const { chainId } = useAccount();
  const { data: tokens, isError: tokensFailed } = usePoolTokens(pool);
  const { data: status, isError: statusFailed } = useVenueStatus(pool);
  const { data: balances } = useBalances(pool, tokens, address);
  const { data: settlements = [] } = useSettlements(pool);
  const writes = useVenueWrites({ pool, tokens, status });

  useEffect(() => {
    onError(writes.error);
  }, [writes.error, onError]);

  const activeBatchOrders = writes.orders.filter(
    (o) => o.batchId === status?.batchId,
  );

  if (!address) {
    return (
      <main className="shell venue-gate">
        <section className="panel panel-focus">
          <h2>Enter the venue</h2>
          <p className="panel-sub">
            Connect a wallet to fund the venue and seal an order.
          </p>
          <button className="btn primary large" onClick={onConnect}>
            Connect wallet
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <TradeFlow
        tokens={tokens}
        balances={balances ?? null}
        status={status ?? null}
        hasOrders={activeBatchOrders.length > 0}
      />

      <BatchStatusBar
        status={status ?? null}
        tokens={tokens}
        unreachable={tokensFailed || statusFailed}
        busy={writes.busy}
        onCloseBatch={writes.closeBatch}
      />

      <div className="trader">
        <aside className="trader-side">
          <BalancesPanel
            tokens={tokens}
            balances={balances ?? null}
            busy={writes.busy}
            mintable={!isCoston2(chainId)}
            onDeposit={writes.deposit}
            onWithdraw={writes.withdraw}
            onMint={writes.mintTestFunds}
          />
          <VenuePanel
            status={status ?? null}
            tokens={tokens}
            poolAddress={poolAddress}
            onPoolAddress={onPoolAddress}
          />
        </aside>
        <div className="trader-main">
          <OrderTicket
            tokens={tokens}
            status={status ?? null}
            balances={balances ?? null}
            orders={writes.orders}
            busy={writes.busy}
            trader={address}
            onSubmit={writes.submit}
          />
          <SettlementsTable
            settlements={settlements}
            tokens={tokens}
            referencePrice={status?.referencePrice ?? null}
            maxDeviationBps={status?.maxDeviationBps ?? 0n}
          />
        </div>
      </div>
    </main>
  );
}
