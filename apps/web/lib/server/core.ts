import 'server-only';

type Core = typeof import('@glide/core');
let core: Promise<Core> | null = null;

/**
 * Loads the recorder at runtime with Node's own module loader instead of the
 * bundler: it drives Playwright/ffmpeg and serializes the in-page runtime with
 * Function.prototype.toString, both of which must stay untouched.
 */
export function loadCore(): Promise<Core> {
  return (core ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '@glide/core' as string) as Promise<Core>);
}
