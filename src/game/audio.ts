// Web Audio API synth sounds — no external files
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq: number, duration: number, type: OscillatorType = "sine", vol = 0.15, slide = 0) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), c.currentTime + duration);
  gain.gain.setValueAtTime(vol, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration);
}

let _lastShoot = 0;
// Per user request: keep only the shoot sound. All other SFX are no-ops
// so the game stays quiet aside from background music + shoot feedback.
export const sfx = {
  shoot: () => {
    const n = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (n - _lastShoot < 60) return; // throttle
    _lastShoot = n;
    tone(660, 0.08, "square", 0.08, -300);
  },
  pop: () => {},
  drop: () => {},
  bounce: () => {},
  // Game-loss sting: descending tones for a clear "you lost" feel
  gameOver: () => {
    tone(440, 0.18, "sawtooth", 0.18, -180);
    setTimeout(() => tone(330, 0.22, "sawtooth", 0.16, -160), 140);
    setTimeout(() => tone(220, 0.45, "triangle", 0.18, -120), 320);
  },
  // Sharp alert when danger line is crossed (plays alongside gameOver)
  dangerHit: () => {
    tone(880, 0.09, "square", 0.14, -200);
    setTimeout(() => tone(660, 0.12, "square", 0.14, -200), 90);
  },
  // Small purple blast for the special bubble
  specialBlast: () => {
    tone(180, 0.18, "sawtooth", 0.18, 400);
    setTimeout(() => tone(120, 0.22, "triangle", 0.14, -60), 40);
  },
  click: () => {},
};

export function unlockAudio() {
  getCtx();
  // Pre-create music element on first user interaction so it can play later
  ensureMusicEl();
}

// =============== Background music — looping MP3 ===============
export type TrackId = "interstellar" | "winner" | "bamboo" | "burnaboy";

export const TRACKS: { id: TrackId; label: string; src: string }[] = [
  { id: "interstellar", label: "Interstellar", src: "/audio/bgm.mp3" },
  { id: "winner",       label: "Sunflower",    src: "/audio/sunflower.mp3" },
  { id: "bamboo",       label: "Bamboo Flute", src: "/audio/bamboo-flute.mp3" },
  { id: "burnaboy",     label: "Burna Boy",    src: "/audio/burna-boy.mp3" },
];

let musicEl: HTMLAudioElement | null = null;
let currentTrack: TrackId = "interstellar";

function trackSrc(id: TrackId): string {
  return TRACKS.find((t) => t.id === id)?.src ?? TRACKS[0].src;
}

function ensureMusicEl(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!musicEl) {
    musicEl = new Audio(trackSrc(currentTrack));
    musicEl.loop = true;
    musicEl.volume = 0.65;
    musicEl.preload = "auto";
  }
  return musicEl;
}

export function getCurrentTrack(): TrackId {
  return currentTrack;
}

export function setTrack(id: TrackId) {
  if (id === currentTrack && musicEl) return;
  currentTrack = id;
  const wasPlaying = musicEl ? !musicEl.paused : false;
  if (musicEl) {
    try { musicEl.pause(); } catch {}
  }
  musicEl = null;
  const el = ensureMusicEl();
  if (el && wasPlaying) {
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
}

export function startMusic() {
  const el = ensureMusicEl();
  if (!el) return;
  // Restart from beginning on every fresh game start
  try {
    el.currentTime = 0;
  } catch {}
  const p = el.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

export function stopMusic() {
  if (!musicEl) return;
  try {
    musicEl.pause();
    musicEl.currentTime = 0;
  } catch {}
}

export function pauseMusic() {
  if (!musicEl) return;
  try { musicEl.pause(); } catch {}
}

export function resumeMusic() {
  const el = ensureMusicEl();
  if (!el) return;
  const p = el.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

// Kept for API compatibility; no longer scales tempo (single soundtrack).
export function setMusicIntensity(_v: number) {
  // intentional no-op
}
