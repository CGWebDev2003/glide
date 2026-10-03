import { EASINGS, type EasingName } from './easing.js';

export type Segment =
  | { kind: 'hold'; y: number; duration: number; label: string }
  | { kind: 'move'; from: number; to: number; duration: number; easing: EasingName; label: string }
  /** scroll stands still at `y` while action number `action` (index into TimelineOptions.actions) runs */
  | { kind: 'action'; y: number; duration: number; action: number; label: string };

export interface Timeline {
  segments: Segment[];
  /** total duration in seconds */
  duration: number;
  /** set if the timeline was compressed to respect maxDuration */
  compressedBy?: number;
}

export interface TimelineOptions {
  maxScroll: number;
  mode: 'continuous' | 'sections';
  speed: number;
  duration?: number;
  easing: EasingName;
  pauseDuration: number;
  minSegmentDuration: number;
  introDuration: number;
  outroDuration: number;
  maxDuration: number;
  /** sections mode: candidate stop positions (document px) */
  stops?: number[];
  /** sections mode: stops closer than this (px) are merged */
  minStopDistance?: number;
  /** hover/click stops (document px); scrolling halts at each, sorted top to bottom */
  actions?: { y: number; duration: number }[];
}

/** Normalizes section stops: clamps, sorts, dedupes, always includes 0 and max. */
export function normalizeStops(stops: number[], maxScroll: number, minDistance: number): number[] {
  const clamped = stops
    .map((s) => Math.min(maxScroll, Math.max(0, Math.round(s))))
    .sort((a, b) => a - b);
  const out = [0];
  for (const s of [...clamped, maxScroll]) {
    const last = out[out.length - 1];
    if (s - last >= minDistance) out.push(s);
    else if (s === maxScroll && s > last) {
      // always end exactly at the bottom; never drop the top stop
      if (out.length > 1) out[out.length - 1] = s;
      else out.push(s);
    }
  }
  return out;
}

export function buildTimeline(o: TimelineOptions): Timeline {
  const segments: Segment[] = [];
  if (o.introDuration > 0) segments.push({ kind: 'hold', y: 0, duration: o.introDuration, label: 'intro' });

  // actions grouped by (rounded, clamped) scroll position; same-position actions keep their order
  const actionsAt = new Map<number, number[]>();
  (o.actions ?? [])
    .map((a, i) => ({ y: Math.min(o.maxScroll, Math.max(0, Math.round(a.y))), i }))
    .sort((a, b) => a.y - b.y || a.i - b.i)
    .forEach(({ y, i }) => actionsAt.set(y, [...(actionsAt.get(y) ?? []), i]));
  const actionYs = [...actionsAt.keys()];

  let stops: number[];
  if (o.mode === 'continuous') {
    stops = [...new Set([0, ...actionYs, o.maxScroll])].sort((a, b) => a - b);
  } else {
    // section stops close to an action stop give way to it
    const near = (s: number) => actionYs.some((y) => Math.abs(y - s) < (o.minStopDistance ?? 1));
    const sections = normalizeStops(o.stops ?? [], o.maxScroll, o.minStopDistance ?? 1)
      .filter((s) => s === 0 || s === o.maxScroll || !near(s));
    stops = [...new Set([...sections, ...actionYs])].sort((a, b) => a - b);
  }

  const total = stops[stops.length - 1] - stops[0];
  // a single uninterrupted scroll keeps its exact duration; split scrolls get a minimum per leg
  const minLeg = o.mode === 'sections' || stops.length > 2 ? o.minSegmentDuration : 0;
  let n = 0;
  for (let i = 0; i < stops.length; i++) {
    if (i > 0) {
      const dist = stops[i] - stops[i - 1];
      const d = o.duration !== undefined ? (o.duration * dist) / total : dist / o.speed;
      segments.push({
        kind: 'move',
        from: stops[i - 1],
        to: stops[i],
        duration: Math.max(minLeg, d),
        easing: o.easing,
        label: o.mode === 'sections' ? `section ${i}` : stops.length > 2 ? `scroll ${i}` : 'scroll',
      });
    }
    const acts = actionsAt.get(stops[i]);
    if (acts) {
      for (const a of acts) {
        segments.push({ kind: 'action', y: stops[i], duration: o.actions![a].duration, action: a, label: `action ${++n}` });
      }
    } else if (o.mode === 'sections' && i > 0 && i < stops.length - 1 && o.pauseDuration > 0) {
      segments.push({ kind: 'hold', y: stops[i], duration: o.pauseDuration, label: `pause ${i}` });
    }
  }

  if (o.outroDuration > 0) {
    const y = o.maxScroll;
    segments.push({ kind: 'hold', y, duration: o.outroDuration, label: 'outro' });
  }

  let duration = segments.reduce((s, seg) => s + seg.duration, 0);
  let compressedBy: number | undefined;
  if (duration > o.maxDuration) {
    // Shrink the scrolling part first (= faster scroll); keep intro/outro.
    // Actions keep their timing too (a click must not become a blur).
    const isFixed = (s: Segment) => s.kind === 'action' || s.label === 'intro' || s.label === 'outro';
    const fixed = segments.filter(isFixed).reduce((a, s) => a + s.duration, 0);
    const flexible = duration - fixed;
    const factor = fixed < o.maxDuration && flexible > 0 ? (o.maxDuration - fixed) / flexible : o.maxDuration / duration;
    for (const s of segments) {
      if (fixed < o.maxDuration && flexible > 0 && isFixed(s)) continue;
      s.duration *= factor;
    }
    compressedBy = factor;
    duration = segments.reduce((s, seg) => s + seg.duration, 0);
  }

  return { segments, duration, compressedBy };
}

/** Segment active at time t (seconds) and the seconds elapsed within it. */
export function segmentAt(tl: Timeline, t: number): { segment: Segment; index: number; elapsed: number } | null {
  let acc = 0;
  for (let i = 0; i < tl.segments.length; i++) {
    const s = tl.segments[i];
    if (t < acc + s.duration || i === tl.segments.length - 1) {
      return { segment: s, index: i, elapsed: Math.min(s.duration, Math.max(0, t - acc)) };
    }
    acc += s.duration;
  }
  return null;
}

/** Scroll position at time t (seconds). */
export function scrollAt(tl: Timeline, t: number): number {
  const at = segmentAt(tl, t);
  if (!at) return 0;
  const s = at.segment;
  if (s.kind !== 'move') return s.y;
  const local = s.duration > 0 ? at.elapsed / s.duration : 1;
  return s.from + (s.to - s.from) * EASINGS[s.easing](local);
}

export function frameCount(tl: Timeline, fps: number): number {
  return Math.max(1, Math.round(tl.duration * fps));
}
