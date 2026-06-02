import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import { GameCanvas } from "@/components/game/GameCanvas";
import { Leaderboard } from "@/components/game/Leaderboard";

import {
  issueGameToken,
  submitScoreSecure,
  reserveUsernameSecure,
} from "@/lib/leaderboard.functions";
import { sfx, unlockAudio, TRACKS, type TrackId, getCurrentTrack, setTrack } from "@/game/audio";
import { preloadGameAssets } from "@/game/preload";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSwitchChain, useWriteContract, useReadContract } from "wagmi";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contract";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "RITUAL BUBBLE SHOOTER — Pop. Match. Ritualize." },
      {
        name: "description",
        content:
          "A neon hacker bubble shooter. Match colors, drop orphans, and climb the global Top 20 leaderboard.",
      },
      { property: "og:title", content: "RITUAL BUBBLE SHOOTER" },
      {
        property: "og:description",
        content: "Neon hacker bubble shooter with a global Top 20 leaderboard.",
      },
    ],
  }),
  component: Index,
});

type Phase = "home" | "connect-wallet" | "menu" | "leaderboard" | "play" | "over";

const RITUAL_CHAIN_ID = 1979;
const USERNAME_STORAGE_KEY = "ritual_bubble_username";
const USERNAME_REGISTRY_KEY = "ritual_bubble_username_registry";

function getLocalRegistry(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(USERNAME_REGISTRY_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function addToLocalRegistry(name: string) {
  if (typeof window === "undefined") return;
  const existing = getLocalRegistry();
  const lower = name.toLowerCase();
  if (!existing.some((n) => n.toLowerCase() === lower)) {
    existing.push(name);
    localStorage.setItem(USERNAME_REGISTRY_KEY, JSON.stringify(existing));
  }
}

function isNameTakenLocally(name: string): boolean {
  const lower = name.toLowerCase();
  return getLocalRegistry().some((n) => n.toLowerCase() === lower);
}

async function submitScore(
  username: string,
  score: number,
  token: string,
): Promise<number | null> {
  try {
    const res = await submitScoreSecure({
      data: { username, score, token },
    });
    if (!res.ok) return null;
    return res.rank ?? null;
  } catch {
    return null;
  }
}

function shortAddr(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function Index() {
  useEffect(() => {
    // Warm the asset cache the moment the home/menu mounts.
    void preloadGameAssets();
  }, []);
  const [phase, setPhase] = useState<Phase>("home");
  const [username, setUsername] = useState("");
  const [finalScore, setFinalScore] = useState(0);
  const [rank, setRank] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [gameKey, setGameKey] = useState(0);
  const [usernameLocked, setUsernameLocked] = useState(false);
  const [gameToken, setGameToken] = useState<string | null>(null);

  const { address } = useAccount();
  const [walletAddress, setWalletAddress] = useState("");
  const [walletManageMode, setWalletManageMode] = useState(false);
  const [localShots, setLocalShots] = useState(0);
  const [localBursts, setLocalBursts] = useState(0);
  const txCount = localShots + localBursts;

  useEffect(() => {
    if (address) setWalletAddress(address);
    else setWalletAddress("");
  }, [address]);

  // Restore locked username from previous session
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(USERNAME_STORAGE_KEY);
    if (saved) {
      setUsername(saved);
      setUsernameLocked(true);
      setPhase("connect-wallet");
    }
  }, []);

  const onUsernameAccepted = useCallback((name: string) => {
    sfx.click();
    setUsername(name);
    setUsernameLocked(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(USERNAME_STORAGE_KEY, name);
      addToLocalRegistry(name);
    }
    setPhase("connect-wallet");
  }, []);

  const startGame = useCallback(() => {
    unlockAudio();
    sfx.click();
    setLocalShots(0);
    setLocalBursts(0);
    setGameToken(null);
    setGameKey((k) => k + 1);
    setPhase("play");
    // Fetch token in the background — game starts immediately, score
    // submission just waits on this if it lands late.
    issueGameToken({ data: { username: username.trim() } })
      .then((res) => setGameToken(res.token))
      .catch(() => setGameToken(null));
  }, [username]);

  const handleGameOver = useCallback(
    async (score: number) => {
      setFinalScore(score);
      setSubmitting(true);
      setRank(null);
      setPhase("over");
      if (!gameToken) {
        setSubmitting(false);
        return;
      }
      const r = await submitScore(username.trim(), score, gameToken);
      setRank(r);
      setSubmitting(false);
    },
    [username, gameToken],
  );

  const handleRestart = useCallback(() => {
    setLocalShots(0);
    setLocalBursts(0);
    setGameToken(null);
    setGameKey((k) => k + 1);
    setPhase("play");
    issueGameToken({ data: { username: username.trim() } })
      .then((res) => setGameToken(res.token))
      .catch(() => setGameToken(null));
  }, [username]);

  const handleHome = useCallback(() => {
    setPhase("menu");
  }, []);

  // Fullscreen game phase
  if (phase === "play") {
    return (
      <main className="fixed inset-0 w-screen h-[100dvh] overflow-hidden bg-[#0a0f0a]">
        <div aria-hidden className="play-area-bg" />
        <div aria-hidden className="play-area-grid" />
        <div aria-hidden className="core-glow" />
        <FloatingOrbs count={18} />
        <GameCanvas
          key={gameKey}
          onGameOver={handleGameOver}
          onRestart={handleRestart}
          onHome={handleHome}
          walletAddress={walletAddress}
          txCount={txCount}
          onShot={() => setLocalShots((s) => s + 1)}
          onBurst={() => setLocalBursts((b) => b + 1)}
        />
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] w-full flex flex-col items-center justify-center px-3 py-4 relative overflow-hidden">
      <div aria-hidden className="grid-bg" />
      <FloatingOrbs count={12} />

      {phase === "home" && <HomeScreen onAccepted={onUsernameAccepted} />}

      {phase === "connect-wallet" && (
        <ConnectWalletScreen
          manageMode={walletManageMode}
          onReady={() => { setWalletManageMode(false); setPhase("menu"); }}
          onSkip={() => { setWalletManageMode(false); setPhase("menu"); }}
        />
      )}

      {phase === "menu" && (
        <MenuScreen
          username={username}
          walletAddress={walletAddress}
          onPlay={startGame}
          onLeaderboard={() => { sfx.click(); setPhase("leaderboard"); }}
          onConnect={() => { sfx.click(); setWalletManageMode(true); setPhase("connect-wallet"); }}
        />
      )}

      {phase === "leaderboard" && (
        <LeaderboardScreen
          username={username}
          onBack={() => { sfx.click(); setPhase("menu"); }}
        />
      )}

      {phase === "over" && (
        <GameOverScreen
          score={finalScore}
          rank={rank}
          username={username}
          submitting={submitting}
          walletAddress={walletAddress}
          shots={localShots}
          bursts={localBursts}
          onPlayAgain={() => { sfx.click(); handleRestart(); }}
          onHome={() => { sfx.click(); setPhase("menu"); }}
        />
      )}
    </main>
  );
}

function FloatingOrbs({ count = 12 }: { count?: number }) {
  const orbs = Array.from({ length: count }, (_, i) => {
    const left = (i * 97) % 100;
    const dur = 8 + ((i * 13) % 10);
    const delay = (i * 1.7) % 10;
    const size = 10 + ((i * 7) % 18);
    return (
      <span
        key={i}
        className="orb"
        style={{
          left: `${left}%`,
          width: `${size}px`,
          height: `${size}px`,
          animationDuration: `${dur}s`,
          animationDelay: `-${delay}s`,
        }}
      />
    );
  });
  return <div className="orbs" aria-hidden>{orbs}</div>;
}

function HomeScreen({ onAccepted }: { onAccepted: (name: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const name = value.trim();
    if (!name) return;
    if (name.length < 3) {
      setError("must be at least 3 characters");
      return;
    }
    if (isNameTakenLocally(name)) {
      setError("Name already exists! Please choose a unique name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await reserveUsernameSecure({ data: { username: name } });
      if (!res.ok) {
        if (res.reason === "taken") {
          setError("Name already exists! Please choose a unique name.");
          return;
        }
        onAccepted(name);
        return;
      }
      onAccepted(name);
    } catch {
      onAccepted(name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-overlay">
      <div className="login-box">
        <h2
          className="orbitron font-bold text-[#BF00FF] text-xl sm:text-2xl"
          style={{ textShadow: "0 0 10px #BF00FF" }}
        >
          ARE YOU RITUALIZED?
        </h2>
        <p className="text-[12px] opacity-70 mt-2 mb-5 text-[#BF00FF]">
          Choose your Ritualized name. This is permanent — once claimed, it cannot be changed.
        </p>
        <input
          className="input-neon w-full px-3 py-2.5 rounded text-base mb-2"
          placeholder="username"
          maxLength={20}
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/[^\w\d_\-.]/g, ""));
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) submit();
          }}
          autoFocus
          disabled={busy}
        />
        {error && (
          <div className="text-[#ff5577] text-[12px] font-mono mb-2 text-left">
            ⚠ {error}
          </div>
        )}
        <button
          onClick={submit}
          disabled={!value.trim() || busy}
          className="w-full py-2.5 mt-2 rounded border border-[#BF00FF] text-[#BF00FF] bg-transparent font-mono uppercase tracking-widest text-sm hover:bg-[rgba(191,0,255,0.1)] hover:shadow-[0_0_15px_#BF00FF] transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busy ? "CLAIMING…" : "CLAIM & ENTER"}
        </button>
      </div>
    </div>
  );
}

function ConnectWalletScreen({ onReady, onSkip, manageMode = false }: { onReady: () => void; onSkip: () => void; manageMode?: boolean }) {
  const { isConnected, chain } = useAccount();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();

  const handleSwitch = async () => {
    try {
      switchChain({ chainId: RITUAL_CHAIN_ID });
    } catch (e) {
      console.error("switchChain failed", e);
    }
    // Fallback: directly ask the wallet to add the chain (works when wagmi cannot)
    setTimeout(async () => {
      const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!eth) return;
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x" + RITUAL_CHAIN_ID.toString(16),
            chainName: "Ritual Testnet",
            nativeCurrency: { name: "Ritual", symbol: "RITUAL", decimals: 18 },
            rpcUrls: ["https://rpc.ritualfoundation.org"],
            blockExplorerUrls: ["https://explorer.ritualfoundation.org"],
          }],
        });
      } catch (e) {
        console.error("wallet_addEthereumChain failed", e);
      }
    }, 300);
  };

  useEffect(() => {
    if (manageMode) return; // don't auto-advance when user is managing/changing wallet
    if (isConnected && chain?.id === RITUAL_CHAIN_ID) {
      const t = setTimeout(onReady, 500);
      return () => clearTimeout(t);
    }
  }, [isConnected, chain?.id, onReady, manageMode]);

  const wrongNetwork = isConnected && chain?.id !== RITUAL_CHAIN_ID;

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
        <ConnectButton showBalance={false} chainStatus="icon" />
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
              {switchError.message.slice(0, 120)}
            </div>
          )}
        </div>
      )}

      {isConnected && chain?.id === RITUAL_CHAIN_ID && !manageMode && (
        <div className="mt-3 text-center text-[#BF00FF] font-mono text-[12px] uppercase tracking-widest">
          ✓ Connected to Ritual — entering…
        </div>
      )}

      {isConnected && chain?.id === RITUAL_CHAIN_ID && manageMode && (
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

function MenuScreen({
  username,
  walletAddress,
  onPlay,
  onLeaderboard,
  onConnect,
}: {
  username: string;
  walletAddress: string;
  onPlay: () => void;
  onLeaderboard: () => void;
  onConnect: () => void;
}) {
  return (
    <div className="terminal-panel">
      <div className="scanline" />
      <div className="text-center">
        <h1
          className="orbitron font-bold tracking-[3px] text-[#BF00FF] text-2xl sm:text-3xl md:text-4xl"
          style={{ textShadow: "0 0 10px #BF00FF, 0 0 20px #BF00FF" }}
        >
          RITUAL BUBBLE SHOOTER
        </h1>
        <p className="text-[13px] opacity-70 mt-2 text-[#BF00FF]">
          Welcome to Ritual Bubble Shooter — On Chain
        </p>
      </div>

      <div className="glow-line" />

      <div className="flex flex-col sm:flex-row gap-6">
        <button onClick={onPlay} className="terminal-card">
          <h2>▶ PLAY</h2>
          <p>Initialize session and begin execution</p>
        </button>
        <button onClick={onLeaderboard} className="terminal-card">
          <h2>🏆 LEADERBOARD</h2>
          <p>Access top ranked Ritualized</p>
        </button>
      </div>

      <div className="mt-8 flex justify-center">
        <MusicTrackPicker />
      </div>

      <div className="mt-6 flex justify-center">
        <button
          onClick={onConnect}
          className="px-4 py-2 rounded border border-[#BF00FF]/50 text-[#BF00FF] font-mono uppercase tracking-widest text-xs hover:bg-[rgba(191,0,255,0.1)] hover:shadow-[0_0_15px_#BF00FF] transition"
        >
          {walletAddress ? `⬡ Wallet: ${shortAddr(walletAddress)}` : "⬡ Connect Wallet"}
        </button>
      </div>

      <div className="mt-10 text-center text-[11px] opacity-60 text-[#BF00FF]">
        RITUALIZED: <span className="opacity-100">{username}</span>
        <span className="opacity-50"> · locked</span>
      </div>
      <div className="mt-6 text-center text-[11px] opacity-50 text-[#BF00FF]">
        STATUS: CONNECTED | CHAIN VERIFIED | SECURE LINK ACTIVE
      </div>
    </div>
  );
}

function MusicTrackPicker() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<TrackId>(getCurrentTrack());

  const choose = (id: TrackId) => {
    sfx.click();
    setTrack(id);
    setCurrent(id);
    setOpen(false);
  };

  const label = TRACKS.find((t) => t.id === current)?.label ?? "Interstellar";

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => { sfx.click(); setOpen((o) => !o); }}
        className="px-4 py-2 rounded border border-[#BF00FF]/50 text-[#BF00FF] font-mono uppercase tracking-widest text-xs hover:bg-[rgba(191,0,255,0.1)] hover:shadow-[0_0_15px_#BF00FF] transition flex items-center gap-2"
      >
        ♪ Music Tracks: <span className="opacity-80">{label}</span>
        <span className="opacity-60">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-48 rounded border border-[#BF00FF]/50 bg-black/90 backdrop-blur z-20 overflow-hidden">
          {TRACKS.map((t) => (
            <button
              key={t.id}
              onClick={() => choose(t.id)}
              className={`block w-full text-left px-4 py-2 font-mono text-xs uppercase tracking-widest text-[#BF00FF] hover:bg-[rgba(191,0,255,0.15)] transition ${
                t.id === current ? "bg-[rgba(191,0,255,0.1)]" : ""
              }`}
            >
              {t.id === current ? "▶ " : "  "}{t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LeaderboardScreen({
  username,
  onBack,
}: {
  username: string;
  onBack: () => void;
}) {
  return (
    <div className="terminal-panel">
      <div className="scanline" />
      <div className="text-center">
        <h1
          className="orbitron font-bold tracking-[3px] text-[#BF00FF] text-xl sm:text-2xl"
          style={{ textShadow: "0 0 12px #BF00FF" }}
        >
          LEADERBOARD
        </h1>
      </div>
      <div className="glow-line" />
      <Leaderboard highlight={username} />
      <div className="mt-6 text-center text-[11px] opacity-60 text-[#BF00FF]">
        TOP RITUALIZED — VERIFIED ON CHAIN
      </div>
      <div className="mt-4 flex justify-center">
        <button
          onClick={onBack}
          className="px-6 py-2 rounded border border-[#BF00FF]/50 text-[#BF00FF] font-mono uppercase tracking-widest text-xs hover:bg-[rgba(191,0,255,0.1)] hover:shadow-[0_0_15px_#BF00FF] transition"
        >
          ← back
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

function OnChainLeaderboard({ highlightAddr }: { highlightAddr: string }) {
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

function GameOverScreen({
  score,
  rank,
  username,
  submitting,
  walletAddress,
  shots,
  bursts,
  onPlayAgain,
  onHome,
}: {
  score: number;
  rank: number | null;
  username: string;
  submitting: boolean;
  walletAddress: string;
  shots: number;
  bursts: number;
  onPlayAgain: () => void;
  onHome: () => void;
}) {
  const txCount = shots + bursts;
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

  // reset write state when player starts new game
  useEffect(() => () => reset(), [reset]);

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-6 z-10 py-8">
      <div className="text-center">
        <div className="font-mono text-[10px] tracking-[0.4em] text-destructive mb-2">
          // SESSION.TERMINATED
        </div>
        <h1 className="font-mono text-4xl font-bold text-destructive">GAME OVER</h1>
      </div>

      <div className="panel p-6 w-full text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          final score
        </div>
        <div className="font-mono text-6xl font-bold text-primary text-glow-strong tabular-nums mt-2">
          {score.toLocaleString()}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono uppercase tracking-widest text-[#BF00FF]/70">
          <div>shots<br /><span className="text-[#BF00FF] text-base">{shots}</span></div>
          <div>bursts<br /><span className="text-[#BF00FF] text-base">{bursts}</span></div>
          <div>tx total<br /><span className="text-[#BF00FF] text-base">{txCount}</span></div>
        </div>
        <div className="mt-4 font-mono text-sm text-muted-foreground">
          {submitting ? (
            "uploading score..."
          ) : rank ? (
            <>rank <span className="text-primary font-bold text-glow">#{rank}</span> of top 20</>
          ) : (
            <>not in top 20 · keep grinding</>
          )}
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground/70">
          as <span className="text-primary/80">{username}</span>
        </div>

        {/* On-chain submit */}
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
      </div>

      <div className="flex gap-3 w-full">
        <button onClick={onPlayAgain} className="btn-neon flex-1 py-3 rounded">
          ▶ Play Again
        </button>
        <button
          onClick={onHome}
          className="flex-1 py-3 rounded border border-primary/40 text-primary font-mono uppercase tracking-widest text-sm hover:bg-primary/10 transition"
        >
          Menu
        </button>
      </div>

      {/* Supabase leaderboard — refetches once score submission settles */}
      {submitting ? (
        <div className="text-[#BF00FF]/60 font-mono text-sm py-8 text-center">
          uploading score…
        </div>
      ) : (
        <Leaderboard key={`${username}-${score}-${rank ?? "none"}`} highlight={username} />
      )}

      {/* On-chain leaderboard — only after a successful submit */}
      {walletAddress && (isSuccess || submittedOnce) && (
        <OnChainLeaderboard highlightAddr={walletAddress} />
      )}
    </div>
  );
}
