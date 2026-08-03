import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { flareTestnet } from "viem/chains";

const projectId =
  (import.meta.env.VITE_WC_PROJECT_ID as string | undefined)?.trim() ||
  "00000000000000000000000000000000";

export const config = getDefaultConfig({
  appName: "Flareblind",
  projectId,
  chains: [flareTestnet],
  transports: {
    [flareTestnet.id]: http(flareTestnet.rpcUrls.default.http[0]),
  },
  ssr: false,
});

export { flareTestnet };
