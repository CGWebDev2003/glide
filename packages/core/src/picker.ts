import type { Browser, CDPSession, Page } from 'playwright';
import { resolveViewport, type Config } from './config.js';
import { installPickerRuntime } from './page/picker-runtime.js';
import { launchBrowser, newContext } from './recorder.js';

export type PickMode = 'hover' | 'click' | 'hide';
export interface PickRect { x: number; y: number; width: number; height: number }
export interface PickCandidate { selector: string; label: string; rect: PickRect }
/** Element under a point: `chain[0]` is the innermost hit, later entries its ancestors. */
export interface PickResult { start: number; chain: PickCandidate[] }

declare global {
  interface Window {
    __glidePick: any;
  }
}

/**
 * A live page for choosing elements before a recording: same viewport, user
 * agent and hidden elements as the recording, but in real time and at 1×
 * scale so screenshots are fast. The UI shows screenshots and sends pointer
 * positions; `inspect` answers with a stable selector for the element there.
 */
export class PickerSession {
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
      return new PickerSession(browser, page, cdp, vp.width, vp.height);
    } catch (e) {
      await browser.close().catch(() => {});
      throw e;
    }
  }

  async screenshot(quality = 70): Promise<Buffer> {
    const shot = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true });
    return Buffer.from(shot.data, 'base64');
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
  async rects(targets: { selector: string; text?: string }[]): Promise<(PickRect | null)[]> {
    return this.page.evaluate((t) => window.__glidePick.rects(t) as (PickRect | null)[], targets);
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => {});
  }
}
