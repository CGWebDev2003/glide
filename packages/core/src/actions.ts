import type { Page } from 'playwright';
import type { Action, Config } from './config.js';
import { EASINGS } from './easing.js';

/** An action whose element was found, with the scroll position it runs at. */
export interface ResolvedAction extends Action {
  /** position in config.actions (for messages) */
  index: number;
  /** scroll position (document px) while the action runs */
  y: number;
  /** total seconds: cursor travel + time on the element */
  total: number;
}

type Rect = { x: number; y: number; width: number; height: number; docY: number; vw: number; vh: number };

/** How long the mouse button stays down on a click (s). */
const PRESS = 0.12;
/** Cursor fade in/out (s). */
const FADE = 0.25;

export const describeAction = (a: Action & { index: number }) =>
  `action ${a.index + 1} (${a.type} "${a.selector}"${a.text ? ` with text "${a.text}"` : ''})`;

export async function locate(page: Page, a: Action): Promise<Rect | null> {
  return page.evaluate(([sel, text]) => window.__glide.locate(sel, text) as Rect | null, [a.selector, a.text] as const);
}

/**
 * Finds every action's element and picks the scroll position to stop at:
 * the element centred in the viewport (tall elements: their top near the top).
 * An element that is already fully visible at the previous action's stop
 * shares that stop, so several buttons in one view need no scrolling between.
 */
export async function resolveActions(page: Page, c: Config, warn: (m: string) => void): Promise<ResolvedAction[]> {
  if (!c.actions.length) return [];
  const maxScroll = await page.evaluate(() => window.__glide.getMaxScroll() as number);
  const found: { a: Action; index: number; r: Rect }[] = [];
  for (const [index, a] of c.actions.entries()) {
    const r = await locate(page, a);
    if (r) found.push({ a, index, r });
    else warn(`${describeAction({ ...a, index })}: element not found or not visible, skipped`);
  }
  found.sort((p, q) => p.r.docY - q.r.docY || p.index - q.index);

  const out: ResolvedAction[] = [];
  for (const { a, index, r } of found) {
    const margin = r.vh * 0.08;
    const prev = out[out.length - 1];
    const fits = (y: number) => r.docY >= y + margin && r.docY + r.height <= y + r.vh - margin;
    let y: number;
    if (prev && fits(prev.y)) y = prev.y;
    else {
      y = r.height > r.vh * 0.7 ? r.docY - r.vh * 0.12 : r.docY + r.height / 2 - r.vh / 2;
      y = Math.round(Math.min(maxScroll, Math.max(0, y)));
    }
    const total = a.moveDuration + Math.max(a.duration, a.type === 'click' ? PRESS + 0.05 : 0);
    out.push({ ...a, index, y, total });
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = EASINGS.easeInOutCubic;

/**
 * Drives the real mouse (hover/click through Chromium's input pipeline) and the
 * drawn cursor, one video frame at a time. Called before each frame is rendered.
 */
export class ActionPlayer {
  private pos: { x: number; y: number } | null = null;
  private opacity = 0;
  private scale = 1;
  private mouseInside = false;
  private segment = -1;
  private from = { x: 0, y: 0 };
  private target: { x: number; y: number } | null = null;
  private fadeIn = false;
  private pressedAt: number | null = null;
  private released = false;
  private warned = new Set<number>();

  constructor(
    private page: Page,
    private style: 'arrow' | 'touch' | 'none',
    private size: number,
    private warn: (m: string) => void,
  ) {}

  /** A frame inside an action segment; `elapsed` = seconds since the segment started. */
  async step(segment: number, a: ResolvedAction, elapsed: number): Promise<void> {
    const first = segment !== this.segment;
    if (first) {
      await this.release();
      this.segment = segment;
      this.pressedAt = null;
      this.released = false;
      this.target = null;
    }
    const arrived = elapsed >= a.moveDuration;
    if (!this.target || !arrived) {
      // follow the element while travelling (layout may still shift), then lock
      const r = await locate(this.page, a);
      if (r) this.target = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      else if (!this.target) {
        if (!this.warned.has(a.index)) this.warn(`${describeAction(a)}: element disappeared, skipped`);
        this.warned.add(a.index);
        return this.idle(1 / 60);
      }
      if (r && this.target && (this.target.y < 0 || this.target.y > r.vh) && !this.warned.has(a.index)) {
        this.warned.add(a.index);
        this.warn(`${describeAction(a)}: element is outside the viewport at its stop`);
      }
    }
    const t = this.target!;
    if (first) {
      this.fadeIn = this.opacity < 1 || !this.pos;
      // a hidden cursor appears a little below/right of the element and glides in
      this.from = this.fadeIn || !this.pos
        ? { x: t.x + this.size * 4, y: t.y + this.size * 3 }
        : { ...this.pos };
    }
    const k = a.moveDuration > 0 ? ease(clamp(elapsed / a.moveDuration, 0, 1)) : 1;
    this.pos = { x: this.from.x + (t.x - this.from.x) * k, y: this.from.y + (t.y - this.from.y) * k };
    if (this.fadeIn) this.opacity = Math.max(this.opacity, clamp(elapsed / FADE, 0, 1));
    await this.page.mouse.move(this.pos.x, this.pos.y);
    this.mouseInside = true;

    if (a.type === 'click' && arrived) {
      if (this.pressedAt === null) {
        this.pressedAt = elapsed;
        await this.page.mouse.down();
      } else if (!this.released && elapsed >= this.pressedAt + PRESS) {
        await this.release();
      }
    }
    // press feedback: shrink while down, spring back afterwards
    if (this.pressedAt !== null && !this.released) this.scale = 0.8;
    else if (this.pressedAt !== null) this.scale = 0.8 + 0.2 * clamp((elapsed - this.pressedAt - PRESS) / 0.15, 0, 1);
    else this.scale = 1;
    await this.draw();
  }

  /** A frame outside any action: let go of the element and fade the cursor out. */
  async idle(dt: number): Promise<void> {
    this.segment = -1;
    await this.release();
    if (this.mouseInside) {
      // leave the page so :hover ends and nothing else gets hovered while scrolling
      await this.page.mouse.move(-1, -1);
      this.mouseInside = false;
    }
    if (this.opacity > 0) {
      this.opacity = Math.max(0, this.opacity - dt / FADE);
      this.scale = 1;
      await this.draw();
    }
  }

  private async release() {
    if (this.pressedAt !== null && !this.released) {
      this.released = true;
      await this.page.mouse.up();
    }
  }

  private async draw() {
    if (this.style === 'none' || !this.pos) return;
    const c = { ...this.pos, opacity: this.opacity, scale: this.scale, style: this.style, size: this.size };
    await this.page.evaluate((c) => window.__glide.cursor(c), c);
  }
}
