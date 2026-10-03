import { EASINGS, type EasingName } from './easing.js';

export type Segment =
  | { kind: 'hold'; y: number; duration: number; label: string }
  | { kind: 'move'; from: number; to: number; duration: number; easing: EasingName; label: string };

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

  if (o.maxScroll > 0) {
    if (o.mode === 'continuous') {
      const d = o.duration ?? o.maxScroll / o.speed;
      segments.push({ kind: 'move', from: 0, to: o.maxScroll, duration: d, easing: o.easing, label: 'scroll' });
    } else {
      const stops = normalizeStops(o.stops ?? [], o.maxScroll, o.minStopDistance ?? 1);
      const total = stops[stops.length - 1] - stops[0];
      for (let i = 1; i < stops.length; i++) {
        const dist = stops[i] - stops[i - 1];
        const d = o.duration !== undefined ? (o.duration * dist) / total : dist / o.speed;
        segments.push({
          kind: 'move',
          from: stops[i - 1],
          to: stops[i],
          duration: Math.max(o.minSegmentDuration, d),
          easing: o.easing,
          label: `section ${i}`,
        });
        if (i < stops.length - 1 && o.pauseDuration > 0) {
          segments.push({ kind: 'hold', y: stops[i], duration: o.pauseDuration, label: `pause ${i}` });
        }
      }
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
    const fixed = segments.filter((s) => s.label === 'intro' || s.label === 'outro').reduce((a, s) => a + s.duration, 0);
    const flexible = duration - fixed;
    const factor = fixed < o.maxDuration ? (o.maxDuration - fixed) / flexible : o.maxDuration / duration;
    for (const s of segments) {
      if (fixed < o.maxDuration && (s.label === 'intro' || s.label === 'outro')) continue;
      s.duration *= factor;
    }
    compressedBy = factor;
    duration = segments.reduce((s, seg) => s + seg.duration, 0);
  }

  return { segments, duration, compressedBy };
}

/** Scroll position at time t (seconds). */
export function scrollAt(tl: Timeline, t: number): number {
  let acc = 0;
  for (const s of tl.segments) {
    if (t < acc + s.duration || s === tl.segments[tl.segments.length - 1]) {
      const local = s.duration > 0 ? Math.min(1, Math.max(0, (t - acc) / s.duration)) : 1;
      if (s.kind === 'hold') return s.y;
      return s.from + (s.to - s.from) * EASINGS[s.easing](local);
    }
    acc += s.duration;
  }
  return 0;
}

export function frameCount(tl: Timeline, fps: number): number {
  return Math.max(1, Math.round(tl.duration * fps));
}
