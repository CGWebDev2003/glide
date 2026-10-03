/**
 * In-page runtime, injected via Playwright's `addInitScript` before any page
 * script runs. It replaces every time source the page can observe with a
 * virtual clock that only moves when the recorder calls `__glide.frame()`.
 *
 * Patterns adopted from timesnap/timeweb (tungs):
 *  - override Date, Date.now, performance.now, requestAnimationFrame,
 *    setTimeout/setInterval (+ clear*) before page scripts run
 *  - timers are executed in due-order while advancing, so chains of timeouts
 *    behave like in real time
 *  - CSS animations/transitions are discovered via document.getAnimations()
 *    and seeked to the virtual time; <video> elements are paused and seeked
 *
 * IMPORTANT: this function is serialized with Function.prototype.toString(),
 * so it must be fully self-contained (no imports, no outer references).
 */
export function installGlideRuntime(opts: { seed: number | null }): void {
  const w = window as any;
  if (w.__glide) return;

  // ---- deterministic Math.random (mulberry32) -------------------------------
  if (opts && typeof opts.seed === 'number') {
    let a = opts.seed >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- native references (used by the runtime itself) ----------------------
  const NativeDate = Date;
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativePerfNow = performance.now.bind(performance);
  const nativeAnimPause = Animation.prototype.pause;
  const nativeAnimPlay = Animation.prototype.play;

  // ---- virtual clock ---------------------------------------------------------
  // Virtual time starts at the real performance.now() at injection time so the
  // values look plausible; from here on only `frame()` moves it forward.
  let now = nativePerfNow();
  const epochOffset = NativeDate.now() - now; // Date.now() = epochOffset + now
  const startNow = now;

  // ---- Date ------------------------------------------------------------------
  const VirtualDate = function (this: unknown, ...args: unknown[]) {
    if (!new.target) return new NativeDate(epochOffset + now).toString();
    return Reflect.construct(NativeDate, args.length ? args : [epochOffset + now], new.target);
  } as unknown as DateConstructor;
  Object.setPrototypeOf(VirtualDate, NativeDate);
  (VirtualDate as any).prototype = NativeDate.prototype;
  (VirtualDate as any).now = () => Math.floor(epochOffset + now);
  (VirtualDate as any).parse = NativeDate.parse;
  (VirtualDate as any).UTC = NativeDate.UTC;
  w.Date = VirtualDate;

  // ---- performance.now -------------------------------------------------------
  try {
    Object.defineProperty(performance, 'now', { value: () => now, configurable: true, writable: true });
  } catch {
    (performance as any).now = () => now;
  }

  // ---- timers ----------------------------------------------------------------
  type Timer = { due: number; seq: number; fn: unknown; args: unknown[]; interval: number | null };
  const timers = new Map<number, Timer>();
  let nextTimerId = 1;
  let timerSeq = 0;

  const report = (err: unknown) => {
    // surface page errors without breaking the frame loop
    if (typeof w.reportError === 'function') w.reportError(err);
    else nativeSetTimeout(() => { throw err; });
  };

  const addTimer = (fn: unknown, delay: unknown, args: unknown[], repeat: boolean) => {
    const d = Math.max(0, Number(delay) || 0);
    const id = nextTimerId++;
    timers.set(id, { due: now + d, seq: timerSeq++, fn, args, interval: repeat ? Math.max(1, d) : null });
    return id;
  };
  w.setTimeout = (fn: unknown, delay?: unknown, ...args: unknown[]) => addTimer(fn, delay, args, false);
  w.setInterval = (fn: unknown, delay?: unknown, ...args: unknown[]) => addTimer(fn, delay, args, true);
  w.clearTimeout = w.clearInterval = (id: number) => { timers.delete(Number(id)); };

  const callTimerFn = (fn: unknown, args: unknown[]) => {
    try {
      if (typeof fn === 'function') fn.apply(window, args);
      else (0, eval)(String(fn));
    } catch (e) { report(e); }
  };

  /** Runs all timers due up to `target` in chronological order. */
  const runTimersUntil = (target: number) => {
    let guard = 0;
    for (;;) {
      let nextId = -1;
      let next: Timer | null = null;
      for (const [id, t] of timers) {
        if (t.due <= target && (!next || t.due < next.due || (t.due === next.due && t.seq < next.seq))) {
          next = t; nextId = id;
        }
      }
      if (!next) break;
      if (++guard > 100000) { console.warn('[glide] timer loop guard hit'); break; }
      if (next.due > now) now = next.due;
      if (next.interval !== null) { next.due = now + next.interval; next.seq = timerSeq++; }
      else timers.delete(nextId);
      callTimerFn(next.fn, next.args);
    }
    now = target;
  };

  // ---- requestAnimationFrame -------------------------------------------------
  let rafQueue = new Map<number, FrameRequestCallback>();
  let nextRafId = 1;
  w.requestAnimationFrame = (cb: FrameRequestCallback) => { const id = nextRafId++; rafQueue.set(id, cb); return id; };
  w.cancelAnimationFrame = (id: number) => { rafQueue.delete(Number(id)); };
  const runRaf = () => {
    const queue = rafQueue;
    rafQueue = new Map();
    for (const cb of queue.values()) {
      try { cb(now); } catch (e) { report(e); }
    }
  };

  // requestIdleCallback -> virtual timer
  w.requestIdleCallback = (cb: IdleRequestCallback) =>
    addTimer(() => cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline), 1, [], false);
  w.cancelIdleCallback = w.clearTimeout;

  // ---- Web Animations (CSS animations, transitions, element.animate) ----------
  // Every animation on the document timeline is paused and its currentTime is
  // set from the virtual clock. Scroll-driven animations (ScrollTimeline /
  // ViewTimeline) are left alone, they follow the real scroll position.
  type Managed = { birth: number; base: number; userPaused: boolean };
  const managed = new Map<Animation, Managed>();
  let timelineFrozen = false;
  let internalCall = false;

  // Respect animations the page itself pauses/plays.
  Animation.prototype.pause = function (this: Animation) {
    const m = managed.get(this);
    if (m && !internalCall) {
      m.base = (this.currentTime as number) ?? 0;
      m.birth = now;
      m.userPaused = true;
    }
    return nativeAnimPause.call(this);
  };
  Animation.prototype.play = function (this: Animation) {
    const m = managed.get(this);
    const r = nativeAnimPlay.call(this);
    if (m && !internalCall) {
      m.base = (this.currentTime as number) ?? 0;
      m.birth = now;
      m.userPaused = false;
      internalCall = true;
      try { nativeAnimPause.call(this); } finally { internalCall = false; }
    }
    return r;
  };

  const syncAnimations = () => {
    const seen = new Set<Animation>();
    let all: Animation[] = [];
    try { all = document.getAnimations(); } catch { return; }
    internalCall = true;
    try {
      for (const a of all) {
        if (a.timeline !== document.timeline) continue; // scroll-driven
        seen.add(a);
        let m = managed.get(a);
        if (!m) {
          if (a.playState === 'paused' || a.playState === 'idle') continue; // paused by the page
          // When the document timeline is frozen (CDP), currentTime is the true
          // progress (usually 0 or a page-set offset). Without the freeze it
          // contains real-time drift from page load, so restart from 0.
          const base = timelineFrozen ? ((a.currentTime as number) ?? 0) : 0;
          m = { birth: now, base, userPaused: false };
          managed.set(a, m);
          nativeAnimPause.call(a);
        }
        if (m.userPaused) continue;
        const rate = a.playbackRate || 1;
        const t = m.base + (now - m.birth) * rate;
        const timing = a.effect?.getComputedTiming();
        const end = Number(timing?.endTime ?? Infinity);
        if (rate > 0 && Number.isFinite(end) && t >= end) {
          try { a.finish(); } catch { a.currentTime = end; }
          managed.delete(a); // finished: events fire, fill-mode keeps end state
        } else {
          a.currentTime = Math.max(0, t);
        }
      }
    } finally { internalCall = false; }
    for (const a of managed.keys()) if (!seen.has(a)) managed.delete(a);
  };

  // ---- <video> ---------------------------------------------------------------
  type ManagedVideo = { birth: number; base: number; synced: boolean };
  const videos = new Map<HTMLVideoElement, ManagedVideo>();
  let syncVideos = true;

  const seek = (v: HTMLVideoElement, t: number) =>
    new Promise<void>((resolve) => {
      const done = () => { v.removeEventListener('seeked', done); resolve(); };
      v.addEventListener('seeked', done);
      nativeSetTimeout(done, 2000);
      v.currentTime = t;
    });

  const syncVideoElements = async () => {
    if (!syncVideos) return;
    const pending: Promise<void>[] = [];
    for (const v of Array.from(document.querySelectorAll('video'))) {
      let m = videos.get(v);
      if (!m) {
        if (v.paused && !v.autoplay) continue;
        m = { birth: now, base: v.autoplay ? 0 : v.currentTime, synced: false };
        videos.set(v, m);
      }
      if (!v.paused) v.pause();
      if (!m.synced && v.readyState < 2 && v.preload !== 'none') {
        // first frame of this video: wait (once) until it has decodable data
        await new Promise<void>((resolve) => {
          const done = () => { v.removeEventListener('loadeddata', done); v.removeEventListener('error', done); resolve(); };
          v.addEventListener('loadeddata', done);
          v.addEventListener('error', done);
          nativeSetTimeout(done, 5000);
        });
      }
      if (v.readyState < 1 || !Number.isFinite(v.duration) || v.duration <= 0) continue;
      let t = m.base + (now - m.birth) / 1000;
      t = v.loop ? t % v.duration : Math.min(t, v.duration);
      // nudge past exact frame boundaries so the decoder picks the same frame every run
      t = Math.min(t + 0.001, v.duration);
      // always seek once: autoplay videos may have run in real time during page load
      if (!m.synced || Math.abs(v.currentTime - t) > 0.0005) pending.push(seek(v, t));
      m.synced = true;
    }
    await Promise.all(pending);
  };

  // ---- images / fonts --------------------------------------------------------
  const waitForImages = async (timeout: number) => {
    const vh = window.innerHeight;
    const pending: Promise<unknown>[] = [];
    for (const img of Array.from(document.images)) {
      if (img.complete) continue;
      const r = img.getBoundingClientRect();
      if (r.bottom < -vh || r.top > 2 * vh) continue;
      pending.push(new Promise((res) => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
      }).then(() => img.decode().catch(() => {})));
    }
    if (document.fonts && document.fonts.status === 'loading') pending.push(document.fonts.ready);
    if (!pending.length) return;
    await Promise.race([Promise.all(pending), new Promise((r) => nativeSetTimeout(r, timeout))]);
  };

  const nativeFrame = () => new Promise<void>((r) => nativeRAF(() => r()));

  // ---- scroll drivers ----------------------------------------------------------
  type Driver = { kind: 'native' | 'lenis' | 'custom'; lenisPath?: string; hook?: string };
  let driver: Driver = { kind: 'native' };
  let customHook: ((y: number) => unknown) | null = null;

  const resolvePath = (path: string): any =>
    path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), window);

  const scrollEl = () => document.scrollingElement || document.documentElement;

  const setScroll = async (y: number) => {
    if (driver.kind === 'lenis') {
      const lenis = resolvePath(driver.lenisPath || 'lenis');
      if (lenis && typeof lenis.scrollTo === 'function') {
        lenis.scrollTo(y, { immediate: true, force: true });
        return;
      }
    } else if (driver.kind === 'custom' && customHook) {
      await customHook(y);
      return;
    }
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
  };

  const getMaxScroll = () => {
    if (driver.kind === 'lenis') {
      const lenis = resolvePath(driver.lenisPath || 'lenis');
      if (lenis && typeof lenis.limit === 'number') return lenis.limit;
    }
    const el = scrollEl();
    return Math.max(0, el.scrollHeight - window.innerHeight);
  };

  // ---- public API (called from Node via page.evaluate) ----------------------
  w.__glide = {
    get now() { return now - startNow; },
    setTimelineFrozen(v: boolean) { timelineFrozen = v; },
    setSyncVideos(v: boolean) { syncVideos = v; },

    detectLenis(path: string) {
      const l = resolvePath(path);
      return !!(l && typeof l.scrollTo === 'function');
    },
    hasLenisMarkup() {
      return document.documentElement.classList.contains('lenis');
    },
    setDriver(d: Driver) {
      driver = d;
      customHook = null;
      if (d.kind === 'custom' && d.hook) {
        // eslint-disable-next-line no-new-func
        customHook = (0, eval)(`(${d.hook})`);
        if (typeof customHook !== 'function') throw new Error('custom scroll hook must evaluate to a function');
      }
      if (d.kind === 'lenis') {
        const lenis = resolvePath(d.lenisPath || 'lenis');
        try { lenis?.resize?.(); } catch { /* ignore */ }
        try { lenis?.start?.(); } catch { /* ignore */ }
      }
    },
    getMaxScroll,
    getScrollY() {
      if (driver.kind === 'lenis') {
        const lenis = resolvePath(driver.lenisPath || 'lenis');
        if (lenis && typeof lenis.scroll === 'number') return lenis.scroll;
      }
      return window.scrollY;
    },
    getViewportHeight() { return window.innerHeight; },

    /** Absolute top positions (document coordinates) of elements matching `selector`. */
    sectionTops(selector: string, minHeight: number) {
      const sy = window.scrollY;
      const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
      // keep only outermost matches (no nested sections)
      const outer = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
      return outer
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r, el }) => r.height >= minHeight && getComputedStyle(el).display !== 'none')
        .map(({ r }) => r.top + sy);
    },

    /** Advance virtual time without changing scroll (used for warm-up). */
    async advance(ms: number) {
      const step = 1000 / 60;
      const target = now + ms;
      while (now < target - 1e-6) {
        const t = Math.min(target, now + step);
        await nativeFrame();
        runTimersUntil(t);
        runRaf();
        syncAnimations();
      }
      await syncVideoElements();
    },

    /**
     * Renders one video frame: scroll -> let the browser dispatch scroll events
     * and IntersectionObserver callbacks -> advance timers -> run rAF callbacks
     * (GSAP, ScrollTrigger, Lenis) -> seek CSS/WAAPI animations and videos ->
     * wait for images in view. The caller captures a screenshot afterwards.
     */
    async frame(y: number | null, dt: number, imageTimeout: number) {
      if (y !== null) await setScroll(y);
      // two native frames: scroll events + IO observation, then IO callbacks
      await nativeFrame();
      await nativeFrame();
      runTimersUntil(now + dt);
      runRaf();
      syncAnimations();
      await syncVideoElements();
      await waitForImages(imageTimeout);
      // a last style/layout flush so the screenshot shows the final state
      void document.documentElement.offsetHeight;
      return w.__glide.getScrollY();
    },
  };
}
