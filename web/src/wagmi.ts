import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { http } from "wagmi";
import { flareTestnet, hardhat } from "viem/chains";
import { chains } from "./lib/network";

const projectId = (import.meta.env.VITE_WC_PROJECT_ID as string | undefined)?.trim();

const wallets = projectId
  ? [injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet]
  : [injectedWallet, metaMaskWallet];

export const config = getDefaultConfig({
  appName: "Flareblind",
  projectId: projectId ?? "",
  wallets: [{ groupName: "Wallets", wallets }],
  chains,
  transports: {
    [flareTestnet.id]: http(flareTestnet.rpcUrls.default.http[0], { batch: true }),
    [hardhat.id]: http(hardhat.rpcUrls.default.http[0], { batch: true }),
  },
  ssr: false,
});

export { flareTestnet };
