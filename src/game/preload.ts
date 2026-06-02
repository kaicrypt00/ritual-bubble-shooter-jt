// Module-level asset preloader. Images are loaded ONCE at app start (and
// kicked off again after each game ends) so opening the play screen is
// effectively instant — no 5-second wait staring at a blank canvas while
// images decode.

const SOURCES = ["/cat-face.png", "/siggy-thrower.png"] as const;

let cached: HTMLImageElement[] | null = null;
let pending: Promise<HTMLImageElement[]> | null = null;

function loadOne(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = src;
  });
}

export function preloadGameAssets(): Promise<HTMLImageElement[]> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = Promise.all(SOURCES.map(loadOne)).then((imgs) => {
    cached = imgs;
    pending = null;
    return imgs;
  });
  return pending;
}

export function getPreloadedAssets(): HTMLImageElement[] | null {
  return cached;
}

// Kick off preloading the moment this module is imported (browser only).
if (typeof window !== "undefined") {
  // microtask delay so we don't block initial render
  Promise.resolve().then(() => {
    void preloadGameAssets();
  });
}
