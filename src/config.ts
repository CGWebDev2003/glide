import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { EASING_NAMES } from './easing.js';

export const PRESETS = {
  desktop: { width: 1920, height: 1080 },
  laptop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
export type PresetName = keyof typeof PRESETS;

const viewportSchema = z.union([
  z.enum(['desktop', 'laptop', 'mobile']),
  z.object({ width: z.number().int().min(100).max(7680), height: z.number().int().min(100).max(7680) }),
]);

const scrollSchema = z
  .object({
    mode: z.enum(['continuous', 'sections']).default('continuous'),
    /** Scroll speed in CSS px per second (ignored when `duration` is set). */
    speed: z.number().positive().default(600),
    /** Total scroll duration in seconds (excluding intro/outro/pauses). Overrides `speed`. */
    duration: z.number().positive().optional(),
    easing: z.enum(EASING_NAMES).default('easeInOutCubic'),
    /** sections mode: pause at each stop in seconds. */
    pauseDuration: z.number().min(0).default(1.2),
    /** sections mode: CSS selector(s) for the stops. Default: auto-detect. */
    sections: z.union([z.string(), z.array(z.string())]).optional(),
    /** sections mode: offset in px subtracted from each section top (e.g. fixed header height). */
    sectionOffset: z.number().default(0),
    /** sections mode: minimum travel time between two stops in seconds. */
    minSegmentDuration: z.number().positive().default(0.8),
  })
  .prefault({});

export const configSchema = z.object({
  url: z.string().url(),
  output: z.string().optional(),
  viewport: viewportSchema.default('desktop'),
  deviceScaleFactor: z.number().min(1).max(4).default(2),
  /** Output video size. Default: viewport size (CSS px), mobile: viewport × deviceScaleFactor. */
  outputSize: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  fps: z.number().int().min(1).max(240).default(60),
  format: z.enum(['mp4', 'webm']).default('mp4'),
  /** x264 CRF (lower = better). 14–18 is visually lossless. */
  crf: z.number().int().min(0).max(51).default(16),
  /** x264 preset. */
  encoderPreset: z
    .enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'])
    .default('slow'),
  /** Frame capture format. jpeg is much faster at high resolutions, png is lossless. */
  captureFormat: z.enum(['jpeg', 'png']).default('jpeg'),
  captureQuality: z.number().int().min(1).max(100).default(95),

  scroll: scrollSchema,
  scrollDriver: z.enum(['auto', 'native', 'lenis', 'custom']).default('auto'),
  /** Dot path on window to the Lenis instance. */
  lenisPath: z.string().default('lenis'),
  /** custom driver: JS function source `(y) => { ... }`, may be async. */
  scrollHook: z.string().optional(),

  /** Seconds to stay at the top before scrolling (hero animation). */
  introDuration: z.number().min(0).default(2),
  /** Seconds to stay at the bottom at the end. */
  outroDuration: z.number().min(0).default(1.5),
  /** Virtual seconds to fast-forward before the first frame (e.g. preloaders). */
  warmup: z.number().min(0).default(0),
  hideSelectors: z.array(z.string()).default([]),
  /** Extra CSS injected into the page. */
  injectCss: z.string().optional(),
  /** Extra JS (function body) evaluated after load, before recording. */
  injectScript: z.string().optional(),
  hideScrollbar: z.boolean().default(true),

  /** Scroll through the page once to trigger lazy loading, then reload. */
  prepass: z.boolean().default(true),
  /** Set loading="eager" on all <img> after load. */
  eagerImages: z.boolean().default(true),
  /** Pause and seek <video> elements to the virtual time. */
  syncVideos: z.boolean().default(true),
  /** Max wait per frame for images in view to finish loading (ms). */
  imageTimeout: z.number().int().min(0).default(5000),
  /** Page load timeout (ms). */
  timeout: z.number().int().positive().default(60000),
  /** Safety cap in seconds. Scroll speed is raised to fit if exceeded. */
  maxDuration: z.number().positive().default(120),
  /** Extra HTTP headers, cookies etc. */
  headers: z.record(z.string(), z.string()).optional(),
  userAgent: z.string().optional(),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
  /** Seed for a deterministic Math.random (null = native random). */
  randomSeed: z.number().int().nullable().default(1337),
  /** Browser: bundled Chromium, or an installed Chrome/Edge (needed for H.264/AAC videos on the page). */
  browser: z.enum(['chromium', 'chrome', 'msedge']).default('chromium'),
  /** Run the browser with a visible window (debugging). */
  headful: z.boolean().default(false),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

export function resolveViewport(c: Config): { width: number; height: number; preset?: PresetName } {
  if (typeof c.viewport === 'string') return { ...PRESETS[c.viewport], preset: c.viewport };
  return c.viewport;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size in video pixels (always even for yuv420p). */
export function resolveOutputSize(c: Config): { width: number; height: number } {
  const vp = resolveViewport(c);
  if (c.outputSize) {
    return { width: even(c.outputSize.width), height: even(c.outputSize.height) };
  }
  // small (mobile) viewports would give tiny videos: keep the device pixels
  const scale = vp.width < 800 ? c.deviceScaleFactor : 1;
  return { width: even(vp.width * scale), height: even(vp.height * scale) };
}

export function parseConfig(input: unknown, source = 'config'): Config {
  const res = configSchema.safeParse(input);
  if (!res.success) {
    const lines = res.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid ${source}:\n${lines.join('\n')}`);
  }
  const c = res.data;
  if (c.scrollDriver === 'custom' && !c.scrollHook) {
    throw new ConfigError(`Invalid ${source}: scrollDriver "custom" requires "scrollHook"`);
  }
  return c;
}

export async function loadConfigFile(file: string): Promise<{ raw: Record<string, unknown>; dir: string }> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    throw new ConfigError(`Cannot read config file ${file}: ${(e as Error).message}`);
  }
  try {
    return { raw: JSON.parse(text), dir: path.dirname(path.resolve(file)) };
  } catch (e) {
    throw new ConfigError(`Config file ${file} is not valid JSON: ${(e as Error).message}`);
  }
}

export class ConfigError extends Error {}

export function defaultOutputName(c: Config): string {
  const host = new URL(c.url).hostname.replace(/^www\./, '') || 'page';
  const vp = resolveViewport(c);
  const tag = vp.preset ?? `${vp.width}x${vp.height}`;
  return `${host.replace(/[^a-z0-9.-]/gi, '_')}-${tag}.${c.format}`;
}
