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
import { useAccount } from "wagmi";
import { useEffect } from "react";

export function Swap(props: {
  address: Address | undefined;
  poolAddress: string;
  pool: Address | undefined;
  onPoolAddress: (a: string) => void;
  onConnect: () => void;
  onError: (msg: string | null) => void;
}) {
  const { address, poolAddress, pool, onPoolAddress, onConnect, onError } =
    props;
  const { chainId } = useAccount();
  const { data: tokens } = usePoolTokens(pool);
  const { data: status } = useVenueStatus(pool);
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
      <main className="shell swap-gate">
        <section className="panel panel-focus">
          <h2>Swap</h2>
          <p className="panel-sub">
            Connect a wallet on Coston2 to fund the venue and seal an order.
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
        balances={balances ?? null}
        status={status ?? null}
        hasOrders={activeBatchOrders.length > 0}
      />

      <BatchStatusBar
        status={status ?? null}
        tokens={tokens}
        busy={writes.busy}
        onCloseBatch={writes.closeBatch}
      />

      <div className="trader">
        <aside className="trader-side">
          <BalancesPanel
            tokens={tokens}
            balances={balances ?? null}
            busy={writes.busy}
            liveNetwork={isCoston2(chainId)}
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
            orders={writes.orders}
            busy={writes.busy}
            trader={address}
            onSubmit={writes.submit}
          />
          <SettlementsTable
            settlements={settlements}
            tokens={tokens}
            referencePrice={status?.referencePrice ?? null}
            maxDeviationBps={status?.maxDeviationBps ?? 200n}
          />
        </div>
      </div>
    </main>
  );
}
