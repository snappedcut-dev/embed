import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backoffMs, frameUrl, isFrameMessage, newFrameId, DEFAULT_ORIGIN, EmbedError,
} from '../dist/protocol.js';

const FRAME = {};
const expected = { origin: 'https://snappedcut.com', window: FRAME, frameId: 'abc123' };
const good = { source: 'snappedcut', v: 1, frameId: 'abc123', type: 'ready' };
const event = (over = {}) => ({ origin: expected.origin, source: FRAME, data: good, ...over });

test('a well-formed message from the right frame is accepted', () => {
  assert.equal(isFrameMessage(event(), expected), true);
});

test('a message from another origin is rejected', () => {
  assert.equal(isFrameMessage(event({ origin: 'https://evil.example' }), expected), false);
});

test('a message from another window on the same origin is rejected', () => {
  // Origin alone is not enough: a second iframe or an unexpected popup shares it.
  assert.equal(isFrameMessage(event({ source: {} }), expected), false);
});

test('a message carrying another embed frameId is rejected', () => {
  // Two embeds on one page share the origin and the parent. This keeps them apart.
  assert.equal(isFrameMessage(event({ data: { ...good, frameId: 'other' } }), expected), false);
});

test('a message without our source marker is rejected', () => {
  assert.equal(isFrameMessage(event({ data: { ...good, source: 'something-else' } }), expected), false);
  assert.equal(isFrameMessage(event({ data: null }), expected), false);
  assert.equal(isFrameMessage(event({ data: 'ready' }), expected), false);
});

test('an unknown event type is rejected rather than forwarded', () => {
  assert.equal(isFrameMessage(event({ data: { ...good, type: 'eval' } }), expected), false);
});

test('the frame URL carries the key in the query and the token in the hash', () => {
  const url = frameUrl({ publishableKey: 'pk_live_1', token: 'tok 1', frameId: 'f1' });
  const parsed = new URL(url);
  assert.equal(parsed.origin, DEFAULT_ORIGIN);
  assert.equal(parsed.pathname, '/embed');
  assert.equal(parsed.searchParams.get('key'), 'pk_live_1');
  assert.equal(parsed.searchParams.get('frame'), 'f1');
  // A hash is not sent to the server, so the token stays out of access logs.
  assert.equal(parsed.hash, '#t=tok%201');
  assert.ok(!parsed.search.includes('tok'));
});

test('a trailing slash on a custom origin does not double up', () => {
  const url = frameUrl({ origin: 'http://localhost:3000/', frameId: 'f1' });
  assert.ok(url.startsWith('http://localhost:3000/embed?'));
});

test('frame ids differ between embeds', () => {
  assert.notEqual(newFrameId(), newFrameId());
});

test('the token backoff climbs and then caps at 30s', () => {
  assert.deepEqual([0, 1, 2, 3].map(backoffMs), [1000, 2000, 4000, 8000]);
  assert.equal(backoffMs(99), 30_000);
  assert.equal(backoffMs(-5), 1000);
});

test('EmbedError keeps its code for branching', () => {
  const e = new EmbedError('token_expired', 'gone');
  assert.equal(e.code, 'token_expired');
  assert.ok(e instanceof Error);
});

test('features travel in the query, and the token stays in the hash', () => {
  const url = new URL(frameUrl({ frameId: 'f1', publishableKey: 'pk_test_x', token: 'tok', features: { formats: ['mp4'], stock: false } }));
  assert.deepEqual(JSON.parse(url.searchParams.get('features')), { formats: ['mp4'], stock: false });
  assert.equal(url.searchParams.get('t'), null);
  assert.equal(url.hash, '#t=tok');
});
