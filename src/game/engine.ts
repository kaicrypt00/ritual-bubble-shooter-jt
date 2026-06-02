// Bubble Shooter Engine — offset hex grid, accurate aim/bounce, flood-fill match, orphan drop
import { sfx } from "./audio";

export const COLORS = [
  "#39ff14", // neon green
  "#00d4ff", // bright blue
  "#ff2d95", // hot pink
  "#b14eff", // purple
  "#ffd700", // gold
  "#ffffff", // white
];

export const COLS = 12;
const TOP_ROWS_INITIAL = 4;
const BUBBLE_RADIUS_REF = 22; // reference radius — actual scales with canvas
const ROW_OFFSET_FACTOR = Math.sqrt(3) / 2; // hex row height = 2r * sqrt(3)/2 = r*sqrt(3)

type Bubble = {
  row: number;
  col: number;
  color: number;
  // pixel positions (computed)
  x: number;
  y: number;
  // for falling animation
  falling?: boolean;
  vy?: number;
  // for popping animation
  popping?: boolean;
  popT?: number;
};

type Shot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  special?: boolean;
};

export type GameCallbacks = {
  onScore: (score: number) => void;
  onGameOver: (score: number) => void;
  onIntensity?: (intensity: number) => void;
  onShoot?: () => void;
  onBurst?: (count: number) => void;
};

export class BubbleShooterGame {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cb: GameCallbacks;
  catFaceImg: HTMLImageElement | null = null;
  siggySrc: HTMLImageElement | null = null;

  width = 0;
  height = 0;
  dpr = 1;

  // logical coordinate system size (we render to dpr-scaled backing store)
  logicalW = 480;
  logicalH = 720;

  radius = BUBBLE_RADIUS_REF;
  rowHeight = BUBBLE_RADIUS_REF * 2 * ROW_OFFSET_FACTOR;

  grid: (Bubble | null)[][] = [];
  totalRows = 30; // capacity

  shooterX = 240;
  shooterY = 680;
  aimX = 240;
  aimY = 100;

  current: { color: number } = { color: 0 };
  next: { color: number } = { color: 0 };

  shot: Shot | null = null;
  fallingBubbles: Bubble[] = [];
  burstRings: { x: number; y: number; color: number; t: number }[] = [];

  score = 0;
  shotsSinceDrop = 0;
  shotsPerDrop = 6;
  minShotsPerDrop = 2;
  shotSpeed = 1150;
  maxShotSpeed = 1700;
  rowsPushed = 0;
  pushOffset = 0; // visual descent of the field
  topRowParity = 0; // 0 means row 0 is "even" (left-aligned), 1 means odd-shifted

  // Progressive color pool: start with 3, unlock 1 more every N pushes up to 6
  colorPoolSize = 3;
  maxColorPool = 6;

  rafId: number | null = null;
  lastT = 0;
  running = false;
  over = false;

  pointerActive = false;

  // === Special bubble: each game starts with 3. When armed, the next shot
  // becomes a purple blast bubble that explodes the first thing it touches
  // (and the bubbles in a small radius around the impact point). ===
  specialAmmo = 3;
  useSpecial = false;
  specialSlotRects: { x: number; y: number; w: number; h: number }[] = [];


  constructor(canvas: HTMLCanvasElement, cb: GameCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cb = cb;
    this.resize();
    this.initGrid();
    this.current = { color: this.randColor() };
    this.next = { color: this.randColor() };
    this.bindEvents();
  }

  bindEvents() {
    const c = this.canvas;
    const move = (e: PointerEvent) => {
      const p = this.toLogical(e.clientX, e.clientY);
      this.aimX = p.x;
      this.aimY = p.y;
    };
    const down = (e: PointerEvent) => {
      const p = this.toLogical(e.clientX, e.clientY);
      // Tap on a special-bubble slot toggles the special arm state instead
      // of starting an aim. Consumes the gesture (no fire on pointer-up).
      if (this.hitSpecialSlot(p.x, p.y)) {
        if (this.specialAmmo > 0) this.useSpecial = !this.useSpecial;
        else this.useSpecial = false;
        return;
      }
      this.pointerActive = true;
      move(e);
      c.setPointerCapture(e.pointerId);
    };
    const up = (e: PointerEvent) => {
      if (!this.pointerActive) return;
      this.pointerActive = false;
      move(e);
      this.fire();
      try { c.releasePointerCapture(e.pointerId); } catch {}
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    this._cleanup = () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
    };
  }
  _cleanup: () => void = () => {};

  toLogical(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const localX = (clientX - rect.left) - this._stageOffsetX;
    const stagePx = this._stagePx || rect.width;
    const x = (localX / stagePx) * this.logicalW;
    const y = ((clientY - rect.top) / rect.height) * this.logicalH;
    return { x, y };
  }

  resize() {
    const parent = this.canvas.parentElement!;
    const w = Math.max(320, parent.clientWidth);
    const h = Math.max(400, parent.clientHeight);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.width = w;
    this.height = h;

    // Pick a stage width so bubbles render at a comfortable physical size.
    // Mobile: bigger bubbles (~38px diameter -> radius 19). Desktop: ~32px.
    // On wide PCs we cap stage width and letterbox sides with the dark bg
    // so bubbles don't grow to cover the entire screen.
    const isMobile = w < 700;
    const targetBubbleDiamPx = isMobile ? 44 : 40;
    const maxStagePx = COLS * targetBubbleDiamPx;
    const stagePx = isMobile ? w : Math.min(w, Math.max(460, maxStagePx));
    this.logicalW = 480;
    this.logicalH = Math.round((h / stagePx) * this.logicalW);
    this.radius = this.logicalW / (COLS * 2);
    this.rowHeight = this.radius * 2 * ROW_OFFSET_FACTOR;
    this.shooterX = this.logicalW / 2;
    // Shooter origin sits inside the ring on top of the siggy thrower image.
    // Medium/smaller attractive size: image height = r * 9, bottom-flush with
    // the canvas, with the held bubble centered on the actual ring opening.
    // Danger line (shooterY - r * 1.5) automatically tracks this.
    this.shooterY = this.logicalH - this.radius * 5.43;

    // Uniform scale so bubbles stay round; center horizontally with letterbox.
    const scale = (stagePx / this.logicalW) * this.dpr;
    const offsetXpx = ((w - stagePx) / 2) * this.dpr;
    this.ctx.setTransform(scale, 0, 0, scale, offsetXpx, 0);
    this._stageOffsetX = (w - stagePx) / 2;
    this._stagePx = stagePx;
    if (this.grid && this.grid.length) this.refreshAllPositions();
  }

  _stageOffsetX = 0;
  _stagePx = 0;

  initGrid() {
    this.grid = [];
    for (let r = 0; r < this.totalRows; r++) {
      this.grid.push(new Array(COLS).fill(null));
    }
    for (let r = 0; r < TOP_ROWS_INITIAL; r++) {
      for (let c = 0; c < COLS; c++) {
        // odd rows have one fewer cell (offset hex)
        if (this.isOddRow(r) && c === COLS - 1) continue;
        // Guarantee a diverse spread of all 6 colors by cycling through
        // a shuffled palette so no run looks monochrome.
        this.grid[r][c] = this.makeBubble(r, c, this.diverseColor(r, c));
      }
    }
  }

  // Shuffled color sequence ensures every new board shows all 6 colors evenly.
  _paletteSeq: number[] = [];
  _paletteIdx = 0;
  diverseColor(_r: number, _c: number): number {
    if (this._paletteIdx >= this._paletteSeq.length) {
      const base: number[] = [];
      for (let i = 0; i < this.colorPoolSize; i++) base.push(i);
      // Fisher-Yates shuffle
      for (let i = base.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [base[i], base[j]] = [base[j], base[i]];
      }
      this._paletteSeq = base;
      this._paletteIdx = 0;
    }
    return this._paletteSeq[this._paletteIdx++];
  }

  isOddRow(r: number) {
    // parity = (r + topRowParity) is odd -> shifted right by radius
    return ((r + this.topRowParity) & 1) === 1;
  }

  makeBubble(r: number, c: number, color: number): Bubble {
    const { x, y } = this.cellToPixel(r, c);
    return { row: r, col: c, color, x, y };
  }

  cellToPixel(r: number, c: number) {
    const xOffset = this.isOddRow(r) ? this.radius : 0;
    const x = this.radius + xOffset + c * this.radius * 2;
    const y = this.radius + r * this.rowHeight + this.pushOffset;
    return { x, y };
  }

  refreshAllPositions() {
    for (let r = 0; r < this.totalRows; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = this.grid[r][c];
        if (b) {
          const p = this.cellToPixel(r, c);
          b.x = p.x;
          b.y = p.y;
        }
      }
    }
  }

  // Determine which colors are still on the board (so we don't shoot useless colors)
  activeColors(): number[] {
    const set = new Set<number>();
    for (let r = 0; r < this.totalRows; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = this.grid[r][c];
        if (b) set.add(b.color);
      }
    }
    return set.size ? Array.from(set) : [0, 1, 2, 3, 4, 5];
  }

  randColor() {
    const active = this.activeColors();
    // Prefer colors that are in BOTH the unlocked pool and currently on board
    const limited: number[] = [];
    for (const c of active) if (c < this.colorPoolSize) limited.push(c);
    const pool = limited.length ? limited : active;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.over = false;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = Math.min(50, t - this.lastT);
      this.lastT = t;
      this.update(dt / 1000);
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this._cleanup();
  }

  fire() {
    if (this.shot || this.over || !this.running) return;
    const dx = this.aimX - this.shooterX;
    const dy = this.aimY - this.shooterY;
    if (dy >= -10) return; // must aim up
    const len = Math.hypot(dx, dy);
    const speed = this.shotSpeed; // logical units/sec, ramps with difficulty
    const isSpecial = this.useSpecial && this.specialAmmo > 0;
    this.shot = {
      x: this.shooterX,
      y: this.shooterY,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      color: isSpecial ? 3 : this.current.color, // 3 = purple slot for visuals
      special: isSpecial,
    };
    sfx.shoot();
    this.cb.onShoot?.();
    if (isSpecial) {
      this.specialAmmo--;
      this.useSpecial = false;
      // Held + next colors remain queued; special doesn't consume them.
    } else {
      this.current = this.next;
      this.next = { color: this.randColor() };
    }
  }

  hitSpecialSlot(x: number, y: number): boolean {
    for (const s of this.specialSlotRects) {
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true;
    }
    return false;
  }

  blastAt(x: number, y: number) {
    const R = this.radius * 3.7;
    const removed: Bubble[] = [];
    for (let r = 0; r < this.totalRows; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = this.grid[r][c];
        if (!b) continue;
        const dx = x - b.x, dy = y - b.y;
        if (dx * dx + dy * dy < R * R) {
          removed.push(b);
          this.grid[r][c] = null;
        }
      }
    }
    sfx.specialBlast();
    for (const b of removed) {
      const dx = b.x - x, dy = b.y - y;
      const d = Math.hypot(dx, dy) || 1;
      b.falling = true;
      b.vy = -160 + (dy / d) * 240 + Math.random() * 40;
      (b as any).vx = (dx / d) * 300 + (Math.random() - 0.5) * 80;
      this.fallingBubbles.push(b);
      this.burstRings.push({ x: b.x, y: b.y, color: 3, t: 0 });
    }
    // Big central purple shockwave
    this.burstRings.push({ x, y, color: 3, t: 0 });
    this.score += removed.length * 15;
    // Drop newly orphaned bubbles
    const orphans = this.findOrphans();
    for (const b of orphans) {
      this.grid[b.row][b.col] = null;
      b.falling = true;
      b.vy = 0;
      this.fallingBubbles.push(b);
    }
    if (orphans.length) this.score += orphans.length * 25;
    this.cb.onScore(this.score);
  }

  update(dt: number) {
    // animate falling orphans
    for (const b of this.fallingBubbles) {
      b.vy = (b.vy ?? 0) + 1500 * dt;
      b.y += b.vy * dt;
      const vx = (b as any).vx ?? 0;
      if (vx) b.x += vx * dt;
    }
    this.fallingBubbles = this.fallingBubbles.filter((b) => b.y < this.logicalH + 50);

    // advance burst rings
    if (this.burstRings.length) {
      for (const ring of this.burstRings) ring.t += dt;
      this.burstRings = this.burstRings.filter((r) => r.t < 0.45);
    }

    if (!this.shot) return;

    // sub-step integration to avoid tunneling
    const steps = 4;
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (!this.shot) break;
      this.shot.x += this.shot.vx * sdt;
      this.shot.y += this.shot.vy * sdt;

      // walls
      if (this.shot.x < this.radius) {
        this.shot.x = this.radius;
        this.shot.vx = Math.abs(this.shot.vx);
        sfx.bounce();
      } else if (this.shot.x > this.logicalW - this.radius) {
        this.shot.x = this.logicalW - this.radius;
        this.shot.vx = -Math.abs(this.shot.vx);
        sfx.bounce();
      }

      // ceiling
      if (this.shot.y < this.radius) {
        if (this.shot.special) {
          this.blastAt(this.shot.x, this.shot.y);
          this.shot = null;
        } else {
          this.snapShot();
        }
        return;
      }

      // collision with any bubble
      const hit = this.checkCollision(this.shot.x, this.shot.y);
      if (hit) {
        if (this.shot.special) {
          this.blastAt(this.shot.x, this.shot.y);
          this.shot = null;
        } else {
          this.snapShot();
        }
        return;
      }
    }
  }

  checkCollision(x: number, y: number): boolean {
    const minDist = this.radius * 2 - 1;
    // only check a localized region
    for (let r = 0; r < this.totalRows; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = this.grid[r][c];
        if (!b) continue;
        const dx = x - b.x;
        const dy = y - b.y;
        if (dx * dx + dy * dy < minDist * minDist) return true;
      }
    }
    return false;
  }

  snapShot() {
    if (!this.shot) return;
    // find nearest empty grid cell
    const { row, col } = this.findSnapCell(this.shot.x, this.shot.y);
    if (row < 0) {
      this.shot = null;
      return;
    }
    // ensure within bounds
    if (row >= this.totalRows) {
      // game over — placed below, treat as game over check after
    }
    this.grid[row][col] = this.makeBubble(row, col, this.shot.color);
    const placed = this.grid[row][col]!;
    this.shot = null;

    // matching
    const cluster = this.findCluster(row, col, placed.color);
    if (cluster.length >= 3) {
      sfx.pop();
      this.cb.onBurst?.(cluster.length);
      // Drop physics: matched bubbles fall off screen instead of vanishing.
      for (const b of cluster) {
        this.grid[b.row][b.col] = null;
        b.falling = true;
        // stronger burst kick — fly outward from cluster center
        const cx = placed.x, cy = placed.y;
        const dx = b.x - cx, dy = b.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        b.vy = -180 + (dy / d) * 220 + Math.random() * 40;
        (b as any).vx = (dx / d) * 280 + (Math.random() - 0.5) * 80;
        this.fallingBubbles.push(b);
      }
      // burst rings (cheap shockwave at each popped bubble)
      for (const b of cluster) {
        this.burstRings.push({ x: b.x, y: b.y, color: b.color, t: 0 });
      }
      this.score += cluster.length * 10;

      // drop orphans
      const orphans = this.findOrphans();
      if (orphans.length > 0) {
        sfx.drop();
        for (const b of orphans) {
          this.grid[b.row][b.col] = null;
          b.falling = true;
          b.vy = 0;
          this.fallingBubbles.push(b);
        }
        this.score += orphans.length * 25;
      }
      this.cb.onScore(this.score);
    }

    // refresh next color pool (active colors)
    if (!this.activeColors().includes(this.current.color)) {
      this.current = { color: this.randColor() };
    }
    if (!this.activeColors().includes(this.next.color)) {
      this.next = { color: this.randColor() };
    }

    // shot count -> push down
    this.shotsSinceDrop++;
    if (this.shotsSinceDrop >= this.shotsPerDrop) {
      this.shotsSinceDrop = 0;
      this.pushNewRow();
      this.rowsPushed++;
      // ramp difficulty: faster pushes + faster shots over time
      if (this.shotsPerDrop > this.minShotsPerDrop) this.shotsPerDrop--;
      if (this.shotSpeed < this.maxShotSpeed) this.shotSpeed += 25;
      // Unlock a new color every 3 pushes, up to max
      if (this.colorPoolSize < this.maxColorPool && this.rowsPushed % 3 === 0) {
        this.colorPoolSize++;
      }
      this.reportIntensity();
    }

    // Hard game-over when bubbles cross the red danger line
    this.checkGameOver();
  }

  reportIntensity() {
    if (!this.cb.onIntensity) return;
    // 0 at start (shotsPerDrop=6, speed=1150) -> 1 at max
    const speedI =
      (this.shotSpeed - 1150) / (this.maxShotSpeed - 1150);
    const dropI = (6 - this.shotsPerDrop) / (6 - this.minShotsPerDrop);
    const intensity = Math.max(0, Math.min(1, (speedI + dropI) / 2));
    this.cb.onIntensity(intensity);
  }

  checkGameOver() {
    if (this.over) return;
    // Simple, fair rule: only end the game when a SETTLED bubble's bottom
    // edge actually crosses the danger line. The danger line is drawn at
    // `shooterY - radius * 1.5` in render(), so we use the exact same value
    // here — no fudge factors, no early triggers.
    const danger = this.shooterY - this.radius * 1.5;
    for (let r = this.totalRows - 1; r >= 0; r--) {
      for (let c = 0; c < COLS; c++) {
        const b = this.grid[r][c];
        if (!b) continue;
        if (b.y + this.radius > danger) {
          this.over = true;
          // Stop the game loop immediately so the board is no longer
          // playable after the danger line is crossed.
          this.running = false;
          if (this.rafId) cancelAnimationFrame(this.rafId);
          this.rafId = null;
          // Audio cues for losing — sharp danger alert + descending sting
          sfx.dangerHit();
          sfx.gameOver();
          this.cb.onGameOver(this.score);
          return;
        }
      }
    }
  }

  findSnapCell(x: number, y: number): { row: number; col: number } {
    // Search nearby cells; prefer adjacent-to-existing OR top row, but simple approach:
    // try all empty cells within reasonable radius and pick closest that is supported (touches another or top)
    let best = -1;
    let bestRow = -1;
    let bestCol = -1;
    let bestDist = Infinity;

    const approxRow = Math.max(0, Math.round((y - this.radius - this.pushOffset) / this.rowHeight));
    const minR = Math.max(0, approxRow - 2);
    const maxR = Math.min(this.totalRows - 1, approxRow + 2);

    for (let r = minR; r <= maxR; r++) {
      const maxC = this.isOddRow(r) ? COLS - 1 : COLS;
      for (let c = 0; c < maxC; c++) {
        if (this.grid[r][c]) continue;
        // must be supported (top row OR has neighbor)
        const supported = r === 0 || this.getNeighbors(r, c).some((n) => this.grid[n.row]?.[n.col]);
        if (!supported) continue;
        const p = this.cellToPixel(r, c);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestRow = r;
          bestCol = c;
          best = 1;
        }
      }
    }
    if (best < 0) return { row: -1, col: -1 };
    return { row: bestRow, col: bestCol };
  }

  getNeighbors(r: number, c: number): { row: number; col: number }[] {
    // Offset hex neighbors depend on row parity
    const odd = this.isOddRow(r);
    const offsets = odd
      ? [
          [-1, 0], [-1, 1],
          [0, -1], [0, 1],
          [1, 0], [1, 1],
        ]
      : [
          [-1, -1], [-1, 0],
          [0, -1], [0, 1],
          [1, -1], [1, 0],
        ];
    const out: { row: number; col: number }[] = [];
    for (const [dr, dc] of offsets) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= this.totalRows) continue;
      const maxC = this.isOddRow(nr) ? COLS - 1 : COLS;
      if (nc < 0 || nc >= maxC) continue;
      out.push({ row: nr, col: nc });
    }
    return out;
  }

  findCluster(r: number, c: number, color: number): Bubble[] {
    const visited = new Set<string>();
    const stack: { row: number; col: number }[] = [{ row: r, col: c }];
    const out: Bubble[] = [];
    while (stack.length) {
      const { row, col } = stack.pop()!;
      const key = `${row},${col}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const b = this.grid[row]?.[col];
      if (!b || b.color !== color) continue;
      out.push(b);
      for (const n of this.getNeighbors(row, col)) stack.push(n);
    }
    return out;
  }

  findOrphans(): Bubble[] {
    const connected = new Set<string>();
    const stack: { row: number; col: number }[] = [];
    // seed with all top-row bubbles
    for (let c = 0; c < COLS; c++) {
      if (this.grid[0][c]) stack.push({ row: 0, col: c });
    }
    while (stack.length) {
      const { row, col } = stack.pop()!;
      const key = `${row},${col}`;
      if (connected.has(key)) continue;
      if (!this.grid[row]?.[col]) continue;
      connected.add(key);
      for (const n of this.getNeighbors(row, col)) stack.push(n);
    }
    const orphans: Bubble[] = [];
    for (let r = 0; r < this.totalRows; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = this.grid[r][c];
        if (b && !connected.has(`${r},${c}`)) orphans.push(b);
      }
    }
    return orphans;
  }

  pushNewRow() {
    // shift all rows down by 1, insert new row at top with random colors
    for (let r = this.totalRows - 1; r > 0; r--) {
      this.grid[r] = this.grid[r - 1];
      // update row index of bubbles
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c]) this.grid[r][c]!.row = r;
      }
    }
    // flip parity since we shifted
    this.topRowParity = 1 - this.topRowParity;
    this.grid[0] = new Array(COLS).fill(null);
    const maxC = this.isOddRow(0) ? COLS - 1 : COLS;
    for (let c = 0; c < maxC; c++) {
      this.grid[0][c] = this.makeBubble(0, c, this.diverseColor(0, c));
    }
    this.refreshAllPositions();
  }

  handleDangerOverflow() {
    const limit = this.shooterY - this.radius * 1.5;
    let lowest = -1;
    for (let r = this.totalRows - 1; r >= 0; r--) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c]) { lowest = r; break; }
      }
      if (lowest >= 0) break;
    }
    if (lowest < 0) return;
    const lowestY = this.cellToPixel(lowest, 0).y;
    if (lowestY + this.radius * 2 < limit) return;

    // Penalty: drop the bottom 2 rows of bubbles (visually fall away),
    // deduct points, and play game-over-ish sound, but keep playing.
    sfx.gameOver();
    let cleared = 0;
    for (let r = lowest; r > lowest - 2 && r >= 0; r--) {
      for (let c = 0; c < COLS; c++) {
        const b = this.grid[r][c];
        if (b) {
          this.grid[r][c] = null;
          b.falling = true;
          b.vy = 200;
          this.fallingBubbles.push(b);
          cleared++;
        }
      }
    }
    this.score = Math.max(0, this.score - cleared * 5);
    this.cb.onScore(this.score);
    // Drop any newly orphaned bubbles too
    const orphans = this.findOrphans();
    for (const b of orphans) {
      this.grid[b.row][b.col] = null;
      b.falling = true;
      b.vy = 0;
      this.fallingBubbles.push(b);
    }
  }

  render() {
    const ctx = this.ctx;

    // Clear the ENTIRE backing store (including letterbox gutters) in
    // device pixels, so previous-frame ghosts in the side margins are wiped.
    // The current transform letterboxes the logical area, so reset, clear,
    // then restore the transform.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#0a0f0a";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    // Hard-clip everything that follows to the logical play-area rect.
    // This guarantees that bubble glow, falling-bubble vx drift, aim-line
    // shadows, etc. can never render outside the stage on wide screens.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.logicalW, this.logicalH);
    ctx.clip();

    // base background fill inside the play area
    ctx.fillStyle = "#0a0f0a";
    ctx.fillRect(0, 0, this.logicalW, this.logicalH);

    ctx.fillStyle = 'rgba(191,0,255,0.06)';
    ctx.fillRect(0, 0, this.logicalW, this.logicalH);

    // grid lines (subtle)
    ctx.strokeStyle = "rgba(191,0,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= COLS; i++) {
      const x = i * this.radius * 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.logicalH);
      ctx.stroke();
    }

    // danger line — pulsing purple, sits just above the ball-holder ring
    const danger = this.shooterY - this.radius * 1.5;
    const pulse = 0.5 + Math.sin(performance.now() / 200) * 0.25;
    ctx.strokeStyle = `rgba(191, 0, 255, ${pulse})`;
    ctx.shadowColor = "rgba(191,0,255,0.9)";
    ctx.shadowBlur = 4;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, danger);
    ctx.lineTo(this.logicalW, danger);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // bubbles
    for (let r = 0; r < this.totalRows; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = this.grid[r][c];
        if (b) this.drawBubble(b.x, b.y, b.color);
      }
    }
    // falling
    for (const b of this.fallingBubbles) this.drawBubble(b.x, b.y, b.color, 0.8);

    // burst shockwave rings
    if (this.burstRings.length) {
      ctx.save();
      for (const ring of this.burstRings) {
        const p = ring.t / 0.45; // 0..1
        const rad = this.radius * (1 + p * 2.2);
        const alpha = (1 - p) * 0.7;
        ctx.strokeStyle = COLORS[ring.color];
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5 * (1 - p) + 0.5;
        ctx.shadowColor = COLORS[ring.color];
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // aim line
    if (!this.shot && !this.over) this.drawAim();

    // shooter
    this.drawShooter();

    // shot
    if (this.shot) {
      if (this.shot.special) this.drawSpecialBubble(this.shot.x, this.shot.y, 1);
      else this.drawBubble(this.shot.x, this.shot.y, this.shot.color);
    }

    // close stage clip
    ctx.restore();
  }

  // Cache fully-composed bubble sprites per color to avoid expensive
  // shadowBlur + 2 radial gradients + cat face composite per bubble per frame.
  bubbleSpriteCache: (HTMLCanvasElement | null)[] = [];
  bubbleSpriteRadius = 0;
  bubbleSpriteHasCat = false;
  buildBubbleSprite(color: number): HTMLCanvasElement {
    const r = this.radius;
    const pad = Math.ceil(r * 0.6); // room for glow
    const size = Math.ceil((r + pad) * 2);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const x = size / 2;
    const y = size / 2;
    const col = COLORS[color];
    // outer neon glow
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    const gradient = ctx.createRadialGradient(
      x - r * 0.3, y - r * 0.35, r * 0.05,
      x, y, r
    );
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.25, col + 'ee');
    gradient.addColorStop(0.7, col);
    gradient.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const shine = ctx.createRadialGradient(
      x - r * 0.3, y - r * 0.4, 0,
      x - r * 0.3, y - r * 0.4, r * 0.7
    );
    shine.addColorStop(0, 'rgba(255,255,255,0.71)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.beginPath();
    ctx.arc(x - r * 0.28, y - r * 0.38, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    if (this.catFaceImg && this.catFaceImg.complete && this.catFaceImg.naturalWidth > 0) {
      ctx.globalAlpha = 0.88;
      const s = r * 1.8;
      ctx.drawImage(this.catFaceImg, x - s / 2, y - s / 2, s, s);
      ctx.globalAlpha = 1;
    }
    return c;
  }
  getBubbleSprite(color: number): HTMLCanvasElement {
    const catReady = !!(this.catFaceImg && this.catFaceImg.complete && this.catFaceImg.naturalWidth > 0);
    if (this.bubbleSpriteRadius !== this.radius || this.bubbleSpriteHasCat !== catReady) {
      this.bubbleSpriteCache = [];
      this.bubbleSpriteRadius = this.radius;
      this.bubbleSpriteHasCat = catReady;
    }
    let s = this.bubbleSpriteCache[color];
    if (!s) {
      s = this.buildBubbleSprite(color);
      this.bubbleSpriteCache[color] = s;
    }
    return s;
  }
  drawBubble(x: number, y: number, color: number, alpha = 1) {
    const sprite = this.getBubbleSprite(color);
    const ctx = this.ctx;
    const half = sprite.width / 2;
    if (alpha !== 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - half, y - half);
      ctx.restore();
    } else {
      ctx.drawImage(sprite, x - half, y - half);
    }
  }
  drawBubbleScaled(x: number, y: number, color: number, scale: number) {
    const sprite = this.getBubbleSprite(color);
    const ctx = this.ctx;
    const size = sprite.width * scale;
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  // Special "blast" bubble — extra-glowy purple orb with a jagged spark
  // pattern. Animated pulse on the glow so it stands out from regular bubbles.
  drawSpecialBubble(x: number, y: number, scale: number) {
    const ctx = this.ctx;
    const r = this.radius * scale;
    const t = performance.now() / 200;
    const pulse = 0.7 + Math.sin(t) * 0.3;
    ctx.save();
    // Outer aura
    ctx.shadowColor = '#ff4dff';
    ctx.shadowBlur = 22 * pulse;
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
    grad.addColorStop(0, 'rgba(255,220,255,1)');
    grad.addColorStop(0.25, '#ff66ff');
    grad.addColorStop(0.65, '#BF00FF');
    grad.addColorStop(1, '#3a0055');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Jagged starburst (outer blast rays)
    ctx.strokeStyle = 'rgba(255,240,255,0.95)';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const spikes = 10;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + t * 0.5;
      const r1 = r * 0.32;
      const r2 = r * 0.78;
      ctx.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
    }
    ctx.stroke();
    // Inner explosion polygon — classic "comic blast" star shape
    const pts = 12;
    ctx.beginPath();
    for (let i = 0; i < pts * 2; i++) {
      const a = (i / (pts * 2)) * Math.PI * 2 - t * 0.3;
      const rad = i % 2 === 0 ? r * 0.55 : r * 0.28;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const innerGrad = ctx.createRadialGradient(x, y, r * 0.05, x, y, r * 0.55);
    innerGrad.addColorStop(0, 'rgba(255,255,255,1)');
    innerGrad.addColorStop(0.4, '#ffec80');
    innerGrad.addColorStop(0.8, '#ff66ff');
    innerGrad.addColorStop(1, 'rgba(191,0,255,0.8)');
    ctx.fillStyle = innerGrad;
    ctx.shadowColor = '#ffec80';
    ctx.shadowBlur = 10 * pulse;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Bright hot core
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    // Rim
    ctx.strokeStyle = 'rgba(255,140,255,0.95)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, r - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }



  lighten(hex: string, amt: number) {
    const { r, g, b } = this.hexToRgb(hex);
    return `rgb(${Math.min(255, r + 255 * amt)},${Math.min(255, g + 255 * amt)},${Math.min(255, b + 255 * amt)})`;
  }
  darken(hex: string, amt: number) {
    const { r, g, b } = this.hexToRgb(hex);
    return `rgb(${Math.max(0, r - 255 * amt)},${Math.max(0, g - 255 * amt)},${Math.max(0, b - 255 * amt)})`;
  }
  hexToRgb(hex: string) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  drawShooter() {
    const ctx = this.ctx;
    const r = this.radius;
    // New siggy thrower image: ring is at the TOP of the png (where the
    // bubble is held) and the cat+bowl sits below. Image is bottom-flush
    // with the canvas. Ratios measured from the actual asset (1424x1023).
    const ringRatioY = 0.397;
    const ringRatioX = 0.481;
    const imgAspect = 1424 / 1023;
    const imgW = this.radius * 12.54;
    const imgH = imgW / imgAspect;
    const imgX = this.shooterX - imgW * ringRatioX;
    const imgTop = this.shooterY - imgH * ringRatioY;
    ctx.save();
    if (this.siggySrc && this.siggySrc.complete) {
      ctx.drawImage(this.siggySrc, imgX, imgTop, imgW, imgH);
    }
    ctx.restore();
    // Held bubble — special purple blast if armed, otherwise the current color.
    // Special bubble is rendered a touch larger so it visibly stands out.
    if (this.useSpecial && this.specialAmmo > 0) {
      this.drawSpecialBubble(this.shooterX, this.shooterY, 0.95);
    } else {
      this.drawBubbleScaled(this.shooterX, this.shooterY, this.current.color, 0.74);
    }

    // ---- Single BLAST slot (LEFT side of siggy thrower) ----
    // One holder mirroring NEXT on the right. Shows the special bubble +
    // a countdown badge of how many charges remain. Tap to arm/disarm.
    const sb = r * 2.05;
    let sx = imgX - sb - r * 0.12;
    if (sx < r * 0.15) sx = r * 0.15;
    let sy = this.shooterY + r * 0.35;
    if (sy < r * 0.2) sy = r * 0.2;
    if (sy + sb > this.logicalH - r * 0.2) sy = this.logicalH - sb - r * 0.2;
    this.specialSlotRects = [{ x: sx, y: sy, w: sb, h: sb }];
    const filled = this.specialAmmo > 0;
    const armed = this.useSpecial && filled;
    ctx.save();
    ctx.strokeStyle = armed ? '#ff4dff' : '#BF00FF';
    ctx.lineWidth = armed ? 2.2 : 1.5;
    ctx.shadowColor = '#BF00FF';
    ctx.shadowBlur = armed ? 16 : 8;
    ctx.beginPath();
    (ctx as any).roundRect(sx, sy, sb, sb, r * 0.45);
    ctx.stroke();
    ctx.fillStyle = filled ? 'rgba(191,0,255,0.15)' : 'rgba(191,0,255,0.05)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    if (filled) {
      this.drawSpecialBubble(sx + sb / 2, sy + sb / 2, 0.92);
    } else {
      ctx.save();
      ctx.strokeStyle = 'rgba(191,0,255,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(sx + sb / 2, sy + sb / 2, r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Countdown badge (top-right corner of the slot)
    ctx.save();
    const badgeR = r * 0.55;
    const bx = sx + sb - badgeR * 0.4;
    const by = sy + badgeR * 0.4;
    ctx.fillStyle = '#0a0f0a';
    ctx.strokeStyle = '#ff4dff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#ff4dff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(r * 0.85)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.specialAmmo), bx, by + 1);
    ctx.restore();
    // Label
    ctx.save();
    ctx.fillStyle = '#BF00FF';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BLAST', sx + sb / 2, sy - 4);
    ctx.restore();

    // NEXT preview box — sits OUTSIDE on the right side of the siggy png,
    // vertically aligned with the ring so it reads as a holder next to the
    // thrower. Clamp inside the canvas if room is tight.
    const nb = r * 2.05;
    let nx = imgX + imgW + r * 0.12;
    if (nx + nb > this.logicalW - r * 0.15) {
      nx = this.logicalW - nb - r * 0.15;
    }
    if (nx < r * 0.2) nx = r * 0.2;
    let ny = this.shooterY + r * 0.35;
    if (ny < r * 0.2) ny = r * 0.2;
    if (ny + nb > this.logicalH - r * 0.2) {
      ny = this.logicalH - nb - r * 0.2;
    }
    ctx.save();
    ctx.strokeStyle = '#BF00FF';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#BF00FF';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    (ctx as any).roundRect(nx, ny, nb, nb, r * 0.45);
    ctx.stroke();
    ctx.fillStyle = 'rgba(191,0,255,0.10)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    this.drawBubble(nx + nb / 2, ny + nb / 2, this.next.color);
    ctx.save();
    ctx.fillStyle = '#BF00FF';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT', nx + nb / 2, ny - 4);
    ctx.restore();
  }


  drawAim() {
    // Trace path with bouncing off walls until hit or top
    const ctx = this.ctx;
    let dx = this.aimX - this.shooterX;
    let dy = this.aimY - this.shooterY;
    if (dy >= -10) return;
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;

    let x = this.shooterX;
    let y = this.shooterY;
    let bounces = 0;
    const maxBounces = 3;
    const points: [number, number][] = [[x, y]];

    while (bounces <= maxBounces) {
      // step until wall, bubble, or ceiling
      const step = 4;
      let hit = false;
      while (true) {
        x += dx * step;
        y += dy * step;
        if (x < this.radius) {
          // reflect
          const t = (this.radius - (x - dx * step)) / dx;
          x = this.radius;
          dx = -dx;
          bounces++;
          points.push([x, y]);
          break;
        }
        if (x > this.logicalW - this.radius) {
          x = this.logicalW - this.radius;
          dx = -dx;
          bounces++;
          points.push([x, y]);
          break;
        }
        if (y < this.radius || this.checkCollision(x, y)) {
          points.push([x, y]);
          hit = true;
          break;
        }
      }
      if (hit) break;
    }

    ctx.save();
    ctx.strokeStyle = COLORS[this.current.color];
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.shadowColor = COLORS[this.current.color];
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
    ctx.restore();
  }
}
