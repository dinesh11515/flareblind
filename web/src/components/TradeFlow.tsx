import type { Balances, PoolTokens, VenueStatus } from "../types";
import { Phase } from "../abi/pool";

export function TradeFlow(props: {
  tokens: PoolTokens | undefined;
  balances: Balances | null;
  status: VenueStatus | null;
  hasOrders: boolean;
}) {
  const { tokens, balances, status, hasOrders } = props;

  const funded =
    balances !== null && (balances.venueBase > 0n || balances.venueQuote > 0n);
  const open = status?.phase === Phase.Open;
  const sealing = status?.phase === Phase.Sealing;
  const pair = tokens
    ? `${tokens.baseSymbol} or ${tokens.quoteSymbol}`
    : "the venue tokens";

  const steps = [
    {
      id: 1,
      title: "Fund the venue",
      body: `Deposit ${pair} so the enclave can fill you.`,
      done: funded,
      active: !funded,
    },
    {
      id: 2,
      title: "Seal an order",
      body: "Encrypt size + limit in-browser. Only ciphertext hits the chain.",
      done: hasOrders || (!open && funded),
      active: funded && open && !hasOrders,
    },
    {
      id: 3,
      title: "Wait for clearing",
      body: "When the window ends, one uniform price settles everyone who crosses.",
      done: false,
      active: sealing || (funded && hasOrders && open),
    },
  ];

  return (
    <nav id="how" className="trade-flow" aria-label="How a Flareblind trade works">
      {steps.map((step, i) => (
        <div
          key={step.id}
          className={`flow-step ${step.done ? "done" : ""} ${step.active ? "active" : ""}`}
        >
          <div className="flow-index mono" aria-hidden="true">
            {step.done ? "✓" : step.id}
          </div>
          <div className="flow-copy">
            <strong>{step.title}</strong>
            <span>{step.body}</span>
          </div>
          {i < steps.length - 1 && <div className="flow-rail" aria-hidden="true" />}
        </div>
      ))}
    </nav>
  );
}
