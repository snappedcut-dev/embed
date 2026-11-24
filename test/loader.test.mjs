import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configFromScript } from '../dist/loader.js';

/** The two methods configFromScript actually uses, over a plain attribute map. */
const script = (attrs) => ({
  getAttribute: (name) => (name in attrs ? attrs[name] : null),
  hasAttribute: (name) => name in attrs,
  setAttribute: () => {},
});

test('data-key and data-target become the key and the target', () => {
  const { target, config } = configFromScript(
    script({ 'data-key': 'pk_live_1', 'data-target': '#editor' }),
  );
  assert.equal(target, '#editor');
  assert.equal(config.publishableKey, 'pk_live_1');
});

test('data-config is merged, and the named attributes win over it', () => {
  const { config } = configFromScript(
    script({
      'data-key': 'pk_live_real',
      'data-target': '#e',
      'data-config': '{"locale":"fr","publishableKey":"pk_live_stale","theme":{"mode":"light"}}',
    }),
  );
  assert.equal(config.publishableKey, 'pk_live_real');
  assert.equal(config.locale, 'fr');
  assert.deepEqual(config.theme, { mode: 'light' });
});

test('a malformed data-config does not take the mount down with it', () => {
  const { config } = configFromScript(
    script({ 'data-key': 'pk_live_1', 'data-target': '#e', 'data-config': '{not json' }),
  );
  assert.equal(config.publishableKey, 'pk_live_1');
});

test('absent attributes are absent, not undefined-valued', () => {
  const { config } = configFromScript(script({ 'data-key': 'pk_live_1', 'data-target': '#e' }));
  assert.ok(!('token' in config));
  assert.ok(!('locale' in config));
});

test('a script with no data-target yields a null target', () => {
  assert.equal(configFromScript(script({ 'data-key': 'pk_live_1' })).target, null);
});
