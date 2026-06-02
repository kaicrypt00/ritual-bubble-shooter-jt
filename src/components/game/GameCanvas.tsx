import { useEffect, useRef, useState } from "react";
import { BubbleShooterGame } from "@/game/engine";
import {
  unlockAudio,
  startMusic,
  stopMusic,
  pauseMusic,
  resumeMusic,
  sfx,
} from "@/game/audio";
import { preloadGameAssets, getPreloadedAssets } from "@/game/preload";

type Props = {
  onGameOver: (score: number) => void;
  onRestart: () => void;
  onHome: () => void;
  walletAddress?: string;
  txCount?: number;
  onShot?: () => void;
  onBurst?: () => void;
};

export function GameCanvas({ onGameOver, onRestart, onHome, walletAddress, txCount = 0, onShot, onBurst }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<BubbleShooterGame | null>(null);
  const [score, setScore] = useState(0);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stage, setStage] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useEffect(() => {
    unlockAudio();
    startMusic();
    const canvas = canvasRef.current!;
    const callbacks = {
      onScore: (s: number) => setScore(s),
      onGameOver: (s: number) => {
        // Kick off preloading right away so the *next* play session opens
        // instantly (assets stay in the module-level cache).
        void preloadGameAssets();
        setTimeout(() => onGameOver(s), 400);
      },
      onShoot: () => onShot?.(),
      onBurst: () => onBurst?.(),
    };

    const syncStage = () => {
      const g = gameRef.current;
      if (g) setStage({ left: g._stageOffsetX, width: g._stagePx });
    };

    const boot = (imgs: HTMLImageElement[]) => {
      const game = new BubbleShooterGame(canvas, callbacks);
      game.catFaceImg = imgs[0];
      game.siggySrc = imgs[1];
      gameRef.current = game;
      game.start();
      syncStage();
    };

    // Use cached images synchronously if available → no startup delay.
    const cached = getPreloadedAssets();
    if (cached) {
      boot(cached);
    } else {
      preloadGameAssets().then(boot);
    }

    syncStage();
    const onResize = () => { const g = gameRef.current; if (g) { g.resize(); syncStage(); } };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      gameRef.current?.stop();
      stopMusic();
    };
  }, [onGameOver]);


  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (next) pauseMusic();
      else resumeMusic();
      return next;
    });
  };

  return (
    <div className="relative flex flex-col items-center w-full h-full bg-[#0a0f0a]">
      {walletAddress && (
        <div
          style={{
            position: "absolute",
            top: 56,
            right: 12,
            background: "rgba(0,0,0,0.75)",
            border: "1px solid #BF00FF",
            borderRadius: 8,
            padding: "6px 14px",
            color: "#BF00FF",
            fontFamily: "monospace",
            zIndex: 10,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: "0.15em" }}>ON-CHAIN TXS</div>
          <div style={{ fontSize: 22, fontWeight: 700, textShadow: "0 0 8px #BF00FF" }}>{txCount}</div>
          <div style={{ fontSize: 9, opacity: 0.5 }}>RITUAL ⬡</div>
        </div>
      )}
      {/* HUD */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 gap-2 z-10">
        <button
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="font-mono text-xs uppercase tracking-widest text-primary/80 hover:text-primary transition border border-primary/30 px-3 py-1.5 rounded bg-black/40 backdrop-blur"
        >
          {muted ? "♪ off" : "♪ on"}
        </button>
        <div className="font-mono text-3xl font-bold text-glow-strong text-primary tabular-nums">
          {score.toString().padStart(6, "0")}
        </div>
        <button
          onClick={() => { sfx.click(); pauseMusic(); setMenuOpen(true); }}
          className="font-mono text-xs uppercase tracking-widest text-primary/80 hover:text-primary transition border border-primary/30 px-3 py-1.5 rounded bg-black/40 backdrop-blur"
        >
          ☰ Menu
        </button>
      </div>

      {/* Canvas — fills remaining stage */}
      <div
        ref={wrapRef}
        className="relative w-full h-full overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          className="touch-none select-none"
          style={{ display: "block", width: "100%", height: "100%", position: "relative", zIndex: 5 }}
        />
        {/* Side gutters mask any bubble that visually escapes the play area.
            Higher z-index than the canvas so bubbles can never peek through. */}
        {stage.width > 0 && (
          <>
            <div
              className="stage-gutter left"
              style={{ width: Math.max(0, stage.left) }}
            />
            <div
              className="stage-gutter right"
              style={{ width: Math.max(0, stage.left) }}
            />
            {/* Subtle border framing around the actual play area */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: stage.left,
                width: stage.width,
                pointerEvents: "none",
                zIndex: 7,
                borderLeft: "1px solid rgba(191,0,255,0.35)",
                borderRight: "1px solid rgba(191,0,255,0.35)",
                boxShadow: "0 0 30px rgba(191,0,255,0.2)",
              }}
            />
          </>
        )}
      </div>

      {menuOpen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="panel p-6 w-[280px] flex flex-col gap-3">
            <div className="font-mono text-[10px] tracking-[0.3em] text-primary/80 text-center">
              // PAUSED
            </div>
            <button
              onClick={() => { sfx.click(); if (!muted) resumeMusic(); setMenuOpen(false); }}
              className="btn-neon py-3 rounded text-sm"
            >
              ▶ Resume
            </button>
            <button
              onClick={() => { sfx.click(); setMenuOpen(false); onRestart(); }}
              className="py-3 rounded border border-primary/40 text-primary font-mono uppercase tracking-widest text-xs hover:bg-primary/10 transition"
            >
              ↻ Restart
            </button>
            <button
              onClick={() => { sfx.click(); setMenuOpen(false); onHome(); }}
              className="py-3 rounded border border-primary/40 text-primary font-mono uppercase tracking-widest text-xs hover:bg-primary/10 transition"
            >
              ⌂ Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
