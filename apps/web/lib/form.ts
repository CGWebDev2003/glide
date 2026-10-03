/** Form state <-> CLI-compatible config JSON (client-safe). */
import type { EasingName } from '@glide/core/options';

export type ViewportMode = 'desktop' | 'laptop' | 'mobile' | 'custom';

export interface FormAction {
  type: 'hover' | 'click';
  selector: string;
  /** optional: only elements containing this text */
  text: string;
  duration: number;
  /** keys the form has no field for (e.g. moveDuration) */
  extra: Record<string, unknown>;
}

export interface FormState {
  url: string;
  name: string;
  viewport: ViewportMode;
  width: number;
  height: number;
  deviceScaleFactor: number;
  fps: number;
  format: 'mp4' | 'webm';
  mode: 'continuous' | 'sections';
  tempo: 'speed' | 'duration';
  speed: number;
  duration: number;
  easing: EasingName;
  pauseDuration: number;
  sections: string;
  sectionOffset: number;
  introDuration: number;
  outroDuration: number;
  hideSelectors: string;
  actions: FormAction[];
  scrollDriver: 'auto' | 'native' | 'lenis' | 'custom';
  lenisPath: string;
  scrollHook: string;
  injectCss: string;
  warmup: number;
  prepass: boolean;
  maxDuration: number;
  browser: 'chromium' | 'chrome' | 'msedge';
  outputWidth: string;
  outputHeight: string;
  /** config keys the form has no field for (kept when round-tripping JSON) */
  extra: Record<string, unknown>;
}

export const DEFAULT_FORM: FormState = {
  url: '',
  name: '',
  viewport: 'desktop',
  width: 1280,
  height: 800,
  deviceScaleFactor: 2,
  fps: 60,
  format: 'mp4',
  mode: 'continuous',
  tempo: 'speed',
  speed: 600,
  duration: 20,
  easing: 'easeInOutCubic',
  pauseDuration: 1.2,
  sections: '',
  sectionOffset: 0,
  introDuration: 2,
  outroDuration: 1.5,
  hideSelectors: '',
  actions: [],
  scrollDriver: 'auto',
  lenisPath: 'lenis',
  scrollHook: '',
  injectCss: '',
  warmup: 0,
  prepass: true,
  maxDuration: 120,
  browser: 'chromium',
  outputWidth: '',
  outputHeight: '',
  extra: {},
};

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** Builds the config JSON (only non-default values, so it stays readable). */
export function toConfig(f: FormState): Record<string, unknown> {
  const d = DEFAULT_FORM;
  const c: Record<string, unknown> = { ...f.extra, url: f.url.trim() };
  c.viewport = f.viewport === 'custom' ? { width: f.width, height: f.height } : f.viewport;
  if (f.deviceScaleFactor !== d.deviceScaleFactor) c.deviceScaleFactor = f.deviceScaleFactor;
  if (f.fps !== d.fps) c.fps = f.fps;
  if (f.format !== d.format) c.format = f.format;
  if (f.outputWidth && f.outputHeight) c.outputSize = { width: Number(f.outputWidth), height: Number(f.outputHeight) };

  const scroll: Record<string, unknown> = { mode: f.mode };
  if (f.tempo === 'duration') scroll.duration = f.duration;
  else scroll.speed = f.speed;
  scroll.easing = f.easing;
  if (f.mode === 'sections') {
    scroll.pauseDuration = f.pauseDuration;
    if (lines(f.sections).length) scroll.sections = lines(f.sections);
    if (f.sectionOffset) scroll.sectionOffset = f.sectionOffset;
  }
  c.scroll = { ...((f.extra.scroll as object) ?? {}), ...scroll };

  c.introDuration = f.introDuration;
  c.outroDuration = f.outroDuration;
  if (lines(f.hideSelectors).length) c.hideSelectors = lines(f.hideSelectors);
  const actions = f.actions
    .filter((a) => a.selector.trim())
    .map((a) => ({
      ...a.extra,
      type: a.type,
      selector: a.selector.trim(),
      ...(a.text.trim() ? { text: a.text.trim() } : {}),
      duration: a.duration,
    }));
  if (actions.length) c.actions = actions;
  if (f.scrollDriver !== d.scrollDriver) c.scrollDriver = f.scrollDriver;
  if (f.lenisPath.trim() && f.lenisPath.trim() !== d.lenisPath) c.lenisPath = f.lenisPath.trim();
  if (f.scrollDriver === 'custom' && f.scrollHook.trim()) c.scrollHook = f.scrollHook.trim();
  if (f.injectCss.trim()) c.injectCss = f.injectCss;
  if (f.warmup) c.warmup = f.warmup;
  if (!f.prepass) c.prepass = false;
  if (f.maxDuration !== d.maxDuration) c.maxDuration = f.maxDuration;
  if (f.browser !== d.browser) c.browser = f.browser;
  return c;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

/** Loads a config JSON (e.g. from the CLI) into the form. */
export function fromConfig(raw: Record<string, unknown>, name = ''): FormState {
  const d = DEFAULT_FORM;
  const {
    url, viewport, deviceScaleFactor, fps, format, outputSize, scroll, introDuration, outroDuration,
    hideSelectors, actions, scrollDriver, lenisPath, scrollHook, injectCss, warmup, prepass, maxDuration, browser, output,
    ...extra
  } = raw;
  void output; // the app names files itself
  const s = (scroll && typeof scroll === 'object' ? scroll : {}) as Record<string, unknown>;
  const { mode, speed, duration, easing, pauseDuration, sections, sectionOffset, ...scrollExtra } = s;
  if (Object.keys(scrollExtra).length) extra.scroll = scrollExtra;
  const vp = viewport && typeof viewport === 'object' ? (viewport as { width: number; height: number }) : null;
  const os = outputSize && typeof outputSize === 'object' ? (outputSize as { width: number; height: number }) : null;
  return {
    url: str(url, ''),
    name,
    viewport: vp ? 'custom' : (['desktop', 'laptop', 'mobile'].includes(viewport as string) ? viewport : 'desktop') as ViewportMode,
    width: vp?.width ?? d.width,
    height: vp?.height ?? d.height,
    deviceScaleFactor: num(deviceScaleFactor, d.deviceScaleFactor),
    fps: num(fps, d.fps),
    format: format === 'webm' ? 'webm' : 'mp4',
    mode: mode === 'sections' ? 'sections' : 'continuous',
    tempo: typeof duration === 'number' ? 'duration' : 'speed',
    speed: num(speed, d.speed),
    duration: num(duration, d.duration),
    easing: (typeof easing === 'string' ? easing : d.easing) as EasingName,
    pauseDuration: num(pauseDuration, d.pauseDuration),
    sections: Array.isArray(sections) ? sections.join('\n') : str(sections, ''),
    sectionOffset: num(sectionOffset, 0),
    introDuration: num(introDuration, d.introDuration),
    outroDuration: num(outroDuration, d.outroDuration),
    hideSelectors: Array.isArray(hideSelectors) ? hideSelectors.join('\n') : '',
    actions: Array.isArray(actions) ? actions.filter((a) => a && typeof a === 'object').map(toFormAction) : [],
    scrollDriver: (['auto', 'native', 'lenis', 'custom'].includes(scrollDriver as string) ? scrollDriver : 'auto') as FormState['scrollDriver'],
    lenisPath: str(lenisPath, d.lenisPath),
    scrollHook: str(scrollHook, ''),
    injectCss: str(injectCss, ''),
    warmup: num(warmup, 0),
    prepass: prepass !== false,
    maxDuration: num(maxDuration, d.maxDuration),
    browser: (['chromium', 'chrome', 'msedge'].includes(browser as string) ? browser : 'chromium') as FormState['browser'],
    outputWidth: os ? String(os.width) : '',
    outputHeight: os ? String(os.height) : '',
    extra,
  };
}

function toFormAction(raw: Record<string, unknown>): FormAction {
  const { type, selector, text, duration, ...extra } = raw;
  return {
    type: type === 'click' ? 'click' : 'hover',
    selector: str(selector, ''),
    text: str(text, ''),
    duration: num(duration, 1.5),
    extra,
  };
}

/** Rough duration estimate in seconds (page height unknown before loading). */
export function estimateDuration(f: FormState): string {
  if (f.tempo === 'duration') {
    return `≈ ${Math.round(f.introDuration + f.duration + f.outroDuration)} s`;
  }
  return `abhängig von der Seitenlänge (${f.speed} px/s)`;
}

export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** First http(s) URL in a shared text (Android shares the URL inside `text`). */
export function extractUrl(...candidates: (string | undefined | null)[]): string {
  for (const c of candidates) {
    const m = c?.match(/https?:\/\/[^\s]+/i);
    if (m) return m[0];
  }
  return '';
}
