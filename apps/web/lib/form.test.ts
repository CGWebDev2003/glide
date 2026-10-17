import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, fromConfig, toConfig, type FormAction } from './form';

const action = (a: Partial<FormAction>): FormAction => ({ type: 'hover', selector: '', text: '', value: '', duration: 1.5, extra: {}, ...a });
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

test('type actions survive a round trip through the JSON, typingSpeed included', () => {
  const raw = { url: 'https://kunde.de', actions: [{ type: 'type', selector: '#q', value: 'Hallo', typingSpeed: 8, duration: 2 }] };
  const f = fromConfig(raw);
  assert.equal(f.actions[0].type, 'type');
  assert.equal(f.actions[0].value, 'Hallo');
  assert.deepEqual(toConfig(f).actions, raw.actions);
});
