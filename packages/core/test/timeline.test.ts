import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, frameCount, normalizeStops, scrollAt } from '../src/timeline.js';
import { parseConfig, resolveOutputSize, ConfigError } from '../src/config.js';
import { encoderArgs } from '../src/ffmpeg.js';

const base = {
  maxScroll: 3000, mode: 'continuous' as const, speed: 600, easing: 'linear' as const, pauseDuration: 1,
  minSegmentDuration: 0.5, introDuration: 2, outroDuration: 1, maxDuration: 120,
};

test('continuous: intro hold, linear scroll, outro hold', () => {
  const tl = buildTimeline(base);
  assert.equal(tl.duration, 2 + 5 + 1);
  assert.equal(scrollAt(tl, 1), 0);
  assert.equal(scrollAt(tl, 2 + 2.5), 1500);
  assert.equal(scrollAt(tl, 7.5), 3000);
  assert.equal(scrollAt(tl, 100), 3000);
  assert.equal(frameCount(tl, 60), 480);
});

test('duration overrides speed', () => {
  const tl = buildTimeline({ ...base, duration: 10, introDuration: 0, outroDuration: 0 });
  assert.equal(tl.duration, 10);
});

test('maxDuration compresses the scroll part, keeps intro/outro', () => {
  const tl = buildTimeline({ ...base, speed: 10, maxDuration: 13 });
  assert.ok(Math.abs(tl.duration - 13) < 1e-9);
  assert.ok(tl.compressedBy! < 1);
  assert.equal(tl.segments[0].duration, 2);
});

test('sections: stops with pauses, ends at bottom', () => {
  const tl = buildTimeline({ ...base, mode: 'sections', stops: [0, 1000, 2000, 2950], minStopDistance: 300, introDuration: 0, outroDuration: 0 });
  const moves = tl.segments.filter((s) => s.kind === 'move');
  assert.deepEqual(moves.map((m) => (m as any).to), [1000, 2000, 3000]);
  assert.equal(tl.segments.filter((s) => s.kind === 'hold').length, 2);
});

test('normalizeStops dedupes, clamps and keeps 0', () => {
  assert.deepEqual(normalizeStops([50, 900, 950, 5000], 2000, 300), [0, 900, 2000]);
  assert.deepEqual(normalizeStops([], 100, 300), [0, 100]);
});

test('scroll is monotonic for every easing', async () => {
  const { EASING_NAMES } = await import('../src/easing.js');
  for (const easing of EASING_NAMES) {
    const tl = buildTimeline({ ...base, easing });
    let prev = -1;
    for (let i = 0; i <= frameCount(tl, 60); i++) {
      const y = scrollAt(tl, i / 60);
      assert.ok(y >= prev - 1e-9, `${easing} not monotonic`);
      prev = y;
    }
  }
});

test('config defaults, presets and even output size', () => {
  const c = parseConfig({ url: 'https://example.com', viewport: 'mobile' });
  assert.equal(c.fps, 60);
  assert.equal(c.deviceScaleFactor, 2);
  assert.deepEqual(resolveOutputSize(c), { width: 780, height: 1688 });
  const d = parseConfig({ url: 'https://example.com', viewport: { width: 1281, height: 721 } });
  assert.deepEqual(resolveOutputSize(d), { width: 1282, height: 722 });
  assert.throws(() => parseConfig({ url: 'nope' }), ConfigError);
  assert.throws(() => parseConfig({ url: 'https://x.de', scrollDriver: 'custom' }), ConfigError);
});

test('encoder args: H.264 yuv420p faststart', () => {
  const a = encoderArgs({ output: 'o.mp4', fps: 60, width: 1920, height: 1080, format: 'mp4', inputCodec: 'jpeg', crf: 16, preset: 'slow' });
  assert.ok(a.includes('libx264') && a.includes('yuv420p') && a.includes('+faststart'));
});
