import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionDuration, typedCount } from '../src/actions.js';
import { parseConfig } from '../src/config.js';

const typeAction = (value: string, extra: Record<string, unknown> = {}) =>
  parseConfig({ url: 'https://example.com', actions: [{ type: 'type', selector: '#q', value, ...extra }] }).actions[0];

test('typing: one character every 1/speed seconds, the first one right away', () => {
  assert.equal(typedCount('Hallo', 10, -0.01), 0);
  assert.equal(typedCount('Hallo', 10, 0), 1);
  assert.equal(typedCount('Hallo', 10, 0.25), 3);
  assert.equal(typedCount('Hallo', 10, 0.4), 5);
  assert.equal(typedCount('Hallo', 10, 60), 5);
});

test('typing counts characters, not UTF-16 units (emoji, umlauts)', () => {
  assert.equal(typedCount('a😀ü', 10, 60), 3);
  assert.equal(typedCount('a😀ü', 10, 0.1), 2);
});

test('a type action takes longer the longer the text, then holds for its duration', () => {
  const short = actionDuration(typeAction('01234', { typingSpeed: 5, duration: 1 }));
  const long = actionDuration(typeAction('0123456789', { typingSpeed: 5, duration: 1 }));
  const held = actionDuration(typeAction('01234', { typingSpeed: 5, duration: 3 }));
  assert.ok(Math.abs(long - short - 1) < 1e-9, `${long} vs ${short}`);
  assert.ok(Math.abs(held - short - 2) < 1e-9, `${held} vs ${short}`);
});
