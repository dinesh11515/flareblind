import { type ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import {
  RainbowKitProvider,
  lightTheme,
  type Theme,
} from "@rainbow-me/rainbowkit";
import { config } from "./wagmi";
import "@rainbow-me/rainbowkit/styles.css";

const theme: Theme = {
  ...lightTheme({
    accentColor: "#c67139",
    accentColorForeground: "#fffaf2",
    borderRadius: "medium",
    fontStack: "system",
    overlayBlur: "small",
  }),
  colors: {
    ...lightTheme().colors,
    accentColor: "#c67139",
    accentColorForeground: "#fffaf2",
    connectButtonBackground: "#fffaf2",
    connectButtonInnerBackground: "#f5ead8",
    modalBackground: "#fffaf2",
    modalBorder: "rgba(40, 34, 28, 0.12)",
    profileForeground: "#f5ead8",
  },
};

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
