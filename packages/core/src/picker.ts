import type { Browser, CDPSession, Page } from 'playwright';
import { resolveViewport, type Config } from './config.js';
import { installPickerRuntime } from './page/picker-runtime.js';
import { launchBrowser, newContext } from './recorder.js';

export type PickMode = 'hover' | 'click' | 'hide';
export interface PickRect { x: number; y: number; width: number; height: number }
export interface PickCandidate { selector: string; label: string; rect: PickRect }
/** Element under a point: `chain[0]` is the innermost hit, later entries its ancestors. */
export interface PickResult { start: number; chain: PickCandidate[] }
export interface PickTarget { selector: string; text?: string }
/** A preview frame plus the action target rects measured for it (`seq` grows with every frame). */
export interface PickFrame { seq: number; image: Buffer; rects: (PickRect | null)[] }

declare global {
  interface Window {
    __glidePick: any;
  }
}

/**
 * A live page for choosing elements before a recording: same viewport, user
 * agent and hidden elements as the recording, but in real time and at 1×
 * scale. Chromium pushes a frame whenever the page changes (screencast); the
 * UI long-polls `nextFrame` and sends pointer positions, and `inspect`
 * answers with a stable selector for the element there.
 */
export class PickerSession {
  private frame: PickFrame | null = null;
  private waiters = new Set<() => void>();
  private targets: PickTarget[] = [];
  private closed = false;

  private constructor(
    private browser: Browser,
    private page: Page,
    private cdp: CDPSession,
    readonly width: number,
    readonly height: number,
  ) {}

  static async open(config: Config): Promise<PickerSession> {
    const browser = await launchBrowser({ ...config, headful: false });
    try {
      const context = await newContext(browser, config, 1);
      await context.addInitScript({ content: `(() => { const __name = (f) => f; (${installPickerRuntime.toString()})(); })();` });
      const page = await context.newPage();
      page.setDefaultTimeout(config.timeout);
      // a click in the preview must never leave the page
      await page.route('**/*', (route) =>
        route.request().isNavigationRequest() && route.request().frame() === page.mainFrame() && page.url() !== 'about:blank'
          ? route.abort()
          : route.fallback(),
      );
      await page.goto(config.url, { waitUntil: 'domcontentloaded' });
      const css = [
        config.hideScrollbar ? 'html { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }' : '',
        config.injectCss ?? '',
      ].join('\n');
      await page.addStyleTag({ content: css });
      await page.evaluate((s) => window.__glidePick.setHidden(s), config.hideSelectors);
      const cdp = await context.newCDPSession(page);
      const vp = resolveViewport(config);
      const session = new PickerSession(browser, page, cdp, vp.width, vp.height);
      cdp.on('Page.screencastFrame', (f) => void session.onFrame(f.data, f.sessionId));
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 });
      return session;
    } catch (e) {
      await browser.close().catch(() => {});
      throw e;
    }
  }

  /**
   * Measures the targets right away, so the marks match the frame they are
   * shown on. Chromium sends the next frame only after the ack, which keeps
   * slow clients from piling up frames.
   */
  private async onFrame(data: string, sessionId: number) {
    try {
      const rects = this.targets.length ? await this.rects(this.targets).catch(() => this.frame?.rects ?? []) : [];
      this.publish(Buffer.from(data, 'base64'), rects);
    } finally {
      await this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    }
  }

  private publish(image: Buffer, rects: (PickRect | null)[]) {
    this.frame = { seq: (this.frame?.seq ?? 0) + 1, image, rects };
    for (const w of [...this.waiters]) w();
  }

  /** The newest frame after `after`; waits up to `timeout` ms for one (null = none came). */
  nextFrame(after: number, timeout = 10_000): Promise<PickFrame | null> {
    const fresh = () => (this.frame && this.frame.seq > after ? this.frame : null);
    if (fresh() || this.closed) return Promise.resolve(fresh());
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve(fresh());
      };
      const timer = setTimeout(done, timeout);
      this.waiters.add(done);
    });
  }

  /** Action targets whose rects come with every frame (numbered marks in the UI). */
  async setTargets(targets: PickTarget[]): Promise<void> {
    this.targets = targets;
    // the page may not change, so republish the current frame with the new marks
    const rects = targets.length ? await this.rects(targets) : [];
    if (this.frame) this.publish(this.frame.image, rects);
  }

  /** Moves the mouse there (the page shows its hover state) and describes the element. */
  async inspect(x: number, y: number, mode: PickMode): Promise<PickResult | null> {
    await this.page.mouse.move(x, y);
    return this.page.evaluate(([x, y, m]) => window.__glidePick.inspect(x, y, m) as PickResult | null, [x, y, mode] as const);
  }

  async scroll(dy: number, x = this.width / 2, y = this.height / 2): Promise<void> {
    await this.page.mouse.move(x, y);
    await this.page.mouse.wheel(0, dy);
  }

  async setHidden(selectors: string[]): Promise<void> {
    await this.page.evaluate((s) => window.__glidePick.setHidden(s), selectors);
  }

  /** Viewport rects of action targets (null = not found or not visible). */
  async rects(targets: PickTarget[]): Promise<(PickRect | null)[]> {
    return this.page.evaluate((t) => window.__glidePick.rects(t) as (PickRect | null)[], targets);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const w of [...this.waiters]) w();
    await this.browser.close().catch(() => {});
  }
}
