import { formatUnits } from "ethers";
import type { VenueHandles } from "../lib/venue";
import type { Settlement } from "../App";

export function SettlementsTable(props: {
  settlements: Settlement[];
  venue: VenueHandles | null;
}) {
  const { settlements, venue } = props;

  return (
    <section className="panel">
      <h2>Settlements</h2>
      {!venue || settlements.length === 0 ? (
        <p className="note">
          No crossed batches yet. Settled batches appear here with their uniform clearing
          price.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Clearing</th>
              <th>Matched</th>
              <th>Fills</th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((s) => (
              <tr key={s.batchId}>
                <td className="mono">#{s.batchId}</td>
                <td className="mono">{Number(formatUnits(s.clearingPrice, 18)).toFixed(4)}</td>
                <td className="mono">
                  {Number(formatUnits(s.matchedBase, venue.baseDecimals)).toLocaleString()}{" "}
                  {venue.baseSymbol}
                </td>
                <td className="mono">{s.fillCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>How it works</h3>
      <ol className="steps">
        <li>Fund a venue balance and seal an order to the enclave key in your browser.</li>
        <li>
          The batch window closes; the enclave decrypts orders, drops anything unfunded,
          and computes one uniform clearing price maximizing matched volume.
        </li>
        <li>
          The contract verifies the enclave signature, exact volume conservation, and the
          FTSO price band, then moves balances atomically.
        </li>
      </ol>
    </section>
  );
}
