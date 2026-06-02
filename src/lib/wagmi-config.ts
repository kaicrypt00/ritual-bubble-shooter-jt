import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
  coinbaseWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { ritualTestnet } from "./ritual-chain";

// Public demo WalletConnect Cloud projectId. Replace with your own from
// https://cloud.walletconnect.com if you want analytics. Must be a real
// projectId or MetaMask "Opening..." spinner hangs forever.
const WC_PROJECT_ID = "3fcc6bba6f1de962d911bb5b5c3dba68";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      // injectedWallet first → directly opens the installed MetaMask
      // extension via window.ethereum without going through WalletConnect.
      wallets: [
        injectedWallet,
        metaMaskWallet,
        rainbowWallet,
        coinbaseWallet,
        walletConnectWallet,
      ],
    },
  ],
  {
    appName: "Ritual Bubble Shooter",
    projectId: WC_PROJECT_ID,
  },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [ritualTestnet],
  transports: {
    [ritualTestnet.id]: http(),
  },
  ssr: true,
});
