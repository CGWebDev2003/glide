import type { CDPSession, Page } from 'playwright';
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

export type Rect = { x: number; y: number; width: number; height: number; docY: number; vw: number; vh: number; fixed: boolean };

/** How long the mouse button stays down on a click (s). */
const PRESS = 0.12;
/** Cursor fade in/out (s). */
const FADE = 0.25;
/** Pause between clicking into a field and the first keystroke (s). */
const TYPE_GAP = 0.2;
/** Once typing stops, the caret is on and off for this long each (s). */
const BLINK = 0.5;

/** Seconds into a type action when the first character is typed. */
const typingStart = (a: Action) => a.moveDuration + PRESS + TYPE_GAP;

/** Characters of `value` typed `t` seconds after typing started (the first one at t = 0). */
export const typedCount = (value: string, speed: number, t: number) =>
  t < 0 ? 0 : Math.min([...value].length, Math.floor(t * speed + 1e-6) + 1);

/** Total seconds of an action: cursor travel plus the time on the element. */
export function actionDuration(a: Action): number {
  if (a.type === 'type') return typingStart(a) + [...(a.value ?? '')].length / a.typingSpeed + a.duration;
  return a.moveDuration + Math.max(a.duration, a.type === 'click' ? PRESS + 0.05 : 0);
}

export const describeAction = (a: Action & { index: number }) => {
  const what = a.selector ?? a.url ?? a.key ?? (a.to !== undefined ? String(a.to) : '');
  return `action ${a.index + 1} (${a.type}${what ? ` "${what}"` : ''}${a.text ? ` with text "${a.text}"` : ''})`;
};

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
  // scroll videos have no tour steps (parseConfig refuses them)
  for (const [index, a] of c.actions.entries()) {
    const r = await locate(page, a);
    if (r) found.push({ a, index, r });
    else warn(`${describeAction({ ...a, index })}: element not found or not visible, skipped`);
  }
  found.sort((p, q) => p.r.docY - q.r.docY || p.index - q.index);

  const out: ResolvedAction[] = [];
  for (const { a, index, r } of found) {
    const y = stopFor(r, out[out.length - 1]?.y, maxScroll);
    out.push({ ...a, index, y, total: actionDuration(a) });
  }
  return out;
}

/**
 * Scroll position for acting on an element: `current` if it is already
 * comfortably in view there, otherwise the element centred (tall elements:
 * their top near the top of the viewport).
 */
export function stopFor(r: Rect, current: number | undefined, maxScroll: number): number {
  const margin = r.vh * 0.08;
  if (current !== undefined && r.docY >= current + margin && r.docY + r.height <= current + r.vh - margin) return current;
  const y = r.height > r.vh * 0.7 ? r.docY - r.vh * 0.12 : r.docY + r.height / 2 - r.vh / 2;
  return Math.round(Math.min(maxScroll, Math.max(0, y)));
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
  /** type actions: null until the click has focused (and emptied) the field, false if there is none */
  private focused: boolean | null = null;
  /** the type action being typed into its field, and how many of its characters are in */
  private typing: ResolvedAction | null = null;
  private typed = 0;
  private caretShown = false;
  private warned = new Set<number>();
  /** grows with every mouse button release (tours wait for the page to settle after a click) */
  releases = 0;

  constructor(
    private page: Page,
    private cdp: CDPSession,
    private style: 'arrow' | 'touch' | 'none',
    private size: number,
    private warn: (m: string) => void,
  ) {}

  /** A frame inside an action segment; `elapsed` = seconds since the segment started. */
  async step(segment: number, a: ResolvedAction, elapsed: number): Promise<void> {
    const first = segment !== this.segment;
    if (first) {
      await this.release();
      await this.finishTyping();
      await this.hideCaret();
      this.segment = segment;
      this.pressedAt = null;
      this.released = false;
      this.target = null;
      this.focused = null;
      this.typed = 0;
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

    if (a.type !== 'hover' && arrived) {
      if (this.pressedAt === null) {
        this.pressedAt = elapsed;
        await this.page.mouse.down();
      } else if (!this.released && elapsed >= this.pressedAt + PRESS) {
        await this.release();
      }
    }
    if (a.type === 'type' && this.released) {
      await this.type(a, elapsed);
      // the pointer gets out of the way of the text, like on macOS
      if (this.focused) this.opacity = Math.min(this.opacity, 1 - clamp((elapsed - this.pressedAt! - PRESS) / FADE, 0, 1));
    }
    // press feedback: shrink while down, spring back afterwards
    if (this.pressedAt !== null && !this.released) this.scale = 0.8;
    else if (this.pressedAt !== null) this.scale = 0.8 + 0.2 * clamp((elapsed - this.pressedAt - PRESS) / 0.15, 0, 1);
    else this.scale = 1;
    await this.draw();
  }

  /**
   * The page was replaced (tours): the drawn cursor went with the old
   * document, and the mouse button is up again.
   */
  reset(): void {
    this.segment = -1;
    this.pos = null;
    this.opacity = 0;
    this.scale = 1;
    this.mouseInside = false;
    this.pressedAt = null;
    this.released = false;
    this.typing = null;
    this.caretShown = false;
  }

  /** A frame outside any action: let go of the element and fade the cursor out. */
  async idle(dt: number): Promise<void> {
    this.segment = -1;
    await this.release();
    await this.finishTyping();
    await this.hideCaret();
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

  /** Types the characters that are due by now, through real key events. */
  private async type(a: ResolvedAction, elapsed: number) {
    if (this.focused === null) {
      this.focused = await this.page.evaluate(([s, t]) => window.__glide.prepareField(s, t) as boolean, [a.selector, a.text] as const);
      if (this.focused) this.typing = a;
      else this.warn(`${describeAction(a)}: no text field to type into, skipped`);
    }
    if (!this.focused) return;
    const t = elapsed - typingStart(a);
    const n = typedCount(a.value!, a.typingSpeed, t);
    await this.typeTo(n);
    // steady while typing, then blinking on the virtual clock
    const sinceKey = t - (n - 1) / a.typingSpeed;
    await this.page.evaluate((v) => window.__glide.caret(v), n > 0 && Math.floor(sinceKey / BLINK) % 2 === 0);
    this.caretShown = true;
  }

  /** Types the characters of the current type action up to the `n`-th (default: all). */
  private async typeTo(n = Infinity) {
    const chars = [...this.typing!.value!];
    const to = Math.min(n, chars.length);
    for (const ch of chars.slice(this.typed, to)) await this.key(ch);
    this.typed = Math.max(this.typed, to);
  }

  /** Types what is left when the segment ends: with fast typing or a short (compressed) segment, the last characters can fall between two frames. */
  private async finishTyping() {
    if (this.typing) await this.typeTo();
    this.typing = null;
  }

  /**
   * One character as real key events. Playwright only knows the US layout
   * and inserts anything else (umlauts, ß, emoji …) without keydown/keyup,
   * so those are sent through CDP.
   */
  private async key(ch: string) {
    if (/^[\x20-\x7e\n\r\t]$/.test(ch)) return this.page.keyboard.type(ch);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }

  private async hideCaret() {
    if (!this.caretShown) return;
    this.caretShown = false;
    await this.page.evaluate(() => window.__glide.caret(false));
  }

  private async release() {
    if (this.pressedAt !== null && !this.released) {
      this.released = true;
      await this.page.mouse.up();
      this.releases++;
    }
  }

  private async draw() {
    if (this.style === 'none' || !this.pos) return;
    const c = { ...this.pos, opacity: this.opacity, scale: this.scale, style: this.style, size: this.size };
    await this.page.evaluate((c) => window.__glide.cursor(c), c);
  }
}
