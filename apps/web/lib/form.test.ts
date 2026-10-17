import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, fromConfig, newAction, setActionType, toConfig, type FormAction } from './form';

const action = (a: Partial<FormAction>): FormAction => newAction(a.type ?? 'hover', { duration: 1.5, ...a });
const form = (actions: FormAction[]) => ({ ...DEFAULT_FORM, url: 'https://kunde.de', actions });

test('type actions carry their text into the config, other actions do not', () => {
  const c = toConfig(form([
    action({ type: 'type', selector: '#q', value: 'Hallo Welt' }),
    action({ type: 'click', selector: '.btn', value: 'left over from a type action' }),
  ]));
  assert.deepEqual(c.actions, [
    { type: 'type', selector: '#q', value: 'Hallo Welt', duration: 1.5 },
    { type: 'click', selector: '.btn', duration: 1.5 },
  ]);
});

test('type actions without a text are left out, like actions without a selector', () => {
  const c = toConfig(form([action({ type: 'type', selector: '#q', value: '' })]));
  assert.equal(c.actions, undefined);
});

test('switching an action to "Text" drops its text filter, which the form no longer shows', () => {
  // the filter compares the element's text, which is empty for an <input>: it would never match
  const a = setActionType(action({ type: 'click', selector: '#newsletter', text: 'max@kunde.de' }), 'type');
  const c = toConfig(form([{ ...a, value: 'max@kunde.de' }]));
  assert.deepEqual(c.actions, [{ type: 'type', selector: '#newsletter', value: 'max@kunde.de', duration: 1.5 }]);
});

test('type actions survive a round trip through the JSON, typingSpeed included', () => {
  const raw = { url: 'https://kunde.de', actions: [{ type: 'type', selector: '#q', value: 'Hallo', typingSpeed: 8, duration: 2 }] };
  const f = fromConfig(raw);
  assert.equal(f.actions[0].type, 'type');
  assert.equal(f.actions[0].value, 'Hallo');
  assert.deepEqual(toConfig(f).actions, raw.actions);
});

test('tours: kind and every step type go into the config, in the given order', () => {
  const c = toConfig({
    ...form([
      action({ type: 'click', selector: '#open' }),
      action({ type: 'scroll', to: 'bottom', duration: 1 }),
      action({ type: 'scroll', selector: '#preise', to: 'top' }),
      action({ type: 'wait', duration: 2 }),
      action({ type: 'goto', url: '/kontakt', duration: 1 }),
      action({ type: 'press', key: 'Escape' }),
      action({ type: 'goto', url: ' ' }),
    ]),
    kind: 'tour',
  });
  assert.equal(c.kind, 'tour');
  assert.deepEqual(c.actions, [
    { type: 'click', selector: '#open', duration: 1.5 },
    { type: 'scroll', to: 'bottom', duration: 1 },
    { type: 'scroll', selector: '#preise', duration: 1.5 },
    { type: 'wait', duration: 2 },
    { type: 'goto', url: '/kontakt', duration: 1 },
    { type: 'press', key: 'Escape', duration: 1.5 },
  ]);
  assert.equal((c.scroll as Record<string, unknown>).mode, undefined);
});

test('a scroll video leaves out tour-only steps (they stay in the form)', () => {
  const f = form([action({ type: 'click', selector: '#a' }), action({ type: 'wait', duration: 1 })]);
  assert.deepEqual(toConfig(f).actions, [{ type: 'click', selector: '#a', duration: 1.5 }]);
  assert.equal(toConfig(f).kind, undefined);
});

test('tours survive a round trip through the JSON, a scroll position in px included', () => {
  const raw = {
    url: 'https://kunde.de',
    kind: 'tour',
    actions: [{ type: 'scroll', to: 1200, duration: 1 }, { type: 'goto', url: 'https://kunde.de/team', duration: 2 }, { type: 'press', key: 'Enter', duration: 1 }],
  };
  const f = fromConfig(raw);
  assert.equal(f.kind, 'tour');
  assert.deepEqual(toConfig(f).actions, raw.actions);
});
