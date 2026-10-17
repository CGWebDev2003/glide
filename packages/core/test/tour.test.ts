import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopFor, type Rect } from '../src/actions.js';
import { ConfigError, parseConfig } from '../src/config.js';
import { estimateStep, tourMoveDuration } from '../src/tour.js';

const tour = (actions: unknown[], extra: Record<string, unknown> = {}) =>
  parseConfig({ url: 'https://example.com', kind: 'tour', actions, ...extra });

test('tour steps parse with their own fields', () => {
  const c = tour([
    { type: 'click', selector: '#open' },
    { type: 'scroll', to: 'bottom' },
    { type: 'scroll', selector: '#preise' },
    { type: 'wait', duration: 2 },
    { type: 'goto', url: '/kontakt' },
    { type: 'press', key: 'Escape' },
  ]);
  assert.equal(c.kind, 'tour');
  assert.deepEqual(c.actions.map((a) => a.type), ['click', 'scroll', 'scroll', 'wait', 'goto', 'press']);
});

test('scroll videos are the default and refuse tour-only steps', () => {
  assert.equal(parseConfig({ url: 'https://example.com' }).kind, 'scroll');
  assert.throws(() => parseConfig({ url: 'https://example.com', actions: [{ type: 'wait' }] }), ConfigError);
});

test('each step type needs its target', () => {
  for (const bad of [{ type: 'click' }, { type: 'scroll' }, { type: 'goto' }, { type: 'press' }, { type: 'type', selector: '#q' }]) {
    assert.throws(() => tour([bad]), ConfigError, JSON.stringify(bad));
  }
});

test('tour scrolling: none for no distance, at least minSegmentDuration, else distance / speed', () => {
  const c = tour([], { scroll: { speed: 1000, minSegmentDuration: 0.5 } });
  assert.equal(tourMoveDuration(c, 0), 0);
  assert.equal(tourMoveDuration(c, 100), 0.5);
  assert.equal(tourMoveDuration(c, -3000), 3);
  assert.equal(estimateStep(c, tour([{ type: 'wait', duration: 2 }]).actions[0]), 2);
});

test('an element already in view needs no scrolling, one out of view gets centred', () => {
  const r = (docY: number, height = 100): Rect => ({ x: 0, y: 0, width: 100, height, docY, vw: 1280, vh: 800, fixed: false });
  assert.equal(stopFor(r(300), 0, 5000), 0);
  assert.equal(stopFor(r(2000), 0, 5000), 2000 + 50 - 400);
  assert.equal(stopFor(r(4900), 0, 5000), 4550);
  assert.equal(stopFor(r(100), undefined, 5000), 0);
});
