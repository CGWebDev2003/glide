import type { Page } from 'playwright';
import type { Action, Config } from './config.js';
import { actionDuration, describeAction, locate, stopFor, type ActionPlayer, type Rect, type ResolvedAction } from './actions.js';
import { EASINGS } from './easing.js';
import type { Segment } from './timeline.js';

/** A navigation the page started (see `takeNavigation` in page/runtime.ts). */
export interface Navigation {
  /** document: cancelled in the page, Node opens it; native: the browser loads it (form posts); anchor: jump within the page */
  kind: 'document' | 'native' | 'anchor' | 'download';
  url: string;
}

/** What the tour needs from the recorder. */
export interface TourHost {
  page: Page;
  config: Config;
  player: ActionPlayer;
  log: (m: string) => void;
  warn: (m: string) => void;
  /** renders and captures one frame; `y` null keeps the scroll position. Resolves to the page's scroll position. */
  shoot(y: number | null, phase: 'intro' | 'scroll' | 'action'): Promise<number>;
  /** frames captured so far */
  frames(): number;
  /** expected number of frames (progress) */
  setTotal(frames: number): void;
  /** opens the page (document) or waits for the one the browser is loading (native), then prepares it like the first */
  navigate(nav: Navigation): Promise<void>;
  /** waits (in real time) until the requests the page just started are done, e.g. a dialog's content */
  settle(): Promise<void>;
}

export interface TourResult {
  segments: Segment[];
  /** steps that ran with an element (`Segment.action` indexes config.actions) */
  steps: ResolvedAction[];
  /** pages opened during the tour, in order (the first one included) */
  pages: string[];
  duration: number;
}

/** How long a tour waits for a step's element to show up (virtual seconds; dialogs opening, content loading). */
const FIND_TIMEOUT = 2;

/** Playwright errors that mean the page was replaced under a call. */
const isNavigationError = (e: unknown) =>
  e instanceof Error && /Execution context was destroyed|Cannot find context with specified id|frame was detached|navigating/i.test(e.message);

class TourLimit extends Error {}

/** Seconds of scrolling between two positions in a tour (0 = no scrolling). */
export function tourMoveDuration(c: Config, distance: number): number {
  const d = Math.abs(distance);
  return d < 1 ? 0 : Math.max(c.scroll.minSegmentDuration, d / c.scroll.speed);
}

/** Rough length of a tour step (the scrolling it needs is unknown before the page is loaded). */
export function estimateStep(c: Config, a: Action): number {
  if (a.type === 'hover' || a.type === 'click' || a.type === 'type') return actionDuration(a) + c.scroll.minSegmentDuration / 2;
  if (a.type === 'scroll') return c.scroll.minSegmentDuration + a.duration;
  return a.duration;
}

/**
 * Runs `config.actions` as a tour: one step after the other in the given
 * order, on whatever page the previous steps led to. The page is scrolled
 * only when a step's element is not in view (and not in a fixed layer such
 * as a dialog). Links open the next page in the same tab: no frames are
 * taken while it loads, the video cuts to it.
 */
export async function runTour(h: TourHost): Promise<TourResult> {
  const { page, config: c, player } = h;
  const fps = c.fps;
  const limit = Math.max(1, Math.round(c.maxDuration * fps));
  const segments: Segment[] = [];
  const steps: ResolvedAction[] = [];
  const pages = [page.url()];
  /** seconds of video planned so far; frames are produced up to it */
  let planned = 0;
  let y = await page.evaluate(() => window.__glide.getScrollY() as number);
  /** a new page was opened during the current step */
  let arrived = false;
  /** an anchor link was clicked in the current step: scroll there */
  let anchor: string | null = null;

  const arrive = async (nav: Navigation) => {
    h.log(nav.kind === 'native' ? 'Following the page to its next page' : `Opening ${nav.url}`);
    await h.navigate(nav);
    player.reset();
    pages.push(page.url());
    y = await page.evaluate(() => window.__glide.getScrollY() as number);
    arrived = true;
    anchor = null;
  };

  const handle = async (nav: Navigation | null) => {
    if (!nav) return;
    if (nav.kind === 'anchor') anchor = nav.url;
    else if (nav.kind === 'download') h.warn(`a step would download a file (${nav.url}), skipped`);
    else await arrive(nav);
  };

  /** a call into the page; if the page is replaced meanwhile, follow it */
  const safe = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      if (!isNavigationError(e)) throw e;
      await arrive({ kind: 'native', url: '' });
      return undefined;
    }
  };

  const frame = async (to: number | null, phase: 'intro' | 'scroll' | 'action') => {
    if (h.frames() >= limit) throw new TourLimit();
    const got = await safe(() => h.shoot(to, phase));
    if (got === undefined) return;
    y = got;
    await handle((await safe(() => page.evaluate(() => window.__glide.takeNavigation() as Navigation | null))) ?? null);
  };

  /** ends a segment early (a new page or an anchor cut it short) */
  const cut = (seg: Segment, start: number) => {
    seg.duration = (h.frames() - start) / fps;
    planned = h.frames() / fps;
  };

  const hold = async (duration: number, label: string, phase: 'intro' | 'scroll' = 'scroll') => {
    if (duration <= 0) return;
    const seg: Segment = { kind: 'hold', y, duration, label };
    segments.push(seg);
    const start = h.frames();
    planned += duration;
    const end = Math.round(planned * fps);
    while (h.frames() < end) {
      await safe(() => player.idle(1 / fps));
      await frame(null, phase);
      if (arrived) return cut(seg, start);
    }
  };

  const move = async (to: number, label: string) => {
    const from = y;
    const duration = tourMoveDuration(c, to - from);
    if (!duration) return;
    const seg: Segment = { kind: 'move', from, to, duration, easing: c.scroll.easing, label };
    segments.push(seg);
    const start = h.frames();
    planned += duration;
    const end = Math.round(planned * fps);
    const n = Math.max(1, end - start);
    while (h.frames() < end) {
      const k = EASINGS[c.scroll.easing](Math.min(1, (h.frames() - start + 1) / n));
      await safe(() => player.idle(1 / fps));
      await frame(Math.round((from + (to - from) * k) * 100) / 100, 'scroll');
      if (arrived) return cut(seg, start);
    }
  };

  const maxScroll = () => page.evaluate(() => window.__glide.getMaxScroll() as number);

  /**
   * The step's element, waiting a little for it while the page goes on
   * (a dialog fading in, content arriving). Areas inside the page (a dialog's
   * body) are scrolled so it is visible there.
   */
  const find = async (a: Action): Promise<Rect | null> => {
    const start = h.frames();
    let seg: Segment | null = null;
    for (;;) {
      await safe(() => page.evaluate(([s, t]) => window.__glide.revealInner(s, t) as boolean, [a.selector!, a.text] as const));
      const r = await safe(() => locate(page, a));
      if (r || arrived || h.frames() - start >= FIND_TIMEOUT * fps) {
        if (seg) cut(seg, start);
        return r ?? null;
      }
      if (!seg) {
        await h.settle();
        seg = { kind: 'hold', y, duration: FIND_TIMEOUT, label: 'waiting' };
        segments.push(seg);
      }
      await safe(() => player.idle(1 / fps));
      await frame(null, 'scroll');
      planned = h.frames() / fps;
    }
  };

  const act = async (a: Action, index: number) => {
    const r = await find(a);
    if (arrived) return;
    if (!r) {
      h.warn(`${describeAction({ ...a, index })}: element not found or not visible, skipped`);
      return;
    }
    if (!r.fixed) {
      await move(stopFor(r, y, await maxScroll()), `to step ${index + 1}`);
      if (arrived) return;
    }
    const step: ResolvedAction = { ...a, index, y, total: actionDuration(a) };
    steps.push(step);
    const seg: Segment = { kind: 'action', y, duration: step.total, action: index, label: `step ${index + 1}` };
    const segIndex = segments.push(seg) - 1;
    const start = h.frames();
    planned += step.total;
    const end = Math.round(planned * fps);
    while (h.frames() < end) {
      const releases = player.releases;
      await safe(() => player.step(segIndex, step, (h.frames() - start) / fps));
      // a click may load a dialog's content or the next route of a single-page app
      if (!arrived && player.releases !== releases) await h.settle();
      if (!arrived) await frame(null, 'action');
      if (arrived || anchor) return cut(seg, start);
    }
  };

  const scrollStep = async (a: Action, index: number) => {
    let to: number;
    if (a.selector) {
      const r = await find(a);
      if (arrived) return;
      if (!r) {
        h.warn(`${describeAction({ ...a, index })}: element not found or not visible, skipped`);
        return;
      }
      if (r.fixed) return;
      to = r.docY - c.scroll.sectionOffset;
    } else {
      to = a.to === 'top' ? 0 : a.to === 'bottom' ? Infinity : (a.to ?? 0);
    }
    await move(Math.round(Math.min(await maxScroll(), Math.max(0, to))), `step ${index + 1}`);
  };

  const remaining = (from: number) =>
    c.actions.slice(from).reduce((s, a) => s + estimateStep(c, a), 0) + c.outroDuration;

  try {
    h.setTotal(Math.round((c.introDuration + remaining(0)) * fps));
    await hold(c.introDuration, 'intro', 'intro');
    for (const [index, a] of c.actions.entries()) {
      h.setTotal(h.frames() + Math.round(remaining(index) * fps));
      arrived = false;
      anchor = null;
      switch (a.type) {
        case 'hover':
        case 'click':
        case 'type':
          await act(a, index);
          break;
        case 'scroll':
          await scrollStep(a, index);
          break;
        case 'goto': {
          let url: string;
          try {
            url = new URL(a.url!, page.url()).href;
          } catch {
            h.warn(`${describeAction({ ...a, index })}: not a valid URL, skipped`);
            continue;
          }
          await safe(() => player.idle(1 / fps));
          await arrive({ kind: 'document', url });
          break;
        }
        case 'press':
          await safe(() => page.keyboard.press(a.key!));
          await h.settle();
          await handle((await safe(() => page.evaluate(() => window.__glide.takeNavigation() as Navigation | null))) ?? null);
          break;
        case 'wait':
          break;
      }
      // a click on an anchor link cut the step short: scroll there, then pause
      let after = a.type === 'hover' || a.type === 'click' || a.type === 'type' ? 0 : a.duration;
      if (anchor) {
        const at = await safe(() => page.evaluate((u) => window.__glide.anchorY(u) as number | null, anchor!));
        anchor = null;
        if (typeof at === 'number') await move(Math.round(Math.min(await maxScroll(), Math.max(0, at - c.scroll.sectionOffset))), `step ${index + 1}: anchor`);
        after = a.duration;
      }
      if (arrived) {
        arrived = false;
        await hold(a.duration, `step ${index + 1}: page`);
      } else if (after > 0) {
        await hold(after, a.type === 'wait' ? `step ${index + 1}: wait` : `step ${index + 1}`);
      }
      if (arrived) {
        // the page went on by itself during the pause (a timer, a redirect)
        arrived = false;
        await hold(a.duration, `step ${index + 1}: page`);
      }
    }
    await hold(c.outroDuration, 'outro');
  } catch (e) {
    if (!(e instanceof TourLimit)) throw e;
    h.warn(`tour reached maxDuration (${c.maxDuration}s): the remaining steps were not recorded`);
  }
  return { segments, steps, pages, duration: h.frames() / fps };
}
