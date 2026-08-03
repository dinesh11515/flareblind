import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { formatUnits } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { BrandMark } from "./components/BrandMark";
import { Landing } from "./components/Landing";
import { WalletButton } from "./components/WalletButton";
import { usePoolTokens } from "./hooks/usePoolTokens";
import { useVenueStatus } from "./hooks/useVenueStatus";
import { COSTON2_ID, isCoston2 } from "./lib/network";
import { usePoolAddress } from "./lib/pool";
import { formatAppError } from "./lib/errors";
import { Swap } from "./pages/Swap";
import { flareTestnet } from "./wagmi";

export default function App() {
  const navigate = useNavigate();
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { poolAddress, pool, setPoolAddress, poolError, clearPoolError } =
    usePoolAddress();
  const { data: tokens } = usePoolTokens(pool);
  const { data: status } = useVenueStatus(pool);
  const [pendingEnter, setPendingEnter] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingEnter && isConnected) {
      setPendingEnter(false);
      navigate("/swap");
    }
  }, [pendingEnter, isConnected, navigate]);

  useEffect(() => {
    if (poolError) setError(poolError);
  }, [poolError]);

  const enterVenue = () => {
    clearPoolError();
    if (isConnected) {
      navigate("/swap");
      return;
    }
    setPendingEnter(true);
    openConnectModal?.();
  };

  const wrongNetwork = isConnected && !isCoston2(chainId);

  const switchNetwork = async () => {
    setError(null);
    try {
      await switchChainAsync({ chainId: COSTON2_ID });
    } catch (err) {
      setError(formatAppError(err));
    }
  };

  const priceFmt = useMemo(
    () => (p: bigint) => Number(formatUnits(p, 18)).toFixed(4),
    [],
  );

  const toastError = error;

  return (
    <div className="app">
      <div className="ambient" aria-hidden="true">
        <div className="ambient-wave ambient-wave-a" />
        <div className="ambient-wave ambient-wave-b" />
      </div>

      {wrongNetwork && (
        <div className="network-banner" role="status">
          <span>
            Switch to <strong>{flareTestnet.name}</strong> to trade on the
            deployed venue.
          </span>
          <button
            className="btn primary sm"
            disabled={switching}
            onClick={switchNetwork}
          >
            {switching ? "Switching…" : "Switch network"}
          </button>
        </div>
      )}

      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <BrandMark size={38} />
            <div className="brand-text">
              <span className="brand-name">Flareblind</span>
              <span className="tagline">Size-blind FXRP auctions on Flare</span>
            </div>
          </Link>
          <div className="topbar-right">
            {status?.referencePrice != null && tokens && (
              <div className="chip ref-price">
                <span className="label">FTSO</span>
                <span className="mono">
                  {priceFmt(status.referencePrice)} {tokens.quoteSymbol}
                </span>
              </div>
            )}
            <WalletButton />
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Landing onEnter={enterVenue} />} />
        <Route
          path="/swap"
          element={
            <Swap
              address={address}
              poolAddress={poolAddress}
              pool={pool}
              onPoolAddress={setPoolAddress}
              onConnect={() => openConnectModal?.()}
              onError={setError}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {toastError && (
        <div className="toast error" role="alert">
          <span>{toastError}</span>
          <button
            className="toast-dismiss"
            onClick={() => {
              setError(null);
              clearPoolError();
            }}
            aria-label="Dismiss error"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
