import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices, type Browser, type CDPSession, type Page } from 'playwright';
import { resolveOutputSize, resolveViewport, type Config } from './config.js';
import { checkFfmpeg, FrameEncoder } from './ffmpeg.js';
import { installScrollreelRuntime } from './page/runtime.js';
import { buildTimeline, frameCount, scrollAt, type Timeline } from './timeline.js';

export const AUTO_SECTION_SELECTOR = 'body > header, header, section, footer, [data-scrollreel-section]';

export interface RecordOptions {
  output: string;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  onProgress?: (p: Progress) => void;
  /** also write every n-th frame as an image into this directory (debugging) */
  debugFramesDir?: string;
  debugEvery?: number;
  /** JS expression evaluated in the page after every frame; results are returned (testing). */
  probe?: string;
}

export interface Progress {
  frame: number;
  total: number;
  phase: 'intro' | 'scroll';
  elapsedMs: number;
}

export interface RecordResult {
  output: string;
  frames: number;
  duration: number;
  driver: string;
  maxScroll: number;
  timeline: Timeline;
  timelineFrozen: boolean;
  renderMs: number;
  /** per-frame scrollY reported by the page */
  scrollPositions: number[];
  probes: unknown[];
}

declare global {
  interface Window {
    __scrollreel: any;
  }
}

export async function record(config: Config, opts: RecordOptions): Promise<RecordResult> {
  const log = opts.log ?? (() => {});
  const warn = opts.warn ?? log;
  const encoderName = config.format === 'mp4' ? 'libx264' : 'libvpx-vp9';
  const ffmpeg = await checkFfmpeg(encoderName);

  const vp = resolveViewport(config);
  const out = resolveOutputSize(config);
  const isMobile = vp.preset === 'mobile' || vp.width < 600;

  const browser: Browser = await chromium.launch({
    headless: !config.headful,
    args: [
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  let encoder: FrameEncoder | null = null;
  try {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: config.deviceScaleFactor,
      isMobile,
      hasTouch: isMobile,
      userAgent: config.userAgent ?? (isMobile ? devices['iPhone 14'].userAgent : undefined),
      reducedMotion: 'no-preference',
      colorScheme: config.colorScheme ?? null,
      extraHTTPHeaders: config.headers,
    });
    // Serialized manually: dev runners (tsx/esbuild) may wrap functions in a
    // `__name` helper that does not exist inside the page.
    await context.addInitScript({
      content:
        `(() => { const __name = (f) => f; ` +
        `(${installScrollreelRuntime.toString()})(${JSON.stringify({ seed: config.randomSeed })}); })();`,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(config.timeout);
    page.on('pageerror', (e) => warn(`page error: ${e.message}`));
    const cdp = await context.newCDPSession(page);

    // Freeze the document timeline so CSS animations cannot progress in real
    // time between frames (and during page load). The in-page runtime seeks
    // them via the Web Animations API.
    const timelineFrozen = await freezeTimeline(cdp);
    if (!timelineFrozen) warn('could not freeze the animation timeline via CDP, falling back to WAAPI only');

    const load = async (reload = false) => {
      if (reload) await page.reload({ waitUntil: 'load' });
      else await page.goto(config.url, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: Math.min(15000, config.timeout) }).catch(() => {
        warn('network did not become idle within 15s, continuing');
      });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await freezeTimeline(cdp);
      await page.evaluate((v) => window.__scrollreel.setTimelineFrozen(v), timelineFrozen);
    };

    log(`Loading ${config.url}`);
    await load();
    await preparePage(page, config);

    if (config.prepass) {
      log('Pre-pass: scrolling through the page to trigger lazy loading');
      await prepass(page, config);
      log('Reloading for fresh intro animations');
      await load(true);
      await preparePage(page, config);
    }

    const driver = await selectDriver(page, config, warn);
    log(`Scroll driver: ${driver}`);

    if (config.warmup > 0) {
      await page.evaluate((ms) => window.__scrollreel.advance(ms), config.warmup * 1000);
    }

    // ---- encoder -----------------------------------------------------------
    await mkdir(path.dirname(path.resolve(opts.output)), { recursive: true });
    encoder = new FrameEncoder(ffmpeg, {
      output: opts.output,
      fps: config.fps,
      width: out.width,
      height: out.height,
      format: config.format,
      inputCodec: config.captureFormat,
      crf: config.crf,
      preset: config.encoderPreset,
    });
    if (opts.debugFramesDir) await mkdir(opts.debugFramesDir, { recursive: true });

    const dt = 1000 / config.fps;
    const started = Date.now();
    let frame = 0;
    const scrollPositions: number[] = [];
    const probes: unknown[] = [];
    const shoot = async (y: number, total: number, phase: Progress['phase']) => {
      const actualY = await page.evaluate(
        ([y, dt, to]) => window.__scrollreel.frame(y, dt, to) as Promise<number>,
        [y, frame === 0 ? 0 : dt, config.imageTimeout] as const,
      );
      scrollPositions.push(actualY);
      if (opts.probe) probes.push(await page.evaluate(opts.probe));
      const shot = await cdp.send('Page.captureScreenshot', {
        format: config.captureFormat,
        quality: config.captureFormat === 'jpeg' ? config.captureQuality : undefined,
        optimizeForSpeed: true,
        captureBeyondViewport: false,
      });
      const buf = Buffer.from(shot.data, 'base64');
      await encoder!.write(buf);
      if (opts.debugFramesDir && frame % (opts.debugEvery ?? 30) === 0) {
        const name = `frame-${String(frame).padStart(5, '0')}.${config.captureFormat === 'jpeg' ? 'jpg' : 'png'}`;
        await writeFile(path.join(opts.debugFramesDir, name), buf);
      }
      frame++;
      opts.onProgress?.({ frame, total, phase, elapsedMs: Date.now() - started });
    };

    // ---- intro: stay at the top --------------------------------------------
    const introFrames = Math.round(config.introDuration * config.fps);
    const estimate = async () => {
      const tl = await planTimeline(page, config, 0);
      return introFrames + frameCount(tl, config.fps);
    };
    let total = Math.max(1, await estimate());
    for (let i = 0; i < introFrames; i++) {
      await shoot(0, total, 'intro');
      if (i === 0) total = Math.max(1, await estimate()); // layout settles after first frame
    }

    // ---- scroll + outro: measure now (pins, lazy content have settled) ------
    const timeline = await planTimeline(page, config, 0);
    if (timeline.compressedBy) {
      warn(`timeline exceeds maxDuration (${config.maxDuration}s): scrolling ${(1 / timeline.compressedBy).toFixed(2)}× faster`);
    }
    const maxScroll = await page.evaluate(() => window.__scrollreel.getMaxScroll() as number);
    const rest = frameCount(timeline, config.fps);
    total = introFrames + rest;
    for (let i = 0; i < rest; i++) {
      await shoot(scrollAt(timeline, i / config.fps), total, 'scroll');
    }

    await encoder.finish();
    encoder = null;
    return {
      output: opts.output,
      frames: frame,
      duration: frame / config.fps,
      driver,
      maxScroll,
      timeline,
      timelineFrozen,
      renderMs: Date.now() - started,
      scrollPositions,
      probes,
    };
  } finally {
    encoder?.abort();
    await browser.close().catch(() => {});
  }
}

async function freezeTimeline(cdp: CDPSession): Promise<boolean> {
  if (process.env.SCROLLREEL_NO_CDP_FREEZE) return false; // debugging / comparison only
  try {
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
    return true;
  } catch {
    return false;
  }
}

/** Hide elements, inject CSS/JS, force eager images and wait until they are loaded. */
async function preparePage(page: Page, c: Config): Promise<void> {
  const css = [
    c.hideSelectors.length
      ? `${c.hideSelectors.join(',\n')} { display: none !important; visibility: hidden !important; }`
      : '',
    c.hideScrollbar
      ? 'html { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }'
      : '',
    // smooth scroll-behavior would turn every scrollTo into an animation
    'html, body { scroll-behavior: auto !important; }',
    c.injectCss ?? '',
  ].join('\n');
  await page.addStyleTag({ content: css });
  if (c.injectScript) {
    await page.evaluate(`(async () => { ${c.injectScript}\n })()`);
  }
  if (c.eagerImages) {
    await page.evaluate(() => {
      for (const img of Array.from(document.images)) if (img.loading === 'lazy') img.loading = 'eager';
    });
  }
  await page
    .waitForFunction(() => Array.from(document.images).every((i) => i.complete), undefined, { timeout: 15000 })
    .catch(() => {});
}

/** Scroll through the whole page (advancing virtual time) so lazy content gets requested and cached. */
async function prepass(page: Page, c: Config): Promise<void> {
  await selectDriver(page, c, () => {});
  const vh = await page.evaluate(() => window.innerHeight);
  let y = 0;
  for (let guard = 0; guard < 500; guard++) {
    const max = await page.evaluate(() => window.__scrollreel.getMaxScroll() as number);
    await page.evaluate(([y]) => window.__scrollreel.frame(y, 100, 3000), [Math.min(y, max)] as const);
    if (y >= max) break;
    y += vh * 0.7;
  }
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => window.__scrollreel.frame(0, 100, 3000));
}

async function selectDriver(page: Page, c: Config, warn: (m: string) => void): Promise<string> {
  let kind: 'native' | 'lenis' | 'custom' = 'native';
  if (c.scrollDriver === 'custom') kind = 'custom';
  else if (c.scrollDriver === 'native') kind = 'native';
  else {
    const hasLenis = await page.evaluate((p) => window.__scrollreel.detectLenis(p) as boolean, c.lenisPath);
    if (hasLenis) kind = 'lenis';
    else if (c.scrollDriver === 'lenis') {
      throw new Error(`scrollDriver "lenis": no Lenis instance found at window.${c.lenisPath}. Expose it (window.lenis = lenis) or set "lenisPath".`);
    } else if (await page.evaluate(() => window.__scrollreel.hasLenisMarkup() as boolean)) {
      warn(`page uses Lenis but window.${c.lenisPath} is not set - falling back to native scrolling. Expose the instance or set "lenisPath" for best results.`);
    }
  }
  await page.evaluate((d) => window.__scrollreel.setDriver(d), {
    kind,
    lenisPath: c.lenisPath,
    hook: c.scrollHook,
  });
  return kind;
}

async function planTimeline(page: Page, c: Config, introDuration: number): Promise<Timeline> {
  const maxScroll = await page.evaluate(() => window.__scrollreel.getMaxScroll() as number);
  const vh = await page.evaluate(() => window.innerHeight);
  let stops: number[] | undefined;
  if (c.scroll.mode === 'sections') {
    const selector = c.scroll.sections
      ? Array.isArray(c.scroll.sections) ? c.scroll.sections.join(',') : c.scroll.sections
      : AUTO_SECTION_SELECTOR;
    const tops = await page.evaluate(
      ([sel, minH]) => window.__scrollreel.sectionTops(sel, minH) as number[],
      [selector, c.scroll.sections ? 1 : vh * 0.25] as const,
    );
    stops = tops.map((t) => t - c.scroll.sectionOffset);
  }
  return buildTimeline({
    maxScroll,
    mode: c.scroll.mode,
    speed: c.scroll.speed,
    duration: c.scroll.duration,
    easing: c.scroll.easing,
    pauseDuration: c.scroll.pauseDuration,
    minSegmentDuration: c.scroll.minSegmentDuration,
    introDuration,
    outroDuration: c.outroDuration,
    maxDuration: Math.max(1, c.maxDuration - c.introDuration),
    stops,
    minStopDistance: vh * 0.3,
  });
}
