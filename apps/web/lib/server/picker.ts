import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PickerSession } from '@glide/core';
import { loadCore } from './core';

/** Closed after this long without a request (the window was closed, the phone locked …). */
const IDLE_MS = 3 * 60 * 1000;

/**
 * Live preview sessions for choosing elements. Only one at a time: each one is
 * a Chromium instance, and opening the picker again replaces the old one.
 */
class PickerManager {
  private current: { id: string; session: PickerSession; timer: NodeJS.Timeout; busy: Promise<unknown> } | null = null;

  async open(rawConfig: Record<string, unknown>) {
    const { parseConfig, PickerSession } = await loadCore();
    const config = parseConfig(rawConfig, 'Konfiguration');
    await this.close();
    const session = await PickerSession.open(config);
    const id = randomUUID();
    this.current = { id, session, timer: setTimeout(() => void this.close(id), IDLE_MS), busy: Promise.resolve() };
    return { id, width: session.width, height: session.height };
  }

  /** Runs `fn` on the session (one call at a time, so pointer moves cannot overtake each other). */
  async use<T>(id: string, fn: (s: PickerSession) => Promise<T>): Promise<T | null> {
    const cur = this.current;
    if (!cur || cur.id !== id) return null;
    clearTimeout(cur.timer);
    cur.timer = setTimeout(() => void this.close(id), IDLE_MS);
    const run = cur.busy.then(() => fn(cur.session));
    cur.busy = run.catch(() => {});
    return run;
  }

  async close(id?: string) {
    const cur = this.current;
    if (!cur || (id && cur.id !== id)) return;
    this.current = null;
    clearTimeout(cur.timer);
    await cur.session.close();
  }
}

const g = globalThis as unknown as { __glidePicker?: PickerManager };
export const picker: PickerManager = (g.__glidePicker ??= new PickerManager());
