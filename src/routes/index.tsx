import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import { GameCanvas } from "@/components/game/GameCanvas";
import { Leaderboard } from "@/components/game/Leaderboard";

import {
  issueGameToken,
  submitScoreSecure,
  reserveUsernameSecure,
} from "@/lib/leaderboard.functions";
import { sfx, unlockAudio, TRACKS, type TrackId, getCurrentTrack, setTrack } from "@/game/audio";
import { preloadGameAssets } from "@/game/preload";

const WalletAddressSync = lazy(() =>
  import("@/components/game/Web3GameControls").then((module) => ({ default: module.WalletAddressSync })),
);
const ConnectWalletPanel = lazy(() =>
  import("@/components/game/Web3GameControls").then((module) => ({ default: module.ConnectWalletPanel })),
);
const ChainSubmitSection = lazy(() =>
  import("@/components/game/Web3GameControls").then((module) => ({ default: module.ChainSubmitSection })),
);

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

  const [walletAddress, setWalletAddress] = useState("");
  const [walletManageMode, setWalletManageMode] = useState(false);
  const [localShots, setLocalShots] = useState(0);
  const [localBursts, setLocalBursts] = useState(0);
  const txCount = localShots + localBursts;

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
      <Suspense fallback={null}>
        <WalletAddressSync onAddressChange={setWalletAddress} />
      </Suspense>
      <div aria-hidden className="grid-bg" />
      <FloatingOrbs count={12} />

      {phase === "home" && <HomeScreen onAccepted={onUsernameAccepted} />}

      {phase === "connect-wallet" && (
        <Suspense fallback={<div className="terminal-panel max-w-md text-center text-[#BF00FF] font-mono uppercase tracking-widest text-xs">loading wallet…</div>}>
          <ConnectWalletPanel
            manageMode={walletManageMode}
            onReady={() => { setWalletManageMode(false); setPhase("menu"); }}
            onSkip={() => { setWalletManageMode(false); setPhase("menu"); }}
          />
        </Suspense>
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
