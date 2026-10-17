import type { Browser, CDPSession, Page } from 'playwright';
import { resolveViewport, type Action, type Config } from './config.js';
import { installPickerRuntime } from './page/picker-runtime.js';
import { launchBrowser, newContext } from './recorder.js';

export type PickMode = 'hover' | 'click' | 'hide' | 'type' | 'scroll';
export interface PickRect { x: number; y: number; width: number; height: number }
export interface PickCandidate { selector: string; label: string; rect: PickRect }
/** Element under a point: `chain[0]` is the innermost hit, later entries its ancestors. */
export interface PickResult { start: number; chain: PickCandidate[] }
export interface PickTarget { selector: string; text?: string }
/** The text of a type action, shown in its field. */
export interface PickValue extends PickTarget { value: string }
/** A preview frame plus the action target rects measured for it (`seq` grows with every frame). */
export interface PickFrame { seq: number; image: Buffer; rects: (PickRect | null)[] }
/** Tours: what a step did in the preview. `navigated`: it opened another page. */
export interface PickStepResult { ok: boolean; navigated: boolean; url: string }

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
  private values: PickValue[] = [];
  private closed = false;
  /** tours: pages loaded so far, and whether the page started loading another one */
  private documents = 0;
  private navigating = false;

  private constructor(
    private browser: Browser,
    private page: Page,
    private cdp: CDPSession,
    private config: Config,
    readonly width: number,
    readonly height: number,
  ) {
    this.hidden = config.hideSelectors;
  }

  private hidden: string[];

  get tour(): boolean {
    return this.config.kind === 'tour';
  }

  /** The page shown in the preview. */
  get url(): string {
    return this.page.url();
  }

  static async open(config: Config): Promise<PickerSession> {
    const browser = await launchBrowser({ ...config, headful: false });
    try {
      const context = await newContext(browser, config, 1);
      const tour = config.kind === 'tour';
      await context.addInitScript({
        content: `(() => { const __name = (f) => f; (${installPickerRuntime.toString()})(${JSON.stringify({ tour })}); })();`,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(config.timeout);
      if (!tour) {
        // a click in the preview must never leave the page
        await page.route('**/*', (route) =>
          route.request().isNavigationRequest() && route.request().frame() === page.mainFrame() && page.url() !== 'about:blank'
            ? route.abort()
            : route.fallback(),
        );
      }
      const cdp = await context.newCDPSession(page);
      const vp = resolveViewport(config);
      const session = new PickerSession(browser, page, cdp, config, vp.width, vp.height);
      if (tour) {
        // tours click through to other pages: each one gets the same treatment
        page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) session.navigating = true; });
        page.on('domcontentloaded', () => {
          session.documents++;
          session.values = [];
          void session.prepare().catch(() => {});
        });
      }
      await page.goto(config.url, { waitUntil: 'domcontentloaded' });
      if (!tour) await session.prepare();
      cdp.on('Page.screencastFrame', (f) => void session.onFrame(f.data, f.sessionId));
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 });
      return session;
    } catch (e) {
      await browser.close().catch(() => {});
      throw e;
    }
  }

  /** Scrollbar, own CSS and the hidden elements, like in the recording. */
  private async prepare() {
    const css = [
      this.config.hideScrollbar ? 'html { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }' : '',
      this.config.injectCss ?? '',
    ].join('\n');
    await this.page.addStyleTag({ content: css });
    await this.page.evaluate((s) => window.__glidePick.setHidden(s), this.hidden);
  }

  /**
   * Measures the targets right away, so the marks match the frame they are
   * shown on. Chromium sends the next frame only after the ack, which keeps
   * slow clients from piling up frames. Fields that showed up since the last
   * frame (embedded widgets, SPAs) get their texts.
   */
  private async onFrame(data: string, sessionId: number) {
    try {
      if (this.values.length) await this.applyValues().catch(() => {});
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
    this.hidden = selectors;
    await this.page.evaluate((s) => window.__glidePick.setHidden(s), selectors);
  }

  /**
   * Tours: runs a step in the preview, so the next ones can be picked on
   * what it leads to (a dialog, another page). Waits for a page it opens.
   */
  async run(step: Action): Promise<PickStepResult> {
    const before = this.documents;
    this.navigating = false;
    let ok = true;
    const at = step.selector
      ? await this.page.evaluate(([s, t]) => window.__glidePick.reveal(s, t) as { x: number; y: number } | null, [step.selector, step.text] as const)
      : null;
    switch (step.type) {
      case 'click':
      case 'hover':
        if (!at) { ok = false; break; }
        if (step.type === 'click') await this.page.mouse.click(at.x, at.y);
        else await this.page.mouse.move(at.x, at.y);
        break;
      case 'type':
        ok = !!at && await this.page.evaluate(([s, t, v]) => window.__glidePick.fill(s, t, v) as boolean, [step.selector!, step.text, step.value ?? ''] as const);
        if (ok && step.value?.includes('\n')) await this.page.keyboard.press('Enter');
        break;
      case 'scroll':
        if (!step.selector) await this.page.evaluate((to) => window.scrollTo(0, to === 'top' ? 0 : to === 'bottom' ? document.documentElement.scrollHeight : Number(to)), step.to ?? 0);
        else ok = !!at;
        break;
      case 'press':
        await this.page.keyboard.press(step.key!);
        break;
      case 'goto':
        await this.page.goto(new URL(step.url!, this.page.url()).href, { waitUntil: 'domcontentloaded' });
        break;
      case 'wait':
        break;
    }
    // give a navigation the click started a moment to show up, then wait for the page
    const deadline = Date.now() + 400;
    while (!this.navigating && this.documents === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    if (this.navigating || this.documents !== before) {
      const end = Date.now() + this.config.timeout;
      while (this.documents === before && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    return { ok, navigated: this.documents !== before, url: this.page.url() };
  }

  /**
   * Tours: opens the start page again and runs `steps` (quickly, without
   * pauses) to get back to where they lead. Resolves to the index of the
   * first step on the page shown now.
   */
  async replay(steps: Action[]): Promise<{ pageStart: number; failed: number[]; url: string }> {
    await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded' });
    let pageStart = 0;
    const failed: number[] = [];
    for (const [i, step] of steps.entries()) {
      const r = await this.run(step).catch(() => ({ ok: false, navigated: false }));
      if (!r.ok) failed.push(i);
      if (r.navigated) pageStart = i + 1;
      // dialogs and menus open with an animation (real time here)
      else if (step.type === 'click' || step.type === 'press') await new Promise((res) => setTimeout(res, 350));
    }
    return { pageStart, failed, url: this.page.url() };
  }

  /** Shows the texts of type actions in their fields (fields left out get their content back). */
  async setValues(values: PickValue[]): Promise<void> {
    this.values = values;
    await this.applyValues();
  }

  private applyValues() {
    return this.page.evaluate((v) => window.__glidePick.setValues(v), this.values);
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
