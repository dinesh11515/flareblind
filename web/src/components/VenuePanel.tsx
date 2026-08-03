import { useState } from "react";
import { defaultPoolAddress } from "../lib/network";
import { shortHex } from "../lib/format";
import type { PoolTokens, VenueStatus } from "../types";

export function VenuePanel(props: {
  status: VenueStatus | null;
  tokens: PoolTokens | undefined;
  poolAddress: string;
  onPoolAddress: (a: string) => void;
}) {
  const { status, tokens, poolAddress, onPoolAddress } = props;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const deployed = defaultPoolAddress();
  const offDeployed =
    deployed.length > 0 &&
    poolAddress.toLowerCase() !== deployed.toLowerCase();

  return (
    <section className="panel panel-compact">
      <div className="panel-head">
        <div>
          <h2>Market</h2>
          <p className="panel-sub">
            {tokens
              ? `${tokens.baseSymbol} / ${tokens.quoteSymbol} sealed-order auction`
              : "Connect a pool to trade"}
          </p>
        </div>
        {tokens && (
          <span className="pair mono">
            {tokens.baseSymbol}/{tokens.quoteSymbol}
          </span>
        )}
      </div>

      <label className="field">
        <span>Pool contract</span>
        <input
          className="mono"
          value={poolAddress}
          spellCheck={false}
          placeholder="0x…"
          onChange={(e) => onPoolAddress(e.target.value.trim())}
        />
      </label>
      {offDeployed && (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => onPoolAddress(deployed)}
        >
          Reset to deployed Coston2 pool
        </button>
      )}

      {status && (
        <>
          <button
            type="button"
            className="advanced-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <span>{showAdvanced ? "Hide" : "Show"} TEE / enclave details</span>
            <span className="mono" aria-hidden="true">
              {showAdvanced ? "−" : "+"}
            </span>
          </button>

          {showAdvanced && (
            <div className="advanced-block">
              <div className="rows">
                <div className="row">
                  <span className="label">Sealing key</span>
                  <span className="mono" title={status.enclaveKey}>
                    {shortHex(status.enclaveKey, 8)}
                  </span>
                </div>
                <div className="row">
                  <span className="label">Settlement signer</span>
                  <span className="mono" title={status.teeSigner}>
                    {shortHex(status.teeSigner, 8)}
                  </span>
                </div>
                <div className="row">
                  <span className="label">Attestation</span>
                  <span className="mono" title={status.attestationDigest}>
                    {shortHex(status.attestationDigest, 8)}
                  </span>
                </div>
              </div>
              <p className="note">
                Orders encrypt to the sealing key in your browser. The contract
                only accepts settlements signed by this attested enclave, within
                the FTSO band.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
