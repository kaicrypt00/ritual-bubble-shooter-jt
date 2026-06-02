import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, type Address } from "viem";

import { sfx } from "@/game/audio";
import { CONTRACT_ABI, CONTRACT_ADDRESS } from "@/lib/contract";
import { ritualTestnet } from "@/lib/ritual-chain";

const RITUAL_CHAIN_ID = 1979;
const RITUAL_CHAIN_HEX = `0x${RITUAL_CHAIN_ID.toString(16)}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const publicClient = createPublicClient({
  chain: ritualTestnet,
  transport: http(ritualTestnet.rpcUrls.default.http[0]),
});

function shortAddr(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

function getEthereum() {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum;
}

async function getAccounts() {
  const eth = getEthereum();
  if (!eth) return [];
  return (await eth.request({ method: "eth_accounts" })) as Address[];
}

async function getChainId() {
  const eth = getEthereum();
  if (!eth) return undefined;
  const chainId = (await eth.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(chainId, 16);
}

async function addRitualChain() {
  const eth = getEthereum();
  if (!eth) return;
  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: RITUAL_CHAIN_HEX,
        chainName: "Ritual Testnet",
        nativeCurrency: { name: "Ritual", symbol: "RITUAL", decimals: 18 },
        rpcUrls: ["https://rpc.ritualfoundation.org"],
        blockExplorerUrls: ["https://explorer.ritualfoundation.org"],
      },
    ],
  });
}

async function switchToRitualChain() {
  const eth = getEthereum();
  if (!eth) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: RITUAL_CHAIN_HEX }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 4902 || code === -32603) {
      await addRitualChain();
      return;
    }
    throw error;
  }
}

function useWalletState() {
  const [address, setAddress] = useState<Address | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();

  const refresh = useCallback(async () => {
    const [accounts, nextChainId] = await Promise.all([getAccounts(), getChainId()]);
    setAddress(accounts[0]);
    setChainId(nextChainId);
  }, []);

  useEffect(() => {
    void refresh();
    const eth = getEthereum();
    if (!eth?.on) return;
    const onAccountsChanged = (accounts: unknown) => setAddress((accounts as Address[])[0]);
    const onChainChanged = (nextChainId: unknown) => setChainId(Number.parseInt(nextChainId as string, 16));
    eth.on("accountsChanged", onAccountsChanged);
    eth.on("chainChanged", onChainChanged);
    return () => {
      eth.removeListener?.("accountsChanged", onAccountsChanged);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, [refresh]);

  return { address, chainId, refresh };
}

export function WalletAddressSync({ onAddressChange }: { onAddressChange: (address: string) => void }) {
  const { address } = useWalletState();

  useEffect(() => {
    onAddressChange(address ?? "");
  }, [address, onAddressChange]);

  return null;
}

export function ConnectWalletPanel({
  onReady,
  onSkip,
  manageMode = false,
}: {
  onReady: () => void;
  onSkip: () => void;
  manageMode?: boolean;
}) {
  const { address, chainId, refresh } = useWalletState();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const isConnected = Boolean(address);

  const handleSwitch = async () => {
    setSwitching(true);
    setSwitchError(null);
    try {
      await switchToRitualChain();
      await refresh();
    } catch (e) {
      console.error("switchToRitualChain failed", e);
      setSwitchError(e instanceof Error ? e.message : "Unable to switch network");
    } finally {
      setSwitching(false);
    }
  };

  const handleConnect = async () => {
    const eth = getEthereum();
    if (!eth) {
      setSwitchError("No browser wallet found. Install MetaMask or another injected wallet.");
      return;
    }
    setSwitching(true);
    setSwitchError(null);
    try {
      await eth.request({ method: "eth_requestAccounts" });
      await switchToRitualChain();
      await refresh();
    } catch (e) {
      console.error("wallet connect failed", e);
      setSwitchError(e instanceof Error ? e.message : "Wallet request was rejected");
      await refresh();
    } finally {
      setSwitching(false);
    }
  };

  useEffect(() => {
    if (manageMode) return;
    if (isConnected && chainId === RITUAL_CHAIN_ID) {
      const t = setTimeout(onReady, 500);
      return () => clearTimeout(t);
    }
  }, [isConnected, chainId, onReady, manageMode]);

  const wrongNetwork = isConnected && chainId !== RITUAL_CHAIN_ID;

  return (
    <div className="terminal-panel max-w-md">
      <div className="scanline" />
      <div className="text-center">
        <h1
          className="orbitron font-bold tracking-[3px] text-[#BF00FF] text-xl sm:text-2xl"
          style={{ textShadow: "0 0 10px #BF00FF, 0 0 20px #BF00FF" }}
        >
          {manageMode ? "MANAGE WALLET" : "CONNECT WALLET"}
        </h1>
        <p className="text-[12px] opacity-70 mt-3 text-[#BF00FF]">
          {manageMode
            ? "Click your wallet above to disconnect or switch accounts."
            : "Link your wallet to submit scores on the Ritual chain."}
        </p>
      </div>

      <div className="glow-line" />

      <div className="flex justify-center my-4">
        <button
          onClick={isConnected ? handleSwitch : handleConnect}
          disabled={switching}
          className="px-5 py-2 rounded border border-[#BF00FF] text-[#BF00FF] font-mono uppercase tracking-widest text-xs hover:bg-[rgba(191,0,255,0.1)] hover:shadow-[0_0_15px_#BF00FF] transition disabled:opacity-50"
        >
          {switching ? "Wallet request…" : address ? `⬡ ${shortAddr(address)}` : "Connect Wallet"}
        </button>
      </div>

      {wrongNetwork && (
        <div className="mt-2 text-center">
          <div className="text-[#ff5577] font-mono text-[12px] mb-3 uppercase tracking-widest">
            ⚠ Wrong network detected
          </div>
          <button
            onClick={handleSwitch}
            disabled={switching}
            className="px-5 py-2 rounded border border-[#ff5577] text-[#ff5577] font-mono uppercase tracking-widest text-xs hover:bg-[rgba(255,85,119,0.1)] hover:shadow-[0_0_15px_#ff5577] transition disabled:opacity-50"
          >
            {switching ? "Switching…" : "Switch to Ritual"}
          </button>
          {switchError && (
            <div className="text-[#ff5577] font-mono text-[10px] mt-2 opacity-80">
              {switchError.slice(0, 120)}
            </div>
          )}
        </div>
      )}

      {!wrongNetwork && switchError && (
        <div className="text-[#ff5577] font-mono text-[10px] mt-2 text-center opacity-80">
          {switchError.slice(0, 120)}
        </div>
      )}

      {isConnected && chainId === RITUAL_CHAIN_ID && !manageMode && (
        <div className="mt-3 text-center text-[#BF00FF] font-mono text-[12px] uppercase tracking-widest">
          ✓ Connected to Ritual — entering…
        </div>
      )}

      {isConnected && chainId === RITUAL_CHAIN_ID && manageMode && (
        <div className="mt-3 text-center text-[#BF00FF] font-mono text-[12px] uppercase tracking-widest">
          ✓ Connected to Ritual
        </div>
      )}

      <div className="mt-6 text-center">
        <button
          onClick={onSkip}
          className="text-[11px] font-mono uppercase tracking-widest text-[#BF00FF]/50 hover:text-[#BF00FF] transition underline underline-offset-4"
        >
          {manageMode ? "← back to menu" : "skip for now — game works without wallet"}
        </button>
      </div>
    </div>
  );
}

type OnChainEntry = {
  wallet: string;
  username: string;
  score: bigint;
  shots: bigint;
  bursts: bigint;
};

export function OnChainLeaderboardPanel({ highlightAddr }: { highlightAddr: string }) {
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getLeaderboard",
    chainId: RITUAL_CHAIN_ID,
  });

  useEffect(() => {
    const t = setTimeout(() => refetch(), 1500);
    return () => clearTimeout(t);
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="text-center font-mono text-xs text-[#BF00FF]/60 py-4">
        loading on-chain leaderboard…
      </div>
    );
  }

  const tuple = data as readonly [readonly OnChainEntry[], number] | undefined;
  if (!tuple) {
    return (
      <div className="text-center font-mono text-xs text-[#BF00FF]/60 py-4">
        on-chain leaderboard unavailable
      </div>
    );
  }

  const [entries, count] = tuple;
  const list = (entries as OnChainEntry[]).slice(0, count).filter((e) => e && e.wallet && e.wallet !== "0x0000000000000000000000000000000000000000");
  const lowerHighlight = highlightAddr.toLowerCase();

  return (
    <div className="w-full mt-3">
      <div className="text-center font-mono text-[10px] uppercase tracking-[0.3em] text-[#BF00FF]/80 mb-2">
        ⬡ ON-CHAIN LEADERBOARD ⬡
      </div>
      <div className="border border-[#BF00FF]/30 rounded overflow-hidden bg-black/40">
        <table className="w-full font-mono text-xs">
          <thead className="bg-[rgba(191,0,255,0.08)] text-[#BF00FF]/80">
            <tr>
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">USER</th>
              <th className="px-2 py-1.5 text-right">SCORE</th>
              <th className="px-2 py-1.5 text-right">WALLET</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={4} className="px-2 py-3 text-center text-[#BF00FF]/50">no entries yet</td></tr>
            )}
            {list.map((e, i) => {
              const isMe = e.wallet.toLowerCase() === lowerHighlight;
              return (
                <tr
                  key={`${e.wallet}-${i}`}
                  className={isMe ? "bg-[rgba(191,0,255,0.15)] text-[#BF00FF]" : "text-[#BF00FF]/80"}
                  style={isMe ? { textShadow: "0 0 8px #BF00FF" } : undefined}
                >
                  <td className="px-2 py-1.5">{i + 1}</td>
                  <td className="px-2 py-1.5 truncate max-w-[120px]">{e.username}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.score.toString()}</td>
                  <td className="px-2 py-1.5 text-right">{shortAddr(e.wallet)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ChainSubmitSection({
  walletAddress,
  username,
  score,
  shots,
  bursts,
  onLeaderboardVisibleChange,
}: {
  walletAddress: string;
  username: string;
  score: number;
  shots: number;
  bursts: number;
  onLeaderboardVisibleChange: (visible: boolean) => void;
}) {
  const { writeContract, isPending, isSuccess, isError, reset } = useWriteContract();
  const [submittedOnce, setSubmittedOnce] = useState(false);

  const onSubmitChain = () => {
    if (!walletAddress) return;
    sfx.click();
    setSubmittedOnce(true);
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "submitGame",
      args: [username, BigInt(score), BigInt(shots), BigInt(bursts)],
      chainId: RITUAL_CHAIN_ID,
    });
  };

  let btnLabel = "⬡ SUBMIT TO RITUAL";
  let btnDisabled = false;
  if (isPending) { btnLabel = "SUBMITTING..."; btnDisabled = true; }
  else if (isSuccess) { btnLabel = "✓ SUBMITTED ON-CHAIN"; btnDisabled = true; }
  else if (isError) { btnLabel = "NOT SUBMITTED — TRY AGAIN"; }

  useEffect(() => {
    onLeaderboardVisibleChange(isSuccess || submittedOnce);
  }, [isSuccess, submittedOnce, onLeaderboardVisibleChange]);

  useEffect(() => () => reset(), [reset]);

  return (
    <>
      <div className="mt-5">
        {walletAddress ? (
          <button
            onClick={onSubmitChain}
            disabled={btnDisabled}
            className="w-full py-3 rounded border border-[#BF00FF] text-[#BF00FF] font-mono uppercase tracking-widest text-sm hover:bg-[rgba(191,0,255,0.15)] hover:shadow-[0_0_20px_#BF00FF] transition disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ textShadow: "0 0 8px #BF00FF" }}
          >
            {btnLabel}
          </button>
        ) : (
          <div className="font-mono text-xs text-[#BF00FF]/60 uppercase tracking-widest py-2">
            Connect wallet to submit score
          </div>
        )}
      </div>
    </>
  );
}