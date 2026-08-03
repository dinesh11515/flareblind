import { ConnectButton } from "@rainbow-me/rainbowkit";
import { chainLabel } from "../lib/network";
import { shortAddress } from "../lib/format";

export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        const ready = mounted;
        if (!ready) {
          return (
            <button className="btn primary" type="button" disabled>
              Connect wallet
            </button>
          );
        }

        if (!account) {
          return (
            <button className="btn primary" type="button" onClick={openConnectModal}>
              Connect wallet
            </button>
          );
        }

        if (chain?.unsupported) {
          return (
            <button className="btn primary" type="button" onClick={openChainModal}>
              Wrong network
            </button>
          );
        }

        return (
          <button
            className="chip wallet mono"
            type="button"
            title={account.address}
            onClick={openAccountModal}
          >
            <span className="dot" />
            {shortAddress(account.address)} · {chainLabel(chain?.id)}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
