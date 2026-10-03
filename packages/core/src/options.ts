/**
 * Browser-safe constants (no Node or Playwright imports), shared with UIs.
 * Import via `@glide/core/options`.
 */
export const PRESETS = {
  desktop: { width: 1920, height: 1080 },
  laptop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
export type PresetName = keyof typeof PRESETS;

export { EASING_NAMES, type EasingName } from './easing.js';

export const SCROLL_DRIVERS = ['auto', 'native', 'lenis', 'custom'] as const;
export const SCROLL_MODES = ['continuous', 'sections'] as const;
export const FORMATS = ['mp4', 'webm'] as const;
export const BROWSERS = ['chromium', 'chrome', 'msedge'] as const;
